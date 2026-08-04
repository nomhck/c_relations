// ============================================================================
// useCpm: CPM 結果を購読するフック。tasks/dependencies/dataDate/稼働カレンダーを購読し、
// selectCpm（モジュールキャッシュ）をメモ化して返す。全ビュー共通の CPM 参照経路を1つに集約
// （従来は6コンポーネントで同型の selectActiveCalendar + useMemo(selectCpm) を重複記述していた）。
// ============================================================================
import { useMemo } from 'react';
import { useApp, selectActiveCalendar } from './store';
import { selectCpm } from './selectors';
import type { CpmResult } from '../domain';

export function useCpm(): CpmResult {
  const tasks = useApp((s) => s.tasks);
  const deps = useApp((s) => s.dependencies);
  const dataDate = useApp((s) => s.project.dataDate);
  const calendar = useApp(selectActiveCalendar);
  return useMemo(
    () => selectCpm(tasks, deps, dataDate, calendar),
    [tasks, deps, dataDate, calendar],
  );
}
