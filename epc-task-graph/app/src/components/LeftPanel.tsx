// 左パネル（§2.8）: 私は誰・組込みビュー・フィルタ（DIM/ISOLATE）・展開レベル・稼働カレンダー・統計・凡例。
import { useMemo, useState } from 'react';
import { useApp, selectActiveCalendar } from '../store/store';
import { selectCpm } from '../store/selectors';
import {
  deriveVisibleGraph,
  naturalWbsCompare,
  DISCIPLINES,
  STATUSES,
  DISC_COLOR,
  type GraphFilter,
  type Task,
} from '../domain';

// WBSツリーパネル（§1.3/§2.7）: WBS階層を折り畳み可能なツリーで表示。ラベルクリックでその
// サブツリーに絞り込み（wbsPrefixes フィルタ・トグル）。件数付き。ナビの主役の一つ。
interface WbsNode {
  prefix: string;
  count: number;
  children: WbsNode[];
}
function buildWbsCountTree(tasks: Task[]): WbsNode[] {
  const count = new Map<string, number>();
  const childSet = new Map<string, Set<string>>(); // 親prefix（''=ルート）→子prefix集合
  for (const t of tasks) {
    const segs = (t.wbsCode || '')
      .split('.')
      .map((x) => x.trim())
      .filter(Boolean);
    let path = '';
    let parent = '';
    for (const seg of segs) {
      path = path ? path + '.' + seg : seg;
      count.set(path, (count.get(path) ?? 0) + 1);
      if (!childSet.has(parent)) childSet.set(parent, new Set());
      childSet.get(parent)!.add(path);
      parent = path;
    }
  }
  const build = (prefix: string): WbsNode[] =>
    [...(childSet.get(prefix) ?? [])]
      .sort(naturalWbsCompare)
      .map((p) => ({ prefix: p, count: count.get(p) ?? 0, children: build(p) }));
  return build('');
}

function WbsTreePanel() {
  const tasks = useApp((s) => s.tasks);
  const activePrefixes = useApp((s) => s.viewSpec.filter.wbsPrefixes);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildWbsCountTree(tasks), [tasks]);
  const active = new Set(activePrefixes ?? []);

  const toggle = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const clickNode = (p: string) => {
    const cur = useApp.getState().viewSpec.filter.wbsPrefixes ?? [];
    if (cur.length === 1 && cur[0] === p) useApp.getState().setFilter({ wbsPrefixes: undefined });
    else useApp.getState().setFilter({ wbsPrefixes: [p] });
  };
  const renderNode = (node: WbsNode, depth: number): React.ReactNode => (
    <div key={node.prefix}>
      <div className={'wbs-tree-row' + (active.has(node.prefix) ? ' active' : '')}>
        {node.children.length ? (
          <button
            className="wbs-tree-tog"
            onClick={() => toggle(node.prefix)}
            title={expanded.has(node.prefix) ? '折り畳み' : '展開'}
          >
            {expanded.has(node.prefix) ? '▾' : '▸'}
          </button>
        ) : (
          <span className="wbs-tree-tog empty" />
        )}
        <span
          className="wbs-tree-label"
          style={{ paddingLeft: depth * 4 }}
          title="このWBSで絞り込み（再クリックで解除）"
          data-prefix={node.prefix}
          onClick={() => clickNode(node.prefix)}
        >
          <span className="mono">{node.prefix}</span> <span className="muted">({node.count})</span>
        </span>
      </div>
      {expanded.has(node.prefix) ? node.children.map((c) => renderNode(c, depth + 1)) : null}
    </div>
  );

  if (!tree.length) return null;
  return (
    <>
      <h3>WBSツリー（§2.7）</h3>
      <div className="wbs-tree" data-testid="wbs-tree">
        {tree.map((n) => renderNode(n, 0))}
      </div>
    </>
  );
}

// 保存ビュー（§2.8/§12.3.8 PR-T2④）: 現在のフィルタ/表示/折り畳み/テーブル状態を名前付きで保存・適用。
function SavedViews() {
  const views = useApp((s) => s.savedViews);
  const [name, setName] = useState('');
  const save = () => {
    useApp.getState().saveCurrentView(name);
    setName('');
  };
  return (
    <>
      <h3>保存ビュー（§2.8）</h3>
      <div className="row">
        <input
          className="sv-input"
          placeholder="現在のビューを保存…"
          value={name}
          data-testid="saveview-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
        <button className="btn" data-testid="saveview-btn" onClick={save}>
          保存
        </button>
      </div>
      {views.length ? (
        <div className="sv-list" data-testid="saveview-list">
          {views.map((v) => (
            <div className="sv-item" key={v.id}>
              <span
                className="name"
                title="このビューを適用"
                onClick={() => useApp.getState().applyView(v.id)}
              >
                {v.name}
              </span>
              <span className="x" title="削除" onClick={() => useApp.getState().deleteView(v.id)}>
                ×
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="stat">— まだありません</div>
      )}
    </>
  );
}

// 稼働カレンダー編集（§9.1/Phase2）: 稼働曜日トグル＋祝日。土日も稼働日に設定できる。
const WD_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
function CalendarEditor() {
  const cal = useApp(selectActiveCalendar);
  if (!cal) return null;
  const wd = new Set(cal.workingDays);
  const toggle = (n: number) => {
    if (wd.has(n) && cal.workingDays.length <= 1) return; // 全非稼働は不可
    const next = wd.has(n)
      ? cal.workingDays.filter((x) => x !== n)
      : [...cal.workingDays, n].sort((a, b) => a - b);
    useApp.getState().updateCalendar({ workingDays: next });
  };
  return (
    <>
      <h3>稼働カレンダー（§9.1）</h3>
      <div className="row wd-row" data-testid="workingdays">
        {WD_LABELS.map((lbl, n) => (
          <button
            key={n}
            className={'wd-btn' + (wd.has(n) ? ' on' : '') + (n === 0 || n === 6 ? ' weekend' : '')}
            title={wd.has(n) ? '稼働日（クリックで非稼働に）' : '非稼働日（クリックで稼働に）'}
            onClick={() => toggle(n)}
          >
            {lbl}
          </button>
        ))}
      </div>
      <div className="field">
        <label>祝日（1行1日・yyyy-mm-dd）</label>
        <textarea
          rows={2}
          defaultValue={cal.holidays.join('\n')}
          placeholder={'2026-05-03\n2026-05-04'}
          onBlur={(e) => {
            const hs = e.target.value
              .split(/[\s,]+/)
              .map((x) => x.trim())
              .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
            useApp.getState().updateCalendar({ holidays: hs });
          }}
        />
      </div>
    </>
  );
}

type ArrayFilterKey = 'disciplines' | 'statuses';

export function LeftPanel() {
  const filter = useApp((s) => s.viewSpec.filter);
  const displayMode = useApp((s) => s.viewSpec.displayMode);
  const expandLevel = useApp((s) => s.expandLevel);
  const me = useApp((s) => s.me);
  const tasks = useApp((s) => s.tasks);
  const dependencies = useApp((s) => s.dependencies);
  const viewSpec = useApp((s) => s.viewSpec);
  const dataDate = useApp((s) => s.project.dataDate);
  const cpHighlight = useApp((s) => s.cpHighlight);

  const calendar = useApp(selectActiveCalendar);
  const cpm = useMemo(
    () => selectCpm(tasks, dependencies, dataDate, calendar),
    [tasks, dependencies, dataDate, calendar],
  );
  const stats = useMemo(
    () =>
      deriveVisibleGraph(tasks, dependencies, {
        ...viewSpec,
        criticalTasks: cpm.criticalTasks,
        criticalEdges: cpm.criticalEdges,
        cpHighlight,
      }).stats,
    [tasks, dependencies, viewSpec, cpm, cpHighlight],
  );
  const assignees = useMemo(
    () => [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort(),
    [tasks],
  );

  const chip = (key: ArrayFilterKey, val: string, label: string) => (
    <span
      key={val}
      className={'chip' + (((filter[key] as string[] | undefined) || []).includes(val) ? ' on' : '')}
      onClick={() => useApp.getState().toggleArrayFilter(key, val)}
    >
      {label}
    </span>
  );

  return (
    <div className="panel">
      <h3>私は誰（updatedBy / @me）</h3>
      <input
        value={me}
        onChange={(e) => useApp.getState().setMe(e.target.value)}
        style={{ width: '100%', padding: '4px 6px' }}
      />

      <h3>組込みビュー</h3>
      <div className="row">
        <button className="btn" onClick={() => useApp.getState().quickMyTasks()}>
          自分のタスク
        </button>
        <button
          className={'btn' + (viewSpec.filter.criticalOnly ? ' on' : '')}
          onClick={() => useApp.getState().quickCriticalOnly()}
          title="クリティカルパス上のタスクだけを抽出（§2.8）"
        >
          CPのみ
        </button>
        <button
          className="btn"
          onClick={() =>
            useApp.getState().setFilter({ milestonesOnly: !filter.milestonesOnly } as Partial<GraphFilter>)
          }
        >
          マイルストーン
        </button>
      </div>

      <SavedViews />

      <WbsTreePanel />

      <h3>フィルタ（AND結合）</h3>
      <div className="field">
        <label>工種</label>
        <div className="row">{DISCIPLINES.map((d) => chip('disciplines', d, d))}</div>
      </div>
      <div className="field">
        <label>ステータス</label>
        <div className="row">{STATUSES.map((s) => chip('statuses', s, s.replace('_', ' ')))}</div>
      </div>
      <div className="field">
        <label>担当</label>
        <select
          value={(filter.assignees && filter.assignees[0]) || ''}
          onChange={(e) =>
            useApp.getState().setFilter({ assignees: e.target.value ? [e.target.value] : [] })
          }
        >
          <option value="">（すべて）</option>
          <option value="@me">@me（{me}）</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>WBSプレフィックス</label>
        <input
          placeholder="例 1.2"
          value={(filter.wbsPrefixes && filter.wbsPrefixes[0]) || ''}
          onChange={(e) =>
            useApp.getState().setFilter({ wbsPrefixes: e.target.value ? [e.target.value.trim()] : [] })
          }
        />
      </div>
      <div className="field">
        <label>テキスト検索</label>
        <input
          placeholder="名前/notes"
          value={filter.text || ''}
          onChange={(e) => useApp.getState().setFilter({ text: e.target.value })}
        />
      </div>
      <div className="row">
        <span>表示モード:</span>
        <button
          className={'btn' + (displayMode === 'DIM' ? ' on' : '')}
          onClick={() => useApp.getState().setDisplayMode('DIM')}
        >
          DIM減光
        </button>
        <button
          className={'btn' + (displayMode === 'ISOLATE' ? ' on' : '')}
          onClick={() => useApp.getState().setDisplayMode('ISOLATE')}
        >
          ISOLATE抽出
        </button>
      </div>
      <div className="row">
        <button className="btn" onClick={() => useApp.getState().clearFilter()}>
          フィルタ解除
        </button>
      </div>

      <h3>WBS展開レベル（§2.7）</h3>
      <div className="row">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className={'btn' + (expandLevel === n ? ' on' : '')}
            onClick={() => useApp.getState().setExpandLevel(n)}
          >
            Lv{n}
          </button>
        ))}
        <button className="btn" onClick={() => useApp.getState().collapseAll()}>
          全折り畳み
        </button>
      </div>

      <CalendarEditor />

      <h3>表示統計</h3>
      <div className="stat">
        全タスク: <b>{stats.total}</b>
      </div>
      <div className="stat" data-testid="visible-count">
        表示ノード: <b>{stats.visible}</b>（集約 {stats.aggregates}）
      </div>
      <div className="stat">
        表示エッジ: <b>{stats.edges}</b>
      </div>
      <div className="stat">
        マッチ: <b>{stats.matched}</b>
      </div>

      <h3>凡例</h3>
      <div className="legend">
        <span>
          <i style={{ background: DISC_COLOR.E }} />
          設計E
        </span>
        <span>
          <i style={{ background: DISC_COLOR.P }} />
          調達P
        </span>
        <span>
          <i style={{ background: DISC_COLOR.C }} />
          施工C
        </span>
      </div>
    </div>
  );
}
