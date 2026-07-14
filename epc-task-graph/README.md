# EPC タスク依存関係グラフエディタ — Phase 0 モック

EPCプロジェクト（設計/調達/施工）のタスク依存関係をノードグラフ上で編集する社内Webツールの
**Phase 0（ゼロ設定モック）**。設計書は [`../docs/epc-task-graph-design.md`](../docs/epc-task-graph-design.md)。

## 開き方（3行）

```bash
cd epc-task-graph/mock && python3 -m http.server 8000   # 任意の静的サーバでOK
# ブラウザで http://localhost:8000/ を開く（Chrome / Edge 推奨・初回はCDN到達のためネット接続必須）
# ※ file:// で直接開いても概ね動くが、「全体整列」の Blob URL Worker は静的サーバ経由が確実
```

ビルド不要・npm/Node不要。`index.html` 単一ファイルのみ。React18 / @xyflow/react v12 / zustand /
@dagrejs/dagre / htm を `https://esm.sh/`（**バージョン完全固定**）から importmap で解決する。

## 実装メモ

- **単一ファイル** `mock/index.html`（約 1,050 行）。JSXは使わず **htm**（`html\`<${ReactFlow} .../>\``）。Babel standalone不使用。
- **@xyflow/react は v12 API**（`@xyflow/react` 名前空間・`screenToFlowPosition`・`useStore(s=>s.transform[2])` 等）。旧 `reactflow` v11 の書き方は不使用。
- importmap は `?external=react,react-dom` で React 実体を単一化し「複数React」問題を回避（headless検証でフック正常）。
- **`deriveVisibleGraph` は UI非依存の純関数**（§2.6 表示パイプライン）。段1 フィルタ判定 → 段2 WBS折り畳み（集約ノード/集約エッジ）→ 段3 近傍フォーカスを1本に統合。`seedDemo`（4,000ノード生成）・`buildAdjacency`/`ancestorsOf`（祖先BFS）・`topoSort`・`canConnect` も同様に純関数。**すべて `epc-task-graph/app/src/domain/` へそのまま移植できる形**（Phase 1）。
- **データ構造は §5.2 JSONスキーマに完全準拠**。`rev`/`updatedAt`/`updatedBy`（行レベル版数・監査列）、`viewState`（collapsedWbs/expandLevel）、`savedViews`、`calendars`、依存の `type`(FS/SS/FF/SF)・`lagDays` を最初から保持。CPM系（ES/EF/LS/LF/TF/isCritical）は **持たず導出扱い**（§5.1: 永続化しない。Phase 0では計算せず右パネルに「—（未計算）」表示）。
- **循環拒否**（§2.4）: `isValidConnection` で接続ドラッグ中にライブ判定（`source`の祖先SetをBFSで作り O(1) 判定）。拒否時は `onConnectEnd` でトーストに経路 `A → … → B` を表示。自己ループ・重複エッジも拒否。データ層は `topoSort`（Kahn）で二重防御（インポート検証）。
- **大規模対応（§2.6 の中核）**: `onlyRenderVisibleElements` 常時ON＋カスタムノード `memo`＋**zoom<0.4 で色付き矩形化（LOD）**＋表示パイプラインで同時表示を常時数百に制御。1,500ノード超の表示になる操作は警告トースト。
- **全体整列**（§2.5）: 4,000ノードのdagreレイアウトを **Blob URL の module Worker**（内部で esm.sh の dagre を import）で非同期実行し、UIをブロックしない。表示中サブグラフの整列はメインスレッド同期（集約ノードはメンバー座標を平行移動して座標を永続化）。
- **永続化**: localStorage（デバウンス500ms差分保存）＋ JSON エクスポート/インポート（`.epcgraph.json`、インポート時に全バリデーション）＋「4,000ノードデモ生成」ボタン。
- **Undo/Redo**: `{tasks, dependencies}` の素朴スナップショット（上限20世代）。不変更新で未変更オブジェクトを参照共有（JSON丸ごと保存はしない）。表示状態（フィルタ/折り畳み/フォーカス/選択）はUndo対象外。
- **操作**（§1.2）: 空白ダブルクリック作成／`N`／ハンドルD&D接続／`Delete`削除／ノードダブルクリック or `Enter` でインライン名前編集／`Tab` 後続連続作成／`H` 近傍フォーカス（`[` `]`で深さ増減）／`E` 集約展開／`1`〜`3` 展開レベル／`F` フィット／`Cmd/Ctrl+Z` Undo。インライン編集中はグローバルショートカット無効化。

## 受入基準の自己確認（§10 Phase 0 (a)〜(h)）

検証方法: (1) 純関数を bun で単体実行、(2) 実際に **headless Google Chrome を CDP で駆動**して起動〜各操作を実測（`window.__EPC` にストア/純関数を露出）。GPU/fpsの厳密計測は環境上不可のため、そこは目視前提で未実測と明記。

| 基準 | 結果 | 実測値/根拠 |
|---|---|---|
| **(a)** 開くだけで動く | ✅ 実測 | headless Chromeでマウント成功・**console error 0件**。importmap/CSS/Worker すべて解決 |
| **(b)** 作成→接続→編集→削除→整列→リロード復元が一連 | ✅ 実測 | addTask/連続作成、接続（cycle以外可）、updateTask、delete（deleteDeps を Undo 経路で実測）、整列（下記g）、**リロードで tasks 4000→4000 復元**（localStorage）を確認 |
| **(c)** 循環接続が拒否＋トーストに経路 | ✅ 実測 | `canConnect` が `reason:"cycle"` と経路配列を返却。UIは `explainReject` で `A → … → B` をトースト表示。自己ループ/重複も拒否 |
| **(d)** JSON往復で完全復元 | ✅ 実測 | 4,000ノードを JSON化(2.99MB)→再パース→`validateDoc` OK・件数保持 |
| **(e)** 4,000生成→既定/全展開/ISOLATEが滑らか | ✅ 実測（fpsのみ目視前提） | 生成 **44ms**。既定Lv2＝集約30ノード（DOM描画18）。ISOLATE(担当1名)=可視400（DOM270）、(担当+工種+WBS)=可視23。パイプラインで数百に制御できることを数値で実証。**フレームレートの厳密計測は本環境では不可** |
| **(f)** 近傍フォーカスで上流/下流のみ表示＋折り畳み先継続バッジ | ✅ 実測 | focus適用で近傍のみ（例: 実タスク5＋continuation集約1・エッジ7）。折り畳み内へ続く経路を「◯件が内部に続く」点線集約ノードで表示 |
| **(g)** 全体整列がUIをブロックしない | ✅ 実測 | Blob URL Worker で 4,000ノード整列→座標一括適用を確認（メインスレッド非ブロック。Worker不可環境はメインスレッドfallback） |
| **(h)** §1.2 操作1〜10が動く | ✅ 実測/配線確認 | 作成・接続・削除・編集・連続作成(Tab)・絞り込み・辿る(H)・折り畳み/展開・整列・保存の各アクションを配線し主要経路を実測 |

### 既知の差異・注意（Phase 1へ引き継ぎ）

- **ISOLATE「担当=1名」が数十でなく約400**: シードは設計どおり「担当10名 × 4,000タスク均等配分」なので1担当あたり最小400（= 数百）。設計 (e) の例示「担当=1名 → 数十」は担当10名前提と数値的に整合しない（**設計書内の軽微な不整合**）。実運用の「自分のタスク」は担当がWBS枝に偏るため実際はもっと少ない。数十レベルは担当＋工種＋WBSの複合フィルタで到達（実測23）。タスク側検証基準「数十〜数百」は満たす。
- **fps/GPU**: 55fps級の体感は目視前提。headless計測は本環境で不可のため未実測。Phase 1 の Playwright 性能計測で数値化すること（撤退基準§3.1の正式判定もそこで）。
- **subflowのD&D親子付替えは非対応**（設計どおりv1で意図的に切る）。WBS変更は右パネルの属性フォームから。
- **CPM未実装**: `criticalOnly` フィルタ・「CPのみ表示」ビューは disabled 表示。導出値Mapのデータ設計だけ用意済み。Phase 1でエンジンを差し込む。
- **俯瞰モード（§2.10 自前Canvas）は未実装**（Phase 1）。Phase 0 は編集ビューのみ。
