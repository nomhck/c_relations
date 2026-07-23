// ============================================================================
// メモ化セレクタ（§9.1-9.2, §5.1）: CpmResult を tasks/deps/dataDate の「参照が
// 変わった時だけ」再計算する。CPM 結果は非永続の導出値（DBに焼かない）。
// CP強調・criticalOnly フィルタ・完了日サマリ・右パネルTF はすべてこの1つの結果を参照。
// ============================================================================
import {
  computeCpm,
  deriveTableRows,
  type Calendar,
  type CpmResult,
  type CpmTaskResult,
  type Dependency,
  type Task,
  type TableResult,
  type TableSort,
  type ViewSpec,
} from '../domain';

interface CpmCache {
  tasks: Task[] | null;
  deps: Dependency[] | null;
  dataDate: string | null;
  calendar: Calendar | null;
  result: CpmResult | null;
}

const cache: CpmCache = { tasks: null, deps: null, dataDate: null, calendar: null, result: null };

// tasks/deps の配列参照（immer が変更時のみ差し替える）・dataDate・稼働カレンダー参照で判定。
export function selectCpm(
  tasks: Task[],
  deps: Dependency[],
  dataDate: string,
  calendar?: Calendar | null,
): CpmResult {
  const cal = calendar ?? null;
  if (
    cache.result &&
    cache.tasks === tasks &&
    cache.deps === deps &&
    cache.dataDate === dataDate &&
    cache.calendar === cal
  ) {
    return cache.result;
  }
  const result = computeCpm(tasks, deps, dataDate, cal);
  cache.tasks = tasks;
  cache.deps = deps;
  cache.dataDate = dataDate;
  cache.calendar = cal;
  cache.result = result;
  return result;
}

// ============================================================================
// テーブル行のメモ化セレクタ（§12.3.1 メモ化）: selectCpm と同型のモジュールキャッシュ。
// キーは tasks/deps/viewSpec/sort/cpm の「参照」。immer が変更時のみ参照を差し替えるため
// 成立する（selectCpm と同じ根拠）。cpm は selectCpm().byTask を渡す。
// ============================================================================
interface TableRowsCache {
  tasks: Task[] | null;
  deps: Dependency[] | null;
  viewSpec: Partial<ViewSpec> | null;
  sort: TableSort[] | null;
  cpm: Map<string, CpmTaskResult> | null;
  result: TableResult | null;
}

const tableCache: TableRowsCache = {
  tasks: null,
  deps: null,
  viewSpec: null,
  sort: null,
  cpm: null,
  result: null,
};

export function selectTableRows(
  tasks: Task[],
  deps: Dependency[],
  viewSpec: Partial<ViewSpec>,
  sort: TableSort[],
  cpm: Map<string, CpmTaskResult> | null,
): TableResult {
  if (
    tableCache.result &&
    tableCache.tasks === tasks &&
    tableCache.deps === deps &&
    tableCache.viewSpec === viewSpec &&
    tableCache.sort === sort &&
    tableCache.cpm === cpm
  ) {
    return tableCache.result;
  }
  const result = deriveTableRows(tasks, deps, viewSpec, sort, cpm);
  tableCache.tasks = tasks;
  tableCache.deps = deps;
  tableCache.viewSpec = viewSpec;
  tableCache.sort = sort;
  tableCache.cpm = cpm;
  tableCache.result = result;
  return result;
}
