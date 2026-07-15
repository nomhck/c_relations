import type { Calendar, Dependency, GraphDoc, Task } from './types';

export function newId(): string {
  return globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function nowISO(): string {
  return new Date().toISOString();
}

// 決定的乱数（seed.ts のデモ生成を再現可能にする）。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTask(p: Partial<Task> = {}, by = '私'): Task {
  const ts = nowISO();
  const isMilestone = !!p.isMilestone;
  return {
    id: p.id || newId(),
    name: p.name != null ? p.name : '新規タスク',
    wbsCode: p.wbsCode != null ? p.wbsCode : '',
    discipline: p.discipline || 'OTHER',
    isMilestone,
    durationDays: isMilestone ? 0 : p.durationDays != null ? p.durationDays : 5,
    status: p.status || 'NOT_STARTED',
    progress: p.progress != null ? p.progress : 0,
    assignee: p.assignee != null ? p.assignee : '',
    constraintType: p.constraintType || 'ASAP',
    constraintDate: p.constraintDate != null ? p.constraintDate : null,
    notes: p.notes || '',
    position: p.position || { x: 0, y: 0 },
    rev: p.rev != null ? p.rev : 1,
    createdAt: p.createdAt || ts,
    updatedAt: p.updatedAt || ts,
    updatedBy: p.updatedBy || by,
  };
}

export function makeDep(
  predecessorId: string,
  successorId: string,
  p: Partial<Dependency> = {},
  by = '私',
): Dependency {
  return {
    id: p.id || newId(),
    predecessorId,
    successorId,
    type: p.type || 'FS',
    lagDays: p.lagDays != null ? p.lagDays : 0,
    rev: p.rev != null ? p.rev : 1,
    updatedAt: p.updatedAt || nowISO(),
    updatedBy: p.updatedBy || by,
  };
}

export function defaultCalendar(): Calendar {
  return { id: 'cal-default', name: '週休2日', workingDays: [1, 2, 3, 4, 5], holidays: [] };
}

export function emptyDoc(name = '新規プロジェクト'): GraphDoc {
  const ts = nowISO();
  return {
    schemaVersion: 1,
    project: {
      id: newId(),
      name,
      description: '',
      calendarId: 'cal-default',
      dataDate: ts.slice(0, 10),
      createdAt: ts,
      updatedAt: ts,
      version: 1,
    },
    viewState: { collapsedWbs: [], expandLevel: 2 },
    savedViews: [],
    calendars: [defaultCalendar()],
    tasks: [],
    dependencies: [],
  };
}
