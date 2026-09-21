import { useState } from "react";
import { getQueue } from "../domain/engine";
import { ExceptionRecord, KIND_META, PH_MAX, PH_MIN, PH_PASSES_REQUIRED, StationState } from "../domain/types";
import { fmtTime } from "./format";

interface HeadActionsProps {
  record: ExceptionRecord;
  foamLimit: number;
  onSupplement(minutes: number): void;
  onPhRetest(value: number): void;
  onDefoam(): void;
  onFoamRetest(value: number): void;
}

/** 队首处置面板：按异常类型给出对应解除流程 */
function HeadActions({ record, foamLimit, onSupplement, onPhRetest, onDefoam, onFoamRetest }: HeadActionsProps) {
  const [minutes, setMinutes] = useState("5");
  const [phValue, setPhValue] = useState("");
  const [foamValue, setFoamValue] = useState("");

  if (record.kind === "temperature") {
    return (
      <div className="head-actions">
        <p className="hint">温度项：补时后解除（补时只解温度项）。</p>
        <label>
          <span>补时分钟数</span>
          <input type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <button className="primary" onClick={() => onSupplement(Number(minutes))}>补时解除</button>
      </div>
    );
  }

  if (record.kind === "ph") {
    return (
      <div className="head-actions">
        <p className="hint">
          酸碱项：须连续 {PH_PASSES_REQUIRED} 次复测合格（窗口 {PH_MIN}–{PH_MAX}），当前合格 {record.phPasses}/{PH_PASSES_REQUIRED}。
        </p>
        <div className="pass-dots">
          {Array.from({ length: PH_PASSES_REQUIRED }, (_, i) => (
            <span key={i} className={i < record.phPasses ? "dot on" : "dot"} />
          ))}
        </div>
        <label>
          <span>pH 复测值</span>
          <input type="number" step="0.01" value={phValue} onChange={(e) => setPhValue(e.target.value)} placeholder="如 6.5" />
        </label>
        <button className="primary" onClick={() => onPhRetest(Number(phValue))}>提交复测</button>
      </div>
    );
  }

  return (
    <div className="head-actions">
      <p className="hint">泡沫项：须先排泡再复测（限值 {foamLimit}mm），复测超限须重新排泡。</p>
      {record.defoamed ? (
        <>
          <label>
            <span>排泡后泡沫高度 mm</span>
            <input type="number" value={foamValue} onChange={(e) => setFoamValue(e.target.value)} placeholder={`≤ ${foamLimit}`} />
          </label>
          <button className="primary" onClick={() => onFoamRetest(Number(foamValue))}>复测解除</button>
        </>
      ) : (
        <button className="primary" onClick={onDefoam}>排泡</button>
      )}
    </div>
  );
}

interface QueuePanelProps {
  state: StationState;
  onSupplement(id: string, minutes: number): void;
  onPhRetest(id: string, value: number): void;
  onDefoam(id: string): void;
  onFoamRetest(id: string, value: number): void;
  onToggleUrgent(id: string, urgent: boolean): void;
}

export function QueuePanel({ state, onSupplement, onPhRetest, onDefoam, onFoamRetest, onToggleUrgent }: QueuePanelProps) {
  const queue = getQueue(state);
  const head = queue[0] ?? null;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>按发生顺序解除 · 加急整链插队首</p>
          <h2>待处置队列（{queue.length}）</h2>
        </div>
      </div>
      {queue.length === 0 && <p className="empty">当前没有待处置异常，所有批次均可评审。</p>}
      <div className="queue">
        {queue.map((record, index) => {
          const isHead = head?.id === record.id;
          const batch = state.batches.find((b) => b.id === record.batchId);
          return (
            <article key={record.id} className={`queue-item${isHead ? " head" : ""}`}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div className="queue-body">
                <div className="batch-head">
                  <h3>
                    {record.id} · {KIND_META[record.kind].label}项
                  </h3>
                  {record.urgent && <span className="badge urgent">加急</span>}
                  <span className={`badge ${isHead ? "ok" : "neutral"}`}>{isHead ? "可处置" : `等待前 ${index} 项`}</span>
                </div>
                <p>{record.title}</p>
                <p>
                  批次 {record.batchId} · 发生 #{record.seq} · {fmtTime(record.occurredAt)} · {record.measured}
                </p>
                <div className="row-actions">
                  <button onClick={() => onToggleUrgent(record.id, !record.urgent)}>
                    {record.urgent ? "取消加急" : "加急"}
                  </button>
                </div>
                {isHead && batch && (
                  <HeadActions
                    key={record.id}
                    record={record}
                    foamLimit={batch.foamLimit}
                    onSupplement={(m) => onSupplement(record.id, m)}
                    onPhRetest={(v) => onPhRetest(record.id, v)}
                    onDefoam={() => onDefoam(record.id)}
                    onFoamRetest={(v) => onFoamRetest(record.id, v)}
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
