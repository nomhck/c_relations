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
  type ActiveView,
  type Calendar,
  type Dependency,
  type DisplayMode,
  type GraphDoc,
  type GraphFilter,
  type ProjectMeta,
  type SavedView,
  type TableColumnKey,
  type TableSort,
  type TableSortKey,
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
  emptyDoc,
  wbsPath,
} from '../domain';
import { runFullLayout } from '../layout/layout';
import {
  getCurrentProjectId,
  getRepo,
  persistPatch,
  setCurrentProjectId,
  type DirtySnapshot,
} from './persistence';

enableMapSet();

const LS_ME = 'epc-app-me';
const LS_ACTIVE_VIEW = 'epc-app-active-view';
const LS_TABLE_COLUMNS = 'epc-app-table-columns';

// 表示列の正準順（§12.3.2）。TableView はこの順で、tableColumns に含まれる列だけを描画する。
export const ALL_TABLE_COLUMNS: TableColumnKey[] = [
  'wbsCode',
  'name',
  'wbsPath',
  'discipline',
  'assignee',
  'status',
  'progress',
  'durationDays',
  'es',
  'ef',
  'ls',
  'lf',
  'totalFloat',
  'critical',
  'deps',
];

// 既定表示列（§12.3.2 「既定」列）。wbsPath / ls / lf は既定非表示。
const DEFAULT_TABLE_COLUMNS: TableColumnKey[] = [
  'wbsCode',
  'name',
  'discipline',
  'assignee',
  'status',
  'progress',
  'durationDays',
  'es',
  'ef',
  'totalFloat',
  'critical',
  'deps',
];

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
  centerSelected?: () => void; // 選択タスクへパン（センタリングのみ・fitViewはしない、§12.2）
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
  // 複数行選択（§12.3.5 PR-T2・テーブル限定）。空=単一選択モード（selection.taskId にフォールバック）。
  // selection.taskId は常に「アンカー（範囲選択の基点・右パネル/グラフが読む主選択）」を指す。
  selectedIds: string[];
  editingId: string | null;
  toast: ToastItem[];
  saveStatus: 'saved' | 'dirty';
  dirty: DirtyState;
  runners: Runners;
  cpHighlight: boolean; // CP強調トグル（§2.11/§9.2）。非永続・Undo対象外
  projectList: ProjectMeta[]; // 複数プロジェクト一覧（§6.1）

  // ---- 多ビュー表示状態（§12.2・Undo対象外・Dexie非永続）----
  activeView: ActiveView; // localStorage 記憶
  tableSort: TableSort[]; // 多重ソート（PR-T1は単一キー運用）。既定 []＝WBS自然順
  tableColumns: TableColumnKey[]; // 表示列。localStorage 記憶

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
  // ---- 複数行選択・一括操作（§12.3.5 PR-T2）----
  setSelectedIds: (ids: string[], anchor?: string) => void; // 範囲選択の確定（ids＋アンカー）
  toggleSelectedId: (id: string) => void; // Cmd/Ctrl+クリックのトグル
  bulkUpdateTasks: (ids: string[], patch: Partial<Task>) => void; // 一括更新（1確定=1 Undo）
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
  quickCriticalOnly: () => void;
  toggleCpHighlight: () => void;

  // ---- 多ビュー（§12.2）: 新設アクション ----
  setActiveView: (v: ActiveView) => void;
  setTableSort: (sort: TableSort[]) => void;
  toggleTableSort: (key: TableSortKey, additive: boolean) => void;
  toggleTableColumn: (key: TableColumnKey) => void;
  revealTask: (taskId: string) => void;

  undo: () => void;
  redo: () => void;

  toDoc: () => GraphDoc;
  loadDoc: (doc: GraphDoc, opts?: { persist?: boolean }) => void;
  generateDemo: () => void;
  layoutAll: () => void;

  // ---- 複数プロジェクト管理（§6.1）----
  renameProject: (name: string) => void;
  setDataDate: (d: string) => void;
  refreshProjects: () => Promise<void>;
  switchProject: (id: string) => Promise<void>;
  newProject: (name?: string) => Promise<void>;
  duplicateCurrentProject: () => Promise<void>;
  deleteCurrentProject: () => Promise<void>;
}

// ---- 永続化（Dexie・デバウンス500ms差分保存、§6.1）----
// ダーティ集合から GraphPatch を組み、DexieRepository.savePatch（差分書き）へ渡す。
// ハイドレーション中（起動時の Dexie 読込）は保存を抑止する。
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let hydrating = false;

function snapshotDirty(d: DirtyState): DirtySnapshot {
  return {
    tasks: [...d.tasks],
    deps: [...d.deps],
    deletedTasks: [...d.deletedTasks],
    deletedDeps: [...d.deletedDeps],
  };
}

function scheduleSave() {
  if (hydrating) return;
  if (saveTimer) clearTimeout(saveTimer);
  useApp.setState({ saveStatus: 'dirty' });
  saveTimer = setTimeout(() => {
    const snap = snapshotDirty(useApp.getState().dirty);
    const doc = useApp.getState().toDoc();
    persistPatch(doc, snap)
      .then((res) => {
        if (!res.ok) {
          // ローカル単独運用では通常起きない（§7.2）。起きたら通知のみ。
          useApp.getState().showToast('保存で衝突を検知しました（' + res.conflicts.length + '件）', true);
          return;
        }
        // 保存済みの ID だけをダーティから外す（保存中に追加された分は残す）。
        useApp.setState((s) => {
          for (const id of snap.tasks) s.dirty.tasks.delete(id);
          for (const id of snap.deps) s.dirty.deps.delete(id);
          for (const id of snap.deletedTasks) s.dirty.deletedTasks.delete(id);
          for (const id of snap.deletedDeps) s.dirty.deletedDeps.delete(id);
          const clean =
            s.dirty.tasks.size === 0 &&
            s.dirty.deps.size === 0 &&
            s.dirty.deletedTasks.size === 0 &&
            s.dirty.deletedDeps.size === 0;
          s.saveStatus = clean ? 'saved' : 'dirty';
        });
      })
      .catch(() => {
        useApp.setState({ saveStatus: 'dirty' });
        useApp.getState().showToast('Dexie保存に失敗しました。エクスポートを推奨', true);
      });
  }, 500);
}

// 起動時: まず starter を同期表示 → Dexie から現在プロジェクトへ非同期ハイドレート（§6.1）。
// 空DBの初回は「現在の starter を初回プロジェクトとして保存」するだけで loadDoc しない
// （同期表示済みの state をクロバーしない）。既存プロジェクトがある時のみ読み込んで差し替える。
export async function bootstrapStore(): Promise<void> {
  hydrating = true;
  try {
    const repo = getRepo();
    const list = await repo.listProjects();
    if (!list.length) {
      const doc = useApp.getState().toDoc();
      await repo.saveGraph(doc);
      setCurrentProjectId(doc.project.id);
    } else {
      const cur = getCurrentProjectId();
      const targetId = cur && list.some((p) => p.id === cur) ? cur : list[0].id;
      setCurrentProjectId(targetId);
      const doc = await repo.loadGraph(targetId);
      useApp.getState().loadDoc(doc, { persist: false });
    }
    await useApp.getState().refreshProjects();
  } catch {
    /* Dexie 不可環境では starter のまま動作 */
  } finally {
    hydrating = false;
    // ハイドレーション中に行われた編集（保存が抑止されていた分）を吐き出す。
    const d = useApp.getState().dirty;
    if (d.tasks.size || d.deps.size || d.deletedTasks.size || d.deletedDeps.size) scheduleSave();
  }
}

function initialMe(): string {
  try {
    return localStorage.getItem(LS_ME) || '私';
  } catch {
    return '私';
  }
}

function initialActiveView(): ActiveView {
  try {
    const v = localStorage.getItem(LS_ACTIVE_VIEW);
    if (v === 'graph' || v === 'table' || v === 'gantt') return v;
  } catch {
    /* ignore */
  }
  return 'graph';
}

function initialTableColumns(): TableColumnKey[] {
  try {
    const raw = localStorage.getItem(LS_TABLE_COLUMNS);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((k): k is TableColumnKey =>
          (ALL_TABLE_COLUMNS as string[]).includes(k as string),
        );
        if (valid.length) return valid;
      }
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_TABLE_COLUMNS];
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

const doc0 = starterDoc();
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
      selectedIds: [],
      editingId: null,
      toast: [],
      saveStatus: 'saved',
      dirty: { tasks: new Set(), deps: new Set(), deletedTasks: new Set(), deletedDeps: new Set() },
      runners: {},
      cpHighlight: false,
      projectList: [],
      activeView: initialActiveView(),
      tableSort: [],
      tableColumns: initialTableColumns(),

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
          s.selectedIds = [];
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
          s.selectedIds = s.selectedIds.filter((id) => !idset.has(id));
          if (s.selection.taskId && idset.has(s.selection.taskId))
            s.selection = { taskId: s.selectedIds[s.selectedIds.length - 1] || null, edgeId: null, aggId: null };
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
          s.selectedIds = [];
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
          s.selectedIds = []; // 単一選択に戻す（多選択はテーブルの明示操作でのみ張る）
        }),
      // 範囲選択の確定（Shift+クリック等）: ids をそのまま多選択とし、アンカーを selection.taskId に。
      setSelectedIds: (ids, anchor) =>
        set((s) => {
          const uniq = [...new Set(ids)];
          s.selectedIds = uniq.length > 1 ? uniq : [];
          s.selection = {
            taskId: anchor ?? uniq[uniq.length - 1] ?? null,
            edgeId: null,
            aggId: null,
          };
        }),
      // Cmd/Ctrl+クリックのトグル: id を多選択に足す/外す。アンカーは操作した id（外した時は残りの末尾）。
      toggleSelectedId: (id) =>
        set((s) => {
          const base = s.selectedIds.length ? [...s.selectedIds] : s.selection.taskId ? [s.selection.taskId] : [];
          const idx = base.indexOf(id);
          let anchor: string | null;
          if (idx >= 0) {
            base.splice(idx, 1);
            anchor = base[base.length - 1] ?? null;
          } else {
            base.push(id);
            anchor = id;
          }
          s.selectedIds = base.length > 1 ? base : [];
          s.selection = { taskId: anchor, edgeId: null, aggId: null };
        }),
      // 一括更新（削除/ステータス/担当/工種）: 1回の set() ＝ 1 Undo単位（zundo は状態差分で1エントリ）。
      bulkUpdateTasks: (ids, patch) => {
        const idset = new Set(ids);
        set((s) => {
          const now = nowISO();
          for (const t of s.tasks) {
            if (!idset.has(t.id)) continue;
            Object.assign(t, patch);
            t.rev += 1;
            t.updatedAt = now;
            t.updatedBy = s.me;
            s.dirty.tasks.add(t.id);
          }
        });
        scheduleSave();
      },
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
          s.selectedIds = [];
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
          } else if (s.selectedIds.length) {
            // 多選択中の Esc は単一（アンカー）へ戻す（選択自体は残す）。
            s.selectedIds = [];
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
      // 「CPのみ表示」組込みビュー（§2.8）: criticalOnly + ISOLATE で背骨チェーンを抽出。
      quickCriticalOnly: () => {
        set((s) => {
          s.viewSpec.displayMode = 'ISOLATE';
          s.viewSpec.focus = null;
          s.viewSpec.filter = { criticalOnly: true };
          s.cpHighlight = true;
        });
        get().fit();
      },
      toggleCpHighlight: () =>
        set((s) => {
          s.cpHighlight = !s.cpHighlight;
        }),

      // ---- 多ビュー（§12.2）: 表示状態アクション（Undo対象外・Dexie非永続）----
      setActiveView: (v) => {
        try {
          localStorage.setItem(LS_ACTIVE_VIEW, v);
        } catch {
          /* ignore */
        }
        set((s) => {
          s.activeView = v;
        });
      },
      setTableSort: (sort) =>
        set((s) => {
          s.tableSort = sort;
        }),
      // ヘッダクリック=単独 asc→desc→解除／Shift+クリック=キー追加（PR-T1は単一運用が主）。
      toggleTableSort: (key, additive) =>
        set((s) => {
          const cur = s.tableSort;
          const idx = cur.findIndex((x) => x.key === key);
          if (!additive) {
            if (idx === -1) {
              s.tableSort = [{ key, dir: 'asc' }];
            } else if (cur[idx].dir === 'asc') {
              s.tableSort = [{ key, dir: 'desc' }];
            } else {
              s.tableSort = []; // desc の次は解除（＝WBS自然順へ戻る）
            }
            return;
          }
          // 追加（Shift+クリック）: 既存キーはトグル、無ければ末尾に追加（最大3キー）。
          const next = [...cur];
          if (idx === -1) {
            if (next.length < 3) next.push({ key, dir: 'asc' });
          } else if (next[idx].dir === 'asc') {
            next[idx] = { key, dir: 'desc' };
          } else {
            next.splice(idx, 1);
          }
          s.tableSort = next;
        }),
      toggleTableColumn: (key) => {
        set((s) => {
          const has = s.tableColumns.includes(key);
          s.tableColumns = has
            ? s.tableColumns.filter((k) => k !== key)
            : ALL_TABLE_COLUMNS.filter((k) => k === key || s.tableColumns.includes(k));
        });
        try {
          localStorage.setItem(LS_TABLE_COLUMNS, JSON.stringify(get().tableColumns));
        } catch {
          /* ignore */
        }
      },
      // 選択対象を必ず見せる（§12.2）: 祖先WBSプレフィックスを collapsedWbs から除去＋選択。
      // 'wbs::'+prefix のID規約は集約ノードと共有。検索ジャンプ（§2.6）にも将来流用。
      revealTask: (taskId) =>
        set((s) => {
          const t = s.tasks.find((x) => x.id === taskId);
          if (!t) return;
          const ancestors = new Set(wbsPath(t.wbsCode));
          const collapsedWbs = s.viewSpec.collapsedWbs.filter((p) => !ancestors.has(p));
          s.viewSpec.collapsedWbs = collapsedWbs;
          s.viewState.collapsedWbs = collapsedWbs;
          s.selection = { taskId, edgeId: null, aggId: null };
          s.selectedIds = [];
        }),

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
      loadDoc: (doc, opts) => {
        set((s) => {
          s.schemaVersion = doc.schemaVersion;
          s.project = doc.project;
          s.viewState = doc.viewState;
          s.savedViews = doc.savedViews;
          s.calendars = doc.calendars;
          s.tasks = doc.tasks;
          s.dependencies = doc.dependencies;
          s.selection = { taskId: null, edgeId: null, aggId: null };
          s.selectedIds = [];
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
          s.saveStatus = 'saved';
        });
        useApp.temporal.getState().clear(); // 新ドキュメントは履歴を持ち越さない
        // loadDoc は「全量差替え」（デモ生成・インポート等）。差分ではなく全量 saveGraph で
        // 永続化する。persist:false（起動時ハイドレート・切替/複製/復元の自前保存）では保存しない。
        if (!opts || opts.persist !== false) {
          const doc2 = get().toDoc();
          if (hydrating) return;
          useApp.setState({ saveStatus: 'dirty' });
          getRepo()
            .saveGraph(doc2)
            .then(() => {
              setCurrentProjectId(doc2.project.id);
              useApp.setState({ saveStatus: 'saved' });
              void get().refreshProjects();
            })
            .catch(() => {
              useApp.setState({ saveStatus: 'dirty' });
              get().showToast('Dexie保存に失敗しました。エクスポートを推奨', true);
            });
        }
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

      // ---- 複数プロジェクト管理（§6.1）----
      renameProject: (name) => {
        set((s) => {
          s.project.name = name;
          s.project.updatedAt = nowISO();
        });
        scheduleSave();
      },
      setDataDate: (d) => {
        set((s) => {
          s.project.dataDate = d;
          s.project.updatedAt = nowISO();
        });
        scheduleSave();
      },
      refreshProjects: async () => {
        try {
          const list = await getRepo().listProjects();
          set((s) => {
            s.projectList = list;
          });
        } catch {
          /* ignore */
        }
      },
      switchProject: async (id) => {
        // 保存待ちを吐き出してから切替（未保存差分を落とさない）。
        const snap = snapshotDirty(get().dirty);
        if (snap.tasks.length || snap.deps.length || snap.deletedTasks.length || snap.deletedDeps.length) {
          try {
            await persistPatch(get().toDoc(), snap);
          } catch {
            /* ignore */
          }
        }
        try {
          const doc = await getRepo().loadGraph(id);
          setCurrentProjectId(id);
          get().loadDoc(doc, { persist: false });
          get().fit(200);
          get().showToast('プロジェクトを切り替えました: ' + doc.project.name);
        } catch {
          get().showToast('プロジェクトの読込に失敗しました', true);
        }
      },
      newProject: async (name) => {
        const doc = emptyDoc(name || '新規プロジェクト');
        try {
          await getRepo().saveGraph(doc);
          setCurrentProjectId(doc.project.id);
          get().loadDoc(doc, { persist: false });
          await get().refreshProjects();
          get().showToast('新規プロジェクトを作成しました');
        } catch {
          get().showToast('プロジェクト作成に失敗しました', true);
        }
      },
      duplicateCurrentProject: async () => {
        const cur = get().project;
        try {
          const dup = await getRepo().duplicateProject(cur.id, cur.name + '（複製）');
          setCurrentProjectId(dup.project.id);
          get().loadDoc(dup, { persist: false });
          await get().refreshProjects();
          get().fit(200);
          get().showToast('プロジェクトを複製しました');
        } catch {
          get().showToast('複製に失敗しました', true);
        }
      },
      deleteCurrentProject: async () => {
        const curId = get().project.id;
        try {
          await getRepo().deleteProject(curId);
          const list = await getRepo().listProjects();
          if (list.length) {
            await get().switchProject(list[0].id);
          } else {
            await get().newProject('新規プロジェクト');
          }
          await get().refreshProjects();
          get().showToast('プロジェクトを削除しました');
        } catch {
          get().showToast('削除に失敗しました', true);
        }
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
