import { getTimeline } from "../domain/engine";
import { StationState, TimelineType } from "../domain/types";
import { fmtTime } from "./format";

const TYPE_LABEL: Record<TimelineType, string> = {
  batch: "登记",
  reading: "监测",
  exception: "异常",
  urgent: "加急",
  supplement: "补时",
  retest: "复测",
  defoam: "排泡",
  cleared: "解除",
  invalidated: "失效",
  param: "参数",
  review: "评审",
};

interface TimelinePanelProps {
  state: StationState;
  /** 受控筛选：与批次列表的选中态联动 */
  filter: string;
  onFilter(batchId: string): void;
}

export function TimelinePanel({ state, filter, onFilter }: TimelinePanelProps) {
  const events = getTimeline(state, filter || undefined);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>与列表同源 · 刷新后一致</p>
          <h2>处置时间线（{events.length}）</h2>
        </div>
        <select value={filter} onChange={(e) => onFilter(e.target.value)}>
          <option value="">全部批次</option>
          {state.batches.map((b) => (
            <option key={b.id} value={b.id}>{b.id}</option>
          ))}
        </select>
      </div>
      <div className="timeline">
        {events.length === 0 && <p className="empty">暂无事件。</p>}
        {events.map((event) => (
          <div key={event.id} className={`timeline-item type-${event.type}`}>
            <span className="dot" />
            <div>
              <p>
                <b>{event.batchId}</b>
                <span className="tag">{TYPE_LABEL[event.type]}</span>
                <time>{fmtTime(event.at)}</time>
              </p>
              <p>{event.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
