// ============================================================================
// メモ化セレクタ（§9.1-9.2, §5.1）: CpmResult を tasks/deps/dataDate の「参照が
// 変わった時だけ」再計算する。CPM 結果は非永続の導出値（DBに焼かない）。
// CP強調・criticalOnly フィルタ・完了日サマリ・右パネルTF はすべてこの1つの結果を参照。
// ============================================================================
import { computeCpm, type CpmResult, type Dependency, type Task } from '../domain';

interface CpmCache {
  tasks: Task[] | null;
  deps: Dependency[] | null;
  dataDate: string | null;
  result: CpmResult | null;
}

const cache: CpmCache = { tasks: null, deps: null, dataDate: null, result: null };

// tasks/deps の配列参照（immer が変更時のみ差し替える）と dataDate で判定。
export function selectCpm(tasks: Task[], deps: Dependency[], dataDate: string): CpmResult {
  if (
    cache.result &&
    cache.tasks === tasks &&
    cache.deps === deps &&
    cache.dataDate === dataDate
  ) {
    return cache.result;
  }
  const result = computeCpm(tasks, deps, dataDate);
  cache.tasks = tasks;
  cache.deps = deps;
  cache.dataDate = dataDate;
  cache.result = result;
  return result;
}
