// ============================================================================
// 編集キャンバス（React Flow v12）。§2.6 表示パイプラインの出力のみを描画し、
// onlyRenderVisibleElements + LOD + memo ノードで大規模を捌く。
// domain の deriveVisibleGraph が「何を載せるか」を一元決定する。
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type IsValidConnection,
} from '@xyflow/react';
import {
  deriveVisibleGraph,
  canConnect,
  DISC_COLOR,
  type Discipline,
  type VisibleNode,
} from '../domain';
import { toRFNodes, toRFEdges, type RFNodeData } from '../adapters/reactflow';
import { dagreLayout } from '../layout/layout';
import { useApp, explainReject, nameOf } from '../store/store';
import { nodeTypes } from './nodes';

function FocusBar() {
  const focus = useApp((s) => s.viewSpec.focus);
  const name = useApp((s) => (s.viewSpec.focus ? nameOf(s.viewSpec.focus.taskId) : ''));
  if (!focus) return null;
  return (
    <div className="focusbar">
      <span>
        <b>{name}</b> の上流{focus.up}・下流{focus.down}階層を表示中
      </span>
      <span>
        深さ{' '}
        <button className="btn" onClick={() => useApp.getState().incFocusDepth(-1)}>
          −
        </button>{' '}
        <button className="btn" onClick={() => useApp.getState().incFocusDepth(1)}>
          ＋
        </button>
      </span>
      <button className="btn" onClick={() => useApp.getState().clearFocus()}>
        解除 (Esc)
      </button>
    </div>
  );
}

export function CanvasArea() {
  const tasks = useApp((s) => s.tasks);
  const dependencies = useApp((s) => s.dependencies);
  const viewSpec = useApp((s) => s.viewSpec);
  const focus = viewSpec.focus;
  const rf = useReactFlow();
  const dragSrc = useRef<string | null>(null);

  const derived = useMemo(
    () => deriveVisibleGraph(tasks, dependencies, viewSpec),
    [tasks, dependencies, viewSpec],
  );
  const lastDerived = useRef(derived);
  lastDerived.current = derived;

  const [nodes, setNodes] = useState<Node<RFNodeData>[]>(() => toRFNodes(derived.visibleNodes));
  const [edges, setEdges] = useState<Edge[]>(() => toRFEdges(derived.visibleEdges));
  useEffect(() => {
    setNodes(toRFNodes(derived.visibleNodes));
    setEdges(toRFEdges(derived.visibleEdges));
  }, [derived]);

  // 1,500ノード超の表示は警告（§2.6 第一の防御）
  const warned = useRef(false);
  useEffect(() => {
    if (derived.stats.visible > 1500 && !warned.current) {
      warned.current = true;
      useApp
        .getState()
        .showToast(
          `この操作で${derived.stats.visible}ノードが表示されます。フィルタか下位WBS展開を推奨（性能保証外）`,
          true,
        );
    } else if (derived.stats.visible <= 1500) warned.current = false;
  }, [derived]);

  const onNodesChange = useCallback((ch: NodeChange<Node<RFNodeData>>[]) => setNodes((nds) => applyNodeChanges(ch, nds)), []);
  const onEdgesChange = useCallback((ch: EdgeChange<Edge>[]) => setEdges((eds) => applyEdgeChanges(ch, eds)), []);
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    if (!node.id.startsWith('wbs::')) useApp.getState().setPosition(node.id, node.position);
  }, []);

  const isValid = useCallback<IsValidConnection>(({ source, target }) => {
    if (!source || !target) return false;
    if (source.startsWith('wbs::') || target.startsWith('wbs::')) return false;
    return canConnect(source, target, useApp.getState().dependencies).ok;
  }, []);
  const onConnect = useCallback(({ source, target }: Connection) => {
    if (!source || !target) return;
    if (source.startsWith('wbs::') || target.startsWith('wbs::')) return;
    useApp.getState().addDependencyChecked(source, target);
  }, []);
  const onConnectStart = useCallback((_e: unknown, p: { nodeId: string | null }) => {
    dragSrc.current = p.nodeId;
  }, []);
  const onConnectEnd = useCallback((e: MouseEvent | TouchEvent) => {
    const src = dragSrc.current;
    dragSrc.current = null;
    if (!src) return;
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e;
    const el = document.elementFromPoint(pt.clientX, pt.clientY);
    const nodeEl = el && el.closest ? el.closest('.react-flow__node') : null;
    const tgt = nodeEl && nodeEl.getAttribute('data-id');
    if (!tgt || tgt === src) return;
    const s = useApp.getState();
    if (tgt.startsWith('wbs::')) {
      s.expandAggregate(tgt);
      s.showToast('集約ノードを展開しました。実タスクへ接続してください（実エッジは実タスク間のみ）');
      return;
    }
    const chk = canConnect(src, tgt, s.dependencies);
    if (!chk.ok) s.showToast(explainReject(chk, s), true);
  }, []);

  const onSelectionChange = useCallback(({ nodes: sn, edges: se }: { nodes: Node[]; edges: Edge[] }) => {
    if (sn && sn.length === 1) {
      const id = sn[0].id;
      if (id.startsWith('wbs::')) useApp.getState().setSelection({ aggId: id });
      else useApp.getState().setSelection({ taskId: id });
    } else if (se && se.length === 1) {
      useApp.getState().setSelection({ edgeId: se[0].id });
    } else if ((!sn || !sn.length) && (!se || !se.length)) {
      useApp.getState().setSelection({});
    }
  }, []);
  const onNodesDelete = useCallback((del: Node[]) => {
    const ids = del.filter((n) => !n.id.startsWith('wbs::')).map((n) => n.id);
    if (ids.length) useApp.getState().deleteTasks(ids);
  }, []);
  const onEdgesDelete = useCallback((del: Edge[]) => {
    const ids = del.map((e) => (e.data as { realId?: string } | undefined)?.realId).filter(Boolean) as string[];
    if (ids.length) useApp.getState().deleteDeps(ids);
  }, []);
  const onNodeDoubleClick = useCallback((_e: unknown, node: Node) => {
    if (node.id.startsWith('wbs::')) useApp.getState().expandAggregate(node.id);
    else useApp.getState().setEditing(node.id);
  }, []);
  const onPaneDbl = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!(target.classList && target.classList.contains('react-flow__pane'))) return;
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      useApp.getState().addTask({ position: pos });
    },
    [rf],
  );

  // runners 登録（ツールバー/キーボードから呼ぶ）
  useEffect(() => {
    const s = useApp.getState();
    s.setRunner('fitView', () => rf.fitView({ duration: 400, padding: 0.2 }));
    s.setRunner('createAtCenter', () => {
      const pos = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      useApp.getState().addTask({ position: pos });
    });
    s.setRunner('layoutVisible', () => {
      const der = lastDerived.current;
      const pos = dagreLayout(der.visibleNodes, der.visibleEdges);
      const st = useApp.getState();
      const byId = new Map(st.tasks.map((t) => [t.id, t]));
      const updates: Record<string, { x: number; y: number }> = {};
      for (const vn of der.visibleNodes as VisibleNode[]) {
        const np = pos[vn.id];
        if (!np) continue;
        if (vn.kind === 'task') updates[vn.id] = np;
        else {
          const dx = np.x - vn.position.x;
          const dy = np.y - vn.position.y;
          for (const mid of vn.memberIds) {
            const mt = byId.get(mid);
            if (mt) updates[mid] = { x: mt.position.x + dx, y: mt.position.y + dy };
          }
        }
      }
      st.applyPositions(updates);
      setTimeout(() => rf.fitView({ duration: 400, padding: 0.2 }), 30);
      st.showToast('表示中サブグラフを整列しました（' + der.visibleNodes.length + 'ノード）');
    });
  }, [rf]);

  // キーボード（§2.2）。インライン編集中は無効化。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement).tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement).isContentEditable) return;
      const s = useApp.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        return;
      }
      if (meta) return;
      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          s.runners.createAtCenter?.();
          break;
        case 'Tab':
          if (s.selection.taskId) {
            e.preventDefault();
            s.createSuccessor(s.selection.taskId);
          }
          break;
        case 'Enter':
          if (s.selection.taskId) {
            e.preventDefault();
            s.setEditing(s.selection.taskId);
          }
          break;
        case 'h':
        case 'H':
          if (s.selection.taskId) s.toggleFocus(s.selection.taskId);
          break;
        case 'e':
        case 'E':
          if (s.selection.aggId) s.expandAggregate(s.selection.aggId);
          break;
        case '[':
          s.incFocusDepth(-1);
          break;
        case ']':
          s.incFocusDepth(1);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          rf.fitView({ duration: 400, padding: 0.2 });
          break;
        case '1':
          s.setExpandLevel(1);
          break;
        case '2':
          s.setExpandLevel(2);
          break;
        case '3':
          s.setExpandLevel(3);
          break;
        case 'Escape':
          s.escape();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rf]);

  const st = derived.stats;
  return (
    <div className="canvas-area" onDoubleClick={onPaneDbl}>
      {focus ? <FocusBar /> : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        isValidConnection={isValid}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onSelectionChange={onSelectionChange}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onlyRenderVisibleElements
        snapToGrid
        snapGrid={[15, 15]}
        connectionRadius={30}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift']}
        minZoom={0.05}
        maxZoom={2.5}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(nd) =>
            nd.type === 'aggregate'
              ? '#94a3b8'
              : DISC_COLOR[(nd.data as RFNodeData)?.n?.kind === 'task' ? ((nd.data as RFNodeData).n as { task: { discipline: Discipline } }).task.discipline : 'OTHER'] || '#64748b'
          }
        />
        <Controls />
      </ReactFlow>
      <div className="hint">
        空白ダブルクリックで作成 · ハンドルからドラッグで接続 · N/Tab/Enter/H/F/1-3/Delete/⌘Z · 表示 {st.visible} / 全 {st.total}
      </div>
    </div>
  );
}
