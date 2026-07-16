// ヘッダ/ツールバー（§1.3）: プロジェクト切替・CP強調・完了日・作成・整列・Undo/Redo・
//   デモ生成・Export/Import・保存状態。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useApp } from '../store/store';
import { selectCpm } from '../store/selectors';
import { validateDoc, wbsPath } from '../domain';

// プロジェクト完了日サマリ（§9.2）。完了日が動いたらフラッシュして即時フィードバック。
function CompletionSummary() {
  const tasks = useApp((s) => s.tasks);
  const deps = useApp((s) => s.dependencies);
  const dataDate = useApp((s) => s.project.dataDate);
  const cpm = useMemo(() => selectCpm(tasks, deps, dataDate), [tasks, deps, dataDate]);
  const endDate = cpm.projectEndDate;
  const [flash, setFlash] = useState(false);
  const prev = useRef(endDate);
  useEffect(() => {
    if (prev.current !== endDate) {
      prev.current = endDate;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [endDate]);
  return (
    <span className={'completion' + (flash ? ' flash' : '')} data-testid="completion" title="CPM Step1 による完了日（暦日・FS）">
      完了日: <b>{endDate || '—'}</b>（+{cpm.projectEnd}d · CP {cpm.criticalTasks.size}）
    </span>
  );
}

function ProjectBar() {
  const projectId = useApp((s) => s.project.id);
  const name = useApp((s) => s.project.name);
  const list = useApp((s) => s.projectList);
  return (
    <span className="projectbar">
      <select
        value={projectId}
        onChange={(e) => useApp.getState().switchProject(e.target.value)}
        title="プロジェクト切替"
      >
        {list.length === 0 ? <option value={projectId}>{name}</option> : null}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn" title="新規プロジェクト" onClick={() => useApp.getState().newProject('新規プロジェクト')}>
        ＋新規
      </button>
      <button className="btn" title="複製" onClick={() => useApp.getState().duplicateCurrentProject()}>
        複製
      </button>
      <button
        className="btn"
        title="削除"
        onClick={() => {
          if (confirm('このプロジェクトを削除しますか？（元に戻せません）')) useApp.getState().deleteCurrentProject();
        }}
      >
        削除
      </button>
    </span>
  );
}

export function Header() {
  const name = useApp((s) => s.project.name);
  const saveStatus = useApp((s) => s.saveStatus);
  const runners = useApp((s) => s.runners);
  const cpHighlight = useApp((s) => s.cpHighlight);
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
      <ProjectBar />
      <CompletionSummary />
      <button
        className={'btn' + (cpHighlight ? ' on' : '')}
        onClick={() => useApp.getState().toggleCpHighlight()}
        title="クリティカルパスを赤で強調（§2.11）"
        data-testid="cp-toggle"
      >
        CP強調
      </button>
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
