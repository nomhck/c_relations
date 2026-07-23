// ============================================================================
// ガントビュー（§9.3 / §12.4・Phase 3 / PR-G）。View Shell の第3タブ。
// §12.4 の接続契約に純粋に乗る:
//   1. 行集合 = selectTableRows（テーブルと同一の順序/折り畳み/フィルタ/ソート）
//   2. バー座標 = selectCpm().byTask の es/ef（暦日オフセット×日幅・線形）
//   3. WBS行のサマリバー = TableRow.esMin/efMax（deriveTableRows の集計・PR-T2で追加済み）
//   4. 行仮想化 = @tanstack/react-virtual（テーブルと共有・ROW_HEIGHT 共通）
// 描画方式: 自前の絶対配置 div（§9.3 スパイク判断＝SVGよりDOMバーが軽量で十分）。
// 左ペイン（名前列）と右ペイン（時間軸）を分離し、縦スクロールを同期・横スクロールは右のみ。
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { addCalendarDays, DISC_COLOR, type TableRow } from '../../domain';
import { useApp, selectActiveCalendar } from '../../store/store';
import { selectCpm, selectTableRows } from '../../store/selectors';
import { ROW_HEIGHT } from '../table/cells';

const LEFT_W = 260; // 名前ペイン幅
const HEAD_H = 30; // 日付軸ヘッダ高
const MS_DAY = 86400000;

function dayOffset(dateStr: string, base: string): number {
  return Math.round((Date.parse(dateStr) - Date.parse(base)) / MS_DAY);
}

// 月初の目盛り（yyyy-mm ラベル）を [0, maxOff] の範囲で列挙。
function monthTicks(dataDate: string, maxOff: number): { off: number; label: string }[] {
  const ticks: { off: number; label: string }[] = [];
  const d = new Date(dataDate + 'T00:00:00Z');
  d.setUTCDate(1);
  for (let i = 0; i < 1200; i++) {
    const iso = d.toISOString().slice(0, 10);
    const off = dayOffset(iso, dataDate);
    if (off > maxOff) break;
    if (off >= 0) ticks.push({ off, label: iso.slice(0, 7) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return ticks;
}

export function GanttView({ active }: { active: boolean }) {
  const tasks = useApp((s) => s.tasks);
  const dependencies = useApp((s) => s.dependencies);
  const viewSpec = useApp((s) => s.viewSpec);
  const dataDate = useApp((s) => s.project.dataDate);
  const cpHighlight = useApp((s) => s.cpHighlight);
  const tableSort = useApp((s) => s.tableSort);
  const selection = useApp((s) => s.selection);
  const [dayWidth, setDayWidth] = useState(4);

  const calendar = useApp(selectActiveCalendar);
  const cpm = useMemo(
    () => selectCpm(tasks, dependencies, dataDate, calendar),
    [tasks, dependencies, dataDate, calendar],
  );
  const augSpec = useMemo(
    () => ({ ...viewSpec, criticalTasks: cpm.criticalTasks, criticalEdges: cpm.criticalEdges, cpHighlight }),
    [viewSpec, cpm, cpHighlight],
  );
  const { rows } = useMemo(
    () => selectTableRows(tasks, dependencies, augSpec, tableSort, cpm.byTask),
    [tasks, dependencies, augSpec, tableSort, cpm],
  );

  // 時間ドメイン: dataDate(=0) 〜 全タスクの最遅 EF。
  const maxOff = useMemo(() => {
    let m = 1;
    for (const r of cpm.byTask.values()) if (r.ef > m) m = r.ef;
    return m;
  }, [cpm]);
  const timelineW = Math.max(200, (maxOff + 2) * dayWidth);
  const ticks = useMemo(() => monthTicks(dataDate, maxOff), [dataDate, maxOff]);

  const parentRef = useRef<HTMLDivElement>(null); // 右ペイン（縦横スクロール・仮想化の親）
  const leftInnerRef = useRef<HTMLDivElement>(null); // 左ペイン内側（縦スクロールを右に同期）

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // 右ペインの縦スクロールを左ペインへ反映（横は右のみ）。
  const onScroll = useCallback(() => {
    if (leftInnerRef.current && parentRef.current) {
      leftInnerRef.current.style.transform = `translateY(${-parentRef.current.scrollTop}px)`;
    }
  }, []);

  const rowsRef = useRef<TableRow[]>(rows);
  rowsRef.current = rows;
  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.id, i));
    return m;
  }, [rows]);
  const selId = selection.taskId || selection.aggId || null;

  useEffect(() => {
    if (!active) return;
    virtualizer.measure();
    onScroll();
    if (selId != null) {
      const idx = indexById.get(selId);
      if (idx != null) virtualizer.scrollToIndex(idx, { align: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const select = (r: TableRow) => {
    if (r.kind === 'wbs') useApp.getState().setSelection({ aggId: r.id });
    else useApp.getState().setSelection({ taskId: r.id });
  };

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="ganttview">
      <div className="gantt-toolbar">
        <span className="stat">
          ガント：<b>{rows.length}</b> 行 · 期間 <b>{maxOff}</b> 日（基準日 {dataDate}）
        </span>
        <span className="spacer" />
        <span className="gantt-zoom">
          日幅
          <button className="btn" title="縮小" onClick={() => setDayWidth((w) => Math.max(1.5, w - 1))}>
            －
          </button>
          <button className="btn" title="拡大" onClick={() => setDayWidth((w) => Math.min(16, w + 1))}>
            ＋
          </button>
        </span>
      </div>

      <div className="gantt-main">
        {/* 左ペイン: タスク名列（横固定・縦は右に同期） */}
        <div className="gantt-left" style={{ width: LEFT_W }}>
          <div className="gantt-left-head" style={{ height: HEAD_H }}>
            タスク
          </div>
          <div className="gantt-left-clip">
            <div ref={leftInnerRef} className="gantt-left-inner" style={{ height: totalSize }}>
              {virtualItems.map((vi) => {
                const r = rows[vi.index];
                if (!r) return null;
                const isWbs = r.kind === 'wbs';
                return (
                  <div
                    key={r.id}
                    className={'gantt-name' + (isWbs ? ' wbs' : '') + (r.id === selId ? ' sel' : '')}
                    style={{ transform: `translateY(${vi.start}px)`, height: ROW_HEIGHT }}
                    onClick={() => select(r)}
                  >
                    <span style={{ paddingLeft: 6 + r.depth * 13 }}>
                      {isWbs ? (
                        <>
                          <button
                            className="wbs-toggle"
                            onClick={(e) => {
                              e.stopPropagation();
                              useApp.getState().toggleCollapse(r.wbsPrefix || '');
                            }}
                          >
                            {r.collapsed ? '▸' : '▾'}
                          </button>
                          <b>WBS {r.wbsPrefix}</b>
                          <span className="muted">（{r.memberCount}）</span>
                        </>
                      ) : (
                        <span className="gantt-tname">
                          {r.task!.isMilestone ? '◆ ' : ''}
                          {r.task!.name || '（無題）'}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 右ペイン: 時間軸（縦横スクロール・仮想化の親） */}
        <div className="gantt-right" ref={parentRef} onScroll={onScroll} data-testid="gantt-scroll">
          <div className="gantt-axis" style={{ width: timelineW, height: HEAD_H }}>
            {ticks.map((t) => (
              <div key={t.off} className="gantt-tick" style={{ left: t.off * dayWidth }}>
                <span>{t.label}</span>
              </div>
            ))}
            {/* 基準日ライン（§12.4: project.dataDate = オフセット0） */}
            <div className="gantt-today" style={{ left: 0 }} title={'基準日 ' + dataDate} />
          </div>

          <div className="gantt-body" style={{ height: totalSize, width: timelineW }}>
            {/* 月グリッド線 */}
            {ticks.map((t) => (
              <div key={t.off} className="gantt-grid" style={{ left: t.off * dayWidth }} />
            ))}
            {virtualItems.map((vi) => {
              const r = rows[vi.index];
              if (!r) return null;
              return (
                <GanttBar
                  key={r.id}
                  row={r}
                  cpm={cpm.byTask.get(r.id) || null}
                  dataDate={dataDate}
                  dayWidth={dayWidth}
                  top={vi.start}
                  selected={r.id === selId}
                  onSelect={() => select(r)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttBar({
  row,
  cpm,
  dataDate,
  dayWidth,
  top,
  selected,
  onSelect,
}: {
  row: TableRow;
  cpm: { es: number; ef: number; isCritical: boolean } | null;
  dataDate: string;
  dayWidth: number;
  top: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const isWbs = row.kind === 'wbs';
  let es: number | null = null;
  let ef: number | null = null;
  let critical = false;

  if (isWbs) {
    // WBSサマリバー: 集計済み esMin/efMax（暦日）をオフセット化。
    if (row.esMin && row.efMax) {
      es = dayOffset(row.esMin, dataDate);
      ef = dayOffset(row.efMax, dataDate);
    }
    critical = !!row.hasCritical;
  } else if (cpm) {
    es = cpm.es;
    ef = cpm.ef;
    critical = cpm.isCritical;
  }

  const rowEl = (children: React.ReactNode) => (
    <div
      className={'gantt-track' + (selected ? ' sel' : '')}
      style={{ transform: `translateY(${top}px)`, height: ROW_HEIGHT }}
      onClick={onSelect}
    >
      {children}
    </div>
  );

  if (es == null || ef == null) return rowEl(null);

  const isMilestone = !isWbs && row.task?.isMilestone;
  const x = es * dayWidth;

  if (isMilestone) {
    return rowEl(<div className="gantt-ms" style={{ left: x }} title={row.task!.name} />);
  }

  const w = Math.max(3, (ef - es) * dayWidth);
  const color = critical
    ? '#ef4444'
    : isWbs
      ? '#94a3b8'
      : DISC_COLOR[row.task!.discipline] || DISC_COLOR.OTHER;
  const progress = !isWbs ? row.task!.progress : (row.avgProgress ?? 0);

  return rowEl(
    <div
      className={'gantt-bar' + (isWbs ? ' summary' : '') + (critical ? ' crit' : '')}
      style={{ left: x, width: w, background: color }}
      title={`${isWbs ? 'WBS ' + row.wbsPrefix : row.task!.name}: ${row.esMin ?? addCalendarDays(dataDate, es)} 〜 ${row.efMax ?? addCalendarDays(dataDate, ef)}`}
    >
      {!isWbs && progress > 0 ? <i className="gantt-prog" style={{ width: progress + '%' }} /> : null}
    </div>,
  );
}
