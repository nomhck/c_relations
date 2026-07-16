// ============================================================================
// カスタムノード（§2.11 EPC視覚規約）。すべて memo・LOD分岐（zoom<0.4で矩形化、§2.6）。
// React Flow 依存はこのコンポーネント層に閉じ込める（domain/store は非依存）。
// ============================================================================
import { memo } from 'react';
import { Handle, Position, useStore as useRFStore, type NodeProps } from '@xyflow/react';
import { DISC_COLOR } from '../adapters/reactflow';
import type { VisibleAggregateNode, VisibleTaskNode } from '../domain';
import { useApp } from '../store/store';

export const TaskNode = memo(function TaskNode({ id, data }: NodeProps) {
  const n = (data as { n: VisibleTaskNode }).n;
  const t = n.task;
  const zoom = useRFStore((s) => s.transform[2]);
  const editing = useApp((s) => s.editingId === id);
  const selected = useApp((s) => s.selection.taskId === id);
  const lod = zoom < 0.4;
  const color = DISC_COLOR[t.discipline] || DISC_COLOR.OTHER;

  if (lod && !editing) {
    return (
      <div
        className={'lod-node' + (n.critical ? ' critical' : '')}
        style={{ background: color, opacity: n.dim ? 0.2 : n.outside ? 0.5 : 1 }}
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  const cls = [
    'task-node',
    'st-' + t.status,
    n.dim ? 'dim' : '',
    n.outside ? 'outside' : '',
    n.isOrigin ? 'origin' : '',
    n.critical ? 'critical' : '',
    selected ? 'sel' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const commit = (val: string) => {
    const v = (val || '').trim();
    if (v) useApp.getState().updateTask(id, { name: v });
    useApp.getState().setEditing(null);
  };

  return (
    <div className={cls}>
      <div className="disc-bar" style={{ background: color }} />
      <Handle type="target" position={Position.Left} />
      {editing ? (
        <input
          className="task-name-input nodrag"
          autoFocus
          defaultValue={t.name}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit((e.target as HTMLInputElement).value);
            } else if (e.key === 'Escape') {
              useApp.getState().setEditing(null);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <div className="task-name">{t.name}</div>
      )}
      <div className="task-meta">
        {t.discipline} · {t.assignee || '—'} · {t.durationDays}d
      </div>
      {t.status === 'DONE' ? <span className="badge-done">✓</span> : null}
      {t.status === 'IN_PROGRESS' ? (
        <div className="progress">
          <i style={{ width: t.progress + '%' }} />
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const MilestoneNode = memo(function MilestoneNode({ id, data }: NodeProps) {
  const n = (data as { n: VisibleTaskNode }).n;
  const t = n.task;
  const selected = useApp((s) => s.selection.taskId === id);
  return (
    <div className="ms-wrap">
      <Handle type="target" position={Position.Left} />
      <div className={'ms-node' + (selected ? ' sel' : '') + (n.critical ? ' critical' : '')} />
      <div className="ms-label">{t.name}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const AggregateNode = memo(function AggregateNode({ id, data }: NodeProps) {
  const n = (data as { n: VisibleAggregateNode }).n;
  const zoom = useRFStore((s) => s.transform[2]);
  const total = n.count || 1;
  const expand = () => useApp.getState().expandAggregate(id);
  const seg = (c: number, key: string) =>
    c > 0 ? (
      <span key={key} style={{ width: (c / total) * 100 + '%', background: DISC_COLOR[key as 'E'] }} />
    ) : null;

  if (n.continuation) {
    return (
      <div
        className="agg-node"
        style={{ borderStyle: 'dotted', background: '#eef2ff' }}
        title="フォーカス深さの先で折り畳み内へ続く経路（§2.9）"
      >
        <Handle type="target" position={Position.Left} />
        <div className="agg-title">⋯ {n.prefix}</div>
        <div className="agg-sub">{n.count} 件が内部に続く</div>
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }
  if (zoom < 0.4) {
    return (
      <div className="lod-node" style={{ background: '#94a3b8', width: 60 }} onDoubleClick={expand}>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }
  return (
    <div
      className={'agg-node' + (n.dim ? ' dim' : '')}
      onDoubleClick={expand}
      title="ダブルクリックで展開（E）"
    >
      <Handle type="target" position={Position.Left} />
      <div className="agg-title">▣ {n.prefix}</div>
      <div className="agg-sub">
        {n.count} タスク · 進捗平均 {n.avgProgress}%
      </div>
      <div className="agg-bars">
        {seg(n.disc.E, 'E')}
        {seg(n.disc.P, 'P')}
        {seg(n.disc.C, 'C')}
        {seg(n.disc.OTHER, 'OTHER')}
      </div>
      {n.hasMilestone ? <span className="agg-badges">🚩</span> : null}
      {n.hasCritical ? <span className="agg-badges cp" title="内部にクリティカルタスクあり">◆CP</span> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const nodeTypes = { task: TaskNode, milestone: MilestoneNode, aggregate: AggregateNode };
