import { ReactFlowProvider } from '@xyflow/react';
import { useApp } from '../store/store';
import { Header, Breadcrumb } from './Header';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { ViewShell } from './ViewShell';
import { SearchPalette } from './SearchPalette';

function Toasts() {
  const toast = useApp((s) => s.toast);
  return (
    <div className="toasts">
      {toast.map((t) => (
        <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function App() {
  return (
    <ReactFlowProvider>
      <div className="app">
        <Header />
        <Breadcrumb />
        <div className="body">
          <LeftPanel />
          <ViewShell />
          <RightPanel />
        </div>
        <Toasts />
        <SearchPalette />
      </div>
    </ReactFlowProvider>
  );
}
