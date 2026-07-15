import type { Discipline, Status } from './types';

export const DISCIPLINES: Discipline[] = ['E', 'P', 'C', 'OTHER'];
export const STATUSES: Status[] = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'ON_HOLD'];

// 工種色（§2.11）: バーに限定（全面塗りはステータス色と衝突するため使わない）。
export const DISC_COLOR: Record<Discipline, string> = {
  E: '#2563eb',
  P: '#d97706',
  C: '#059669',
  OTHER: '#6b7280',
};
