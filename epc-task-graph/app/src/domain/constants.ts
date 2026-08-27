import type { Discipline, Status } from './types';

export const DISCIPLINES: Discipline[] = ['E', 'P', 'C', 'OTHER'];
export const STATUSES: Status[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'ON_HOLD'];

// 工種色（§2.11）: バー・ドット・エッジ等「文字が乗らない」グラフィック用途の鮮やかな色。
export const DISC_COLOR: Record<Discipline, string> = {
  E: '#2563eb',
  P: '#d97706',
  C: '#059669',
  OTHER: '#6b7280',
};

// 白文字が乗る背景（工種チップ・集約カードのヘッダ）用の WCAG AA 安全版。
// P/C は上の鮮やかな色だと白文字がAA割れ（3.19/3.77）するため暗色に落とす（5.02/5.48）。
export const DISC_COLOR_ON: Record<Discipline, string> = {
  E: '#2563eb', // 白字 5.17
  P: '#b45309', // 白字 5.02
  C: '#047857', // 白字 5.48
  OTHER: '#6b7280', // 白字 4.83
};
