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
  naturalWbsCompare,
  DISC_COLOR,
  type Discipline,
  type VisibleNode,
} from '../domain';
import { toRFNodes, toRFEdges, type RFNodeData } from '../adapters/reactflow';
import { dagreLayout } from '../layout/layout';
import { useApp, explainReject, nameOf, selectActiveCalendar } from '../store/store';
import { selectCpm } from '../store/selectors';
import { nodeTypes } from './nodes';

// 俯瞰グリッド整列（§2.10/デザイン刷新）: 表示がすべて集約ノード（＝WBS群の俯瞰）のとき、
// LR依存チェーンだと横長になり fitView が極端に縮小→ノードが判読不能になる。WBS自然順で
// タイル状に敷き詰め、読める倍率で全群が一望できるようにする。集約は非永続の表示専用ノード
// なので座標を差し替えても実データ（タスク位置）に影響しない。タスクを含む表示は従来どおり。
const OVR_CW = 208;
const OVR_CH = 132;
function gridPackOverview(vnodes: VisibleNode[]): VisibleNode[] {
  if (vnodes.length < 2 || vnodes.length > 400) return vnodes;
  if (!vnodes.every((n) => n.kind === 'aggregate')) return vnodes;
  const sorted = [...vnodes].sort((a, b) => naturalWbsCompare((a as any).prefix, (b as any).prefix));
  const cols = Math.max(1, Math.round(Math.sqrt(sorted.length * 1.7))); // 横長バイアスで一望しやすく
  return sorted.map((n, i) => ({
    ...n,
    position: { x: (i % cols) * OVR_CW, y: Math.floor(i / cols) * OVR_CH },
  }));
}

function FocusBar() {
  const focus = useApp((s) => s.viewSpec.focus);
  const name = useApp((s) => (s.viewSpec.focus ? nameOf(s.viewSpec.focus.taskId) : ''));
  if (!focus) return null;
  const mode = focus.mode || 'isolate';
  const setRange = (up: number, down: number) => useApp.getState().setFocusRange(up, down);
  const stepper = (label: string, val: number, on: (v: number) => void) => (
    <span className="focus-step">
      {label}
      <button className="btn" title="1世代減らす" onClick={() => on(Math.max(0, val - 1))}>
        −
      </button>
      <b>{val}</b>
      <button className="btn" title="1世代増やす" onClick={() => on(val + 1)}>
        ＋
      </button>
      世代
    </span>
  );
  return (
    <div className="focusbar">
      <span>
        <b>{name}</b> の関係タスク（{mode === 'highlight' ? 'ハイライト' : '抽出'}）
      </span>
      {stepper('上流', focus.up ?? 2, (v) => setRange(v, focus.down ?? 2))}
      {stepper('下流', focus.down ?? 2, (v) => setRange(focus.up ?? 2, v))}
      <span className="focus-modes">
        <button
          className={'btn' + (mode === 'highlight' ? ' on' : '')}
          title="全体を残して関係タスクを強調"
          onClick={() => useApp.getState().setFocusMode('highlight')}
        >
          ハイライト
        </button>
        <button
          className={'btn' + (mode === 'isolate' ? ' on' : '')}
          title="関係タスクだけを抽出表示"
          onClick={() => {
            useApp.getState().setFocusMode('isolate');
            useApp.getState().fit();
          }}
        >
          抽出
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
  const dataDate = useApp((s) => s.project.dataDate);
  const cpHighlight = useApp((s) => s.cpHighlight);
  const focus = viewSpec.focus;
  const rf = useReactFlow();
  const dragSrc = useRef<string | null>(null);

  // CPM 導出値（メモ化・参照が変わった時だけ再計算、§9.2）。
  const calendar = useApp(selectActiveCalendar);
  const cpm = useMemo(
    () => selectCpm(tasks, dependencies, dataDate, calendar),
    [tasks, dependencies, dataDate, calendar],
  );
  // 表示パイプラインへ CPM を注入した viewSpec（安定参照）。CP強調/CPのみ を統合。
  const augSpec = useMemo(
    () => ({ ...viewSpec, criticalTasks: cpm.criticalTasks, criticalEdges: cpm.criticalEdges, cpHighlight }),
    [viewSpec, cpm, cpHighlight],
  );

  const derived = useMemo(
    () => deriveVisibleGraph(tasks, dependencies, augSpec),
    [tasks, dependencies, augSpec],
  );
  const lastDerived = useRef(derived);
  lastDerived.current = derived;

  // 俯瞰（全集約）ならグリッド整列した表示用ノードを使う（座標差し替えは集約のみ・非永続）。
  const displayNodes = useMemo(() => gridPackOverview(derived.visibleNodes), [derived]);

  const [nodes, setNodes] = useState<Node<RFNodeData>[]>(() => toRFNodes(displayNodes));
  const [edges, setEdges] = useState<Edge[]>(() => toRFEdges(derived.visibleEdges));
  useEffect(() => {
    setNodes(toRFNodes(displayNodes));
    setEdges(toRFEdges(derived.visibleEdges));
  }, [derived, displayNodes]);

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
    // 選択タスクへセンタリング（ビュー間同期・§12.2。fitView はしない＝ズーム保持）。
    s.setRunner('centerSelected', () => {
      const st = useApp.getState();
      const id = st.selection.taskId;
      if (!id) return;
      const t = st.tasks.find((x) => x.id === id);
      if (t) rf.setCenter(t.position.x, t.position.y, { zoom: rf.getZoom(), duration: 400 });
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
      // 多ビュー: グラフがアクティブな時だけグラフ用ショートカットを処理（§12.2）。
      // Undo/Redo（meta+z）は上で先に処理済みなので全ビュー共通で効く。
      if (useApp.getState().activeView !== 'graph') return;
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
          nodeColor={(nd) => {
            const n = (nd.data as RFNodeData)?.n;
            // 俯瞰でもクリティカルパスを一目化（§2.10/§2.11）: CPタスク/CPを含む集約は赤系。
            if (n?.kind === 'task' && cpm.criticalTasks.has(n.id)) return '#ef4444';
            if (n?.kind === 'aggregate') return n.hasCritical ? '#f87171' : '#94a3b8';
            const disc =
              n?.kind === 'task' ? (n as { task: { discipline: Discipline } }).task.discipline : 'OTHER';
            return DISC_COLOR[disc] || '#64748b';
          }}
        />
        <Controls />
      </ReactFlow>
      <div className="hint">
        空白ダブルクリックで作成 · ハンドルからドラッグで接続 · N/Tab/Enter/H/F/1-3/Delete/⌘Z · 表示 {st.visible} / 全 {st.total}
      </div>
    </div>
  );
}
