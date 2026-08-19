# AIMangaStudio

[![中文](https://img.shields.io/badge/-中文-0078D7?style=flat-square)](./README.md) [![English](https://img.shields.io/badge/-English-4CAF50?style=flat-square)](./README.en-US.md) [![日本語](https://img.shields.io/badge/-日本語-F44336?style=flat-square)](./README.ja-JP.md)

![og image](./og.webp)

**A serial-comic creation tool powered by AI.** Go from a one-line idea to a complete serialized comic — worldview → characters → chapters → page-by-page paneling and illustration — through a conversational AI agent. Just tell the AI what to change in plain language.

## Who is it for

- People who want to create serialized comics but don't know paneling or composition
- People who need characters and scenes to stay consistent across dozens of pages
- People who want to revise AI drafts using their own words

## How it works

The app consists of two panels:

- **Left — Series Workbench**: a vertical card flow of series / chapters / pages, showing generation progress and finished pages in real time
- **Right — Creation Assistant**: an AI agent chat panel that submits proposal cards stage by stage for your approval, and accepts natural-language revision requests

The agent guides you through 5 stages:

1. **Logline** — enter a title and a one-line pitch
2. **Worldview** — AI generates era / art style / color mood / background settings
3. **Characters** — AI creates 3-4 core characters, each with a generated reference image
4. **Chapters** — AI splits the target page count into chapters
5. **Pages** — AI breaks each page into panels and generates images, with per-panel retouching, whole-page rewriting, and one-click next-page continuation

### Cross-page consistency

- **Character reference images**: each character gets a "passport" image that is attached every time the character appears
- **Scene continuity**: the previous page's image is passed as a reference so outfits / scenery / color mood carry over
- **Story continuity**: descriptions of all finished pages are fed to the text model as context

## Quick Start

### Requirements

- Node.js (recommended 18+)
- npm

### 1. Clone the repository

```bash
git clone https://github.com/morsoli/aimangastudio.git
cd aimangastudio
```

### 2. Install dependencies

```bash
npm install
```

(`postinstall` automatically installs the backend dependencies under `server/`)

### 3. Configure environment variables

Copy `.env.example` to `.env` in the project root and fill in your API key:

```bash
cp .env.example .env
```

```env
# Text generation (default: Agnes)
TEXT_PROVIDER=agnes
TEXT_MODEL=agnes-2.5-flash
TEXT_API_KEY=your_agnes_api_key
TEXT_BASE_URL=https://apihub.agnes-ai.cn/v1

# Image generation (default: Agnes)
IMAGE_PROVIDER=agnes
IMAGE_MODEL=agnes-image-2.1-flash
IMAGE_API_KEY=your_agnes_api_key
IMAGE_BASE_URL=https://apihub.agnes-ai.cn/v1
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

## Model Configuration

Configuration priority (high → low):

1. `server/runtime-config.json` saved via the UI "Model Configuration" (local runtime file, not committed)
2. `.env` file
3. Built-in defaults (Agnes)

### Supported providers

| Type | Provider | Default model |
|------|----------|---------------|
| Text | **Agnes (default)** | `agnes-2.5-flash` |
| Text | Google Gemini | Gemini series |
| Text | DeepSeek | `deepseek-v4-flash` |
| Text | OpenAI Compatible | Any OpenAI API-compatible model |
| Image | **Agnes (default)** | `agnes-image-2.1-flash` |
| Image | Google Gemini | Gemini series |
| Image | StepFun | `step-image-edit-2` |
| Image | Minimax | `image-01-live` |
| Image | OpenAI Compatible | Any OpenAI API-compatible model |

### Configure via UI

1. After starting the project, click the "Model Configuration" button in the top bar.
2. In the "Text Model" / "Image Model" tabs, pick a provider and enter your API key.
3. You can customize the model name, Base URL, request timeout (ms), and extra parameters (JSON).
4. Click "Save" to apply. The configuration is written to `server/runtime-config.json`.

### Notes

- API keys are stored locally only (browser storage + a server-side local config file) and are never uploaded to any external service.
- Both `.env` and `server/runtime-config.json` are listed in `.gitignore` and stay out of version control.
- When switching providers, the model name and Base URL auto-update to the corresponding defaults and can be manually overridden.

## Project Structure

```
AI_comic/
├── docs/                    # Design docs and visual DNA references
│   ├── references/          # Target art-style reference images (3)
│   └── style-dna.md         # Visual DNA spec (human-readable)
├── public/                  # Static assets
├── server/                  # Backend (Express + TypeScript)
│   ├── providers/           # Provider adapters (agnes / gemini / deepseek / step / minimax / openai-compatible)
│   ├── config.ts            # Model config loading (runtime-config.json → .env → defaults)
│   ├── dna-inject.ts        # Visual DNA injection into image prompts
│   ├── graphic-novel-dna.ts # Art-style system constraints (v1.0-locked)
│   ├── routes.ts            # /api/text, /api/image
│   ├── series-routes.ts     # Series CRUD
│   └── series-store.ts      # Series persistence (series-data.json)
├── src/                     # Frontend (React + Vite + TypeScript)
│   ├── components/          # AgentWorkbench / AgentChatPanel / SeriesWorkbench / ModelConfigModal, etc.
│   ├── contexts/            # SeriesContext / LocalizationContext
│   ├── hooks/               # useModelConfig / useLocalization / useKeyboard
│   ├── locales/             # Chinese / English / Japanese
│   └── services/            # agentEngine (agent state machine) / modelClient / seriesClient
├── tools/                   # One-off helper scripts (regen-dna-reference.cjs)
├── .env.example             # Environment variable template
├── start.bat / start.ps1    # Windows one-click launcher
├── start.sh                 # Linux / macOS one-click launcher
└── stop.bat                 # Windows one-click stop
```

## Data Storage

All series data is stored in `server/series-data.json` (contains base64 images, listed in `.gitignore`) and survives service restarts. Delete the file manually to wipe all series.

## One-click Launch (Windows)

`start.bat` in the repository root is an all-in-one launcher — **just double-click it**:

- Checks Node.js 18+
- Runs `npm install` automatically on first launch (frontend + backend)
- Starts the backend (3001) and frontend (5173) in the background
- Opens the browser at http://localhost:5173 automatically

Want a desktop icon? Run `start.bat --shortcut` to create `AIMangaStudio.lnk` on your desktop.

Linux / macOS: use `bash start.sh` (equivalent shell version).

## Contributing

Contributions welcome — please open issues or PRs and follow code style and contribution guidelines.

## License

MIT
