// ============================================================================
// View Shell（§12.2）: グラフ/テーブル/ガント(disabled) のタブ＋器。
// マウント戦略: 非アクティブ側は display:none で常駐（レイアウト計算が止まり最軽量。
//   ビューポート/スクロール位置/選択が保たれる）。復帰時に fitView は呼ばない。
// 選択・フィルタ・折り畳みはストア共有状態なので「同期は基本なにもしない」で成立する。
// ============================================================================
import { useEffect } from 'react';
import { useApp } from '../store/store';
import type { ActiveView } from '../domain';
import { CanvasArea } from './CanvasArea';
import { TableView } from './table/TableView';

function Tab({ view, label, disabled }: { view: ActiveView; label: string; disabled?: boolean }) {
  const active = useApp((s) => s.activeView === view);
  return (
    <button
      className={'viewtab' + (active ? ' active' : '')}
      disabled={disabled}
      data-testid={'viewtab-' + view}
      onClick={() => !disabled && useApp.getState().setActiveView(view)}
      title={disabled ? 'Phase 3 で提供予定' : label}
    >
      {label}
      {disabled ? <span className="soon">（近日）</span> : null}
    </button>
  );
}

export function ViewShell() {
  const activeView = useApp((s) => s.activeView);

  // グラフへ復帰した時: 選択対象を必ず見せる（祖先WBS展開＋センタリング）。§12.2。
  useEffect(() => {
    if (activeView !== 'graph') return;
    const s = useApp.getState();
    if (s.selection.taskId) {
      s.revealTask(s.selection.taskId);
      // 展開反映後にパン（センタリングのみ・fitViewはしない）。
      setTimeout(() => useApp.getState().runners.centerSelected?.(), 60);
    }
  }, [activeView]);

  // テーブルへ復帰した時: 折り畳み中の祖先を展開（スクロール追従は TableView 側）。
  useEffect(() => {
    if (activeView !== 'table') return;
    const s = useApp.getState();
    if (s.selection.taskId) s.revealTask(s.selection.taskId);
  }, [activeView]);

  return (
    <div className="viewshell">
      <div className="viewtabs">
        <Tab view="graph" label="グラフ" />
        <Tab view="table" label="テーブル" />
        <Tab view="gantt" label="ガント" disabled />
      </div>
      <div className="viewstack">
        <div className="view-pane" style={{ display: activeView === 'graph' ? 'flex' : 'none' }}>
          <CanvasArea />
        </div>
        <div className="view-pane" style={{ display: activeView === 'table' ? 'flex' : 'none' }}>
          <TableView active={activeView === 'table'} />
        </div>
      </div>
    </div>
  );
}
