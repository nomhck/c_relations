# EPCタスク依存関係グラフエディタ 設計書 v1.3

> 設計: Fable(最大) / 実装: Opus/Sonnet 想定 / 2026-07-09 作成
> v1.3 (2026-07-17): §12「多ビュー（グラフ／テーブル／ガント）」を追記。ビュー切替タブはPhase 3から前倒し（§1.3注記）。既存章の内容は不変。
> 対象: EPC業界（Engineering / Procurement / Construction、プラント・建設）向け社内Webツール。本リポジトリ内の新規サブプロジェクト（`epc-task-graph/`、Python資産とは独立したフロントエンド主体のプロジェクト）。
> **規模前提: 1プロジェクト4,000タスク以上（将来さらに増加、設計上の余裕は10,000）。複数人利用の可能性あり（段階導入）。この2つを第一級の制約として全章に織り込む。**

## 0. 概要とプロダクト原則

### 0.1 何を作るか
EPCプロジェクトのタスク依存関係を**ノードグラフ上で直感的に作成・編集・可視化**するWebアプリ。タスク（ノード）のCRUDと依存（エッジ）の接続/削除が中心操作。クリティカルパス可視化を第一級機能とし、最終的に完全なCPM計算とガントチャート表示まで拡張、Azure上で社内向けに稼働させる。

### 0.2 用語の定義（UI文言もこれに統一。「親/子」の曖昧さを排除）
| 用語 | 意味 | UIでの見せ方 |
|---|---|---|
| **先行/後続**（predecessor/successor） | 依存関係（エッジ）で繋がる上流/下流。ユーザーが「親タスク/子タスク」と言うとき大抵こちら | エッジ・近傍フォーカス・右パネル「依存」欄 |
| **親WBS/子WBS**（WBS階層） | `wbsCode`のプレフィックスが定義する構造上の包含関係 | 折り畳みグループ・WBSツリー・パンくず |
- UIコピーで依存関係に「親/子」という語は**使わない**（先行/後続で統一）。右パネルは「依存（先行/後続）」と「WBS（親/兄弟/子）」を明確に分けて表示する（§2.9）。

### 0.3 プロダクト原則（優先順位順）
1. **UX最優先**: 機能の多さより「操作が気持ちいいこと」を優先。競合（MS Project / Primavera P6）は機能は豊富だが依存関係の編集体験が最悪（表形式で先行タスクIDを手入力）。本ツールの存在意義は「FigJam/Miroのような編集体験でスケジュールネットワークを描ける」こと。
2. **「直感的」の定義**（受入基準として使う）:
   - 初見のユーザーがマニュアル無しで「タスクを作る→依存を繋ぐ→消す」を60秒以内にできる
   - すべての破壊的操作がUndoできる（Undo/Redoは最初から必須）
   - 操作の結果が即座に視覚フィードバックされる（接続可否、循環検出、選択状態、完了日の変化）
   - マウスだけで完結し、かつキーボードだけでも主要操作ができる
3. **「4,000は一度に見ない」を設計の公理にする**: 全量同時レンダリングはどのライブラリでもUX品質と両立しない（§3.1）。**フィルタ／WBS折り畳み／近傍フォーカスという3つのナビゲーション機能が、そのまま性能戦略でもある**——編集ビューに載るノードを常時数百に保つ。全体俯瞰は専用の軽量Canvasレイヤで見せる。EPCにはWBS階層と担当分担が必ずあるため、この戦略はドメインと整合する。
4. **性能予算を数値で持つ**（受入基準として使う）: 編集ビュー同時表示 ≤ 1,500ノード（既定 ≤ 300）、パン/ズーム55fps以上、編集操作の反映 <50ms、4,000ノードプロジェクトの読込→初期表示 <2s、全体自動レイアウトはWorkerで非同期・UIをブロックしない。
5. **複数人対応は「データモデルは最初から・機構は段階的に」**: MVPは単独編集で軽く作るが、行レベルのバージョン・更新者・変更単位はスキーマに最初から持たせ、楽観的同時実行制御→変更通知→（必要なら）リアルタイムへ**作り直しなしで**積み上げる（§7）。
6. **段階的深化**: Phase 0は「環境構築ゼロで開くだけで動くモック」。ただしデータモデル・表示パイプライン（フィルタ→折り畳み→フォーカス）はPhase 0から本設計どおりにし、エンジンの作り直しを発生させない。
7. **データは常に持ち出せる**: どのフェーズでもJSONエクスポート/インポート可能。ストレージ実装はRepositoryインターフェースの背後に隠蔽。
8. **循環依存は構造的に作れない**: DAG不変条件はUI層で予防し（繋げない）、データ層でも検証する。

### 0.4 非スコープ（v1では作らない）
- リソース平準化・コスト管理・EVM
- リアルタイム共同編集（Yjs/CRDT）は**拡張点として設計だけ確保**（§7.4）、実装は運用データが必要性を示してから
- .mppバイナリの直接読み書き（§8参照、MSPDI XMLで代替）
- モバイル最適化（デスクトップブラウザ前提、Edge/Chrome）

## 1. 主要ユースケースと操作フロー

### 1.1 想定ユーザーとシナリオ
| ユーザー | シナリオ |
|---|---|
| 工程担当（メイン） | 受注直後、WBSベースにタスクを起こし依存を繋いでネットワーク図を作る。週次で進捗更新・依存見直し。通常は担当WBS枝を展開して作業 |
| 各工種リーダー | 「自分のタスク」ビュー（§2.8）で自担当だけ抽出→進捗更新。あるタスクを選び上流/下流を辿って影響確認（§2.9） |
| PM | クリティカルパスのみ表示（§2.8）＋俯瞰で全体一望。マイルストーン監視。ガントで対外説明（Phase 3以降） |
| 計画部門 | MS Projectとの往復（MSPDIで4,000行規模のインポート、Phase 5） |
| 複数担当の同時利用 | WBS単位で担当分担して並行編集（衝突は稀という運用前提、§7.1）。他者の変更は自動リフレッシュで反映（Phase 4） |

### 1.2 コア操作フロー（Phase 0から動くもの）
1. **タスク作成**: キャンバス空白部をダブルクリック → その座標に新ノード生成、名前が即インライン編集状態（Enterで確定、Escで取消）。またはツールバー「＋タスク」/ キー `N`。作成時のWBSは「現在展開中のWBSコンテキスト」を既定値に。
2. **依存接続**: ノード右端のハンドル（source）からドラッグ → 対象ノード左端（target）へドロップ。ドラッグ中、接続可能ノードは緑ハイライト、**循環になるノードは赤＋接続拒否**（§2.4）。
3. **依存削除**: エッジをクリック選択 → `Delete`/`Backspace`。またはエッジホバーで中点に出る「×」ボタン。
4. **タスク編集**: ノードクリック → 右サイドパネル（属性フォーム＋依存/WBSナビ）。名前はノード上ダブルクリックでもインライン編集。
5. **タスク削除**: 選択して `Delete`。接続エッジも同時削除。確認ダイアログは出さない（Undoで戻せる。複数選択削除時のみトースト「N件削除しました [元に戻す]」）。
6. **連続作成（速度の肝）**: ノード選択中に `Tab` → 右隣に後続タスクを自動生成し依存を接続、名前編集状態に。「A→B→C→…」の鎖を秒速で作れる（FigJamのTab増殖の踏襲）。
7. **絞り込み**: 左パネルのフィルタ or `Cmd+K`から。「自分のタスク」「クリティカルパスのみ」はワンクリックの組込みビュー（§2.8）。
8. **辿る**: ノード選択→`H`で近傍フォーカス（上流/下流N階層、§2.9）。
9. **WBS折り畳み/展開**: 集約ノードのダブルクリックで展開、グループヘッダ「−」で折り畳み。ツールバーに「レベル1/2/3まで展開」「全折り畳み」（§2.7）。
10. **整列**: ツールバー「自動整列」→ 表示中サブグラフのみDAGレイアウト（左→右）。全体整列は別コマンド（Worker実行・進捗表示、§2.5）。
11. **保存**: 自動保存（デバウンス500ms・差分）。ヘッダに「保存済み ✓ / 保存中…」表示。

### 1.3 画面構成（1画面完結）
```
┌────────────────────────────────────────────────────────┐
│ ヘッダ: プロジェクト名 | 検索(Cmd+K) | ビュー切替(保存ビュー/自分のタスク/CPのみ) |     │
│         展開レベル | 整列 | 俯瞰(O) | Undo/Redo | Export/Import | 保存状態          │
│ パンくず: 1 土木 › 1.2 基礎工事 › 杭打設（選択タスクのWBS経路、クリックでジャンプ）    │
├────────────┬───────────────────────────┬───────────────┤
│ 左パネル    │  編集キャンバス (React Flow)│ 右パネル(選択時)│
│ (折畳可)    │  ・表示中ノード/エッジのみ   │ ・属性フォーム   │
│ ・WBSツリー │  ・ミニマップ(右下)         │ ・依存(先行/後続)│
│ ・フィルタ  │  ・ズームコントロール(左下)  │   リスト+ジャンプ│
│ ・保存ビュー│  ・フォーカスバー(フォーカス │ ・WBS(親/兄弟)  │
│ ・凡例      │    中はモード表示+解除)     │               │
└────────────┴───────────────────────────┴───────────────┘
```
Phase 3でヘッダにビュー切替タブ「ネットワーク | ガント」を追加。
※ v1.3追記: ビュー切替タブは§12の多ビュー器（View Shell）として前倒しし「グラフ | テーブル | ガント」の3タブ構成にする。テーブルビューが先行（§12.3）、ガントはPhase 3のまま（§12.4）。

## 2. UX/インタラクション設計（本ツールの肝）

### 2.1 マウス/トラックパッド操作系
| 操作 | 割当 | 備考 |
|---|---|---|
| パン | 空白ドラッグ / Space+ドラッグ / 2本指スクロール | React Flowデフォルト踏襲 |
| ズーム | Ctrl(Cmd)+ホイール / ピンチ | 0.1〜2.5x。`fitView`ボタンとキー `F`（表示中全体） `Shift+F`（選択部） |
| ノード移動 | ドラッグ | 15pxグリッドスナップ（`snapToGrid`） |
| 複数選択 | Shift+ドラッグで矩形選択 / Shift+クリックで追加 | 選択群はまとめて移動・削除・コピー可 |
| 接続 | source→targetハンドルドラッグ | ハンドルはホバー時拡大（当たり判定は見た目の2倍、`connectionRadius: 30`） |
| WBS展開/折畳 | 集約ノードをダブルクリック / グループヘッダ「−」 | §2.7 |
| コンテキストメニュー | 右クリック | ノード: 編集/削除/複製/上流を辿る/下流を辿る/このWBSだけ表示。集約ノード: 展開/この枝だけ表示。空白: ここにタスク作成/貼付け/整列 |

### 2.2 キーボード操作系（全操作にマウス不要の経路を用意）
| キー | 動作 |
|---|---|
| `N` / ダブルクリック | 新規タスク（ビューポート中央 or カーソル位置） |
| `Tab` / `Shift+Tab`（ノード選択中） | 後続 / 先行タスクを作成して接続 |
| `Enter` | 選択ノードの名前をインライン編集 |
| `Delete` / `Backspace` | 選択ノード/エッジ削除 |
| `Cmd/Ctrl+Z` / `+Shift+Z` | Undo / Redo |
| `Cmd/Ctrl+C` / `+V` / `+D` | コピー / 貼付け / 複製（選択群の内部エッジも複製） |
| `Cmd/Ctrl+A` | 表示中ノード全選択 |
| `Cmd/Ctrl+K` | 検索パレット（§2.8） |
| `H`（ノード選択中） | 近傍フォーカスのトグル（§2.9）。`[` `]`で上流/下流の深さ増減 |
| `E` / `C`（集約ノード選択中） | 展開 / 折り畳み |
| `O` | 俯瞰モードのトグル（§2.10） |
| `1`〜`3` | 展開レベル1〜3を適用 |
| 矢印キー | 選択ノードを1グリッド移動（Shiftで5グリッド） |
| `Esc` | フォーカス解除→選択解除→パネル/俯瞰を閉じる（段階的） |
| `F` / `Shift+F` | 表示中全体フィット / 選択フィット |

実装注: React Flowの`deleteKeyCode`/`multiSelectionKeyCode`等の組込みpropsを使い、残りは`useKeyPress`＋自前ハンドラ。インライン編集中はグローバルショートカット無効化（`event.target`がinputなら無視）。

### 2.3 Undo/Redo（最初から実装）
- zustandストアに**zundo**（temporal middleware）を適用。スナップショット対象は`{tasks, dependencies}`のみ（ビューポート・選択・折り畳み・フィルタ・フォーカスは含めない）。
- **4,000ノードでの履歴メモリ対策**: zundoの`diff`オプション（差分保存）を必ず有効化し、immerで不変更新して未変更オブジェクトを参照共有。履歴上限100。
- ドラッグ移動は`onNodeDragStop`で1操作として記録。属性フォームはblur/確定時に記録。差分同期（§7）のダーティ追跡はUndo/Redoと連動（Undoで戻した行もダーティ扱いにして保存対象へ）。

### 2.4 循環依存の防止（DAG不変条件）
- **接続時予防**: React Flow の `isValidConnection` で、`target`から`source`への到達可能性チェック。到達可能なら循環になるので接続不能に。ドラッグ中は不可ノードを赤枠＋カーソル`not-allowed`で予告し、拒否時はトースト「循環依存になるため接続できません（A → … → B）」で**経路を表示**（なぜダメかを教える）。
- 自己ループ・重複エッジ（同一ペア同一方向）も拒否。
- **計算量（4,000ノード・6,000エッジ前提）**: ①隣接リスト（`Map<taskId, succIds[]>`）をストアで常時維持（エッジ増減時に増分更新） ②ドラッグ開始時に「sourceの祖先集合」を1回だけBFSで計算しSet化、判定はO(1)。数万ノードまで頭打ちしない。この隣接リストは近傍フォーカス（§2.9）・CPM（§9.1）とも共用する。
- **データ層検証**: インポート/読込時にKahnのトポロジカルソートを実行し、循環があればエラー（該当エッジ列挙）を出して読込中断。UIとデータの二重防御。

### 2.5 自動レイアウト（DAG、4,000ノード対応）
- 方向は**左→右（LR）**固定。EPCの時系列直感（ガントとの対応）に合致。
- レイアウトは**2スコープ**に分ける:
  1. **表示中サブグラフの整列**（日常操作）: 現在表示中の数百ノードのみ。dagre（`@dagrejs/dagre`、`rankdir: LR, ranksep: 80, nodesep: 40`）で数十ms、メインスレッド同期でよい。アニメーション付き（300ms ease-out）。
  2. **全体整列**（インポート直後・明示コマンド）: 4,000ノード全体。dagre/elkjsは4,000ノードで**数秒〜十数秒かかり得る**ため必ず**Web Worker**で実行（elkjsは公式にWorker対応。dagreも純JSなのでWorker包装は容易）。実行中はトースト＋プログレス、完了時に座標を一括適用（即適用）。さらに**階層レイアウト**で問題を分割: WBSグループ単位のメタグラフ（数十ノード）をレイアウト→各グループ内部を独立レイアウト→オフセット合成。1回あたりの問題サイズが数百に落ち、実測1〜2秒級に収まる想定。Workerでも遅い場合の逃がし先はPhase 4のFunctions（サーバ側elkjs、同一コード流用）——階層分割で足りる見込みが高く先回り実装はしない。
- Phase 0はdagreのみ。elkjs（`layered`、交差最小化・グループ対応が優秀）への差替えはPhase 1でオプション化。`layoutGraph(nodes, edges, opts): positions`の関数インターフェースに隔離。
- **手動配置の尊重**: 整列は明示ボタン実行時のみ再配置。新規ノードだけ自動配置（Tab作成時は先行ノードの右120px、重なれば下にずらす）。

### 2.6 表示パイプライン（大規模対応の中核・全ナビゲーション機能の統合点）
編集ビューに何を載せるかは、domain層の純関数パイプラインが一元決定する。**フィルタ・折り畳み・フォーカスは独立機能ではなく、この1本のパイプラインの段**であり、これがそのまま性能戦略になる。

```
deriveVisibleGraph(tasks, deps, viewSpec) → { visibleNodes, visibleEdges, stats }
  viewSpec = { filter, displayMode, collapsedWbs, focus }

段1 フィルタ判定 (§2.8): 各タスクに match/nomatch を付与
     displayMode=ISOLATE → nomatch を除去（描画対象から外す＝性能に直結）
     displayMode=DIM     → nomatch を残し淡色フラグ
段2 WBS折り畳み (§2.7): collapsedWbs 配下を集約ノードへ置換、境界跨ぎ依存を集約エッジへ
     （ISOLATE時はマッチを含む枝を自動展開、マッチゼロの枝は自動折り畳み）
段3 近傍フォーカス (§2.9): focus 指定時、起点から上流/下流N階層のみ残す
     ※探索は「フィルタ前の全依存グラフ」で行う——フィルタで隠れた真の先行/後続を
       silently 省かない。フィルタ外だがフォーカス内のノードは点線枠+半透明で表示
出力: React Flow へは adapter 経由で変換。memoize（入力参照が変わった時のみ再計算、全段 O(V+E)、
      4,000ノードで <15ms、メインスレッド可）
```
**レンダリング4層の防御**（パイプラインの出力に対して）:
1. **表示数制御（第一の防御）**: 上記パイプラインで同時表示を常時数百に。初期表示はレベル2展開（典型300以下）。**1,500ノード超の表示になる操作は警告**（「この操作で2,100タスクが表示されます。フィルタか下位WBS展開を推奨」→続行は可能、性能保証外と明示）。
2. **ビューポート仮想化**: React Flow `onlyRenderVisibleElements` 常時有効。画面外ノードはDOM未マウント。
3. **LOD（セマンティックズーム）**: zoom < 0.4 でノードを色付き矩形のみ（ラベル・進捗バー・ハンドル非表示）に分岐（`useStore(s => s.transform[2])`）。zoom < 0.15 では俯瞰モード（§2.10）へ誘導するトースト。
4. **ノード実装の規律**: カスタムノードは`memo`必須・propsは最小プリミティブ・ストア購読はセレクタ単位・エッジは`smoothstep`固定でラベル常時非表示（選択時のみ）・CSSアニメーション禁止（ハイライト時のみ）。
**ナビゲーション補助**: ミニマップ（表示中グラフ・工種色反映）、WBSツリー（左パネル、仮想スクロール、キャンバスと双方向同期）、検索パレット（`Cmd+K`、タスク名/WBS/担当のあいまい検索・4,000件はfuse.jsで十分・**必要なWBS枝を自動展開してジャンプ**——折り畳みで見えないタスクにも検索で必ず辿り着ける）。

### 2.7 WBS階層の折り畳み/展開（スケール設計の心臓部）
- **モデル**: `wbsCode`（例 `1.2.3`）のプレフィックスが木を定義。折り畳み状態は `collapsedWbs: string[]` としてプロジェクトの`viewState`に永続化（§5.2）。
- **集約ノード**: 折り畳みプレフィックス配下のタスク群を1個のWBS集約ノードに置換（件数・工種内訳ミニバー・進捗平均・内部にマイルストーン/クリティカル有のバッジ）。境界を跨ぐ依存は**集約エッジ**（点線・本数バッジ、同一ペアで重複排除）。「代表であって実エッジではない」ことを点線で示す。
- **操作**: 集約ノードのダブルクリック/`E`で1階層展開。展開中グループはReact Flowのグループノード（枠）として表示、ヘッダに「1.2 配管工事（214）[−]」。枠内タスクのドラッグは枠内移動のみ（**親子付替えD&Dはv1非対応**——WBS変更は属性パネルで。subflowのD&D親子付替えはUX難所のため意図的に切る）。
- **集約ノードへの接続**: 依存ドラッグのドロップ先が集約ノードの場合は接続を作らず、その場で展開して継続（実エッジは実タスク間にのみ存在する原則）。
- **初期状態**: レベル2まで展開。前回の`collapsedWbs`があれば復元。
- **wbsCode未設定タスク**: ルート直下扱い（常時表示）。ゼロから作る小規模ユースケースでは折り畳みが登場せず、単純なキャンバスとして使える（小さく始めて大きく育つ）。

### 2.8 フィルタとビュー（第一級機能・ナビゲーションの主役）
4,000タスクを前に「まず絞る」が既定動線。フィルタは飾りではなく**描画対象を減らす性能機構**（ISOLATEモード、§2.6段1）を兼ねる。

- **フィルタ条件（AND結合）**:
```ts
interface GraphFilter {
  wbsPrefixes?: string[];        // WBS枝
  disciplines?: Discipline[];    // 工種 E/P/C/OTHER
  assignees?: string[];          // 担当者（"@me" は現在ユーザーに展開、§7.5）
  statuses?: Status[];
  milestonesOnly?: boolean;
  criticalOnly?: boolean;        // CPM導出値 isCritical=true のみ（§2.11, §9）
  dateRange?: { from?: string; to?: string };  // ES〜EFが範囲に重なる（CPM導出後有効）
  text?: string;                 // 名前/notes部分一致
}
```
- **表示モード2種**（トグル、既定はDIM）:
  - **DIM（減光）**: 非マッチをopacity 0.15で残す。文脈を保ったまま注目する用途。
  - **ISOLATE（抽出）**: 非マッチを描画対象から除去し、マッチを含むWBS枝だけ自動展開。**大規模時の主役**。抽出結果だけで「表示中サブグラフの整列」（§2.5）をかけると、そのビュー専用の読みやすいレイアウトになる（元の座標はビュー内一時座標として扱い、永続座標は変更しない）。
- **組込みビュー（ワンクリック、ヘッダ常設）**:
  - **自分のタスク**: `assignees:["@me"] + ISOLATE`＋直接の先行/後続を1階層だけ淡色表示（自分の作業の入口と出口が見える個人ビュー。§2.9のフォーカスと同じ描画規約）。
  - **クリティカルパスのみ**: `criticalOnly + ISOLATE`。CP上のタスクと駆動依存だけの細長いチェーンが抽出され、全体整列後は「プロジェクトの背骨」が1本で読める。CPM実装前（Phase 1前半）はボタンをdisabled表示（機能の存在は最初から見せる）。
  - **マイルストーンのみ**: 菱形＋その直接先行/後続。
- **保存ビュー（プリセット）**:
```ts
interface SavedView {
  id: string; name: string;               // 例「配管チーム週次」「E工程レビュー用」
  filter: GraphFilter; displayMode: 'DIM'|'ISOLATE';
  collapsedWbs?: string[];                // 省略時は現状維持
  createdBy: string; updatedAt: string;
}
```
  プロジェクト単位で永続化（チーム共有。§5.2/5.3）。左パネルに一覧、ワンクリック適用、現在の状態から「ビューとして保存」。個人専用ビューはPhase 4で`createdBy`による「自分のビュー」セクション分け表示（データは同じテーブル）。
- フィルタ状態はURLハッシュにも反映（`#view=...`）——「この絞り込みを見て」とリンクで共有できる（Phase 1）。

### 2.9 近傍フォーカス（先行/後続を辿る・「自分のタスクの前後」を見せる）
「このタスクの上流（先行）と下流（後続）だけ見たい」はEPC工程会議の最頻出要求。選択→`H`で発動。

- **動作**: 起点タスクから依存グラフを上流Nu階層・下流Nd階層BFS（既定 Nu=Nd=2、`[` `]`で増減、∞可）。パイプライン段3（§2.6）として適用され、**該当ノードだけが表示**される（フォーカス外は非表示。DIMではなく除去——4,000中の近傍20個を見る場面で減光4,000個を描く意味はない）。
- **真実性の担保**: 探索はフィルタ前の**全依存グラフ**で行う。アクティブなフィルタに合致しないが依存上は繋がっているタスクは**点線枠＋半透明**で表示し「フィルタ外だが依存あり」を明示。折り畳まれたWBS内へ続く経路は集約ノード経由で表示し「◯件が内部に続く」バッジ。**上流・下流が silently 隠れることは決してない**。
- **視覚規約**: 起点=太枠＋影。直接の先行=左側へ橙系強調エッジ、直接の後続=右側へ青系強調エッジ。2階層目以降は通常色。フォーカス中は画面上部に**フォーカスバー**（「杭打設 の上流2・下流2階層を表示中 ｜ 深さ[−][+] ｜ 解除(Esc)」）。
- **フォーカス中も編集可能**: 依存の追加・削除・属性編集がそのままできる（閲覧専用にしない）。新規接続でフォーカス集合が変わったら即再計算。
- **右パネルのナビゲーション**（選択時常設、フォーカスと独立に使える）:
  - **依存（先行/後続）**: 直接の先行リスト・後続リスト（タスク名＋依存タイプ＋lag。クリックでジャンプ、×で依存削除、＋で追加=検索パレットから選択）。**依存の追加はドラッグ接続と等価な第二経路**（遠く離れたノード間はこちらが速い）。
  - **WBS（親/兄弟/子）**: パンくず（ヘッダにも常設表示、クリックでその枝へジャンプ）＋同一WBS内の兄弟タスク一覧。
- **上流/下流ハイライト（軽量版）**: フォーカスせず選択だけの状態でも、到達可能な先行群/後続群を減光ハイライト表示するトグルを右クリックメニューに残す（従来のP6的な使い方）。

### 2.10 俯瞰モード（全体マップ、専用Canvasレイヤ）
- `O`キー/ヘッダボタンで、**4,000ノード全量**を1枚に描く読取専用オーバーレイ。React FlowのDOMノードではなく**自前の`<canvas>`1枚**に全タスクを2〜6pxの矩形（凡例トグル: 工種色/ステータス色/クリティカル赤）、依存を1px線で直描画。4,000矩形＋6,000線の再描画はCanvas 2Dで数ms。パン/ズームは変換行列、ヒットテストは座標グリッド。
- アクティブなフィルタは俯瞰にも反映（マッチを明色・非マッチを灰色）——「全体の中でどこが自分の担当か」「CPがどこを走るか」を一望させる。
- クリックで該当タスク/WBS枝を編集ビューで自動展開してジャンプ。ドラッグ範囲選択→「この範囲を展開して編集」。
- これにより「編集=React Flow（数百ノード・リッチUX）／俯瞰=自前Canvas（4,000+・軽量）」の分業が完成し、**WebGL系ライブラリへの乗換えを不要にする**。実装規模は約300行（レンダラ・変換・ヒットテスト、編集機能なし）。

### 2.11 EPC特有の見せ方
- **工種色分け**（ノード左端4pxのカラーバー＋ミニマップ・俯瞰反映）: Engineering=青 `#2563eb`、Procurement=橙 `#d97706`、Construction=緑 `#059669`、その他=灰。色はバーに限定（全面塗りはステータス色と衝突）。
- **ステータス**: 未着手=白地/灰枠、進行中=白地/青枠＋進捗バー、完了=灰地＋チェック、保留=黄枠＋アイコン。進捗はノード下辺の細いバー。
- **マイルストーン**: 菱形ノード（duration=0強制）。折り畳み中でも集約ノードに旗バッジ。
- **クリティカルパス（第一級機能）**: CPM導出値`isCritical`を持つタスク/駆動依存を**赤系太線**で強調。ヘッダに常設トグル＋「CPのみ表示」組込みビュー（§2.8）。集約ノード/集約エッジには内部CP有の赤バッジ。俯瞰CanvasでCP全体経路を一望。ノード右パネルにTF（トータルフロート）表示、TF小（準クリティカル、例TF≤5日）は橙で段階表示。**UIとデータ設計（導出値Map、§9.2）はPhase 1から組み込み、計算エンジンだけ後から差し込む。**
- **日付表示**（CPM後）: ノード下部にES〜EF日付を小さく表示（LODで消える）。

### 2.12 参考プロダクト所見
| プロダクト | 学ぶ点 | 避ける点 |
|---|---|---|
| FigJam / Figma | Tab増殖・インライン編集・Undo完備・即応性。UXの北極星 | — |
| Miro | 無限キャンバス・ミニマップ・フレーム(≒WBSグループ) | 汎用すぎて依存の意味論がない |
| n8n / Dify | React Flow系エディタの実例。ハンドルUX・状態色分け | 数十ノード前提でスケール設計は参考外 |
| MS Project / P6 | 依存タイプ(FS/SS/FF/SF)・ラグ・TFの業界標準用語。P6のWBSバンド・フィルタ/レイアウト保存（=保存ビューの先例） | 表形式で依存を編集させるUX |
| Dagster / Airflow UI | 大規模DAGのLOD・ズーム挙動・グループ折り畳み・上流/下流ハイライト | 閲覧専用で編集UXの参考にならない |

## 3. 技術スタック選定

### 3.1 グラフ描画ライブラリ比較（4,000+ノード基準）
評価軸: ①編集UX（本製品の存在意義） ②4,000+での描画性能 ③React親和性 ④折り畳み/グループ対応 ⑤ライセンス。

| | **React Flow (@xyflow/react v12)** | Cytoscape.js | Sigma.js v3 | AntV G6 v5 | Reagraph / WebGL系viewer |
|---|---|---|---|---|---|
| 描画方式 | DOM(ノード)+SVG(エッジ) | Canvas | WebGL | Canvas(+WebGL実験) | WebGL |
| 素の同時描画上限の目安 | 数百〜2千（リッチノード）／仮想化+単純ノードで数千 | 〜1万 | 数万〜 | 〜1万（公称） | 数万〜 |
| 編集UX（D&D接続・インライン編集・リッチノード） | ◎ ノード=Reactコンポーネント。組込みD&D接続・選択・ミニマップ | △ 描画中心。edgehandles等プラグイン＋自前多い | ✕ 閲覧特化。編集は全自前 | ○ 組込みbehavior有。ノードはconfig/Canvas描画でReactコンポーネント化は別拡張＆性能劣化 | ✕ 閲覧特化 |
| React親和性 | ◎ ネイティブ | △ ラッパー経由の状態同期が辛い | △ | ○（公式Reactバインディング） | ○ |
| グループ折り畳み | ○ subflow＋自前導出グラフ（§2.7） | ○ compound nodes | ✕ | ◎ combo組込み | △ |
| ライセンス/実績 | MIT。n8n/Dify/Langflow等 | MIT | MIT | MIT | MIT |
| CDN/ESMビルド無し | ○ esm.sh | ◎ UMD | ○ | ○ | △ |

**判断**:
- 「4,000を全部同時に描く」性能だけならSigma.js/G6が勝つ。しかし採ると**編集UX（価値の根幹）を全自前実装**することになりUX最優先の原則と衝突。本設計は§2.6のとおり編集ビューの同時表示を常時数百に制御するので、React Flowの弱点（大量DOM）を**そもそも踏まない**。全量俯瞰の需要は自前Canvasレイヤ（§2.10、300行弱）で満たし、WebGLライブラリ一式を背負わない。
- **結論: React Flow（@xyflow/react v12系）＋ 表示パイプライン（フィルタISOLATE・WBS折り畳み・近傍フォーカス）＋ `onlyRenderVisibleElements` ＋ LOD ＋ 自前Canvas俯瞰レイヤ**。「ノード=Reactコンポーネント」がリッチノードと開発速度に決定的に効く。現行はv12系（`@xyflow/react`。旧`reactflow` v11の記事のコピペ禁止）。
- **撤退基準（エスケープハッチ）**: Phase 0受入テストで「表示1,500ノード時にパン/ズーム30fps未満 or 編集反映100ms超」がLOD・memo徹底後も解消しない場合、編集ビューをG6 v5（combo折り畳み組込み）へ乗換える。この保険のため**ストア/domain層はReact Flow非依存**（変換はadapters層1ファイルに隔離）。俯瞰Canvas・表示パイプライン・CPMはどちらの世界でも再利用可能。
- ガント（Phase 3）は別ビュー・別描画（§9.3）。React Flowで無理にガントを描かない。

### 3.2 各段階のスタック一覧
| | Phase 0 モック | Phase 1 MVP | Phase 4 本番 |
|---|---|---|---|
| 実行 | **単一HTML＋ESM CDN（ビルド不要）** | Vite + React 18 + TypeScript | 同左（SWAへデプロイ） |
| 状態 | zustand（CDN） | zustand + zundo(diff) + immer | 同左 |
| グラフ | @xyflow/react v12 + dagre（表示中）+ Worker全体整列 | 同左＋elkjs差替口＋俯瞰Canvas | 同左 |
| 永続化 | localStorage + JSON入出力 | IndexedDB（**Dexie**）+ JSON入出力 | Azure SQL（差分API）＋オフライン草稿はIndexedDB |
| 共同編集 | なし（単独） | なし（単独、ただし行rev/updatedByは記録） | 楽観的同時実行制御＋変更ポーリング（§7） |
| API | なし | なし | Azure Functions (Node/TS, SWA managed) |
| 認証 | なし | なし（「私は誰」ローカル設定、§7.5） | SWA組込みEntra ID |
| テスト | 4,000ノードシードで手動性能確認 | Vitest（domain）+ Playwright（スモーク+性能計測） | 同左＋API結合 |
- IndexedDBラッパーにsql.jsでなく**Dexie**を選ぶ理由: 本データはドキュメント的（タスク/依存の2コレクション）でSQL不要。sql.js(wasm)は初期化コスト・永続化の癖がありMVPを重くする。「SQLite系は本番側（Azure SQL）」で要件を満たす。スキーマはJSON Schema（§5）を単一の真実とし両ストレージへ写像。4,000タスク＝生JSON 2〜4MB、IndexedDBには余裕。

## 4. アーキテクチャの段階的進化

### 4.1 Phase 0: ゼロ設定モック（開くだけ）
```
epc-task-graph/mock/index.html   ← ブラウザで開くだけ（file:// or 任意の静的サーバ）
  <script type="importmap">      react / react-dom / @xyflow/react / zustand / @dagrejs/dagre / htm
                                  → https://esm.sh/...（バージョン固定）
  <script type="module">         アプリ本体（htmでJSX不使用）
  全体整列Worker                  file://ではWorker(new URL)不可のため Blob URL 方式でインライン生成
  永続化: localStorage（4,000ノード≈3MBは上限5MB内だがギリギリ。超過時はエクスポート促しトースト）
  入出力: JSONダウンロード / ファイル選択インポート / 「4,000ノードデモ生成」ボタン
```
- 制約: 初回ロードにネット接続必要（CDN）。それ以外の「環境構築」はゼロ。npmもNode.jsも不要。
- esm.shが不安定な場合のフォールバック: `npx vite`最小構成（`npm i && npm run dev`の2手）。ただしまずesm.shで作る。

### 4.2 Phase 1: ローカルMVP（Vite）
```
epc-task-graph/app/
  src/
    domain/        ← 型・Zodバリデーション・グラフ演算（隣接リスト・循環検出・トポソート・
                      deriveVisibleGraph=表示パイプライン・フィルタ評価）・CPM。UI/React Flow非依存の純関数群
    store/         ← zustand ストア＋zundo(diff)＋隣接リスト増分維持＋ダーティ追跡
    storage/       ← Repository IF ＋ DexieRepository / LocalStorageRepository / (後で)ApiRepository
    adapters/      ← domainモデル ⇄ React Flow nodes/edges 変換（React Flow依存をここに閉じ込める）
    components/    ← Canvas, TaskNode, MilestoneNode, WbsGroupNode, WbsAggregateNode, SidePanel,
                      Toolbar, FocusBar, SearchPalette, WbsTreePanel, FilterPanel, SavedViewsPanel
    overview/      ← 俯瞰Canvasレンダラ（純Canvas 2D、React Flow非依存）
    layout/        ← layoutGraph() dagre実装＋Worker起動＋階層分割合成、elkjs差替口
  index.html / vite.config.ts / package.json
```
- `domain/`と`overview/`はReact Flow非依存・完全単体テスト対象。**この分離が撤退基準（§3.1）とPhase 2以降の全て**。

### 4.3 Phase 4: Azure本番
```
[ブラウザ] ──HTTPS──> Azure Static Web Apps (Standardプラン)
                        ├ 静的フロント（Viteビルド成果物）
                        ├ 組込み認証: Entra ID（テナント限定issuer、社外アカウント排除）
                        │   ・staticwebapp.config.json で全ルート allowedRoles:["authenticated"]
                        │   ・APIへ x-ms-client-principal ヘッダでユーザー情報が自動注入（MSAL.js不要）
                        └ Managed Functions (Node20/TS)
                              GET   /api/projects                        一覧（メタのみ）
                              GET   /api/projects/{id}/graph             全量取得（gzip、4,000件で300〜500KB）
                              PATCH /api/projects/{id}/graph             差分保存＋行レベル衝突検知（§7.2）
                              GET   /api/projects/{id}/changes?since=v   変更取得（ポーリング、§7.3）
                              POST  /api/projects, /import 等
                              └──> Azure SQL Database (serverless, 自動一時停止, 最小vCore)
[将来拡張点] Azure Web PubSub / SignalR Service（§7.4、実装はデータが必要性を示してから）
[IaC] Bicep 1ファイル（swa + sql server + db + 接続文字列をSWAのapp settingsへ）
```
- SWAを選ぶ理由: 静的フロント＋薄いAPIに完全一致、認証が設定だけで済む、無料〜Standardで安い。App ServiceはSSR不要な本件では過剰。
- 監視: Application Insights（SWA組込み連携）だけ。凝らない。

## 5. データモデル

### 5.1 設計方針
- 最初のモックから**CPM・複数人対応に必要な列を全部持つ**（大半は既定値のまま）。後からのスキーマ移行が最大の手戻りリスクなので先に潰す。具体的には: 行レベルバージョン`rev`・更新者`updatedBy`・更新時刻`updatedAt`を**tasks/dependenciesの全行に**（§7の楽観的同時実行制御の土台。ローカル運用中は`updatedBy`は「私は誰」設定値、§7.5）。
- 依存タイプはMS Project/P6互換の **FS/SS/FF/SF＋lag（日数、負値=リード可）**。MVPのUIはFSのみ露出し、他は属性パネルで変更可。
- ID: UUID v4（`crypto.randomUUID()`）。オフライン生成・差分同期・MSPDI往復すべてに都合が良い。
- 座標（x,y）は**タスクの属性として永続化**（手動レイアウト尊重＋俯瞰Canvasの描画源）。
- **CPM計算結果（ES/EF/LS/LF/TF/isCritical）は永続化しない**。編集時に`domain/cpm.ts`が導出する`Map<taskId, CpmResult>`（§9.2）。保存すると必ず不整合が起きる。フィルタ`criticalOnly`・CP強調・日付表示はすべてこの導出Mapを参照する（**データ設計としてはPhase 1から存在し、中身の計算だけが後続Phaseで本物になる**）。
- 折り畳み状態（`collapsedWbs`）・保存ビュー（`savedViews`）はプロジェクト単位で永続化。Undo対象外。

### 5.2 JSONスキーマ（交換フォーマット兼ストレージの真実）
```jsonc
// ファイル拡張子 .epcgraph.json / スキーマバージョンで前方互換管理
{
  "schemaVersion": 1,
  "project": {
    "id": "uuid", "name": "○○プラント建設", "description": "",
    "calendarId": "cal-default",
    "dataDate": "2026-07-09",             // ステータス基準日（CPM開始点）
    "createdAt": "ISO8601", "updatedAt": "ISO8601",
    "version": 3                           // プロジェクト全体の単調増加版数（楽観ロックの粗い錠）
  },
  "viewState": {
    "collapsedWbs": ["1.3", "2"],
    "expandLevel": 2
  },
  "savedViews": [                          // §2.8。チーム共有プリセット
    { "id": "uuid", "name": "配管チーム週次",
      "filter": { "disciplines": ["P"], "wbsPrefixes": ["1.2"], "assignees": [], "statuses": [],
                  "milestonesOnly": false, "criticalOnly": false, "text": "" },
      "displayMode": "ISOLATE", "collapsedWbs": null,
      "createdBy": "yamada", "updatedAt": "ISO8601" }
  ],
  "calendars": [
    { "id": "cal-default", "name": "週休2日", "workingDays": [1,2,3,4,5], "holidays": ["2026-12-29"] }
  ],
  "tasks": [
    {
      "id": "uuid",
      "name": "基本設計",
      "wbsCode": "1.2",                    // "" 可。プレフィックスがWBS木を定義（§2.7）
      "discipline": "E",                   // "E"|"P"|"C"|"OTHER"
      "isMilestone": false,                // trueならdurationDays=0を強制
      "durationDays": 20,                  // 暦日→稼働日(カレンダー導入後)。milestone=0
      "status": "IN_PROGRESS",             // NOT_STARTED|IN_PROGRESS|DONE|ON_HOLD
      "progress": 40,                      // 0-100整数
      "assignee": "山田",                  // 自由文字列。Phase 4でEntra IDと突合（§7.5）
      "constraintType": "ASAP",            // ASAP|SNET|FNLT（SNET=Start No Earlier Than）
      "constraintDate": null,
      "notes": "",
      "position": { "x": 120, "y": 240 },
      "rev": 5,                            // 行レベル版数（更新毎に+1、衝突検知の単位）
      "createdAt": "ISO8601", "updatedAt": "ISO8601", "updatedBy": "yamada"
    }
  ],
  "dependencies": [
    {
      "id": "uuid",
      "predecessorId": "uuid",
      "successorId": "uuid",
      "type": "FS",                        // FS|SS|FF|SF
      "lagDays": 0,                        // 整数、負値=リード
      "rev": 1, "updatedAt": "ISO8601", "updatedBy": "yamada"
    }
  ]
}
```
バリデーション（`domain/validate.ts`、Zod）: ①ID一意 ②dependency両端の実在 ③自己ループ禁止 ④同一(pred,succ)重複禁止 ⑤DAG（トポソート成功） ⑥milestoneのduration=0 ⑦progress 0-100。インポート時は全チェック、違反は行番号つきエラー一覧。4,000件のZodパースは百ms級なので読込時のみ実行。

### 5.3 DDL（SQLite方言。Azure SQLでは型を注記どおり読替え）
```sql
-- Azure SQL読替え: TEXT→NVARCHAR(255)/NVARCHAR(MAX), REAL→FLOAT,
--   created/updated_atはDATETIME2, CHECK句・FK ON DELETE CASCADEは同一。
--   行revはアプリ管理INTEGER（DB機能のrowversion型でも代替可だが、ローカルSQLite/Dexieと
--   同一セマンティクスを保つためアプリ管理に統一する）
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  calendar_id  TEXT,
  data_date    TEXT,
  view_state   TEXT NOT NULL DEFAULT '{}',   -- JSON (§5.2 viewState)
  version      INTEGER NOT NULL DEFAULT 1,   -- プロジェクト版数（PATCH成功毎に+1）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE saved_views (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  spec         TEXT NOT NULL,                -- JSON {filter, displayMode, collapsedWbs}
  created_by   TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);

CREATE TABLE calendars (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  working_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  holidays     TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  wbs_code        TEXT NOT NULL DEFAULT '',
  discipline      TEXT NOT NULL DEFAULT 'OTHER'
                    CHECK (discipline IN ('E','P','C','OTHER')),
  is_milestone    INTEGER NOT NULL DEFAULT 0,
  duration_days   REAL NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'NOT_STARTED'
                    CHECK (status IN ('NOT_STARTED','IN_PROGRESS','DONE','ON_HOLD')),
  progress        INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  assignee        TEXT NOT NULL DEFAULT '',
  constraint_type TEXT NOT NULL DEFAULT 'ASAP'
                    CHECK (constraint_type IN ('ASAP','SNET','FNLT')),
  constraint_date TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  pos_x           REAL NOT NULL DEFAULT 0,
  pos_y           REAL NOT NULL DEFAULT 0,
  rev             INTEGER NOT NULL DEFAULT 1,  -- 行レベル版数（§7.2）
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_wbs ON tasks(project_id, wbs_code);
CREATE INDEX idx_tasks_assignee ON tasks(project_id, assignee);  -- 「自分のタスク」

CREATE TABLE dependencies (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_type       TEXT NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS','SS','FF','SF')),
  lag_days       REAL NOT NULL DEFAULT 0,
  rev            INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL DEFAULT '',
  CHECK (predecessor_id <> successor_id),
  UNIQUE (predecessor_id, successor_id)
);
CREATE INDEX idx_deps_project ON dependencies(project_id);
CREATE INDEX idx_deps_succ ON dependencies(successor_id);

-- Phase 4（変更通知L2）で追加。それまで作らない
CREATE TABLE change_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,  -- Azure SQL: IDENTITY
  project_id   TEXT NOT NULL,
  project_ver  INTEGER NOT NULL,                   -- このPATCH適用後のprojects.version
  entity       TEXT NOT NULL CHECK (entity IN ('task','dep','project','view')),
  entity_id    TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload      TEXT,                               -- upsert時の行JSON
  changed_by   TEXT NOT NULL,
  changed_at   TEXT NOT NULL
);
CREATE INDEX idx_changes ON change_log(project_id, project_ver);
```
※ DAG保証はDB制約では表現できないためアプリ層（§2.4の二重防御）で担保。4,000〜10,000行×プロジェクト数十はAzure SQL最小構成で余裕。

## 6. 永続化戦略（4,000+前提）

### 6.1 Repositoryインターフェース（全フェーズ共通の抽象）
```ts
interface GraphRepository {
  listProjects(): Promise<ProjectMeta[]>;
  loadGraph(projectId: string): Promise<GraphDoc>;            // 全量（§6.2）
  savePatch(patch: GraphPatch): Promise<PatchResult>;          // 差分保存（§7.2）
  saveGraph(doc: GraphDoc): Promise<{ version: number }>;      // 全量保存（インポート/初回のみ）
  fetchChanges?(projectId: string, sinceVersion: number): Promise<ChangeSet>;  // Phase 4 L2
  deleteProject(projectId: string): Promise<void>;
}
interface GraphPatch {
  projectId: string;
  baseProjectVersion: number;                 // 参考情報（粗い錠）
  upsertTasks: TaskWithBaseRev[];             // 各行に baseRev（読込時のrev）を同梱
  deleteTaskIds: { id: string; baseRev: number }[];
  upsertDeps: DepWithBaseRev[];
  deleteDepIds: { id: string; baseRev: number }[];
  project?: Partial<ProjectMeta>; viewState?: ViewState; savedViews?: SavedView[];
}
type PatchResult =
  | { ok: true; version: number; newRevs: Record<string, number> }
  | { ok: false; conflicts: RowConflict[] };   // 行単位の衝突リスト（§7.2）
```
- **読みは全量・書きは差分**が基本方針。
  - **全量ロードを選ぶ理由（WBS単位の遅延ロードを採らない）**: 循環チェック（§2.4）・CPM（§9.1）・近傍フォーカスの真実性（§2.9）・俯瞰（§2.10）・検索は全エッジ/全タスクを要求する。依存はWBS境界を自由に跨ぐため部分グラフでは正しさを担保できない。データ量は4,000タスクで生2〜4MB／gzip後300〜500KB、性能予算内。**重いのはデータではなく描画であり、描画側は表示パイプライン（§2.6）で解決済み**。遅延ロードの複雑さは10,000ノードまでは割に合わない。5万ノード級が視野に入ったら再設計ポイント（§11）。
  - **書きは差分（savePatch）**: 編集のたび全量PUT（数MB）は自動保存・複数人と相性が悪い。ストアで**ダーティ追跡**（変更/削除行のIDセット、Undo/Redo連動）し、デバウンス500msでPatch送信（典型数KB）。ローカル実装（Dexie）でもsavePatch＝該当行put/deleteで同一IFを実装（本番切替時の動作差をなくす）。
- 実装差替え: Phase 0 = `LocalStorageRepository`（全量書きで可、ローカルは速い）、Phase 1 = `DexieRepository`（行単位テーブル＋差分書き、保存履歴5世代はスナップショットテーブル）、Phase 4 = `ApiRepository`。

### 6.2 エクスポート/インポート（全フェーズ必須）
- エクスポート: §5.2 JSONをダウンロード（`{project.name}-{date}.epcgraph.json`）。
- インポート: ファイル選択→全バリデーション→「新規プロジェクトとして取込」or「現在のプロジェクトを置換（Undo可）」。取込直後に全体自動レイアウト（Worker）を提案。
- バックアップ・環境間移行（モック→MVP→本番）・不具合再現材料をすべて兼ねる。

## 7. 複数人編集戦略（段階的に積み上げる）

### 7.1 運用前提と方針
- EPCの実務では**WBS単位で担当が分かれる**（土木担当が`1.x`、配管担当が`2.x`…）。同一タスクを複数人が同時に触る事態は稀、という運用前提を置く。したがって**悲観ロックや常時リアルタイム同期は初手では過剰**であり、「衝突は検知して知らせる。稀にしか起きないから対話的解決で十分」が費用対効果の最適点。
- ただし**スキーマとAPIの形は最初（Phase 0/1のローカル実装含む）からL1対応**にしておく（行rev・updatedBy・差分Patch・PatchResultのconflicts型）。ここを後付けにすると全ストレージ実装とストアの書き直しになるため。

### 7.2 レベル別設計とコスト
| レベル | 内容 | 実装コスト | 得られる体験 / トレードオフ |
|---|---|---|---|
| **L0 単独編集**（Phase 0-1） | ローカル保存のみ。複数人は「JSONを渡す」運用 | — | 最速でMVP。同時編集不可 |
| **L1 楽観的同時実行制御**（Phase 4・必須） | savePatchの各行に`baseRev`同梱。サーバは行ごとに`現rev == baseRev`を検査。**全行OKなら適用**（各行rev+1、projects.version+1、change_log追記）。**1行でも不一致なら409で衝突行リスト返却**（サーバ側現値つき）。クライアントは衝突ダイアログ（行ごとに「サーバの値を採用/自分の値で上書き」、上書きは新revで再送）。非衝突行は先に適用してよい（部分適用＋残り再送） | 小（サーバ数十行＋ダイアログ1個）。§5の仕込みが効く | WBS分担運用なら衝突はほぼゼロで、実質自由に並行編集できる。他者の変更が「保存時まで見えない」のが残る欠点→L2で解消 |
| **L2 変更通知/自動リフレッシュ**（Phase 4後半） | クライアントが`GET /changes?since={version}`を20〜30秒間隔でポーリング（SWA+Functionsと相性が良い。常時接続不要）。返ってきたchange_logを**ローカル非ダーティ行にだけ適用**（ダーティ行と重なったらL1と同じ衝突ダイアログ）。ステータスバー「山田さんの変更12件を反映しました」。編集中ユーザーの表示（「このプロジェクトを開いている人」）もポーリング応答に載せる | 中（change_logテーブル＋API1本＋クライアント適用ロジック）。プッシュ基盤不要 | 準リアルタイム（数十秒遅延）。会議で同じ画面を見ながらの共同レビューに耐える。ポーリングコストはFunctions無料枠で無視できる規模 |
| **L3 リアルタイム共同編集**（将来・任意） | Yjs（CRDT）でtasks/depsをY.Mapに写像＋**Azure Web PubSub（or SignalR Service）**でブロードキャスト。プレゼンス（他者カーソル・選択表示）。DBへはYjsドキュメントの定期スナップショット永続化 | 大（数週間。信頼できる真実がSQL⇔CRDTの二重になる問題、オフラインマージ、DAG不変条件のCRDT上での保証=同時編集で循環が「マージの結果」生まれるケースの検出と修復、が本質的に難しい） | Figma級の同時編集。**発動条件を決めておく: L2運用で「同一WBSの高頻度同時編集による衝突ダイアログが週N回超」が実測されたら着手**。それまでは作らない |
- L1→L2→L3は積み上げ式（前段を壊さない）。L3でもL1の行revは「CRDT外の整合性最終防衛線」として残す。

### 7.3 監査・履歴
- 全行の`updatedBy`/`updatedAt`＋change_log（L2以降）で「誰がいつ何を変えたか」が追える。右パネルに「最終更新: 山田 7/9 14:02」を表示（Phase 4）。行単位の履歴UI（タイムライン）はスコープ外、change_logがあれば後から作れる。

### 7.4 リアルタイム化の拡張点（設計上の予約のみ）
- ストアのアクション（addTask/updateTask/connect/…）は既に「意図の単位」になっており、CRDT化する場合はこのアクション層をYjsトランザクションに写像する。**コンポーネント層の変更はほぼ不要**な構造を保つこと（アクションを迂回した直接状態変更を禁止するlintルールをPhase 1から導入）。

### 7.5 ユーザー識別（assigneeと「自分」）
- Phase 0-1（ローカル）: 設定画面で「私は誰」（表示名）を入力→`updatedBy`と`@me`フィルタに使用。
- Phase 4: SWAの`x-ms-client-principal`から`userDetails`（メール）を取得し`updatedBy`に記録。`assignee`は自由文字列のまま維持し（EPC現場では会社名・班名が入ることもある）、**「自分のタスク」判定はユーザー設定の「私のassignee別名リスト」**（例: "山田", "yamada@example.com"）との照合にする。assigneeの完全マスタ化はv1ではしない（運用が固まってから）。

## 8. MS Project連携（nice-to-have、Phase 5）

### 8.1 前提と現実解
- `.mpp`はプロプライエタリ・非公開バイナリで直接パースは非現実的（MPXJというJava/.NETライブラリは存在するが、ブラウザ完結の本構成に合わない。将来必要ならAzure Functionsに.NET関数を足してMPXJで読む拡張案として記録）。
- **現実解: MSPDI（Microsoft Project XML）**。MS Projectが標準で「名前を付けて保存→XML」「開く→XML」に対応する公開スキーマ。テキストなのでブラウザ内で完結処理できる。4,000タスクのMSPDIは10〜30MB級のため、パースが重ければWorker化（実測判断）。

### 8.2 マッピング（往復）
| 本ツール | MSPDI |
|---|---|
| task.name / wbsCode | `Task/Name` / `Task/WBS`（`OutlineLevel`はwbsCode階層深度から導出） |
| durationDays | `Task/Duration`（ISO8601 duration `PT160H0M0S`、8h/日換算、`DurationFormat=7`(日)） |
| isMilestone | `Task/Milestone` |
| dependency(type,lagDays) | `Task/PredecessorLink`（`Type`: 1=FS,0=FF,2=SS,3=SF ※コード表に注意、`LinkLag`は1/10分単位。実物サンプルで要検証） |
| progress | `Task/PercentComplete` |
| discipline/assignee/status | エクスポート時Text1-3カスタムフィールド（or Notes埋込）。インポート時はText1-3→属性対応をユーザー選択 |
| calendars | `Calendars/Calendar/WeekDays` |
| position(x,y) | **対応なし**。インポート時は全体自動レイアウト（Worker）。エクスポートでは捨てる |
- インポート制約: サマリタスク（`Summary=1`）はタスク化せずwbsCodeへ写像（これが折り畳み階層になる）。リソース割当・コストは無視（v1）。
- 受入基準: 「本ツール→XML→MS Projectで開く→XML保存→本ツール」の往復でタスク数・依存・期間・進捗が保存（座標以外）。実装前にMS Project実機でサンプルXMLを2〜3本取得しフィクスチャ化。

## 9. CPM/ガント（クリティカルパスは第一級機能）

### 9.1 CPMアルゴリズム（`domain/cpm.ts`、純関数）
```
入力: tasks, dependencies, calendar, projectStart(dataDate)
1. トポロジカルソート（Kahn）。循環ならエラー（UI上は起き得ないが防御）
2. 前進計算（トポ順）: ES = max(先行制約ごとの下限)
     FS: pred.EF + lag   SS: pred.ES + lag   FF: pred.EF + lag − dur   SF: pred.ES + lag − dur
     先行なしは projectStart。SNET制約 → ES = max(ES, constraintDate)
     EF = ES + dur（カレンダー適用時は稼働日加算 addWorkingDays(ES, dur, cal)）
3. 後退計算（逆トポ順）: LF = min(後続制約ごとの上限)、後続なしは projectEnd = max(全EF)
     FNLT制約 → LF = min(LF, constraintDate)。LS = LF − dur
4. TF = LS − ES。TF ≤ 0 のタスクと駆動依存がクリティカルパス
出力: CpmResultMap = Map<taskId, {es, ef, ls, lf, totalFloat, isCritical}> ＋ projectEnd
      ＋ criticalEdgeIds（駆動依存の集合。エッジ強調に使用）
```
- 日付表現: 内部は「projectStartからの稼働日オフセット（number、0.5日刻み）」。表示時にカレンダーで実日付へ変換（日付⇄オフセットの単調配列＋二分探索でメモ化、4,000タスク一括変換<10ms）。
- **性能**: O(V+E)、4,000ノード・6,000エッジで<20ms。グラフ変更のたびメインスレッド同期実行でよい（Worker不要）。属性連続入力へは再計算デバウンス100ms。
- 段階導入: **Step1** 暦日＋FSのみ（**Phase 1に前倒し**——CP可視化を第一級機能としてMVPから提供） → **Step2** SS/FF/SF＋lag → **Step3** カレンダー（週休・祝日）＋SNET/FNLT。各Stepでプロパティテスト（依存追加でESは減らない／TFの単調性）＋MS Project同一入力での突合テスト。
- **CpmResultMapはUI全体の共有導出値**: CP強調（§2.11）・`criticalOnly`フィルタ（§2.8）・日付表示・ガント（§9.3）・俯瞰CP表示（§2.10）がすべてこの1つのMapを参照。ストアにはメモ化セレクタとして実装（tasks/depsの参照が変わった時のみ再計算）。

### 9.2 CPM結果のUI反映
- Phase 1（Step1時点）: CP赤強調トグル＋「CPのみ表示」ビュー＋右パネルTF表示＋「プロジェクト完了日」サマリ。完了日が変わる編集をしたら完了日表示をフラッシュ（結果が動いたことの即時フィードバック——UX原則2）。
- Phase 2（Step2-3）: 依存タイプ/lag/制約/カレンダー対応で数値が本物になる。ノードES〜EF日付表示、準クリティカル（TF≤閾値、既定5日）の橙段階表示、集約ノード/俯瞰へのCPバッジ・経路表示。

### 9.3 ガントビュー（Phase 3）
- ヘッダタブでネットワーク⇔ガント切替（v1.3: タブの器・行集合・行仮想化は§12の多ビュー基盤として先行整備する。ガントとの接続契約は§12.4）。**同一ストア・同一CpmResultMap・同一フィルタ/折り畳み状態の別ビュー**（絞り込み体験が両ビューで一貫）。編集はまず閲覧＋バー端ドラッグでduration変更程度から。
- 実装方式: ①自前SVG/Canvas（行=タスク、CPM結果から座標計算は自明。依存矢印も自前）②`gantt-task-react`等の既製（4,000行に耐える行仮想化を持つものが少なくメンテも不安定）。**推奨は①自前**——行仮想化（@tanstack/virtual）必須で、既製より制御しやすい。Phase 3冒頭に半日スパイクで最終判断。
- 表示要件: WBS順ソート・WBSグループ行（折り畳み連動）・工種色・進捗塗り・クリティカル赤・依存矢印・マイルストーン菱形・今日線・月/週ヘッダ・行/横スクロール仮想化。

## 10. 実装フェーズ分割（Opus/Sonnet向け作業指示）

> 共通ルール: 各PhaseはPR分割単位まで刻んである。`domain/`は必ずテスト付き。UIはPlaywrightスモーク（起動→ノード作成→接続→リロード後残存）最低1本。**性能受入は必ず「4,000ノードシード」で計測**（シード生成: WBS 3階層×工種3種×担当10名×依存密度1.5本/タスクを`domain/seed.ts`として最初に作り全Phaseで使い回す）。コミットメッセージは日本語可。

### Phase 0: ゼロ設定モック（最優先・2〜3日規模）— 担当: **Sonnet**
**成果物**: `epc-task-graph/mock/index.html`（単一ファイル、~1,000行想定）＋ `epc-task-graph/README.md`（開き方3行）
**作り方（具体）**:
1. importmapで `react@18` `react-dom@18` `@xyflow/react@12`（バージョン固定・メジャー浮動禁止） `zustand` `@dagrejs/dagre` `htm` を `https://esm.sh/` から解決。React Flowのスタイルは `https://esm.sh/@xyflow/react@12/dist/style.css` を `<link>`。
2. JSXは使わずhtm（`html\`<${ReactFlow} ...>\``）で記述。Babel standaloneは使わない（重い）。
3. 実装順: ①ReactFlow表示＋背景＋ミニマップ＋Controls＋`onlyRenderVisibleElements` → ②カスタムTaskNode（名前・工種バー・左右ハンドル、`memo`）＋MilestoneNode＋LOD分岐（zoom<0.4で矩形化） → ③ダブルクリック作成＋インライン名前編集 → ④接続/削除＋`isValidConnection`（ドラッグ開始時に祖先Set計算→O(1)判定） → ⑤**表示パイプラインの骨格 deriveVisibleGraph（フィルタ判定→WBS折り畳み→フォーカス）を純関数で実装**＋集約ノード＋展開/折り畳み＋展開レベルボタン → ⑥簡易フィルタ（工種・ステータス・担当、DIM/ISOLATE切替）＋近傍フォーカス（`H`、上流/下流2階層） → ⑦右パネル（属性フォーム＋先行/後続リスト＋WBSパンくず。rev/updatedBy/CPM系属性はデータに持つだけ・計算なし） → ⑧表示中サブグラフのdagre整列＋全体整列（Blob URL Worker） → ⑨localStorage自動保存＋JSON入出力＋**4,000ノードデモ生成ボタン** → ⑩Tab連続作成、Delete、Cmd+Z（素朴なスナップショット20世代で可。ただしJSON.stringify丸ごと保存はしない＝参照共有を意識）
4. データ構造は最初から§5.2のJSONスキーマ（rev/updatedBy/viewState/savedViews含む）に完全準拠。**deriveVisibleGraphはUIから分離した純関数として書く**（Phase 1でそのまま移植）。
**受入基準**: (a) `index.html`をブラウザで開くだけで動く（CDN到達可能な環境で） (b) タスク作成→接続→編集→削除→整列→リロード復元が一連で動く (c) 循環接続が拒否されトーストに経路が出る (d) JSONエクスポート→インポートで完全復元 (e) **4,000ノードデモを生成し、既定展開（レベル2）でパン/ズームが体感スムーズ（目視55fps級）、1枝全展開（〜500ノード表示）でも操作可能、ISOLATEフィルタ（例: 担当=1名）で瞬時に数十ノード表示へ** (f) 近傍フォーカスで上流/下流だけが表示され、折り畳み先への継続がバッジで見える (g) 全体整列がUIをブロックしない (h) §1.2の操作1〜10が動く。

### Phase 1: ローカルMVP（Vite化・UX完成・CP表示・俯瞰）— 設計レビュー: **Opus** / 実装: **Sonnet**
**成果物**: `epc-task-graph/app/`（§4.2構成）。モック全機能を移植の上で追加。
**PR分割**:
1. 足場: Vite+TS+ESLint+Vitest+Playwright、`domain/`型とZodスキーマ、`validate.ts`＋`seed.ts`＋`deriveVisibleGraph`移植＋テスト（循環・折り畳み・フィルタ・フォーカスの導出を網羅）
2. モック移植（コンポーネント分割、adapters層でReact Flow依存隔離、zustand+zundo(diff)+immer、**ダーティ追跡**、Undo/Redo仕上げ。ストア直接変更禁止のlintルール導入=§7.4）
3. `DexieRepository`（行単位・差分書き=savePatch実装・行rev/updatedBy記録）＋複数プロジェクト＋自動保存＋保存履歴5世代＋「私は誰」設定（§7.5）
4. **CPM Step1（暦日・FSのみ）＋CpmResultMapセレクタ＋CP強調トグル＋「CPのみ表示」ビュー＋完了日サマリ**（§9.1-9.2。手計算フィクスチャ5件＋4,000シード<20ms性能テスト）
5. **フィルタ/ビュー完成**: GraphFilter全条件・DIM/ISOLATE・組込みビュー（自分のタスク/CPのみ/マイルストーン）・保存ビューCRUD・URLハッシュ共有
6. **近傍フォーカス完成**（深さ調整・フォーカスバー・フィルタ外点線表示・右パネル依存/WBSナビ・パンくず）＋検索パレット（自動展開ジャンプ）＋WBSツリーパネル（仮想スクロール）
7. **俯瞰Canvasレイヤ**（§2.10）: 全量描画・フィルタ/CP反映・クリックジャンプ・範囲展開
8. キーボード完全対応（§2.2全部）＋コピー/貼付け/複製＋性能仕上げ（elkjs差替口・階層分割レイアウト・Playwright性能計測をCIに記録）
**受入基準**: §0.3「直感的」定義を満たす（第三者1名で60秒テスト）。**§0.3-4の性能予算を4,000シードで数値クリア**（表示300ノードでパン/ズーム55fps、編集反映<50ms、読込<2s、フィルタ適用<100ms）。CPのみ表示で背骨チェーンが抽出され整列できる。撤退基準（§3.1）の判定をここで正式に行い結果をREADMEに記録。

### Phase 2: CPM完成（依存タイプ・カレンダー・制約） — 担当: **Opus**（アルゴリズムとテスト設計）→ 仕上げSonnet可
**PR分割**: ①Step2（SS/FF/SF＋lag）＋プロパティテスト → ②Step3（カレンダー・SNET/FNLT）＋カレンダー編集UI（最小: 週休曜日＋祝日リスト） → ③UI反映拡充（ES〜EF日付表示・準クリティカル橙・集約/俯瞰CPバッジ・dateRangeフィルタ有効化）
**受入基準**: MS Project（or 手計算Excel）と同一入力でES/EF/LS/LF/TF一致のフィクスチャテスト。4,000ノードで編集→再計算→表示更新が体感即時。

### Phase 3: ガントビュー — スパイク判断: **Opus** / 実装: **Sonnet**
①半日スパイク（自前SVG/Canvas vs 既製、**4,000行仮想化を判断軸に**）→設計メモ → ②閲覧ガント（§9.3表示要件、行仮想化・フィルタ/折り畳み連動必須） → ③バー端ドラッグでduration編集＋ネットワークビューへ反映
**受入基準**: 4,000タスクでスクロール滑らか、CPM結果とバー位置一致、ビュー間でフィルタ/折り畳み/選択が同期。

### Phase 4: Azure本番化＋複数人L1/L2 — 担当: **Opus**（IaC/認証/同時実行制御）＋Sonnet（ApiRepository/UI）
**PR分割**: ①Bicep（SWA Standard＋Azure SQL serverless）＋GitHub Actions（SWA標準ワークフロー） → ②Functions API（GET全量gzip / PATCH差分＋**行レベル衝突検知（§7.2 L1）**、x-ms-client-principal→updatedBy） → ③`ApiRepository`（ダーティ追跡→PATCH、409衝突ダイアログ、オフライン草稿退避→再接続時解決） → ④Entra IDテナント限定＋`staticwebapp.config.json`（全ルートauthenticated） → ⑤**L2: change_log＋/changesポーリング＋非ダーティ行への自動反映＋「開いている人」表示**
**受入基準**: 社内アカウントのみログイン可。4,000ノード初回ロード<2s（gzip確認）。連続編集のPATCHが数KB/回。**2ブラウザで別タスクを同時編集→両方成功し互いの変更が30秒以内に自動反映される。同一タスクを同時編集→後者に衝突ダイアログが出て行単位で解決できる。** DB自動停止からの復帰でも初回リクエストが失敗しない（リトライ）。

### Phase 5: MSPDI連携 — 担当: **Sonnet**（Opusがマッピング表レビュー）
①MS Project実機からサンプルXML取得→フィクスチャ化（小規模＋4,000行級の2種） → ②インポート（§8.2、バリデーション＋Worker全体レイアウト、大容量パースのWorker化は実測判断） → ③エクスポート → ④往復テスト
**受入基準**: §8.2の往復基準＋4,000行XMLのインポートがUIをブロックしない。

### Phase 6（任意・発動条件つき）: リアルタイム共同編集L3
§7.2の発動条件（L2運用で衝突ダイアログ週N回超）を満たしたら、Yjs＋Azure Web PubSubで着手。設計はゼロからでなく§7.4のアクション層写像から。

## 11. リスクと対策
1. **React Flowの規模限界を読み誤るリスク**: 表示数制御で回避する設計だが、現場運用で表示が膨らむ可能性 → 1,500超警告＋Phase 0/1の4,000シード実測を受入基準化＋G6への撤退基準と依存隔離（adapters層）を最初から用意（§3.1）。
2. **WBSコード運用が崩れているリスク**: 折り畳み・分担編集の前提は`wbsCode`階層 → 未設定でも動く（ルート直下扱い）＋インポート時にOutlineLevelから自動生成。それでも現場にWBSが無い場合は「工種×エリア」等の属性で折り畳み単位を代替する設計変更が必要（早期に要確認、下記残論点）。
3. **esm.sh依存（Phase 0）**: CDN仕様変更リスク → バージョン完全固定＋Phase 1で脱CDN。壊れたらViteフォールバック。
4. **React Flow v11/v12情報の混在**: 実装は必ず公式docs（reactflow.dev）のv12 APIを参照。
5. **全体レイアウトの計算時間**: dagre/elkjsは4,000で数秒〜十数秒 → Worker必須＋WBS階層分割で問題サイズを数百に分割（§2.5）。遅ければFunctionsへ逃がす拡張点。
6. **Undo履歴のメモリ膨張**: 4,000件×100世代の丸ごと保存は不可 → zundo diff＋immer構造共有を必須化（§2.3）。
7. **同時実行制御の複雑化**: L1/L2で十分なのにL3へ早期着手する誘惑 → 発動条件を数値で固定（§7.2）。逆にL1を後回しにする誘惑 → 行rev/updatedByはPhase 0からスキーマに固定済み（§5.1）。
8. **CPMの端数・カレンダー境界バグ**: 稼働日演算はオフバイワンの巣 → 内部を稼働日オフセット(0.5刻み)に限定、日付変換を1関数に集約、MS Project突合フィクスチャを義務化。
9. **MSPDIの方言と容量**: バージョン差でXML細部が揺れる＋4,000行で10MB級 → 実機サンプル駆動で実装＋パースWorker化を実測判断。
10. **「全量ロード」の限界**: 5万ノード級・多人数高頻度編集が現実になったら部分ロード＋差分購読へ再設計。現要件（〜10,000ノード・WBS分担・L1/L2）では差分保存までで足りると判断。判断根拠ごと本書に残す。

## 12. 多ビュー（グラフ／テーブル／ガント）— v1.3追記

> 背景: Phase 1で実装済みなのはグラフビュー単独（フィルタDIM/ISOLATE・WBS折り畳み・近傍フォーカス・CPM Step1＋`selectCpm`メモ化セレクタ・複数プロジェクト・Dexie差分永続化・保存ビュー）。一方、EPC担当が日常的に「読む」のは表とガントであり、グラフは「編集と依存理解」の面。参考にした多ビュー型モックの見えやすさの正体もテーブルとガントにある。**4,000ノード基盤（表示パイプライン・domain純関数・CpmResult）とデータモデル（§5）はそのまま活かし、読取面としてテーブル（最優先）とガント（Phase 3のまま）を同じ器に差す。** スキーマ変更なし（schemaVersion据え置き）。

### 12.1 原則（既存原則の適用）
1. **ビューは表示層のみ・状態はzustand一元**（§7.4の延長）: 選択・GraphFilter・DIM/ISOLATE・折り畳み・近傍フォーカス・CP強調・現在プロジェクト・dataDateは**全ビュー共有の単一状態**。ビュー固有に持ってよいのは「読み方」の状態（ソート・表示列・スクロール位置・編集中セル）だけ。フィルタや選択をビューごとに複製しない——複製した瞬間に「表とグラフで見えているものが違う」事故が始まる。
2. **行集合はdomain純関数が決める**: グラフの`deriveVisibleGraph`と**対になる`deriveTableRows`を新設**（§12.3.1）。`deriveVisibleGraph`には依存させない——グラフの出力は「集約ノード＋エッジ」、テーブルの出力は「ツリー行の平坦列」で形が違う。共有するのは入力（`ViewSpec`）と下位純関数（`matchesFilter`／`neighborhood`／`wbs.ts`ヘルパー／`selectCpm`）。
3. **描画ライブラリは隔離層越し**（§3.1と同じ規律）: 仮想スクロールは`@tanstack/react-virtual`を`components/table/`内に閉じ、domain/storeは非依存。React Flowをadaptersに閉じたのと同型。
4. **4,000行で滑らかが受入基準**: 仮想スクロール必須。DOM行数は視界＋オーバースキャンの数十行のみ（§12.3.3の性能予算）。

### 12.2 View Shell（多ビューの器）
- **タブ**: ヘッダに「グラフ | テーブル | ガント」。ガントタブはPhase 3までdisabled表示（機能の存在を最初から見せる——CPボタンと同じ流儀§2.8）。タブショートカットはMVPではクリックのみ（既存キー`1`〜`3`は展開レベルで使用済み。割当はPR-T2で検討）。
- **ストア追加**（すべてUndo対象外・Dexie非永続。`viewSpec`同様の表示状態）:
```ts
// AppState 追加
activeView: 'graph' | 'table' | 'gantt';   // localStorage 'epc-app-active-view' に記憶（LS_MEと同流儀）
tableSort: TableSort[];                    // 多重ソート（最大3キー）。既定 []（=WBS自然順）
tableColumns: TableColumnKey[];            // 表示列。localStorage 'epc-app-table-columns' に記憶
// アクション（§7.4 直接setState禁止lintに従い、新設はこの6個のみ）
setActiveView(v: ActiveView): void;
setTableSort(sort: TableSort[]): void;
toggleTableSort(key: TableSortKey, additive: boolean): void; // クリック=単独 asc→desc→解除 / Shift+クリック=キー追加
toggleTableColumn(key: TableColumnKey): void;
revealTask(taskId: string): void;  // wbsPath()で祖先WBSプレフィックスを列挙しcollapsedWbsから除去＋選択。
                                   // ビュー切替時の「選択対象を必ず見せる」の共通実装（検索ジャンプ§2.6にも将来流用）
```
- **マウント戦略**: グラフ（React Flow）とテーブルは**両方マウントしたまま非アクティブ側を`display:none`**で隠す（レイアウト計算が止まり最も軽い。DOMはグラフ=表示中数百ノード・テーブル=数十行のみで常駐コストは無視できる）。復帰時に`fitView`は呼ばない（ビューポート保持）。テーブル側はvirtualizerがコンテナサイズ0の間も破綻しないが、復帰時に`measure()`を1回呼ぶ。**「タブ往復でグラフのビューポート・テーブルのスクロール位置・選択がすべて保たれる」を受入基準にする**（§12.6）。
- **選択・フィルタ同期の仕様**（表で確定。実装の大半は「状態が共有されているので何もしない」で済む）:

| 操作 | 効果 |
|---|---|
| テーブルのタスク行クリック | `selection.taskId`=当該行（グラフのノード選択と同一状態）。右パネルが開く（両ビュー共通） |
| テーブルのWBS行クリック | `selection.aggId`=`'wbs::'+prefix`（集約ノード選択とID規約を共有） |
| グラフで選択→テーブルへ切替 | 該当行へ`scrollToIndex`。祖先WBSが折り畳み中なら`revealTask`で自動展開 |
| テーブルで選択→グラフへ切替 | `revealTask`＋選択ノードへパン（センタリングのみ。fitViewはしない） |
| テーブル行の「⌖ 近傍」ボタン / `H` | `toggleFocus(taskId)`＋`setActiveView('graph')`——「表で見つけて図で前後を辿る」最頻動線 |
| フィルタ／組込みビュー／保存ビュー適用 | `viewSpec`共有のため両ビューへ同時反映（**追加実装ゼロ**。`quickMyTasks`/`quickCriticalOnly`/SavedView適用は現行コードのまま効く） |
| WBS折り畳み | `collapsedWbs`共有。テーブルの▸/▾＝グラフの集約/展開と完全連動 |
| CP強調トグル | グラフ=赤太線、テーブル=CP列の旗＋行の赤アクセント（同じ`cpHighlight`を参照） |
- **左右パネルは全ビュー共通で残す**: 左パネル（フィルタ・保存ビュー・WBSツリー）と右パネル（属性フォーム・依存(先行/後続)ナビ・WBSナビ）はビュー非依存の資産。特に右パネルの依存欄が、テーブルビューにおける依存参照/編集経路になる（§12.3.6）。

### 12.3 テーブルビュー詳細設計（最優先）

#### 12.3.1 行導出 `deriveTableRows`（`domain/deriveTableRows.ts`・純関数・Vitest必須）
```
deriveTableRows(tasks, deps, viewSpec, sort, cpmByTask) → { rows: TableRow[], stats }
  viewSpec: 既存 ViewSpec をそのまま受ける（filter / displayMode / collapsedWbs / focus / me /
            criticalTasks）。cpmByTask は selectCpm().byTask（CPM列の表示とソートに使用。null可）

段1 フィルタ判定: matchesFilter を再利用（§2.8。criticalOnly は viewSpec.criticalTasks 参照）
段2 近傍フォーカス: viewSpec.focus 有効時は neighborhood（graph.ts）で行集合を絞る。
     グラフと同じ真実性規約（§2.9）: 探索は全依存グラフ・フィルタ外の近傍は outside=true の淡色行
段3 WBSツリー化: wbsCode プレフィックスで木を構築（wbs.ts に buildWbsTree を追加。既存関数は不変）。
     中間プレフィックスごとに WBS グループ行（kind:'wbs'）、配下にタスク行（kind:'task'）。
     wbsCode 未設定タスクはルート直下（§2.7と同じ）。
     DIM: 非マッチ行を残し dim=true ／ ISOLATE: 非マッチ除去＋空になった枝を除去＋
     マッチを含む枝は自動展開（deriveVisibleGraph 段2と同じ規則）
段4 折り畳み: collapsedWbs 配下のタスク行・子WBS行を出力せず、WBS行に collapsed=true＋
     memberCount（フィルタ後件数）＋hasCritical/hasMilestone（集約ノード§2.7と同じ意味論）
段5 ソート: 兄弟集合内で多重ソート（**ツリー構造は常に保持**——木を壊すフラット全体ソートはしない。
     フラットな並べ替えが欲しい場面は ISOLATE＋全展開が実質代替）。既定は wbsCode 自然順
     （セグメント数値比較: "1.10" は "1.9" の後）。CPM列(es/ef/ls/lf/tf)は cpmByTask 参照・null時は末尾
段6 DFS平坦化: depth 付き TableRow[]（仮想スクロールに渡す1次元配列）

計算量: O(V log V)（ソート支配）。4,000タスク＋WBS行で <30ms 目標。
```
```ts
type ActiveView = 'graph' | 'table' | 'gantt';
type TableColumnKey =
  | 'wbsCode' | 'name' | 'wbsPath' | 'discipline' | 'assignee' | 'status' | 'progress'
  | 'durationDays' | 'es' | 'ef' | 'ls' | 'lf' | 'totalFloat' | 'critical' | 'deps';
type TableSortKey = Exclude<TableColumnKey, 'deps'>;
interface TableSort { key: TableSortKey; dir: 'asc' | 'desc' }
interface TableRow {
  kind: 'wbs' | 'task';
  id: string;              // task.id ／ 'wbs::'+prefix（グラフ集約ノードとID規約を共有→選択同期に直結）
  depth: number;           // インデント段
  // kind:'wbs'
  wbsPrefix?: string; collapsed?: boolean; memberCount?: number;
  hasCritical?: boolean; hasMilestone?: boolean; avgProgress?: number;
  // kind:'task'
  task?: Task; dim?: boolean; outside?: boolean;
  predCount?: number; succCount?: number;   // buildAdjacency から O(1)
}
```
- **メモ化**: `store/selectors.ts`に`selectTableRows`を追加（`selectCpm`と同型のモジュールキャッシュ。キーは`tasks`/`deps`/`viewSpec`/`sort`/`cpm`の**参照**。immerが変更時のみ参照を差し替えるため成立——既存`selectCpm`と同じ根拠）。

#### 12.3.2 列仕様
| 列 | 内容 / 表示 | ソート | インライン編集 | 既定 |
|---|---|---|---|---|
| WBSコード | `task.wbsCode`（等幅フォント） | ○（自然順） | ✕（MVP。ツリー再配置を伴うため右パネル経由。PR-T2で再検討） | 表示 |
| タスク名 | インデント＋▸/▾（WBS行）＋菱形アイコン（milestone） | ○ | ○ text | 表示（左固定） |
| WBSパス | 「1 › 1.2 › 1.2.3」全パス文字列 | ○ | ✕ | 非表示（ツリーが同情報を担う。ソート後のフラット読み用） |
| 工種 | E/P/C/OTHER カラーチップ（§2.11の色） | ○ | ○ select | 表示 |
| 担当（部署） | `assignee`（部署名運用・§7.5） | ○ | ○ text＋datalist（既存assignee値を候補提示） | 表示 |
| ステータス | バッジ（§2.11の色規約） | ○ | ○ select | 表示 |
| 進捗 | %＋ミニバー | ○ | ○ number 0-100 | 表示 |
| duration | 日数。milestoneは0固定 | ○ | ○ number ≥0（milestone行は編集不可） | 表示 |
| ES / EF | `cpm.esDate`/`efDate`（yyyy-mm-dd。未計算時「—」） | ○ | ✕（導出値・§5.1） | 表示 |
| LS / LF | 同上 | ○ | ✕ | 非表示 |
| TF | `totalFloat`（日）。TF≤0=赤・TF≤5=橙（準クリティカル閾値§2.11と共通） | ○ | ✕ | 表示 |
| CP | `isCritical`の旗（赤） | ○（CP先頭） | ✕ | 表示 |
| 先行/後続 | 件数バッジ「◀2 ▶3」。クリックでポップオーバー（名称リスト→クリックで該当行へジャンプ） | ✕ | ✕（§12.3.6） | 表示 |
- 列表示切替はテーブルツールバー右端の「列」メニュー（チェックリスト、`toggleTableColumn`）。localStorage記憶。
- WBS行には集計を表示: `memberCount`・進捗平均・CP/マイルストーンバッジ（集約ノードと同じ意味論）。配下日付集計（min ES〜max EF）はPR-T2（ガントのサマリバー準備を兼ねる）。

#### 12.3.3 仮想スクロール（必須）とライブラリ選定
- **`@tanstack/react-virtual` v3を採用**（`useVirtualizer`・固定行高32px・overscan 10・ヘッダは`position: sticky`）。段6の平坦配列をインデックス描画するだけで、ツリーテーブルと仮想化が自然に両立する。
- **TanStack Table v8（headlessテーブル）は不採用**: 列モデル・ソート・ツリー展開の状態をライブラリ側インスタンスが持つ設計で、`collapsedWbs`/`viewSpec`/`tableSort`をzustandに一元化する本設計と二重管理になる。列は十数本・機能は本章の範囲で確定しており自前列定義で足りる。仮想化だけを借りる構成はTanStack公式も標準としており（TableのVirtualizationガイドがVirtual併用を前提）、かつ**同ライブラリはガント§9.3の行仮想化でも共用**——依存1個で二役。
- **性能予算**（受入基準）: 4,000タスクで初期表示（derive＋初回描画）<500ms、スクロール55fps級、フィルタ/ソート切替の反映<100ms、DOM行数≤50。行コンポーネントは`memo`＋最小プリミティブprops（グラフノードと同じ規律§2.6-4）。

#### 12.3.4 インライン編集（すべて既存ストアアクション経由）
- 起動: セルダブルクリック／選択行で`Enter`（名前セル）。確定: `Enter`・blur→**`updateTask(id, patch)`**——rev+1・updatedBy・ダーティ追跡・デバウンス保存・zundo履歴が既存アクションに全部付いてくる。破棄: `Esc`。**1確定=1 Undo単位**。
- §7.4の直接setState禁止lintに従い、テーブルからの書込は既存アクション（`updateTask`/`addTask`/`deleteTasks`/`toggleCollapse`/`setSelection`/`toggleFocus`…）のみ。新設アクションは§12.2の6個だけ。
- 入力検証はZodスキーマ（§5.2）と同じ制約をセル側で先に弾く（duration≥0、progress 0-100整数、milestoneのduration編集不可）。確定でCPMが自動再計算され（`selectCpm`の参照キャッシュが自然に無効化）、完了日サマリ・CP列・TF列が即応——結果が動いたことの即時フィードバック（§0.3-2）がテーブルでも成立する。
- ソート中の編集: 確定後は即再ソート。選択行が視界外へ移動したら`scrollToIndex`で追従。

#### 12.3.5 行の追加・削除
- 「＋行」ボタン／キー`N`→`addTask`（wbsCode=選択行の文脈。既存`currentWbsContext`の挙動がそのまま効く）→新行の名前セルが編集状態。
- 選択行で`Delete`→`deleteTasks`（接続依存も同時削除・Undoトースト案内は既存挙動）。MVPは単一行選択。複数行選択（Shift+クリック範囲）と一括操作はPR-T2。
- `Tab`連続作成（後続生成）はグラフ専用のまま。テーブルでの`createSuccessor`流用はPR-T2で検討。

#### 12.3.6 依存の参照（テーブルでは参照まで・編集は最小）
- 先行/後続列のポップオーバー＝**参照とジャンプ**（行間の依存が表内で追える最小要件）。
- 依存の追加/削除は右パネル「依存」欄（全ビュー共通・§2.9の第二経路）とグラフ接続に委ねる。**表のセルで依存を編集させない**——それは競合（MS Project/P6）の悪いUXであり本ツールの存在意義に反する（§0.3-1）。

#### 12.3.7 キーボード（テーブルビュー中）
| キー | 動作 |
|---|---|
| `↑`/`↓` | 行選択移動（選択はグラフと共有） |
| `←`/`→` | WBS行: 折り畳み/展開（`toggleCollapse`）。タスク行で`←`: 親WBS行へ |
| `Enter` | 名前セル編集開始。編集中`Enter`=確定して下の行へ |
| `N` | 新規行（選択行のWBS文脈） |
| `Delete` | 行削除 |
| `H` | 当該タスクの近傍フォーカス＋グラフへ切替（§12.2） |
| `Cmd/Ctrl+Z`/`+Shift+Z` | Undo/Redo（全ビュー共通・既存） |
- インライン編集中はグローバルショートカット無効（§2.2の既存規律をそのまま適用）。

#### 12.3.8 組込みビュー・保存ビューとの関係
- 「自分のタスク」「CPのみ」「マイルストーン」は`viewSpec.filter`を書くだけなので**テーブルにそのまま効く**（`quickMyTasks`/`quickCriticalOnly`は実装変更ゼロ）。「CPのみ＋テーブル」＝背骨の一覧表で、PM向け説明の主力画面になる想定。
- SavedViewへの`tableSort`/表示列の保存はPR-T2（optionalフィールド追加。未知フィールド無視で前方互換、schemaVersion据え置き）。

### 12.4 ガントビューの接続点（Phase 3・ここでは器との契約のみ）
§9.3の計画（自前SVG/Canvas推奨・半日スパイクで最終判断）は変更しない。View Shellとの契約だけ確定する:
1. **同じView Shellの第3タブ**に差す（`activeView: 'gantt'`。§12.2の同期仕様が自動的に適用）。
2. **行集合＝`deriveTableRows`をそのまま使う**（WBS順・折り畳み・フィルタ・ソートがテーブルと同一→ガント左ペインの表と右ペインのバーが常に同じ行並び。行導出を二重実装しない）。
3. **バー座標＝`selectCpm().byTask`のes/ef**（オフセット×日幅。日付ヘッダは`esDate`/`addCalendarDays`）。クリティカル表示は`criticalTasks`/`criticalEdges`、今日線は`project.dataDate`。
4. **行仮想化＝`@tanstack/react-virtual`共用**。行高はテーブルと共有定数（左右ペインのスクロール同期が単純になる）。
つまりPhase 3の作業は「右ペインの時間軸描画」に純化される。テーブルPRの時点で、ガント用の穴（タブ・行集合・仮想化・CPM日付）はすべて開いている。

### 12.5 ファイル構成と既存コードへの影響
```
src/domain/deriveTableRows.ts   新規（純関数＋Vitest。UI/React非依存の規律§4.2を維持）
src/domain/wbs.ts               buildWbsTree 等ヘルパー追加（既存関数は不変）
src/domain/types.ts             ActiveView/TableRow/TableSort/TableColumnKey 追加
src/store/store.ts              activeView/tableSort/tableColumns＋アクション6個追加（既存アクション不変）
src/store/selectors.ts          selectTableRows 追加（selectCpm と同型のモジュールキャッシュ）
src/components/ViewShell.tsx    新規（タブ＋display切替。App.tsx の <CanvasArea/> をこれで包む）
src/components/table/           新規: TableView.tsx / TableRowView.tsx / cells.tsx / ColumnMenu.tsx
src/components/Header.tsx       タブUIの追加（or ViewShell 側にタブバー配置）
package.json                    @tanstack/react-virtual 追加（^3系・メジャー固定）
```
- **変更しないもの**: `deriveVisibleGraph`・`adapters/reactflow.ts`・`CanvasArea`・`persistence.ts`/Dexie（テーブルは新規永続データを持たない。列設定等はlocalStorage）・JSONスキーマ§5.2（schemaVersion据え置き）。

### 12.6 実装フェーズ分割（Opus/Sonnet向け・既存Phase番号と独立の「T系」）

#### PR-T1: 多ビュー器＋テーブルMVP — 実装: **Sonnet** / `deriveTableRows`のテスト設計レビュー: **Opus**（ツリー×フィルタ×折り畳み×ソートの組合せがコーナーケースの巣のため）
**スコープ**: View Shellタブ（ガントdisabled）／`deriveTableRows`＋`selectTableRows`＋Vitest／仮想スクロールテーブル（§12.3.2の既定列・単一キーソート・列表示切替）／選択・フィルタ・折り畳み同期（§12.2の表を全部）／インライン編集（名称/duration/ステータス/担当/工種/進捗）／行追加・削除／キーボード（`↑↓`/`←→`/`Enter`/`N`/`Delete`/`H`）
**受入基準**:
- (a) 4,000ノードデモでテーブル初期表示<500ms・スクロール滑らか（55fps級）・DOM行数≤50
- (b) フィルタ/組込みビュー（自分のタスク・CPのみ）がテーブルへ<100msで反映。DIM=淡色行／ISOLATE=行除去＋マッチ枝の自動展開
- (c) 折り畳みがグラフ⇄テーブルで完全連動（テーブルで畳む→グラフに集約ノードが現れる）
- (d) 行選択⇄ノード選択が同期。ビュー切替時に選択対象へ自動スクロール/自動展開（`revealTask`）。タブ往復でビューポート・スクロール位置・選択が保持
- (e) インライン編集がUndo可・自動保存（保存バッジ遷移）され、完了日サマリ・CP列・TF列が即時更新
- (f) ES/EF/TF/CP列が`selectCpm`と一致（右パネルのTF表示と同値）
- (g) `deriveTableRows`のVitest（ツリー化・ISOLATE枝刈り・折り畳み・wbsCode自然順・focus・CPM列ソート・wbsCode未設定タスク）＋Playwrightスモーク1本（タブ切替→行編集→グラフへ反映確認）
- (h) lint（直接setState禁止）・既存テストすべて緑

#### PR-T2: テーブル仕上げ — 実装: **Sonnet**
多重ソート（Shift+クリック・最大3キー・ヘッダにソート順位バッジ）／複数行選択と一括操作／WBS行の日付集計（min ES〜max EF）／SavedViewへの`tableSort`・表示列保存（optionalフィールド）／wbsCodeセル編集の再検討／テーブルからの後続作成（`createSuccessor`流用）／タブショートカット割当

#### PR-G（=Phase 3）: ガント — スパイク判断: **Opus** / 実装: **Sonnet**（既存計画どおり）
§12.4の契約に乗せる。§9.3のスコープ・受入基準は不変（4,000行スクロール滑らか・CPM結果とバー位置一致・ビュー間でフィルタ/折り畳み/選択同期——同期は§12.2により自動達成見込み）。
> **✅ 実装済み（2026-07-22）**: スパイク判断＝**自前の絶対配置div**（SVGより軽量で十分）。`components/gantt/GanttView.tsx`。左ペイン=タスク名列（WBSツリー・折り畳み連動）／右ペイン=時間軸（月目盛り＋基準日ライン）。行=`selectTableRows`（テーブルと同一）、バー=`selectCpm().byTask`の es/ef（暦日オフセット×日幅）、WBSサマリバー=`TableRow.esMin/efMax`、工種色分け＋進捗オーバレイ＋マイルストーン菱形＋CP赤。縦スクロールを左右同期・横は右のみ。行仮想化=`@tanstack/react-virtual`共用。View Shell第3タブ有効化＋`Y`ショートカット。e2e（軸/バー描画・CPのみで全バーcritical）付き。

## まず着手すべきこと
Phase 0（`epc-task-graph/mock/index.html`）。**4,000ノードデモ生成→折り畳み→フィルタISOLATE→近傍フォーカス→編集、の一連が滑らかに動くこと**がPhase 0最大の検証ポイント（表示パイプラインという性能戦略そのものの実証。ここが通れば描画エンジンの作り直しは発生しない）。データスキーマ（§5.2、rev/updatedBy含む）とderiveVisibleGraphの純関数分離だけ厳密に守れば、残りは後から差し替え可能な構造にしてある。

**（v1.3追記・現況）** Phase 0モックとPhase 1の中核（表示パイプライン・CPM Step1・Dexie差分永続化・複数プロジェクト・保存ビュー）は`epc-task-graph/app/`で稼働済み。**次の着手はPR-T1（§12.6）＝多ビュー器＋テーブルビューMVP**。ガントはその後にPhase 3（PR-G）として§12.4の接続契約に乗せる。

**（2026-07-22 現況更新）** 多ビュー3タブが全て稼働（グラフ／テーブル／ガント）。
- **PR-T1**（多ビュー器＋テーブルMVP）✅、**PR-T2**（テーブル仕上げ）✅ ＝ 多重ソート・複数行選択＋一括操作（削除/ステータス/工種/担当）・WBS日付集計・wbsCodeセル編集・テーブルからのTab後続作成・ビュー切替ショートカット（`G`/`T`/`Y`）。**残るは④SavedViewへの列/ソート保存のみ**（保存ビューUI自体が未実装のため保留＝Phase1側の作業が前提）。
- **PR-G（=Phase 3 ガント）** ✅ 上記のとおり実装。
- **俯瞰デザイン刷新** ✅ 集約ノードを常時判読可能なカード化＋WBSグリッド整列（横長LRチェーンでfitViewが縮小し灰色化する問題を解消）。
- テスト: domain単体54緑／e2e（smoke3・table4・gantt1）。永続化リロード系のe2eは負荷依存の揺れがありPlaywright retries=1で吸収。
- **関係タスクのハイライト＋世代フィルタ（ユーザー要望2026-07-22）** ✅ 近傍フォーカスを刷新（`H`＝既定「関係ハイライト」＝全体を残し近傍をリング＋世代バッジで強調・非近傍は淡色/集約で文脈維持）。`neighborhood`が世代マップ（起点0・上流負・下流正）を返し、`FocusSpec.mode`（highlight/isolate）と上流/下流の世代数を個別調整するUI（フォーカスバー）を追加。domain単体+3・e2e+1。
- **GUIでの依存接続/切断（ユーザー要望③）** ✅ 右パネルに「＋先行/＋後続を追加」の検索コンボ（DepAdder）を新設＝名前/WBSで検索→クリックで接続（`addDependencyChecked`経由で循環は自動拒否）。削除は既存の×（`deleteDeps`）。グラフのハンドル・ドラッグ接続と併存する第二経路（§2.9）。e2e+2（追加/削除・循環拒否）。
- **Phase 2 CPM（依存タイプ＋lag）** ✅ `cpm.ts` を FS のみ → **FS/SS/FF/SF ＋ lag（負でリード）** に拡張（前進/後退計算・駆動エッジ判定を型対応。手計算フィクスチャ4件で検証）。右パネルの各依存にタイプ select ＋ lag 入力（`updateDep`）を追加＝編集が table/gantt/CP に即反映。
- **Phase 2 CPM（日付制約）** ✅ SNET（開始猶予下限＝前進でESを丸め）/ FNLT（終了期限上限＝後退でLFを丸め・期限割れはTF負でクリティカル化＝遅延警告）/ ASAP（既定）に対応。右パネルに制約タイプselect＋日付入力。手計算フィクスチャ+3で検証。
- **Phase 2 CPM（稼働カレンダー）** ✅ 稼働曜日（土日も稼働に設定可）＋祝日に対応。所要は稼働日で数え、非稼働日は跨いで暦日で伸びる（es/ef は暦日オフセットのままでガント線形軸を保持）。全曜日稼働＋祝日なしは線形fast-path＝従来挙動を厳密維持。前進=nextWorking/addWorkingDays、後退=subWorkingDays、SS/SF/FF は稼働日変換。左パネルに稼働曜日トグル＋祝日入力（`updateCalendar`）。手計算+3（週末跨ぎ/祝日/全曜日）・e2e+1（土日を稼働にするとEF+8d→+6d）。**→ Phase 2 完了**。
- **保存ビュー機能（§2.8/§12.3.8）＝ PR-T2④ 完了** ✅ 現在のフィルタ/表示モード/折り畳み＋テーブルのソート/表示列を名前付きで保存・適用・削除（左パネル）。SavedView に `tableSort?`/`tableColumns?` を optional 追加（schema も optional・前方互換・schemaVersion据え置き）。savedViews はパッチ永続。これで **PR-T2 は全項目完了**。
- **ガントのバー端ドラッグ duration 編集** ✅ バー右端ハンドルをドラッグ→所要日数を変更（§9.3「閲覧＋duration変更まで」完了）。プレビューは暦日近似で伸縮し、確定で updateTask→CPM が稼働カレンダー込みで再計算し正しいスパンへスナップ。e2e+1。
- **次候補**: 検索(Cmd+K)・俯瞰専用Canvas 等 Phase1 PR5-8 残／ Phase 4 Azure（サブスク用意後）／ 実データ投入とWBS体系の実地検証。

## ユーザーへの確認事項（2026-07-10 回答反映・確定）
- **WBSコード体系の実態**: ✅ **維持されている見込み**（`1.2.3`形式の階層コード前提でOK）。折り畳み/分担の単位はWBSコードで進める。※実データ投入時に崩れが見つかったら§11-2のフォールバック（工種×エリア）を発動。
- ノード規模の上限見込み: ✅ **1万まででOK**（本設計の想定どおり。5万級の再設計前倒しは不要）。
- 同時編集: ✅ **L2（楽観ロック＋ポーリング通知）まででOK**。L3は§7.2の発動条件が出たら。
- 「自分のタスク」の判定源: ✅ **assignee＝部署名（班/セクション単位）**。個人名ではない。→ §7.5の「私は誰」設定と「自分のタスク」フィルタは**部署名マッチ**で実装する（`seed`のダミー担当も部署名10種として生成）。
- Azureサブスクリプション/テナント: ⏳ **現時点未用意**（適宜用意）。→ **Phase 4は着手保留**。Phase 0〜3（モック→MVP→CPM→ガント）はローカル完結で先行して問題なし。用意でき次第Phase 4着手。
- ガントの編集深度: ✅ **閲覧＋duration変更まででOK**（バーD&Dで日付制約を作る挙動は非採用のままでよい）。
- MS Project実機アクセス: ✅ **可**（サンプルXML取得可能）。
- 多言語対応: ✅ **日本語UIのみでOK**（i18n不要）。
