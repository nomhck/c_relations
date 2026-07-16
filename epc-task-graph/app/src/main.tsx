import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App';
import { useApp, bootstrapStore } from './store/store';
import './styles.css';

// Playwright スモーク／デバッグ用にストアを露出（Phase 0 モックの window.__EPC を踏襲）。
(window as unknown as { __APP: typeof useApp }).__APP = useApp;

// 起動時に Dexie から現在プロジェクトをハイドレート（§6.1）。失敗しても starter で動作。
void bootstrapStore().then(() => useApp.getState().refreshProjects());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
