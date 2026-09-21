/**
 * 异常放行台 —— 领域类型与判定规则常量。
 * 本层只描述数据结构与阈值，不含任何状态转移逻辑（见 engine.ts）。
 */

/** 酸碱合格窗口：pH 超出 [4.5, 7.5] 即触发异常 */
export const PH_MIN = 4.5;
export const PH_MAX = 7.5;
/** 温度偏离阈值：实测与目标温差达到该值（℃）记为偏离 */
export const TEMP_DEVIATION_LIMIT = 2;
/** 温度需连续偏离的分钟数，达到后生成待处置记录 */
export const TEMP_DEVIATION_MINUTES = 3;
/** 酸碱项解除所需的连续复测合格次数 */
export const PH_PASSES_REQUIRED = 2;

export type ExceptionKind = "temperature" | "ph" | "foam";
export type ExceptionStatus = "open" | "cleared" | "invalidated";
export type ReviewStatus = "pending" | "passed" | "failed";

export const KIND_META: Record<ExceptionKind, { label: string; rule: string }> = {
  temperature: {
    label: "温度",
    rule: `连续${TEMP_DEVIATION_MINUTES}分钟偏离目标≥${TEMP_DEVIATION_LIMIT}℃`,
  },
  ph: { label: "酸碱", rule: `超出 ${PH_MIN}–${PH_MAX}` },
  foam: { label: "泡沫", rule: "超过批次限值" },
};

/** 批次工艺参数（修改任一字段都会提升 paramVersion 并使既有结论失效） */
export interface ProcessParams {
  targetTemp: number; // 目标温度 ℃
  holdMinutes: number; // 保温时间 min
  liquorRatio: string; // 浴比
  dyeRecipe: string; // 染料配方
}

export interface Batch {
  id: string;
  orderNo: string; // 客户订单号
  fabric: string; // 面料成分
  gramWeight: number; // 克重 g/m²
  foamLimit: number; // 泡沫高度限值 mm
  params: ProcessParams;
  paramVersion: number;
  review: ReviewStatus;
  /** 温度连续偏离追踪：minutes 为当前连续偏离分钟数，maxDev 为本段最大偏离 */
  tempRun: { minutes: number; maxDev: number };
}

export interface ExceptionRecord {
  id: string;
  batchId: string;
  kind: ExceptionKind;
  /** 全台统一的发生顺序号，解除顺序以此为准 */
  seq: number;
  status: ExceptionStatus;
  title: string;
  measured: string; // 触发时的实测描述
  occurredAt: number;
  urgent: boolean;
  /** 酸碱项：当前连续复测合格次数（不合格即清零） */
  phPasses: number;
  /** 泡沫项：上次复测不合格后是否已重新排泡 */
  defoamed: boolean;
  clearedAt?: number;
  clearedNote?: string;
  /** 解除时所依据的参数版本，参数变更后用于判定结论是否失效 */
  clearedParamVersion?: number;
  invalidatedAt?: number;
  invalidateReason?: string;
}

export type TimelineType =
  | "batch"
  | "reading"
  | "exception"
  | "urgent"
  | "supplement"
  | "retest"
  | "defoam"
  | "cleared"
  | "invalidated"
  | "param"
  | "review";

export interface TimelineEvent {
  id: string;
  batchId: string;
  at: number;
  type: TimelineType;
  text: string;
}

export interface StationState {
  batches: Batch[];
  exceptions: ExceptionRecord[];
  timeline: TimelineEvent[];
  counters: { exception: number; event: number; seq: number };
}
