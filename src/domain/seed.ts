/**
 * 演示数据：全部通过引擎动作构建，保证异常、时间线、队列互相一致。
 * 动作按时间先后顺序执行（解除必须位于队首，与真实操作一致）。
 */
import { addBatch, defoam, editParams, foamRetest, ingestReading, supplementTime } from "./engine";
import { StationState } from "./types";

export function emptyState(): StationState {
  return { batches: [], exceptions: [], timeline: [], counters: { exception: 0, event: 0, seq: 0 } };
}

export function buildSeedState(now: number = Date.now()): StationState {
  const t = (minutesAgo: number) => now - minutesAgo * 60_000;
  let s = emptyState();

  s = addBatch(
    s,
    {
      id: "LAB-624B",
      orderNo: "NO.20260915-B",
      fabric: "混纺斜纹",
      gramWeight: 210,
      foamLimit: 30,
      params: { targetTemp: 90, holdMinutes: 30, liquorRatio: "1:15", dyeRecipe: "活性黄 3RS 0.6% / 柔软剂 2%" },
    },
    t(240)
  ).state;
  s = addBatch(
    s,
    {
      id: "LAB-620A",
      orderNo: "NO.20260918-A",
      fabric: "棉府绸",
      gramWeight: 120,
      foamLimit: 25,
      params: { targetTemp: 80, holdMinutes: 30, liquorRatio: "1:12", dyeRecipe: "活性红 3B 1.2% / 元明粉 40g/L" },
    },
    t(180)
  ).state;
  s = addBatch(
    s,
    {
      id: "LAB-621C",
      orderNo: "NO.20260917-C",
      fabric: "涤纶针织",
      gramWeight: 180,
      foamLimit: 20,
      params: { targetTemp: 98, holdMinutes: 40, liquorRatio: "1:10", dyeRecipe: "分散蓝 2BLN 0.8% / 匀染剂 1g/L" },
    },
    t(150)
  ).state;

  // LAB-620A：温度连续 3 分钟偏离 → 补时解除（演示温度项流程，已解除不挡评审）
  s = ingestReading(s, "LAB-620A", { temp: 82.6 }, t(120)).state;
  s = ingestReading(s, "LAB-620A", { temp: 82.8 }, t(115)).state;
  s = ingestReading(s, "LAB-620A", { temp: 82.4 }, t(110)).state;
  const tempEx = s.exceptions.find((e) => e.batchId === "LAB-620A" && e.kind === "temperature")!;
  s = supplementTime(s, tempEx.id, 5, t(105)).state;
  s = ingestReading(s, "LAB-620A", { temp: 80.1, ph: 6.6, foam: 10 }, t(90)).state;

  // LAB-624B：泡沫异常 → 排泡复测解除 → 改参数后结论失效留档并重新生成待处置
  s = ingestReading(s, "LAB-624B", { foam: 41 }, t(100)).state;
  const foamEx = s.exceptions.find((e) => e.batchId === "LAB-624B" && e.kind === "foam")!;
  s = defoam(s, foamEx.id, t(95)).state;
  s = foamRetest(s, foamEx.id, 22, t(88)).state;
  s = editParams(
    s,
    "LAB-624B",
    { targetTemp: 90, holdMinutes: 45, liquorRatio: "1:15", dyeRecipe: "活性黄 3RS 0.6% / 柔软剂 2%" },
    t(60)
  ).state;

  // LAB-621C：温度连续 3 分钟偏离 + pH 超限，两条待处置
  s = ingestReading(s, "LAB-621C", { temp: 100.6 }, t(33)).state;
  s = ingestReading(s, "LAB-621C", { temp: 100.9 }, t(32)).state;
  s = ingestReading(s, "LAB-621C", { temp: 101.1, ph: 8.2 }, t(31)).state;

  return s;
}
