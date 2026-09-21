import { useState } from "react";
import { Reading } from "../domain/engine";
import { PH_MAX, PH_MIN, StationState, TEMP_DEVIATION_LIMIT, TEMP_DEVIATION_MINUTES } from "../domain/types";

interface MonitorPanelProps {
  state: StationState;
  onIngest(batchId: string, reading: Reading): void;
}

/** 监测录入：温度按分钟打点，pH / 泡沫按次录入；触发规则由引擎判定 */
export function MonitorPanel({ state, onIngest }: MonitorPanelProps) {
  const [batchId, setBatchId] = useState(state.batches[0]?.id ?? "");
  const [temp, setTemp] = useState("");
  const [ph, setPh] = useState("");
  const [foam, setFoam] = useState("");

  const batch = state.batches.find((b) => b.id === batchId) ?? state.batches[0];

  const submit = () => {
    if (!batch) return;
    onIngest(batch.id, {
      temp: temp.trim() === "" ? null : Number(temp),
      ph: ph.trim() === "" ? null : Number(ph),
      foam: foam.trim() === "" ? null : Number(foam),
    });
    setTemp("");
    setPh("");
    setFoam("");
  };

  if (!batch) return null;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>触发即生成待处置记录</p>
          <h2>监测录入</h2>
        </div>
      </div>
      <div className="field-grid">
        <label>
          <span>批次</span>
          <select value={batch.id} onChange={(e) => setBatchId(e.target.value)}>
            {state.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} · {b.fabric}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>当前温度 ℃（目标 {batch.params.targetTemp}℃，偏离≥{TEMP_DEVIATION_LIMIT}℃ 累计 {TEMP_DEVIATION_MINUTES} 分钟触发）</span>
          <input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="留空则不录入" />
        </label>
        <label>
          <span>酸碱值 pH（窗口 {PH_MIN}–{PH_MAX}）</span>
          <input type="number" step="0.01" value={ph} onChange={(e) => setPh(e.target.value)} placeholder="留空则不录入" />
        </label>
        <label>
          <span>泡沫高度 mm（限值 {batch.foamLimit}mm）</span>
          <input type="number" value={foam} onChange={(e) => setFoam(e.target.value)} placeholder="留空则不录入" />
        </label>
      </div>
      <p className="hint">
        温度连续偏离：{batch.tempRun.minutes}/{TEMP_DEVIATION_MINUTES} 分钟
        {batch.tempRun.minutes > 0 && `（本段最大偏离 ${batch.tempRun.maxDev.toFixed(1)}℃）`}
      </p>
      <button className="primary" onClick={submit}>录入读数</button>
    </section>
  );
}
