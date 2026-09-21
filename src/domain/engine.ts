/**
 * 异常放行台 —— 纯函数状态计算引擎。
 * 所有动作均为 (state, ...args) => EngineResult，不触碰任何外部 IO，
 * 时间戳由调用方注入，便于测试与持久化重放。
 */
import {
  ExceptionRecord,
  KIND_META,
  PH_MAX,
  PH_MIN,
  PH_PASSES_REQUIRED,
  ProcessParams,
  StationState,
  TEMP_DEVIATION_LIMIT,
  TEMP_DEVIATION_MINUTES,
  TimelineType,
} from "./types";

export interface EngineResult {
  state: StationState;
  message: string;
}

export interface Reading {
  temp?: number | null;
  ph?: number | null;
  foam?: number | null;
}

// ---------- 内部工具 ----------

function fail(message: string): never {
  throw new Error(message);
}

function getBatch(state: StationState, batchId: string) {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) fail(`批次 ${batchId} 不存在`);
  return batch;
}

function getException(state: StationState, exceptionId: string) {
  const record = state.exceptions.find((e) => e.id === exceptionId);
  if (!record) fail(`待处置记录 ${exceptionId} 不存在`);
  return record;
}

function pushEvent(
  state: StationState,
  batchId: string,
  type: TimelineType,
  text: string,
  at: number
): StationState {
  const id = `T-${state.counters.event + 1}`;
  return {
    ...state,
    timeline: [...state.timeline, { id, batchId, type, text, at }],
    counters: { ...state.counters, event: state.counters.event + 1 },
  };
}

function patchBatch(state: StationState, batchId: string, patch: Partial<StationState["batches"][number]>): StationState {
  return {
    ...state,
    batches: state.batches.map((b) => (b.id === batchId ? { ...b, ...patch } : b)),
  };
}

function patchException(
  state: StationState,
  exceptionId: string,
  patch: Partial<ExceptionRecord>
): StationState {
  return {
    ...state,
    exceptions: state.exceptions.map((e) => (e.id === exceptionId ? { ...e, ...patch } : e)),
  };
}

/** 生成一条待处置记录；若批次已有评审结论则同时作废 */
function createException(
  state: StationState,
  batchId: string,
  kind: ExceptionRecord["kind"],
  title: string,
  measured: string,
  at: number
): { state: StationState; record: ExceptionRecord } {
  const seq = state.counters.seq + 1;
  const record: ExceptionRecord = {
    id: `EX-${state.counters.exception + 1}`,
    batchId,
    kind,
    seq,
    status: "open",
    title,
    measured,
    occurredAt: at,
    urgent: false,
    phPasses: 0,
    defoamed: false,
  };
  let next: StationState = {
    ...state,
    exceptions: [...state.exceptions, record],
    counters: { ...state.counters, exception: state.counters.exception + 1, seq },
  };
  next = pushEvent(next, batchId, "exception", `生成待处置 ${record.id}（${KIND_META[kind].label}）：${title}`, at);
  const batch = getBatch(next, batchId);
  if (batch.review !== "pending") {
    next = patchBatch(next, batchId, { review: "pending" });
    next = pushEvent(next, batchId, "review", `新异常 ${record.id} 触发，原评审结论作废，批次回到待评审`, at);
  }
  return { state: next, record };
}

/** 同批次同类异常是否已有未闭环记录（避免重复生成） */
function hasOpenOfKind(state: StationState, batchId: string, kind: ExceptionRecord["kind"]): boolean {
  return state.exceptions.some((e) => e.batchId === batchId && e.kind === kind && e.status === "open");
}

/** 校验记录存在、未闭环、且位于处置队列队首 */
function assertActionable(state: StationState, exceptionId: string): ExceptionRecord {
  const record = getException(state, exceptionId);
  if (record.status !== "open") fail(`${record.id} 已不在待处置队列`);
  const head = getActionable(state);
  if (!head || head.id !== exceptionId) {
    fail(`${record.id} 前面还有未闭环异常，须按发生顺序解除`);
  }
  return record;
}

// ---------- 批次登记 ----------

export function addBatch(
  state: StationState,
  batch: Omit<StationState["batches"][number], "paramVersion" | "review" | "tempRun">,
  at: number
): EngineResult {
  if (state.batches.some((b) => b.id === batch.id)) fail(`批次号 ${batch.id} 已存在`);
  const next = pushEvent(
    { ...state, batches: [...state.batches, { ...batch, paramVersion: 1, review: "pending", tempRun: { minutes: 0, maxDev: 0 } }] },
    batch.id,
    "batch",
    `批次登记：${batch.fabric} ${batch.gramWeight}g/m²，订单 ${batch.orderNo}，目标 ${batch.params.targetTemp}℃ 保温 ${batch.params.holdMinutes}min`,
    at
  );
  return { state: next, message: `批次 ${batch.id} 已登记` };
}

// ---------- 监测读数 → 异常触发 ----------

export function ingestReading(state: StationState, batchId: string, reading: Reading, at: number): EngineResult {
  const batch = getBatch(state, batchId);
  let next = state;
  const created: string[] = [];
  const notes: string[] = [];

  if (reading.temp != null && Number.isFinite(reading.temp)) {
    const dev = reading.temp - batch.params.targetTemp;
    const absDev = Math.abs(dev);
    if (absDev >= TEMP_DEVIATION_LIMIT) {
      const minutes = batch.tempRun.minutes + 1;
      const maxDev = Math.max(batch.tempRun.maxDev, absDev);
      next = patchBatch(next, batchId, { tempRun: { minutes, maxDev } });
      notes.push(`温度连续偏离 ${minutes}/${TEMP_DEVIATION_MINUTES} 分钟`);
      if (minutes >= TEMP_DEVIATION_MINUTES && !hasOpenOfKind(next, batchId, "temperature")) {
        const r = createException(
          next,
          batchId,
          "temperature",
          `温度连续${TEMP_DEVIATION_MINUTES}分钟偏离目标（最大 ${dev > 0 ? "+" : "−"}${maxDev.toFixed(1)}℃）`,
          `实测 ${reading.temp.toFixed(1)}℃ / 目标 ${batch.params.targetTemp}℃`,
          at
        );
        next = r.state;
        created.push(r.record.id);
      }
    } else if (batch.tempRun.minutes > 0) {
      next = patchBatch(next, batchId, { tempRun: { minutes: 0, maxDev: 0 } });
      notes.push("温度回到受控区间，连续偏离清零");
    }
  }

  if (reading.ph != null && Number.isFinite(reading.ph)) {
    if ((reading.ph < PH_MIN || reading.ph > PH_MAX) && !hasOpenOfKind(next, batchId, "ph")) {
      const r = createException(
        next,
        batchId,
        "ph",
        `酸碱值 ${reading.ph.toFixed(2)} 超出 ${PH_MIN}–${PH_MAX}`,
        `实测 pH ${reading.ph.toFixed(2)}`,
        at
      );
      next = r.state;
      created.push(r.record.id);
    }
  }

  if (reading.foam != null && Number.isFinite(reading.foam)) {
    if (reading.foam > batch.foamLimit && !hasOpenOfKind(next, batchId, "foam")) {
      const r = createException(
        next,
        batchId,
        "foam",
        `泡沫高度 ${reading.foam}mm 超过限值 ${batch.foamLimit}mm`,
        `实测 ${reading.foam}mm / 限值 ${batch.foamLimit}mm`,
        at
      );
      next = r.state;
      created.push(r.record.id);
    }
  }

  if (created.length === 0 && notes.length === 0) {
    return { state: next, message: "读数已记录，未触发异常" };
  }
  const message = created.length > 0 ? `生成待处置记录：${created.join("、")}` : notes.join("；");
  return { state: next, message };
}

// ---------- 处置队列与加急 ----------

/**
 * 全台处置队列：批次内严格按发生顺序排列；
 * 含加急项的批次整链提至队首，但加急项不能跳过本批次更早的未闭环异常。
 */
export function getQueue(state: StationState): ExceptionRecord[] {
  const byBatch = new Map<string, ExceptionRecord[]>();
  for (const e of state.exceptions) {
    if (e.status !== "open") continue;
    const list = byBatch.get(e.batchId) ?? [];
    list.push(e);
    byBatch.set(e.batchId, list);
  }
  const groups = [...byBatch.values()].map((list) => [...list].sort((a, b) => a.seq - b.seq));
  groups.sort((g1, g2) => {
    const u1 = g1.some((e) => e.urgent) ? 0 : 1;
    const u2 = g2.some((e) => e.urgent) ? 0 : 1;
    if (u1 !== u2) return u1 - u2;
    return g1[0].seq - g2[0].seq;
  });
  return groups.flat();
}

/** 当前唯一可处置的记录（队首） */
export function getActionable(state: StationState): ExceptionRecord | null {
  return getQueue(state)[0] ?? null;
}

export function setUrgent(state: StationState, exceptionId: string, urgent: boolean, at: number): EngineResult {
  const record = getException(state, exceptionId);
  if (record.status !== "open") fail(`${record.id} 已闭环，不能加急`);
  if (record.urgent === urgent) fail(urgent ? `${record.id} 已是加急状态` : `${record.id} 未加急`);
  let next = patchException(state, exceptionId, { urgent });
  const earlierOpen = state.exceptions.filter(
    (e) => e.batchId === record.batchId && e.status === "open" && e.seq < record.seq
  );
  const text = urgent
    ? earlierOpen.length > 0
      ? `${record.id} 标记加急：本批次处置链提至队首，仍需先闭环更早异常 ${earlierOpen.map((e) => e.id).join("、")}`
      : `${record.id} 标记加急，已插队至处置队首`
    : `${record.id} 取消加急`;
  next = pushEvent(next, record.batchId, "urgent", text, at);
  return { state: next, message: text };
}

// ---------- 解除动作 ----------

function closeException(
  state: StationState,
  record: ExceptionRecord,
  note: string,
  at: number
): StationState {
  const batch = getBatch(state, record.batchId);
  let next = patchException(state, record.id, {
    status: "cleared",
    clearedAt: at,
    clearedNote: note,
    clearedParamVersion: batch.paramVersion,
  });
  next = pushEvent(next, record.batchId, "cleared", `${record.id} 解除：${note}（依据参数版本 v${batch.paramVersion}）`, at);
  return next;
}

/** 补时：仅适用于温度项；解除后温度视为回归受控，连续偏离追踪清零 */
export function supplementTime(state: StationState, exceptionId: string, minutes: number, at: number): EngineResult {
  const record = assertActionable(state, exceptionId);
  if (record.kind !== "temperature") fail("补时只解温度项，酸碱/泡沫项须按各自流程复测");
  if (!Number.isFinite(minutes) || minutes <= 0) fail("补时分钟数须为正数");
  let next = pushEvent(state, record.batchId, "supplement", `${record.id} 补时 ${minutes} 分钟`, at);
  next = patchBatch(next, record.batchId, { tempRun: { minutes: 0, maxDev: 0 } });
  const note = `补时 ${minutes} 分钟，温度曲线回归受控`;
  next = closeException(next, record, note, at);
  return { state: next, message: `${record.id} 已解除（${note}）` };
}

/** 酸碱项复测：须连续两次合格 */
export function phRetest(state: StationState, exceptionId: string, value: number, at: number): EngineResult {
  const record = assertActionable(state, exceptionId);
  if (record.kind !== "ph") fail("该记录不是酸碱项");
  if (!Number.isFinite(value)) fail("请填写有效的 pH 复测值");
  const pass = value >= PH_MIN && value <= PH_MAX;
  let next: StationState;
  if (!pass) {
    next = patchException(state, exceptionId, { phPasses: 0 });
    next = pushEvent(
      next,
      record.batchId,
      "retest",
      `${record.id} 复测 pH ${value.toFixed(2)} 不合格（窗口 ${PH_MIN}–${PH_MAX}），合格计数清零`,
      at
    );
    return { state: next, message: `复测不合格，${record.id} 合格计数已清零` };
  }
  const passes = record.phPasses + 1;
  if (passes < PH_PASSES_REQUIRED) {
    next = patchException(state, exceptionId, { phPasses: passes });
    next = pushEvent(
      next,
      record.batchId,
      "retest",
      `${record.id} 第 ${passes}/${PH_PASSES_REQUIRED} 次复测 pH ${value.toFixed(2)} 合格`,
      at
    );
    return { state: next, message: `第 ${passes} 次复测合格，还需 ${PH_PASSES_REQUIRED - passes} 次` };
  }
  next = patchException(state, exceptionId, { phPasses: passes });
  next = pushEvent(next, record.batchId, "retest", `${record.id} 第 ${passes}/${PH_PASSES_REQUIRED} 次复测 pH ${value.toFixed(2)} 合格`, at);
  const note = `两次复测合格，末次 pH ${value.toFixed(2)}`;
  next = closeException(next, { ...record, phPasses: passes }, note, at);
  return { state: next, message: `${record.id} 已解除（${note}）` };
}

/** 泡沫项：先排泡 */
export function defoam(state: StationState, exceptionId: string, at: number): EngineResult {
  const record = assertActionable(state, exceptionId);
  if (record.kind !== "foam") fail("该记录不是泡沫项");
  if (record.defoamed) fail(`${record.id} 已排泡，请直接复测`);
  const next = pushEvent(patchException(state, exceptionId, { defoamed: true }), record.batchId, "defoam", `${record.id} 已排泡，待复测`, at);
  return { state: next, message: `${record.id} 已排泡，请复测泡沫高度` };
}

/** 泡沫项：排泡后复测 */
export function foamRetest(state: StationState, exceptionId: string, value: number, at: number): EngineResult {
  const record = assertActionable(state, exceptionId);
  if (record.kind !== "foam") fail("该记录不是泡沫项");
  if (!record.defoamed) fail("泡沫项须先排泡再复测");
  if (!Number.isFinite(value)) fail("请填写有效的泡沫复测值");
  const batch = getBatch(state, record.batchId);
  if (value > batch.foamLimit) {
    let next = patchException(state, exceptionId, { defoamed: false });
    next = pushEvent(
      next,
      record.batchId,
      "retest",
      `${record.id} 复测 ${value}mm 仍超限（限值 ${batch.foamLimit}mm），须重新排泡`,
      at
    );
    return { state: next, message: `复测仍超限，${record.id} 须重新排泡` };
  }
  let next = pushEvent(state, record.batchId, "retest", `${record.id} 排泡后复测 ${value}mm ≤ 限值 ${batch.foamLimit}mm`, at);
  const note = `排泡后复测合格（${value}mm ≤ ${batch.foamLimit}mm）`;
  next = closeException(next, record, note, at);
  return { state: next, message: `${record.id} 已解除（${note}）` };
}

// ---------- 参数变更 → 结论失效 ----------

/**
 * 修改工艺参数：参数版本 +1。
 * 依据旧版本参数得出的解除结论（本项及其后全部）失效并留档，
 * 同时按原异常类型重新生成待处置记录，回到队列末尾。
 */
export function editParams(state: StationState, batchId: string, params: ProcessParams, at: number): EngineResult {
  const batch = getBatch(state, batchId);
  if (!Number.isFinite(params.targetTemp) || params.targetTemp <= 0) fail("目标温度须为正数");
  if (!Number.isFinite(params.holdMinutes) || params.holdMinutes <= 0) fail("保温时间须为正数");
  if (!params.liquorRatio.trim()) fail("浴比不能为空");
  if (!params.dyeRecipe.trim()) fail("染料配方不能为空");
  const nextVersion = batch.paramVersion + 1;
  let next = patchBatch(state, batchId, {
    params,
    paramVersion: nextVersion,
    tempRun: { minutes: 0, maxDev: 0 },
  });
  next = pushEvent(
    next,
    batchId,
    "param",
    `工艺参数变更 v${batch.paramVersion}→v${nextVersion}：目标 ${params.targetTemp}℃ / 保温 ${params.holdMinutes}min / 浴比 ${params.liquorRatio} / 配方 ${params.dyeRecipe}`,
    at
  );

  if (batch.review !== "pending") {
    next = patchBatch(next, batchId, { review: "pending" });
    next = pushEvent(next, batchId, "review", "参数变更，原评审结论作废，批次回到待评审", at);
  }

  const stale = next.exceptions
    .filter((e) => e.batchId === batchId && e.status === "cleared" && (e.clearedParamVersion ?? 0) < nextVersion)
    .sort((a, b) => a.seq - b.seq);

  for (const record of stale) {
    const reason = `工艺参数变更（v${record.clearedParamVersion}→v${nextVersion}），解除结论失效`;
    next = patchException(next, record.id, {
      status: "invalidated",
      invalidatedAt: at,
      invalidateReason: reason,
    });
    next = pushEvent(next, batchId, "invalidated", `${record.id} ${reason}，旧履历留档`, at);
    const regenerated = createException(
      next,
      batchId,
      record.kind,
      `（参数变更重新生成，原 ${record.id}）${record.title}`,
      record.measured,
      at
    );
    next = regenerated.state;
  }

  const message =
    stale.length > 0
      ? `参数已变更至 v${nextVersion}，${stale.length} 项解除结论失效留档并重新生成待处置`
      : `参数已变更至 v${nextVersion}，无受影响结论`;
  return { state: next, message };
}

// ---------- 评审 ----------

export function canReview(state: StationState, batchId: string): { ok: boolean; reason: string } {
  const open = state.exceptions.filter((e) => e.batchId === batchId && e.status === "open");
  if (open.length > 0) {
    return { ok: false, reason: `${open.length} 项待处置异常未闭环（${open.map((e) => e.id).join("、")}）` };
  }
  return { ok: true, reason: "" };
}

export function reviewBatch(state: StationState, batchId: string, pass: boolean, at: number): EngineResult {
  const batch = getBatch(state, batchId);
  const gate = canReview(state, batchId);
  if (!gate.ok) fail(`批次不得评审：${gate.reason}`);
  if (batch.review !== "pending") fail("该批次已有评审结论");
  const review = pass ? "passed" : "failed";
  let next = patchBatch(state, batchId, { review });
  next = pushEvent(next, batchId, "review", `批次评审${pass ? "通过" : "不通过"}`, at);
  return { state: next, message: `${batchId} 评审${pass ? "通过" : "不通过"}` };
}

// ---------- 查询 ----------

export function getArchived(state: StationState, batchId?: string): ExceptionRecord[] {
  return state.exceptions
    .filter((e) => e.status === "invalidated" && (!batchId || e.batchId === batchId))
    .sort((a, b) => (b.invalidatedAt ?? 0) - (a.invalidatedAt ?? 0));
}

export function getTimeline(state: StationState, batchId?: string): StationState["timeline"] {
  return state.timeline
    .filter((t) => !batchId || t.batchId === batchId)
    .slice()
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id, undefined, { numeric: true }));
}
