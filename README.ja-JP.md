# AIMangaStudio

[![中文](https://img.shields.io/badge/-中文-0078D7?style=flat-square)](./README.md) [![English](https://img.shields.io/badge/-English-4CAF50?style=flat-square)](./README.en-US.md) [![日本語](https://img.shields.io/badge/-日本語-F44336?style=flat-square)](./README.ja-JP.md)

![og image](./og.webp)

AIを活用してマンガを制作するためのツールで、脚本生成、絵コンテレイアウト、キャラクタースタイル管理をサポートします。

## プロジェクト概要
AIMangaStudio は、創作者やスタジオ向けに、ストーリー生成、コマ割り、キャラクターデザイン、ページ連続性の解析を統合したエンドツーエンドの制作パイプラインを提供し、脚本から完成ページまでのワークフローを簡素化します。

## 主な機能
- 自然言語によるマンガ脚本生成（ストーリー、セリフ、ナレーション）
- AIによる絵コンテ自動配置（吹き出し、カメラワーク）
- キャラクターとスタイル設定（複数の描画スタイルに対応）
- 複数ページのエクスポート（PNG、PDF）
- 制作履歴とバージョン管理

## クイックスタート
### 要件
- Node.js（推奨 18+）
- npm または yarn

### 1. リポジトリをクローン
```bash
git clone https://github.com/morsoli/aimangastudio.git
cd aimangastudio
```

### 2. 依存関係をインストール
```bash
npm install
# または
# yarn
```

### 3. 環境変数を設定
プロジェクトルートにある `.env.example` を `.env` にコピーし、API キーを入力してください：

```bash
cp .env.example .env
```

`.env` ファイルを編集し、少なくとも以下のキーを設定してください：

```env
# テキスト生成（デフォルト: DeepSeek-V4-Flash）
TEXT_PROVIDER=deepseek
TEXT_MODEL=deepseek-v4-flash
TEXT_API_KEY=your_deepseek_api_key

# 画像生成（デフォルト: Minimax image-01-live）
IMAGE_PROVIDER=minimax
IMAGE_MODEL=image-01-live
IMAGE_API_KEY=your_minimax_tokenplan_api_key

# 動画生成には引き続き Gemini API Key が必要
GEMINI_API_KEY=your_gemini_api_key
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

## 技術スタック
- フロントエンド: React + Vite + TypeScript
- バックエンド: Node.js + Express + TypeScript
- AI: Google GenAI、DeepSeek、StepFun、Minimax、OpenAI Compatible

## モデル設定

このプロジェクトでは、UI または環境変数を通じてテキスト生成と画像生成のモデルをカスタマイズできます。

### 対応プロバイダー

| タイプ | プロバイダー | デフォルトモデル |
|--------|-------------|-----------------|
| テキスト生成 | DeepSeek | `deepseek-v4-flash` |
| テキスト生成 | Google Gemini | Gemini シリーズ |
| テキスト生成 | OpenAI Compatible | OpenAI API 互換の任意のモデル |
| 画像生成 | Minimax (Tokenplan) | `image-01-live` |
| 画像生成 | StepFun | `step-image-edit-2` |
| 画像生成 | Google Gemini | Gemini シリーズ |
| 画像生成 | OpenAI Compatible | OpenAI API 互換の任意のモデル |

### UI から設定

1. プロジェクトを起動後、上部ツールバーの「モデル設定」ボタンをクリックします。
2. 「テキストモデル」タブで DeepSeek を選択し、API キーを入力してください。デフォルトのモデル名は `deepseek-v4-flash` です。
3. 「画像モデル」タブで Minimax または StepFun に切り替えます：
   - Minimax: モデル名 `image-01-live`、Minimax Tokenplan API Key を使用。
   - StepFun: モデル名 `step-image-edit-2`、StepFun API Key を使用。
4. Base URL、リクエストタイムアウト（ミリ秒）、追加パラメータ（JSON）をカスタマイズできます。
5. 「保存」をクリックすると即座に反映され、設定はブラウザのローカルストレージに保存されます。

### 環境変数から設定

UI 以外に、`.env` ファイルを直接編集することもできます：

```env
# テキスト生成
TEXT_PROVIDER=deepseek
TEXT_MODEL=deepseek-v4-flash
TEXT_API_KEY=your_api_key
TEXT_BASE_URL=https://api.deepseek.com
TEXT_TIMEOUT=60000
TEXT_EXTRA_PARAMS={"temperature":0.7}

# 画像生成 - Minimax
IMAGE_PROVIDER=minimax
IMAGE_MODEL=image-01-live
IMAGE_API_KEY=your_minimax_tokenplan_api_key
IMAGE_BASE_URL=https://api.minimaxi.chat/v1
IMAGE_TIMEOUT=120000

# 画像生成 - StepFun（オプション）
# IMAGE_PROVIDER=step
# IMAGE_MODEL=step-image-edit-2
# IMAGE_API_KEY=your_step_api_key
# IMAGE_BASE_URL=https://api.stepfun.com/v1
```

### 注意事項
- API キーはブラウザのローカルストレージにのみ保存され、サーバーにはアップロードされません。
- 動画生成機能は現在も Google Gemini API Key に依存しているため、`GEMINI_API_KEY` が設定されていることを確認してください。
- プロバイダーを切り替えると、モデル名と Base URL が対応するデフォルト値に自動更新されます。手動で上書きも可能です。

## 対象ユーザー
- 個人クリエイター
- マンガ愛好家
- コンテンツ制作スタジオ
- ソーシャルメディアクリエイター

## コントリビュート
Issue や PR を歓迎します。コードスタイルと貢献ガイドに従ってください。

## ライセンス
MIT
