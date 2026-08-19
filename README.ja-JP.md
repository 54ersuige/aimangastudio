# AIMangaStudio

[![中文](https://img.shields.io/badge/-中文-0078D7?style=flat-square)](./README.md) [![English](https://img.shields.io/badge/-English-4CAF50?style=flat-square)](./README.en-US.md) [![日本語](https://img.shields.io/badge/-日本語-F44336?style=flat-square)](./README.ja-JP.md)

![og image](./og.webp)

**連載マンガに特化した AI 創作ツール。** 一行のアイデアから完全な連載マンガまで — 世界観 → キャラクター → 章立て → ページごとのコマ割りと作画 — を対話型 AI エージェントがサポートします。修正点は自然言語で伝えるだけ。

## こんな人向け

- 連載マンガを描きたいけど、コマ割りや構図がわからない人
- キャラクターとシーンを数十ページにわたって一貫させたい人
- AI の初稿を自分の言葉で直したい人

## 仕組み

アプリは 2 つのパネルで構成されます：

- **左側「連載ワークベンチ」**：シリーズ / 章 / ページの縦型カードフロー。生成進捗と完成ページをリアルタイムで確認
- **右側「創作アシスタント」**：AI エージェントのチャットパネル。段階ごとに提案カードを出して承認を求め、自然言語での修正指示も受け付けます

エージェントが案内する 5 つのステージ：

1. **ログライン** — タイトルと一行ピッチを入力
2. **世界観** — AI が時代 / 作風 / 色調 / 背景設定を生成
3. **キャラクター** — AI が主要キャラ 3〜4 人を作成し、各自の「参考画像」を生成
4. **章立て** — AI が目標ページ数を複数の章に自動分割
5. **ページ制作** — AI が各ページをコマに割り、画像を順に生成。「このコマだけ直す」「一言でこのページを書き直す」「ワンクリックで次のページを続き書き」に対応

### ページ間の一貫性

- **キャラ参考画像**：各キャラの「身分証明書」的な画像を、登場のたびに参照として付与
- **シーンの連続性**：前ページの画像を参照として渡し、衣装 / 場面 / 色調を維持
- **ストーリーの連続性**：完成済み全ページの説明をテキストモデルに文脈として渡し、続きを自動的に接続

## クイックスタート

### 要件

- Node.js（推奨 18+）
- npm

### 1. リポジトリをクローン

```bash
git clone https://github.com/morsoli/aimangastudio.git
cd aimangastudio
```

### 2. 依存関係をインストール

```bash
npm install
```

（`postinstall` により `server/` 配下のバックエンド依存も自動インストールされます）

### 3. 環境変数を設定

プロジェクトルートにある `.env.example` を `.env` にコピーし、API キーを入力してください：

```bash
cp .env.example .env
```

```env
# テキスト生成（デフォルト: Agnes）
TEXT_PROVIDER=agnes
TEXT_MODEL=agnes-2.5-flash
TEXT_API_KEY=your_agnes_api_key
TEXT_BASE_URL=https://apihub.agnes-ai.cn/v1

# 画像生成（デフォルト: Agnes）
IMAGE_PROVIDER=agnes
IMAGE_MODEL=agnes-image-2.1-flash
IMAGE_API_KEY=your_agnes_api_key
IMAGE_BASE_URL=https://apihub.agnes-ai.cn/v1
```

### 4. 開発サーバーを起動

```bash
npm run dev
```

- フロントエンド: http://localhost:5173/（ポートが使用中の場合は 5174 に切り替わります）
- バックエンド: http://localhost:3001

### 5. ビルドとプレビュー

```bash
npm run build
npm run preview
```

## モデル設定

設定の優先順位（高 → 低）：

1. UI の「モデル設定」から保存した `server/runtime-config.json`（ローカルのランタイムファイル、コミット対象外）
2. `.env` ファイル
3. コード組み込みのデフォルト値（Agnes）

### 対応プロバイダー

| タイプ | プロバイダー | デフォルトモデル |
|--------|-------------|-----------------|
| テキスト生成 | **Agnes（デフォルト）** | `agnes-2.5-flash` |
| テキスト生成 | Google Gemini | Gemini シリーズ |
| テキスト生成 | DeepSeek | `deepseek-v4-flash` |
| テキスト生成 | OpenAI Compatible | OpenAI API 互換の任意のモデル |
| 画像生成 | **Agnes（デフォルト）** | `agnes-image-2.1-flash` |
| 画像生成 | Google Gemini | Gemini シリーズ |
| 画像生成 | StepFun | `step-image-edit-2` |
| 画像生成 | Minimax | `image-01-live` |
| 画像生成 | OpenAI Compatible | OpenAI API 互換の任意のモデル |

### UI から設定

1. プロジェクト起動後、上部の「モデル設定」ボタンをクリックします。
2. 「テキストモデル」/「画像モデル」タブでプロバイダーを選択し、API キーを入力します。
3. モデル名、Base URL、リクエストタイムアウト（ミリ秒）、追加パラメータ（JSON）をカスタマイズできます。
4. 「保存」をクリックすると即座に反映され、設定は `server/runtime-config.json` に書き込まれます。

### 注意事項

- API キーはローカルのみ（ブラウザストレージ + サーバーのローカル設定ファイル）に保存され、外部サービスには送信されません。
- `.env` と `server/runtime-config.json` はどちらも `.gitignore` に記載されており、バージョン管理に入りません。
- プロバイダーを切り替えると、モデル名と Base URL が対応するデフォルト値に自動更新されます。手動で上書きも可能です。

## プロジェクト構成

```
AI_comic/
├── docs/                    # 設計ドキュメントとビジュアル DNA 参考画像
│   ├── references/          # 目標の作風リファレンス画像（3 枚）
│   └── style-dna.md         # ビジュアル DNA 仕様書（人間が読む用）
├── public/                  # 静的アセット
├── server/                  # バックエンド（Express + TypeScript）
│   ├── providers/           # プロバイダーアダプター（agnes / gemini / deepseek / step / minimax / openai-compatible）
│   ├── config.ts            # モデル設定の読み込み（runtime-config.json → .env → デフォルト）
│   ├── dna-inject.ts        # 画像生成プロンプトへのビジュアル DNA 注入
│   ├── graphic-novel-dna.ts # 作風システムの制約（v1.0-locked）
│   ├── routes.ts            # /api/text、/api/image
│   ├── series-routes.ts     # シリーズ CRUD
│   └── series-store.ts      # シリーズ永続化（series-data.json）
├── src/                     # フロントエンド（React + Vite + TypeScript）
│   ├── components/          # AgentWorkbench / AgentChatPanel / SeriesWorkbench / ModelConfigModal など
│   ├── contexts/            # SeriesContext / LocalizationContext
│   ├── hooks/               # useModelConfig / useLocalization / useKeyboard
│   ├── locales/             # 中国語 / 英語 / 日本語
│   └── services/            # agentEngine（エージェント状態マシン）/ modelClient / seriesClient
├── tools/                   # 単発の補助スクリプト（regen-dna-reference.cjs）
├── .env.example             # 環境変数テンプレート
├── start.bat / start.ps1    # Windows ワンクリック起動
├── start.sh                 # Linux / macOS ワンクリック起動
└── stop.bat                 # Windows ワンクリック停止
```

## データ保存

すべてのシリーズデータは `server/series-data.json`（base64 画像を含む、`.gitignore` 対象）に保存され、サービス再起動後も保持されます。全シリーズを消去するにはこのファイルを手動で削除してください。

## ワンクリック起動（Windows）

リポジトリルートの `start.bat` がオールインワンのランチャーです。**ダブルクリックするだけ**：

- Node.js 18+ をチェック
- 初回起動時に `npm install` を自動実行（フロント + バック）
- バックエンド（3001）とフロントエンド（5173）をバックグラウンドで起動
- ブラウザで http://localhost:5173 を自動で開く

デスクトップアイコンが欲しい場合は `start.bat --shortcut` を実行すると `AIMangaStudio.lnk` が作成されます。

Linux / macOS：`bash start.sh`（同等のシェル版）をご利用ください。

## コントリビュート

Issue や PR を歓迎します。コードスタイルと貢献ガイドに従ってください。

## ライセンス

MIT
