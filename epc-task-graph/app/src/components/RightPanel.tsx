// 右パネル（§2.9）: 属性フォーム＋依存（先行/後続）＋WBS（親/兄弟）＋CPM欄（ES/EF/LS/LF/TF）。
import { useMemo } from 'react';
import { useApp } from '../store/store';
import { selectCpm } from '../store/selectors';
import { DISCIPLINES, STATUSES, wbsPath, type Dependency, type Task } from '../domain';

export function RightPanel() {
  const task = useApp((s) => s.tasks.find((t) => t.id === s.selection.taskId));
  const deps = useApp((s) => s.dependencies);
  const tasks = useApp((s) => s.tasks);
  const dataDate = useApp((s) => s.project.dataDate);
  const cpm = useMemo(() => selectCpm(tasks, deps, dataDate), [tasks, deps, dataDate]);

  if (!task)
    return (
      <div className="panel right">
        <h3>タスク未選択</h3>
        <p className="stat">ノードをクリックすると属性・依存を編集できます。</p>
      </div>
    );

  const upd = (patch: Partial<Task>) => useApp.getState().updateTask(task.id, patch);
  const preds = deps.filter((d) => d.successorId === task.id);
  const succs = deps.filter((d) => d.predecessorId === task.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const siblings = tasks.filter((t) => t.wbsCode === task.wbsCode && t.id !== task.id);

  const depItem = (d: Dependency, otherId: string) => (
    <div className="depitem" key={d.id}>
      <span className="name" onClick={() => useApp.getState().setSelection({ taskId: otherId })}>
        {byId.get(otherId)?.name || otherId.slice(0, 6)}
      </span>
      <span className="stat">
        {d.type} {d.lagDays ? (d.lagDays > 0 ? '+' : '') + d.lagDays + 'd' : ''}
      </span>
      <span className="x" title="依存削除" onClick={() => useApp.getState().deleteDeps([d.id])}>
        ×
      </span>
    </div>
  );

  return (
    <div className="panel right">
      <h3>属性</h3>
      <div className="field">
        <label>名前</label>
        <input value={task.name} onChange={(e) => upd({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>WBSコード</label>
        <input value={task.wbsCode} onChange={(e) => upd({ wbsCode: e.target.value })} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>工種</label>
          <select value={task.discipline} onChange={(e) => upd({ discipline: e.target.value as Task['discipline'] })}>
            {DISCIPLINES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>ステータス</label>
          <select value={task.status} onChange={(e) => upd({ status: e.target.value as Task['status'] })}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>進捗%</label>
          <input
            type="number"
            min={0}
            max={100}
            value={task.progress}
            onChange={(e) => upd({ progress: Math.max(0, Math.min(100, +e.target.value || 0)) })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>期間(日)</label>
          <input
            type="number"
            min={0}
            disabled={task.isMilestone}
            value={task.durationDays}
            onChange={(e) => upd({ durationDays: +e.target.value || 0 })}
          />
        </div>
      </div>
      <div className="field">
        <label>担当</label>
        <input value={task.assignee} onChange={(e) => upd({ assignee: e.target.value })} />
      </div>
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={task.isMilestone}
            onChange={(e) =>
              upd({ isMilestone: e.target.checked, durationDays: e.target.checked ? 0 : task.durationDays })
            }
          />{' '}
          マイルストーン
        </label>
      </div>
      <div className="field">
        <label>notes</label>
        <textarea rows={2} value={task.notes} onChange={(e) => upd({ notes: e.target.value })} />
      </div>

      <h3>依存（先行/後続）</h3>
      <div className="stat">先行（predecessors）</div>
      {preds.length ? preds.map((d) => depItem(d, d.predecessorId)) : <div className="stat">— なし</div>}
      <div className="stat" style={{ marginTop: 6 }}>
        後続（successors）
      </div>
      {succs.length ? succs.map((d) => depItem(d, d.successorId)) : <div className="stat">— なし</div>}
      <div className="row">
        <button className="btn" onClick={() => useApp.getState().toggleFocus(task.id)}>
          近傍フォーカス (H)
        </button>
      </div>

      <h3>WBS（親/兄弟）</h3>
      <div className="stat">パス: {wbsPath(task.wbsCode).join(' › ') || '（ルート）'}</div>
      <div className="stat" style={{ marginTop: 4 }}>
        兄弟タスク（{siblings.length}）
      </div>
      {siblings.slice(0, 8).map((t) => (
        <div className="depitem" key={t.id}>
          <span className="name" onClick={() => useApp.getState().setSelection({ taskId: t.id })}>
            {t.name}
          </span>
        </div>
      ))}

      <h3>CPM（Step1: 暦日・FS）</h3>
      {(() => {
        const r = cpm.byTask.get(task.id);
        if (!r) return <div className="stat">—（未計算）</div>;
        return (
          <>
            <div className="stat">
              ES <b>{r.esDate}</b>（+{r.es}d） · EF <b>{r.efDate}</b>（+{r.ef}d）
            </div>
            <div className="stat">
              LS <b>{r.lsDate}</b>（+{r.ls}d） · LF <b>{r.lfDate}</b>（+{r.lf}d）
            </div>
            <div className="stat">
              トータルフロート（TF）: <b>{r.totalFloat}日</b>{' '}
              {r.isCritical ? (
                <span style={{ color: '#dc2626', fontWeight: 700 }}>◆ クリティカル</span>
              ) : r.totalFloat <= 5 ? (
                <span style={{ color: '#d97706', fontWeight: 700 }}>準クリティカル</span>
              ) : null}
            </div>
          </>
        );
      })()}
      <div className="meta-line" style={{ marginTop: 8 }}>
        rev {task.rev} · 更新 {task.updatedBy} · {task.updatedAt.slice(0, 16).replace('T', ' ')}
      </div>
    </div>
  );
}
