import { useState } from "react";
import { canReview } from "../domain/engine";
import { Batch, ProcessParams, ReviewStatus, StationState, TEMP_DEVIATION_LIMIT, TEMP_DEVIATION_MINUTES } from "../domain/types";

const REVIEW_META: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: "待评审", className: "badge neutral" },
  passed: { label: "评审通过", className: "badge ok" },
  failed: { label: "评审不通过", className: "badge bad" },
};

interface ParamEditorProps {
  batch: Batch;
  onSubmit(params: ProcessParams): void;
  onCancel(): void;
}

function ParamEditor({ batch, onSubmit, onCancel }: ParamEditorProps) {
  const [targetTemp, setTargetTemp] = useState(String(batch.params.targetTemp));
  const [holdMinutes, setHoldMinutes] = useState(String(batch.params.holdMinutes));
  const [liquorRatio, setLiquorRatio] = useState(batch.params.liquorRatio);
  const [dyeRecipe, setDyeRecipe] = useState(batch.params.dyeRecipe);

  const submit = () => {
    onSubmit({
      targetTemp: Number(targetTemp),
      holdMinutes: Number(holdMinutes),
      liquorRatio: liquorRatio.trim(),
      dyeRecipe: dyeRecipe.trim(),
    });
  };

  return (
    <div className="param-editor">
      <p className="hint">修改后参数版本升至 v{batch.paramVersion + 1}，已解除项的结论将失效留档并重新生成待处置。</p>
      <label>
        <span>目标温度 ℃</span>
        <input type="number" value={targetTemp} onChange={(e) => setTargetTemp(e.target.value)} />
      </label>
      <label>
        <span>保温时间 min</span>
        <input type="number" value={holdMinutes} onChange={(e) => setHoldMinutes(e.target.value)} />
      </label>
      <label>
        <span>浴比</span>
        <input value={liquorRatio} onChange={(e) => setLiquorRatio(e.target.value)} />
      </label>
      <label>
        <span>染料配方</span>
        <input value={dyeRecipe} onChange={(e) => setDyeRecipe(e.target.value)} />
      </label>
      <div className="row-actions">
        <button className="primary" onClick={submit}>确认变更</button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

interface BatchListProps {
  state: StationState;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onReview(batchId: string, pass: boolean): void;
  onEditParams(batchId: string, params: ProcessParams): void;
}

export function BatchList({ state, selectedId, onSelect, onReview, onEditParams }: BatchListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <aside className="panel">
      <h2>小样批次</h2>
      <div className="batch-list">
        {state.batches.map((batch) => {
          const openCount = state.exceptions.filter((e) => e.batchId === batch.id && e.status === "open").length;
          const gate = canReview(state, batch.id);
          const review = REVIEW_META[batch.review];
          const editing = editingId === batch.id;
          return (
            <article
              key={batch.id}
              className={`batch-card${selectedId === batch.id ? " selected" : ""}`}
              onClick={() => onSelect(selectedId === batch.id ? null : batch.id)}
            >
              <div className="batch-head">
                <h3>{batch.id}</h3>
                <span className={review.className}>{review.label}</span>
              </div>
              <p>
                {batch.fabric} {batch.gramWeight}g/m² · 订单 {batch.orderNo}
              </p>
              <p>
                目标 {batch.params.targetTemp}℃ · 保温 {batch.params.holdMinutes}min · 浴比 {batch.params.liquorRatio} · 参数 v{batch.paramVersion}
              </p>
              <p>
                泡沫限值 {batch.foamLimit}mm
                {batch.tempRun.minutes > 0 && (
                  <span className="badge warn">
                    温度连续偏离 {batch.tempRun.minutes}/{TEMP_DEVIATION_MINUTES} 分钟（≥{TEMP_DEVIATION_LIMIT}℃）
                  </span>
                )}
                {openCount > 0 && <span className="badge bad">{openCount} 项待处置</span>}
              </p>
              <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  disabled={!gate.ok || batch.review !== "pending"}
                  title={gate.ok ? undefined : `批次不得评审：${gate.reason}`}
                  onClick={() => onReview(batch.id, true)}
                >
                  评审通过
                </button>
                <button
                  disabled={!gate.ok || batch.review !== "pending"}
                  title={gate.ok ? undefined : `批次不得评审：${gate.reason}`}
                  onClick={() => onReview(batch.id, false)}
                >
                  不通过
                </button>
                <button onClick={() => setEditingId(editing ? null : batch.id)}>
                  {editing ? "收起" : "修改参数"}
                </button>
              </div>
              {!gate.ok && <p className="hint">批次不得评审：{gate.reason}</p>}
              {editing && (
                <div onClick={(e) => e.stopPropagation()}>
                  <ParamEditor
                    key={`${batch.id}-v${batch.paramVersion}`}
                    batch={batch}
                    onSubmit={(params) => {
                      onEditParams(batch.id, params);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
