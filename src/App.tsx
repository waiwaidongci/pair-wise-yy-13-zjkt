import { useEffect, useState } from "react";
import "./styles.css";
import {
  defoam,
  editParams,
  EngineResult,
  foamRetest,
  ingestReading,
  phRetest,
  Reading,
  reviewBatch,
  setUrgent,
  supplementTime,
} from "./domain/engine";
import { ProcessParams, StationState } from "./domain/types";
import { loadOrSeed, resetState, saveState } from "./store/persistence";
import { ArchivePanel } from "./components/ArchivePanel";
import { BatchList } from "./components/BatchList";
import { MonitorPanel } from "./components/MonitorPanel";
import { QueuePanel } from "./components/QueuePanel";
import { TimelinePanel } from "./components/TimelinePanel";

interface Notice {
  kind: "ok" | "error";
  text: string;
}

function App() {
  const [state, setState] = useState<StationState>(loadOrSeed);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);

  // 持久化：任何状态变化整体落盘，刷新后列表/时间线/履历一致
  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** 所有页面操作统一经引擎计算，引擎抛出的规则校验错误直接提示 */
  const run = (action: (at: number) => EngineResult) => {
    try {
      const result = action(Date.now());
      setState(result.state);
      setNotice({ kind: "ok", text: result.message });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const openCount = state.exceptions.filter((e) => e.status === "open").length;
  const urgentCount = state.exceptions.filter((e) => e.status === "open" && e.urgent).length;
  const clearedCount = state.exceptions.filter((e) => e.status === "cleared").length;
  const archivedCount = state.exceptions.filter((e) => e.status === "invalidated").length;

  const metrics: Array<[string, number]> = [
    ["待处置异常", openCount],
    ["加急项", urgentCount],
    ["已解除", clearedCount],
    ["履历留档", archivedCount],
  ];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62012 · 源提示词7 · Port 62012</p>
        <h1>染整小样异常放行台</h1>
        <span>
          温度连续三分钟偏离两度、酸碱值超出 4.5–7.5 或泡沫超限即生成待处置记录，批次不得评审；
          异常按发生顺序解除——补时只解温度项，酸碱项须两次复测合格，泡沫项须排泡复测；
          加急可插队首但不能跳过更早未闭环异常；解除后改参数，本项及后续结论失效，旧履历留档。
        </span>
        <div className="row-actions">
          <button
            onClick={() => {
              if (window.confirm("确定重置为演示数据？当前全部记录将被清除。")) {
                setState(resetState());
                setNotice({ kind: "ok", text: "已重置为演示数据" });
              }
            }}
          >
            重置演示数据
          </button>
        </div>
      </section>

      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <section className="metrics">
        {metrics.map(([label, value]) => (
          <article key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <BatchList
          state={state}
          selectedId={selectedBatch}
          onSelect={setSelectedBatch}
          onReview={(batchId, pass) => run((at) => reviewBatch(state, batchId, pass, at))}
          onEditParams={(batchId: string, params: ProcessParams) => run((at) => editParams(state, batchId, params, at))}
        />
        <QueuePanel
          state={state}
          onSupplement={(id, minutes) => run((at) => supplementTime(state, id, minutes, at))}
          onPhRetest={(id, value) => run((at) => phRetest(state, id, value, at))}
          onDefoam={(id) => run((at) => defoam(state, id, at))}
          onFoamRetest={(id, value) => run((at) => foamRetest(state, id, value, at))}
          onToggleUrgent={(id, urgent) => run((at) => setUrgent(state, id, urgent, at))}
        />
      </section>

      <section className="workspace">
        <MonitorPanel state={state} onIngest={(batchId, reading: Reading) => run((at) => ingestReading(state, batchId, reading, at))} />
        <TimelinePanel state={state} filter={selectedBatch ?? ""} onFilter={(id) => setSelectedBatch(id || null)} />
      </section>

      <ArchivePanel state={state} />
    </main>
  );
}

export default App;
