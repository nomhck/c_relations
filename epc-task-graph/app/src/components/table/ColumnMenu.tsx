// ============================================================================
// 列表示メニュー（§12.3.2）。チェックリストで toggleTableColumn。localStorage 記憶はストア側。
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import type { TableColumnKey } from '../../domain';
import { useApp, ALL_TABLE_COLUMNS } from '../../store/store';
import { COLUMN_META } from './cells';

export function ColumnMenu() {
  const columns = useApp((s) => s.tableColumns);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="colmenu" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} title="表示する列を選択">
        列 ▾
      </button>
      {open ? (
        <div className="colmenu-pop">
          {ALL_TABLE_COLUMNS.map((k: TableColumnKey) => (
            <label key={k} className="colmenu-item">
              <input
                type="checkbox"
                checked={columns.includes(k)}
                onChange={() => useApp.getState().toggleTableColumn(k)}
              />
              {COLUMN_META[k].label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
