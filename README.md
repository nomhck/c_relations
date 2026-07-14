# c_relations — EPCタスク依存関係グラフエディタ

EPC工程（プラント/建設）のタスク依存関係を**ノードグラフで可視化・編集**するツール。
ノード＝タスク、エッジ＝依存（先行/後続）。UI/UX最優先で「直感的に依存関係を整理」がコア価値。4,000+ノード規模に対応。

## 構成
- 設計書（source of truth）: [`docs/epc-task-graph-design.md`](docs/epc-task-graph-design.md)（全11章）
- Phase 0 モック（ビルド不要・ブラウザで開くだけ）: [`epc-task-graph/mock/index.html`](epc-task-graph/mock/index.html)

## モックの動かし方
`epc-task-graph/mock/index.html` をブラウザで開くだけ（CDN到達が必要）。
「4,000ノードデモ生成」→ フィルタ(ISOLATE)・WBS折り畳み・近傍フォーカス(`H`) を試せます。

## ロードマップ
Phase 0 モック → 1 ローカルMVP(Vite)+CP表示 → 2 CPM完成 → 3 ガント → 4 Azure本番+複数人編集 → 5 MS Project(MSPDI)連携。
