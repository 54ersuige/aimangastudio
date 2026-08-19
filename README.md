# AIMangaStudio

[![中文](https://img.shields.io/badge/-中文-0078D7?style=flat-square)](./README.md) [![English](https://img.shields.io/badge/-English-4CAF50?style=flat-square)](./README.en-US.md) [![日本語](https://img.shields.io/badge/-日本語-F44336?style=flat-square)](./README.ja-JP.md)

![og image](./og.webp)

**专注连载漫画的 AI 创作工具。** 通过对话式 AI 助手完成从一句话灵感到整部连载漫画的全流程：世界观 → 角色 → 章节 → 逐页分镜出图；你只需要用自然语言告诉 AI 哪里要改。

## 这是为谁准备的

- 想画连载漫画、但不懂分镜构图的人
- 需要角色和场景在几十页里保持一致的人
- 希望 AI 出初稿后能用自己的话改稿的人

## 工作方式

应用由两个面板组成：

- **左侧「连载工作台」**：系列 / 章节 / 页面的纵向卡片流，实时查看生成进度与成品
- **右侧「创作助手」**：AI Agent 对话面板，逐阶段提交方案卡片供你确认，或用自然语言提出修改意见

Agent 引导的 5 个阶段：

1. **一句话简介** — 填写漫画标题 + logline
2. **世界观** — AI 生成时代 / 画风 / 色调 / 背景设定
3. **角色** — AI 创建 3-4 个核心角色，每个角色生成一张「角色参考图」
4. **章节拆分** — AI 按目标页数自动拆分成多章
5. **逐页出图** — AI 拆解分镜并逐张生成图片，支持「改这一格」「用一句话改这一页」「一键续写下一页」

### 跨页一致性机制

- **角色参考图**：每个角色生成一张"身份证"图，每页画到该角色都会带上这张图
- **场景连续性**：生成下一张图时传入前一页的图作为参考，保证服饰 / 场景 / 色调延续
- **剧情连续性**：所有已完成页的描述作为上下文传给文字模型，续写时自动衔接

## 快速开始

### 环境要求

- Node.js（建议 18+）
- npm

### 1. 克隆仓库

```bash
git clone https://github.com/morsoli/aimangastudio.git
cd aimangastudio
```

### 2. 安装依赖

```bash
npm install
```

（`postinstall` 会自动安装 `server/` 下的后端依赖）

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并填入你的 API 密钥：

```bash
cp .env.example .env
```

```env
# 文字生成（默认 Agnes）
TEXT_PROVIDER=agnes
TEXT_MODEL=agnes-2.5-flash
TEXT_API_KEY=your_agnes_api_key
TEXT_BASE_URL=https://apihub.agnes-ai.cn/v1

# 图片生成（默认 Agnes）
IMAGE_PROVIDER=agnes
IMAGE_MODEL=agnes-image-2.1-flash
IMAGE_API_KEY=your_agnes_api_key
IMAGE_BASE_URL=https://apihub.agnes-ai.cn/v1
```

### 4. 启动开发服务器

```bash
npm run dev
```

- 前端地址：http://localhost:5173/（若端口被占用会自动切换到 5174）
- 后端地址：http://localhost:3001

### 5. 构建与预览

```bash
npm run build
npm run preview
```

## 模型配置

配置优先级（高 → 低）：

1. 界面「模型配置」保存的 `server/runtime-config.json`（本地运行时文件，不入库）
2. `.env` 文件
3. 代码内置默认值（Agnes）

### 支持的模型提供商

| 类型 | 提供商 | 默认模型 |
|------|--------|----------|
| 文字生成 | **Agnes（默认）** | `agnes-2.5-flash` |
| 文字生成 | Google Gemini | Gemini 系列 |
| 文字生成 | DeepSeek | `deepseek-v4-flash` |
| 文字生成 | OpenAI Compatible | 任意兼容 OpenAI API 的模型 |
| 图片生成 | **Agnes（默认）** | `agnes-image-2.1-flash` |
| 图片生成 | Google Gemini | Gemini 系列 |
| 图片生成 | 阶跃星辰 Step | `step-image-edit-2` |
| 图片生成 | Minimax | `image-01-live` |
| 图片生成 | OpenAI Compatible | 任意兼容 OpenAI API 的模型 |

### 通过界面配置

1. 启动项目后，点击顶部的「模型配置」按钮。
2. 在「文字模型」/「图片模型」标签页选择提供商并填入 API 密钥。
3. 可自定义模型名称、Base URL、请求超时时间（毫秒）以及额外参数（JSON 格式）。
4. 点击「保存」即可生效，配置会写入 `server/runtime-config.json`。

### 注意事项

- API 密钥仅保存在本地（浏览器存储 + 服务器本地配置文件），不会上传到任何外部服务。
- `.env` 与 `server/runtime-config.json` 均已列入 `.gitignore`，不会进入版本库。
- 切换模型提供商后，模型名称和 Base URL 会自动更新为对应默认值，也可手动覆盖。

## 项目结构

```
AI_comic/
├── docs/                    # 设计文档与视觉 DNA 参考图
│   ├── references/          # 目标画风参考图（3 张）
│   └── style-dna.md         # 视觉 DNA 规范（人类可读版）
├── public/                  # 静态资源
├── server/                  # 后端（Express + TypeScript）
│   ├── providers/           # 各模型提供商适配（agnes / gemini / deepseek / step / minimax / openai-compatible）
│   ├── config.ts            # 模型配置加载（runtime-config.json → .env → 默认值）
│   ├── dna-inject.ts        # 视觉 DNA 注入图片生成 prompt
│   ├── graphic-novel-dna.ts # 画风系统约束（v1.0-locked）
│   ├── routes.ts            # /api/text、/api/image
│   ├── series-routes.ts     # 系列数据 CRUD
│   └── series-store.ts      # 系列数据持久化（series-data.json）
├── src/                     # 前端（React + Vite + TypeScript）
│   ├── components/          # AgentWorkbench / AgentChatPanel / SeriesWorkbench / ModelConfigModal 等
│   ├── contexts/            # SeriesContext（系列状态）/ LocalizationContext
│   ├── hooks/               # useModelConfig / useLocalization / useKeyboard
│   ├── locales/             # 中 / 英 / 日 多语言
│   └── services/            # agentEngine（Agent 状态机）/ modelClient / seriesClient
├── tools/                   # 一次性辅助脚本（regen-dna-reference.cjs）
├── .env.example             # 环境变量模板
├── start.bat / start.ps1    # Windows 一键启动
├── start.sh                 # Linux / macOS 一键启动
└── stop.bat                 # Windows 一键停止
```

## 数据存储

所有系列数据存储在 `server/series-data.json`（含 base64 图片，已列入 `.gitignore`），重启服务后保留。手动删除该文件可清空所有系列。

## 一键启动（Windows）

仓库根目录的 `start.bat` 是一站式启动脚本，**双击即可**：

- 自动检查 Node.js 18+
- 首次运行自动 `npm install`（前端 + 后端）
- 后端（3001）与前端（5173）后台启动
- 自动打开浏览器到 http://localhost:5173

需要桌面图标？运行 `start.bat --shortcut`，会在桌面生成 `AIMangaStudio.lnk`。

Linux / macOS：使用 `bash start.sh`（等价的 shell 版）。

## 贡献

欢迎提交 issue 或 pull request。请遵循项目的代码风格与贡献指南。

## 许可证

MIT
