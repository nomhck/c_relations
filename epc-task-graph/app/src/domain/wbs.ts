// ============================================================================
// WBS 階層ヘルパー（§2.7）。wbsCode（例 "1.2.3"）のプレフィックスが木を定義する。
// ============================================================================
import type { Task } from './types';

export function isWbsPrefix(prefix: string, code: string): boolean {
  if (!prefix) return false;
  return code === prefix || code.startsWith(prefix + '.');
}

// 展開レベル level を超える深さのタスクを、level 段でまとめる折り畳み集合を返す。
export function collapsedForLevel(tasks: Task[], level: number): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    const segs = (t.wbsCode || '').split('.').filter(Boolean);
    if (segs.length > level) set.add(segs.slice(0, level).join('.'));
  }
  return [...set];
}

// 全トッププレフィックス（"全折り畳み" 用）。
export function allTopPrefixes(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    const segs = (t.wbsCode || '').split('.').filter(Boolean);
    if (segs.length >= 1) set.add(segs[0]);
  }
  return [...set];
}

// パンくず用の累積プレフィックス列（"1", "1.2", "1.2.3"）。
export function wbsPath(code: string): string[] {
  const segs = (code || '').split('.').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) out.push(segs.slice(0, i + 1).join('.'));
  return out;
}
