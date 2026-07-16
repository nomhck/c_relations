// 左パネル（§2.8）: 私は誰・組込みビュー・フィルタ（DIM/ISOLATE）・展開レベル・統計・凡例。
import { useMemo } from 'react';
import { useApp } from '../store/store';
import { selectCpm } from '../store/selectors';
import {
  deriveVisibleGraph,
  DISCIPLINES,
  STATUSES,
  DISC_COLOR,
  type GraphFilter,
} from '../domain';

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

  const cpm = useMemo(() => selectCpm(tasks, dependencies, dataDate), [tasks, dependencies, dataDate]);
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
