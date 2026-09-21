/**
 * 持久化层：负责状态的存取与版本校验，不含任何业务规则。
 * 列表、时间线、履历都从同一份状态派生，刷新后自然一致。
 */
import { buildSeedState } from "../domain/seed";
import { StationState } from "../domain/types";

const STORAGE_KEY = "hxyfront-62012:exception-station:v1";

function isStationState(value: unknown): value is StationState {
  if (!value || typeof value !== "object") return false;
  const s = value as StationState;
  return (
    Array.isArray(s.batches) &&
    Array.isArray(s.exceptions) &&
    Array.isArray(s.timeline) &&
    !!s.counters &&
    typeof s.counters.exception === "number" &&
    typeof s.counters.event === "number" &&
    typeof s.counters.seq === "number"
  );
}

export function loadState(): StationState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStationState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(state: StationState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用（如隐私模式）时静默降级为内存态
  }
}

export function loadOrSeed(): StationState {
  return loadState() ?? buildSeedState();
}

export function resetState(): StationState {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
  return buildSeedState();
}
