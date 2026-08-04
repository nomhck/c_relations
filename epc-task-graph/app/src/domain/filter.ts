// ============================================================================
// フィルタ評価（§2.8）。AND 結合。ISOLATE モードでは描画対象を減らす性能機構を兼ねる。
// ============================================================================
import type { GraphFilter, Task } from './types';
import { isWbsPrefix } from './wbs';

// フィルタが1つでも指定されているか（＝絞り込みが効いている状態か）。
// deriveVisibleGraph/deriveTableRows が「DIM 淡色 or ISOLATE 除去」を発動するかの判定に使う。
export function isFilterActive(f: GraphFilter | null | undefined): boolean {
  if (!f) return false;
  return !!(
    (f.wbsPrefixes && f.wbsPrefixes.length) ||
    (f.disciplines && f.disciplines.length) ||
    (f.assignees && f.assignees.length) ||
    (f.statuses && f.statuses.length) ||
    f.milestonesOnly ||
    f.criticalOnly ||
    (f.text && f.text.trim())
  );
}

export function matchesFilter(
  t: Task,
  f: GraphFilter | null | undefined,
  me: string,
  criticalTasks?: Set<string> | null,
): boolean {
  if (!f) return true;
  // 各条件は AND 結合＝1つでも外れたら即 false（早期リターン）。指定なしの条件は素通り。
  // WBS: 指定プレフィックスのいずれかが t の WBS の祖先 or 一致（サブツリー丸ごと該当）。
  if (
    f.wbsPrefixes &&
    f.wbsPrefixes.length &&
    !f.wbsPrefixes.some((p) => isWbsPrefix(p, t.wbsCode) || t.wbsCode === p)
  )
    return false;
  if (f.disciplines && f.disciplines.length && !f.disciplines.includes(t.discipline)) return false;
  // 担当: '@me' は現在ユーザー(me)に展開してから照合（§7.5 部署名マッチ）。
  if (f.assignees && f.assignees.length) {
    const wanted = f.assignees.map((a) => (a === '@me' ? me || '' : a));
    if (!wanted.includes(t.assignee)) return false;
  }
  if (f.statuses && f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (f.milestonesOnly && !t.isMilestone) return false;
  // criticalOnly: CpmResult の criticalTasks を参照（§9.2）。未提供時は空扱いで除外。
  if (f.criticalOnly && !(criticalTasks && criticalTasks.has(t.id))) return false;
  // テキスト: 名前 or notes の部分一致（大文字小文字無視）。
  if (f.text && f.text.trim()) {
    const q = f.text.trim().toLowerCase();
    if (
      !(
        (t.name || '').toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q)
      )
    )
      return false;
  }
  return true;
}
