// ヘッダ/ツールバー（§1.3）: 作成・整列・Undo/Redo・デモ生成・Export/Import・保存状態。
import { useRef } from 'react';
import { useStore } from 'zustand';
import { useApp } from '../store/store';
import { validateDoc, wbsPath } from '../domain';

export function Header() {
  const name = useApp((s) => s.project.name);
  const saveStatus = useApp((s) => s.saveStatus);
  const runners = useApp((s) => s.runners);
  // Undo/Redo 可否は zundo の temporal ストアから購読（§2.3）。
  const canUndo = useStore(useApp.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useApp.temporal, (s) => s.futureStates.length > 0);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const doc = useApp.getState().toDoc();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.project.name}-${new Date().toISOString().slice(0, 10)}.epcgraph.json`;
    a.click();
  };
  const doImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(reader.result as string);
        const v = validateDoc(doc);
        if (!v.ok) {
          useApp.getState().showToast('インポート検証エラー: ' + v.errors.slice(0, 2).join(' / '), true);
          return;
        }
        useApp.getState().loadDoc(doc);
        useApp.getState().fit(200);
        useApp.getState().showToast('インポートしました（' + doc.tasks.length + 'タスク）');
      } catch {
        useApp.getState().showToast('JSON解析に失敗しました', true);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="header">
      <span className="proj">{name}</span>
      <button className="btn primary" onClick={() => runners.createAtCenter?.()}>
        ＋タスク (N)
      </button>
      <button className="btn" onClick={() => runners.layoutVisible?.()}>
        自動整列（表示中）
      </button>
      <button className="btn" onClick={() => useApp.getState().layoutAll()}>
        全体整列（Worker）
      </button>
      <button className="btn" disabled={!canUndo} onClick={() => useApp.getState().undo()}>
        ↶ Undo
      </button>
      <button className="btn" disabled={!canRedo} onClick={() => useApp.getState().redo()}>
        Redo ↷
      </button>
      <span className="spacer" />
      <button className="btn" onClick={() => useApp.getState().generateDemo()}>
        4,000ノード生成
      </button>
      <button className="btn" onClick={doExport}>
        Export
      </button>
      <button className="btn" onClick={() => fileRef.current?.click()}>
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.epcgraph.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.[0]) doImport(e.target.files[0]);
          e.target.value = '';
        }}
      />
      <span className={'savebadge ' + saveStatus} data-testid="savebadge">
        {saveStatus === 'saved' ? '保存済み ✓' : '保存中…'}
      </span>
    </div>
  );
}

export function Breadcrumb() {
  const task = useApp((s) => s.tasks.find((t) => t.id === s.selection.taskId));
  if (!task) return <div className="breadcrumb">タスク未選択</div>;
  const path = wbsPath(task.wbsCode);
  return (
    <div className="breadcrumb">
      WBS:{' '}
      {path.length
        ? path.map((p, i) => (
            <span key={p}>
              {i > 0 ? ' › ' : ''}
              <span className="crumb" onClick={() => useApp.getState().setFilter({ wbsPrefixes: [p] })}>
                {p}
              </span>
            </span>
          ))
        : '（ルート直下）'}
      {' › '}
      <b>{task.name}</b>
    </div>
  );
}
