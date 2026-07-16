import { ReactFlowProvider } from '@xyflow/react';
import { useApp } from '../store/store';
import { Header, Breadcrumb } from './Header';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { CanvasArea } from './CanvasArea';

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
          <CanvasArea />
          <RightPanel />
        </div>
        <Toasts />
      </div>
    </ReactFlowProvider>
  );
}
