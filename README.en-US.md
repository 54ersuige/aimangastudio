# AIMangaStudio

[![中文](https://img.shields.io/badge/-中文-0078D7?style=flat-square)](./README.md) [![English](https://img.shields.io/badge/-English-4CAF50?style=flat-square)](./README.en-US.md) [![日本語](https://img.shields.io/badge/-日本語-F44336?style=flat-square)](./README.ja-JP.md)

![og image](./og.webp)

A tool that uses AI to create manga, supporting script generation, storyboard layout, and character style control.

## Project Overview
AIMangaStudio provides an end-to-end pipeline for manga creators and studios, integrating story generation, panel layout, character design, and page continuity analysis to streamline the process from script to finished pages.

## Key Features
- Natural language manga script generation (story, dialogue, narration)
- AI-driven storyboard layout (speech bubbles, camera cuts)
- Character and style configuration (multiple art styles supported)
- Multi-page export (PNG, PDF)
- Creation history and versioning

## Quick Start
### Requirements
- Node.js (recommended 18+)
- npm or yarn

### 1. Clone the repository
```bash
git clone https://github.com/morsoli/aimangastudio.git
cd aimangastudio
```

### 2. Install dependencies
```bash
npm install
# or
# yarn
```

### 3. Configure environment variables
Copy `.env.example` to `.env` in the project root and fill in your API keys:

```bash
cp .env.example .env
```

Edit `.env` with at least the following keys:

```env
# Text generation (default: DeepSeek-V4-Flash)
TEXT_PROVIDER=deepseek
TEXT_MODEL=deepseek-v4-flash
TEXT_API_KEY=your_deepseek_api_key

# Image generation (default: Minimax image-01-live)
IMAGE_PROVIDER=minimax
IMAGE_MODEL=image-01-live
IMAGE_API_KEY=your_minimax_tokenplan_api_key

# Video generation still requires a Gemini API Key
GEMINI_API_KEY=your_gemini_api_key
```

### 4. Start the development server
```bash
npm run dev
```

- Frontend: http://localhost:5173/ (will fall back to 5174 if occupied)
- Backend: http://localhost:3001

### 5. Build & Preview
```bash
npm run build
npm run preview
```

## Tech Stack
- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- AI: Google GenAI, DeepSeek, StepFun, Minimax, OpenAI Compatible

## Model Configuration

This project supports customizing text and image generation models via the UI or environment variables.

### Supported providers

| Type | Provider | Default model |
|------|----------|---------------|
| Text | DeepSeek | `deepseek-v4-flash` |
| Text | Google Gemini | Gemini series |
| Text | OpenAI Compatible | Any OpenAI API-compatible model |
| Image | Minimax (Tokenplan) | `image-01-live` |
| Image | StepFun | `step-image-edit-2` |
| Image | Google Gemini | Gemini series |
| Image | OpenAI Compatible | Any OpenAI API-compatible model |

### Configure via UI

1. After starting the project, click the "Model Configuration" button in the top toolbar.
2. In the "Text Model" tab, select DeepSeek and enter your API key. The default model name is `deepseek-v4-flash`.
3. In the "Image Model" tab, switch to Minimax or StepFun:
   - Minimax: model name `image-01-live`, using your Minimax Tokenplan API Key.
   - StepFun: model name `step-image-edit-2`, using your StepFun API Key.
4. You can customize the Base URL, request timeout (ms), and extra parameters (JSON).
5. Click "Save" to apply. The configuration is stored in browser local storage.

### Configure via environment variables

Besides the UI, you can also modify `.env` directly:

```env
# Text generation
TEXT_PROVIDER=deepseek
TEXT_MODEL=deepseek-v4-flash
TEXT_API_KEY=your_api_key
TEXT_BASE_URL=https://api.deepseek.com
TEXT_TIMEOUT=60000
TEXT_EXTRA_PARAMS={"temperature":0.7}

# Image generation - Minimax
IMAGE_PROVIDER=minimax
IMAGE_MODEL=image-01-live
IMAGE_API_KEY=your_minimax_tokenplan_api_key
IMAGE_BASE_URL=https://api.minimaxi.chat/v1
IMAGE_TIMEOUT=120000

# Image generation - StepFun (optional)
# IMAGE_PROVIDER=step
# IMAGE_MODEL=step-image-edit-2
# IMAGE_API_KEY=your_step_api_key
# IMAGE_BASE_URL=https://api.stepfun.com/v1
```

### Notes
- API keys are only saved in browser local storage and are not uploaded to the server.
- Video generation currently still relies on the Google Gemini API Key; make sure `GEMINI_API_KEY` is configured.
- When switching providers, the model name and Base URL will auto-update to the corresponding defaults and can be manually overridden.

## Target Users
- Independent creators
- Manga enthusiasts
- Content studios
- Social media creators

## Contributing
Contributions welcome — please open issues or PRs and follow code style and contribution guidelines.


## License
MIT
