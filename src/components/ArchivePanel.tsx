import { getArchived } from "../domain/engine";
import { KIND_META, StationState } from "../domain/types";
import { fmtTime } from "./format";

interface ArchivePanelProps {
  state: StationState;
}

/** 履历留档：参数变更导致失效的解除结论，仅存档不再参与处置 */
export function ArchivePanel({ state }: ArchivePanelProps) {
  const archived = getArchived(state);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>解除后改参数 · 本项及后续结论失效</p>
          <h2>履历留档（{archived.length}）</h2>
        </div>
      </div>
      {archived.length === 0 && <p className="empty">暂无失效结论。</p>}
      <div className="records">
        {archived.map((record) => (
          <article key={record.id}>
            <b className="archived">{record.id.replace("EX-", "")}</b>
            <div>
              <h3>
                {record.id} · {KIND_META[record.kind].label}项 · 批次 {record.batchId}
              </h3>
              <p>{record.title}</p>
              <p>
                原结论：{record.clearedNote}（{record.clearedAt ? fmtTime(record.clearedAt) : "-"}，参数 v{record.clearedParamVersion}）
              </p>
              <p>
                失效：{record.invalidateReason}（{record.invalidatedAt ? fmtTime(record.invalidatedAt) : "-"}）
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
