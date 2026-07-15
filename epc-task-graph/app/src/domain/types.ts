// ============================================================================
// EPCタスク依存関係グラフ ドメイン型（設計書 §5.2 JSONスキーマに完全準拠）
// UI / React / DOM に一切依存しない。Phase 1 の domain 層の唯一の真実。
// ============================================================================

export type Discipline = 'E' | 'P' | 'C' | 'OTHER';
export type Status = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'ON_HOLD';
export type ConstraintType = 'ASAP' | 'SNET' | 'FNLT';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type DisplayMode = 'DIM' | 'ISOLATE';

export interface Position {
  x: number;
  y: number;
}

export interface Task {
  id: string;
  name: string;
  wbsCode: string; // "" 可。プレフィックスが WBS 木を定義（§2.7）
  discipline: Discipline;
  isMilestone: boolean; // true なら durationDays=0 を強制
  durationDays: number;
  status: Status;
  progress: number; // 0-100 整数
  assignee: string; // 自由文字列（Phase 4 で Entra ID と突合、§7.5）
  constraintType: ConstraintType;
  constraintDate: string | null;
  notes: string;
  position: Position;
  rev: number; // 行レベル版数（更新毎に +1、衝突検知の単位、§7.2）
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number; // 整数、負値=リード
  rev: number;
  updatedAt: string;
  updatedBy: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  calendarId: string;
  dataDate: string; // ステータス基準日（CPM開始点）
  createdAt: string;
  updatedAt: string;
  version: number; // プロジェクト全体の単調増加版数（楽観ロックの粗い錠）
}

export interface ViewState {
  collapsedWbs: string[];
  expandLevel: number;
}

export interface GraphFilter {
  wbsPrefixes?: string[];
  disciplines?: Discipline[];
  assignees?: string[]; // "@me" は現在ユーザーへ展開（§7.5）
  statuses?: Status[];
  milestonesOnly?: boolean;
  criticalOnly?: boolean; // CPM 導出値（Phase 1 前半は未計算）
  dateRange?: { from?: string; to?: string };
  text?: string;
}

export interface SavedView {
  id: string;
  name: string;
  filter: GraphFilter;
  displayMode: DisplayMode;
  collapsedWbs: string[] | null;
  createdBy: string;
  updatedAt: string;
}

export interface Calendar {
  id: string;
  name: string;
  workingDays: number[];
  holidays: string[];
}

export interface GraphDoc {
  schemaVersion: number;
  project: ProjectMeta;
  viewState: ViewState;
  savedViews: SavedView[];
  calendars: Calendar[];
  tasks: Task[];
  dependencies: Dependency[];
}

// ---- 表示パイプライン（§2.6）の入出力 ----

export interface FocusSpec {
  taskId: string;
  up: number;
  down: number;
}

export interface ViewSpec {
  filter: GraphFilter;
  displayMode: DisplayMode;
  collapsedWbs: string[];
  focus: FocusSpec | null;
  me: string;
}

export interface DisciplineBreakdown {
  E: number;
  P: number;
  C: number;
  OTHER: number;
}

export interface VisibleTaskNode {
  kind: 'task';
  id: string;
  task: Task;
  position: Position;
  dim: boolean;
  outside: boolean;
  isOrigin: boolean;
  directPred: boolean;
  directSucc: boolean;
}

export interface VisibleAggregateNode {
  kind: 'aggregate';
  id: string;
  prefix: string;
  continuation?: boolean;
  memberIds: string[];
  position: Position;
  count: number;
  disc: DisciplineBreakdown;
  avgProgress: number;
  hasMilestone: boolean;
  hasCritical: boolean;
  dim: boolean;
}

export type VisibleNode = VisibleTaskNode | VisibleAggregateNode;

export interface VisibleEdge {
  id: string;
  source: string;
  target: string;
  aggregate: boolean;
  continuation?: boolean;
  count: number;
  highlight: boolean;
  realId?: string;
}

export interface DeriveStats {
  total: number;
  visible: number;
  aggregates: number;
  matched: number;
  edges: number;
}

export interface DeriveResult {
  visibleNodes: VisibleNode[];
  visibleEdges: VisibleEdge[];
  stats: DeriveStats;
}

export interface Adjacency {
  succ: Map<string, Set<string>>;
  pred: Map<string, Set<string>>;
}

export interface Neighborhood {
  set: Set<string>;
  directPred: Set<string>;
  directSucc: Set<string>;
}

export type ConnectReason = 'self' | 'duplicate' | 'cycle' | null;

export interface ConnectResult {
  ok: boolean;
  reason: ConnectReason;
  path: string[] | null;
}

export interface TopoResult {
  ok: boolean;
  order: string[];
  hasCycle: boolean;
}
