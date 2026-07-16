// ============================================================================
// zustand ストア（§4.2 store層）: domain を包み、Undo/永続化/表示状態を管理。
// - zundo(temporal) + diff（差分保存、§2.3）: JSON.stringify 丸ごと保存は禁止。
// - immer: 不変更新で未変更オブジェクトを参照共有（履歴メモリ対策、§2.3）。
// - ダーティ追跡（§6.1/§7.2 L1の土台）: 変更/削除した行IDを保持し、後PRの savePatch へ渡す。
// 状態のうち temporal が追跡するのは { tasks, dependencies } のみ（partialize）。
// viewSpec/selection/collapsed/focus/filter は履歴に含めない（§2.3）。
// ============================================================================
import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import {
  type Calendar,
  type Dependency,
  type DisplayMode,
  type GraphDoc,
  type GraphFilter,
  type ProjectMeta,
  type SavedView,
  type Task,
  type ViewSpec,
  type ViewState,
  canConnect,
  makeDep,
  makeTask,
  nowISO,
  newId,
  seedDemo,
  starterDoc,
  collapsedForLevel,
  allTopPrefixes,
  parseDoc,
} from '../domain';
import { runFullLayout } from '../layout/layout';

enableMapSet();

const LS_KEY = 'epc-app-doc-v1';
const LS_ME = 'epc-app-me';

export interface Selection {
  taskId: string | null;
  edgeId: string | null;
  aggId: string | null;
}

export interface ToastItem {
  id: string;
  msg: string;
  err: boolean;
}

export interface DirtyState {
  tasks: Set<string>;
  deps: Set<string>;
  deletedTasks: Set<string>;
  deletedDeps: Set<string>;
}

export interface Runners {
  fitView?: () => void;
  createAtCenter?: () => void;
  layoutVisible?: () => void;
}

export interface AppState {
  // ---- ドキュメント（永続化対象・§5.2）----
  schemaVersion: number;
  project: ProjectMeta;
  viewState: ViewState;
  savedViews: SavedView[];
  calendars: Calendar[];
  tasks: Task[]; // temporal 追跡対象
  dependencies: Dependency[]; // temporal 追跡対象

  // ---- 表示状態（履歴対象外）----
  me: string;
  viewSpec: ViewSpec;
  expandLevel: number;
  selection: Selection;
  editingId: string | null;
  toast: ToastItem[];
  saveStatus: 'saved' | 'dirty';
  dirty: DirtyState;
  runners: Runners;

  // ---- アクション ----
  setRunner: (name: keyof Runners, fn: () => void) => void;
  fit: (delay?: number) => void;
  setMe: (me: string) => void;
  showToast: (msg: string, err?: boolean) => void;

  addTask: (p?: Partial<Task>, opts?: { edit?: boolean }) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  setPosition: (id: string, pos: { x: number; y: number }) => void;
  applyPositions: (map: Record<string, { x: number; y: number }>) => void;
  deleteTasks: (ids: string[]) => void;
  addDependencyChecked: (source: string, target: string) => boolean;
  deleteDeps: (ids: string[]) => void;
  createSuccessor: (sourceId: string) => void;

  setEditing: (id: string | null) => void;
  setSelection: (sel: Partial<Selection>) => void;
  setFilter: (patch: Partial<GraphFilter>) => void;
  clearFilter: () => void;
  setDisplayMode: (m: DisplayMode) => void;
  toggleArrayFilter: (key: 'disciplines' | 'statuses' | 'assignees' | 'wbsPrefixes', val: string) => void;
  setExpandLevel: (n: number) => void;
  collapseAll: () => void;
  expandAggregate: (aggId: string) => void;
  toggleCollapse: (prefix: string) => void;
  toggleFocus: (taskId: string) => void;
  clearFocus: () => void;
  incFocusDepth: (delta: number) => void;
  escape: () => void;
  quickMyTasks: () => void;

  undo: () => void;
  redo: () => void;

  toDoc: () => GraphDoc;
  loadDoc: (doc: GraphDoc) => void;
  generateDemo: () => void;
  layoutAll: () => void;
}

// ---- 永続化（localStorage・デバウンス500ms差分保存。Dexie は次PR）----
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  useApp.setState({ saveStatus: 'dirty' });
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(useApp.getState().toDoc()));
      useApp.setState({ saveStatus: 'saved' });
    } catch {
      useApp.setState({ saveStatus: 'dirty' });
      useApp.getState().showToast('localStorage保存に失敗（容量超過の可能性）。エクスポートを推奨', true);
    }
  }, 500);
}

function loadInitialDoc(): GraphDoc {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = parseDoc(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    /* ignore */
  }
  return starterDoc();
}

function initialMe(): string {
  try {
    return localStorage.getItem(LS_ME) || '私';
  } catch {
    return '私';
  }
}

function currentWbsContext(): string {
  const s = useApp.getState();
  const selId = s.selection.taskId;
  if (selId) {
    const t = s.tasks.find((x) => x.id === selId);
    if (t) return t.wbsCode;
  }
  return '';
}

function nameOfState(s: AppState, id: string): string {
  const t = s.tasks.find((x) => x.id === id);
  return t ? t.name : id.slice(0, 6);
}

export function explainReject(chk: ReturnType<typeof canConnect>, s: AppState): string {
  if (chk.reason === 'self') return '自己ループは作成できません';
  if (chk.reason === 'duplicate') return '同じ依存が既に存在します';
  if (chk.reason === 'cycle') {
    const names = (chk.path || []).map((id) => nameOfState(s, id));
    const shown = names.length > 6 ? [...names.slice(0, 3), '…', ...names.slice(-2)] : names;
    return '循環依存になるため接続できません（' + shown.join(' → ') + '）';
  }
  return '接続できません';
}

const doc0 = loadInitialDoc();
const me0 = initialMe();

export const useApp = create<AppState>()(
  temporal(
    immer((set, get) => ({
      schemaVersion: doc0.schemaVersion,
      project: doc0.project,
      viewState: doc0.viewState,
      savedViews: doc0.savedViews,
      calendars: doc0.calendars,
      tasks: doc0.tasks,
      dependencies: doc0.dependencies,

      me: me0,
      viewSpec: {
        filter: {},
        displayMode: 'DIM',
        collapsedWbs: doc0.viewState.collapsedWbs || [],
        focus: null,
        me: me0,
      },
      expandLevel: doc0.viewState.expandLevel || 2,
      selection: { taskId: null, edgeId: null, aggId: null },
      editingId: null,
      toast: [],
      saveStatus: 'saved',
      dirty: { tasks: new Set(), deps: new Set(), deletedTasks: new Set(), deletedDeps: new Set() },
      runners: {},

      setRunner: (name, fn) =>
        set((s) => {
          s.runners[name] = fn;
        }),
      fit: (delay = 160) =>
        setTimeout(() => {
          get().runners.fitView?.();
        }, delay),
      setMe: (me) => {
        try {
          localStorage.setItem(LS_ME, me);
        } catch {
          /* ignore */
        }
        set((s) => {
          s.me = me;
          s.viewSpec.me = me;
        });
      },

      showToast: (msg, err = false) => {
        const id = newId();
        set((s) => {
          s.toast.push({ id, msg, err });
        });
        setTimeout(
          () =>
            set((s) => {
              s.toast = s.toast.filter((t) => t.id !== id);
            }),
          5200,
        );
      },

      // ---- タスク/依存 CRUD（ダーティ追跡付き）----
      addTask: (p = {}, { edit = true } = {}) => {
        const t = makeTask(
          { ...p, wbsCode: p.wbsCode != null ? p.wbsCode : currentWbsContext() || '', updatedBy: get().me },
          get().me,
        );
        set((s) => {
          s.tasks.push(t);
          s.dirty.tasks.add(t.id);
          s.selection = { taskId: t.id, edgeId: null, aggId: null };
          s.editingId = edit ? t.id : null;
        });
        scheduleSave();
        return t;
      },
      updateTask: (id, patch) => {
        set((s) => {
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return;
          Object.assign(t, patch);
          t.rev += 1;
          t.updatedAt = nowISO();
          t.updatedBy = s.me;
          s.dirty.tasks.add(id);
        });
        scheduleSave();
      },
      setPosition: (id, pos) => {
        set((s) => {
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return;
          t.position = pos;
          s.dirty.tasks.add(id);
        });
        scheduleSave();
      },
      applyPositions: (map) => {
        set((s) => {
          for (const t of s.tasks) {
            if (map[t.id]) {
              t.position = map[t.id];
              s.dirty.tasks.add(t.id);
            }
          }
        });
        scheduleSave();
      },
      deleteTasks: (ids) => {
        const idset = new Set(ids);
        set((s) => {
          s.tasks = s.tasks.filter((t) => !idset.has(t.id));
          s.dependencies = s.dependencies.filter(
            (d) => !idset.has(d.predecessorId) && !idset.has(d.successorId),
          );
          for (const id of ids) s.dirty.deletedTasks.add(id);
          if (s.selection.taskId && idset.has(s.selection.taskId))
            s.selection = { taskId: null, edgeId: null, aggId: null };
        });
        scheduleSave();
        if (ids.length > 1) get().showToast(ids.length + '件削除しました（Cmd+Z で元に戻せます）');
      },
      addDependencyChecked: (source, target) => {
        const chk = canConnect(source, target, get().dependencies);
        if (!chk.ok) {
          get().showToast(explainReject(chk, get()), true);
          return false;
        }
        const dep = makeDep(source, target, {}, get().me);
        set((s) => {
          s.dependencies.push(dep);
          s.dirty.deps.add(dep.id);
        });
        scheduleSave();
        return true;
      },
      deleteDeps: (ids) => {
        const idset = new Set(ids);
        set((s) => {
          s.dependencies = s.dependencies.filter((d) => !idset.has(d.id));
          for (const id of ids) s.dirty.deletedDeps.add(id);
        });
        scheduleSave();
      },
      createSuccessor: (sourceId) => {
        const src = get().tasks.find((t) => t.id === sourceId);
        if (!src) return;
        const pos = { x: src.position.x + 220, y: src.position.y };
        const t = makeTask({ wbsCode: src.wbsCode, discipline: src.discipline, position: pos }, get().me);
        const dep = makeDep(sourceId, t.id, {}, get().me);
        set((s) => {
          s.tasks.push(t);
          s.dependencies.push(dep);
          s.dirty.tasks.add(t.id);
          s.dirty.deps.add(dep.id);
          s.selection = { taskId: t.id, edgeId: null, aggId: null };
          s.editingId = t.id;
        });
        scheduleSave();
      },

      // ---- 表示状態（Undo対象外）----
      setEditing: (id) =>
        set((s) => {
          s.editingId = id;
        }),
      setSelection: (sel) =>
        set((s) => {
          s.selection = { taskId: null, edgeId: null, aggId: null, ...sel };
        }),
      setFilter: (patch) =>
        set((s) => {
          Object.assign(s.viewSpec.filter, patch);
        }),
      clearFilter: () =>
        set((s) => {
          s.viewSpec.filter = {};
        }),
      setDisplayMode: (m) => {
        set((s) => {
          s.viewSpec.displayMode = m;
        });
        if (m === 'ISOLATE') get().fit();
      },
      toggleArrayFilter: (key, val) =>
        set((s) => {
          const cur = (s.viewSpec.filter[key] as string[] | undefined) || [];
          const next = cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val];
          (s.viewSpec.filter as any)[key] = next;
        }),
      setExpandLevel: (n) => {
        set((s) => {
          const collapsedWbs = collapsedForLevel(s.tasks, n);
          s.expandLevel = n;
          s.viewSpec.collapsedWbs = collapsedWbs;
          s.viewState.collapsedWbs = collapsedWbs;
          s.viewState.expandLevel = n;
        });
        scheduleSave();
      },
      collapseAll: () => {
        set((s) => {
          const collapsedWbs = allTopPrefixes(s.tasks);
          s.expandLevel = 1;
          s.viewSpec.collapsedWbs = collapsedWbs;
          s.viewState.collapsedWbs = collapsedWbs;
          s.viewState.expandLevel = 1;
        });
        scheduleSave();
      },
      expandAggregate: (aggId) => {
        set((s) => {
          const prefix = aggId.startsWith('wbs::') ? aggId.slice(5) : aggId;
          const collapsedWbs = s.viewSpec.collapsedWbs.filter((p) => p !== prefix);
          s.viewSpec.collapsedWbs = collapsedWbs;
          s.viewState.collapsedWbs = collapsedWbs;
          s.selection = { taskId: null, edgeId: null, aggId: null };
        });
        scheduleSave();
      },
      toggleCollapse: (prefix) => {
        set((s) => {
          const has = s.viewSpec.collapsedWbs.includes(prefix);
          const collapsedWbs = has
            ? s.viewSpec.collapsedWbs.filter((p) => p !== prefix)
            : [...s.viewSpec.collapsedWbs, prefix];
          s.viewSpec.collapsedWbs = collapsedWbs;
          s.viewState.collapsedWbs = collapsedWbs;
        });
        scheduleSave();
      },
      toggleFocus: (taskId) => {
        let enabled = false;
        set((s) => {
          const cur = s.viewSpec.focus;
          if (cur && cur.taskId === taskId) {
            s.viewSpec.focus = null;
          } else {
            s.viewSpec.focus = { taskId, up: 2, down: 2 };
            enabled = true;
          }
        });
        if (enabled) get().fit();
      },
      clearFocus: () =>
        set((s) => {
          s.viewSpec.focus = null;
        }),
      incFocusDepth: (delta) =>
        set((s) => {
          if (!s.viewSpec.focus) return;
          const f = s.viewSpec.focus;
          f.up = Math.max(1, (f.up || 2) + delta);
          f.down = Math.max(1, (f.down || 2) + delta);
        }),
      escape: () =>
        set((s) => {
          if (s.viewSpec.focus) {
            s.viewSpec.focus = null;
          } else if (s.selection.taskId || s.selection.edgeId || s.selection.aggId) {
            s.selection = { taskId: null, edgeId: null, aggId: null };
          }
        }),
      quickMyTasks: () => {
        set((s) => {
          s.viewSpec.displayMode = 'ISOLATE';
          s.viewSpec.focus = null;
          s.viewSpec.filter = { assignees: ['@me'] };
        });
        get().fit();
      },

      // ---- Undo / Redo（zundo temporal 経由。戻した行もダーティ扱い、§2.3）----
      undo: () => {
        useApp.temporal.getState().undo();
        set((s) => {
          for (const t of s.tasks) s.dirty.tasks.add(t.id);
          for (const d of s.dependencies) s.dirty.deps.add(d.id);
        });
        scheduleSave();
      },
      redo: () => {
        useApp.temporal.getState().redo();
        set((s) => {
          for (const t of s.tasks) s.dirty.tasks.add(t.id);
          for (const d of s.dependencies) s.dirty.deps.add(d.id);
        });
        scheduleSave();
      },

      // ---- ドキュメント（doc化・差替え）----
      toDoc: () => {
        const s = get();
        return {
          schemaVersion: s.schemaVersion,
          project: s.project,
          viewState: s.viewState,
          savedViews: s.savedViews,
          calendars: s.calendars,
          tasks: s.tasks,
          dependencies: s.dependencies,
        };
      },
      loadDoc: (doc) => {
        set((s) => {
          s.schemaVersion = doc.schemaVersion;
          s.project = doc.project;
          s.viewState = doc.viewState;
          s.savedViews = doc.savedViews;
          s.calendars = doc.calendars;
          s.tasks = doc.tasks;
          s.dependencies = doc.dependencies;
          s.selection = { taskId: null, edgeId: null, aggId: null };
          s.editingId = null;
          s.viewSpec = {
            filter: {},
            displayMode: 'DIM',
            collapsedWbs: doc.viewState.collapsedWbs || [],
            focus: null,
            me: s.me,
          };
          s.expandLevel = doc.viewState.expandLevel || 2;
          s.dirty = { tasks: new Set(), deps: new Set(), deletedTasks: new Set(), deletedDeps: new Set() };
        });
        useApp.temporal.getState().clear(); // 新ドキュメントは履歴を持ち越さない
        scheduleSave();
      },
      generateDemo: () => {
        const doc = seedDemo({ count: 4000, density: 1.5 });
        get().loadDoc(doc);
        get().fit(200);
        get().showToast(
          `4,000ノードデモを生成しました（tasks=${doc.tasks.length} / deps=${doc.dependencies.length}）`,
        );
      },

      // ---- 全体整列（Worker、§2.5）----
      layoutAll: () => {
        get().showToast('全体整列を実行中…（Web Workerで非同期。UIはブロックしません）');
        const s = get();
        runFullLayout(
          s.tasks.map((t) => t.id),
          s.dependencies.map((d) => [d.predecessorId, d.successorId] as [string, string]),
        )
          .then((posMap) => {
            get().applyPositions(posMap);
            get().showToast('全体整列が完了しました（左→右 DAGレイアウト）');
            get().runners.fitView?.();
          })
          .catch(() => get().showToast('全体整列に失敗しました', true));
      },
    })),
    {
      // temporal 追跡は tasks/dependencies のみ（§2.3）。
      partialize: (state): Pick<AppState, 'tasks' | 'dependencies'> => ({
        tasks: state.tasks,
        dependencies: state.dependencies,
      }),
      limit: 100,
      // 差分保存（§2.3）: 参照が変わったキーだけを、その「変更前の値」で保存する。
      // immer の構造共有により未変更 Task/Dep オブジェクトは参照共有され、メモリ膨張しない。
      diff: (pastState, currentState) => {
        const delta: Partial<Pick<AppState, 'tasks' | 'dependencies'>> = {};
        let changed = false;
        if (pastState.tasks !== currentState.tasks) {
          delta.tasks = pastState.tasks;
          changed = true;
        }
        if (pastState.dependencies !== currentState.dependencies) {
          delta.dependencies = pastState.dependencies;
          changed = true;
        }
        return changed ? delta : null;
      },
    },
  ),
);

export function nameOf(id: string): string {
  return nameOfState(useApp.getState(), id);
}
