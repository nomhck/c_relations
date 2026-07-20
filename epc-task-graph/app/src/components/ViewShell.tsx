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

function Tab({
  view,
  label,
  disabled,
  hint,
}: {
  view: ActiveView;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  const active = useApp((s) => s.activeView === view);
  return (
    <button
      className={'viewtab' + (active ? ' active' : '')}
      disabled={disabled}
      data-testid={'viewtab-' + view}
      onClick={() => !disabled && useApp.getState().setActiveView(view)}
      title={disabled ? 'Phase 3 で提供予定' : hint ? `${label}（${hint}）` : label}
    >
      {label}
      {hint ? <span className="viewtab-key">{hint}</span> : null}
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

  // ビュー切替ショートカット（§12.6 PR-T2）: g=グラフ / t=テーブル。全ビュー共通。
  // g/t はグラフ・テーブルどちらのキー処理でも未使用なので衝突しない。
  // 編集中（input/textarea/select/contentEditable）と修飾キー併用時は無効。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return;
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        useApp.getState().setActiveView('graph');
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        useApp.getState().setActiveView('table');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="viewshell">
      <div className="viewtabs">
        <Tab view="graph" label="グラフ" hint="G" />
        <Tab view="table" label="テーブル" hint="T" />
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
