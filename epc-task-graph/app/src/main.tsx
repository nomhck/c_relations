import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { useApp, bootstrapStore } from "./store/store";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
// Hydrate before enabling edits, so stored project data cannot replace a newly edited screen.
root.render(
  <div className="app-loading" role="status">
    <span>C-Relations</span>
    <p>ワークスペースを開いています…</p>
  </div>,
);
void bootstrapStore().then(() => {
  if (import.meta.env.DEV || import.meta.env.VITE_E2E === "true")
    (window as unknown as { __APP: typeof useApp }).__APP = useApp;
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
