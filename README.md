# AIMangaStudio

[![中文](https://img.shields.io/badge/-中文-0078D7?style=flat-square)](./README.md) [![English](https://img.shields.io/badge/-English-4CAF50?style=flat-square)](./README.en-US.md) [![日本語](https://img.shields.io/badge/-日本語-F44336?style=flat-square)](./README.ja-JP.md)

![og image](./og.webp)

**专注连载漫画的 AI 创作工具。** 一句话生成世界观、角色、章节与连续页面，全程由 AI 负责分镜与绘图；你只需要用自然语言告诉 AI 哪里要改。

## 这是为谁准备的

- 想画连载漫画、但不懂分镜构图的人
- 需要角色和场景在几十页里保持一致的人
- 希望 AI 出初稿后能用自己的话改稿的人

## 项目概述
AIMangaStudio 旨在为独立创作者与工作室提供一套端到端的漫画创作流水线，集成剧情生成、分镜布局、角色设定与页间连续性分析等功能，简化从脚本到漫画页面的制作流程。

## 主要功能
1. 自然语言生成漫画脚本（剧情、对白、旁白）

    ![](docs/screenshots/AI%20剧情建议.jpg)

2. 角色与风格设定（支持多种绘画风格）
    ![](docs/screenshots/创建角色.jpg)

3. AI 分镜自动排版（对话框、镜头切换）
    ![](docs/screenshots/风格设定.jpg)

4. 多页漫画导出（PNG、PDF）

    ![](docs/screenshots/批量导出.jpg)

## 快速开始
### 环境要求
- Node.js（建议 18+）
- npm 或 yarn

### 1. 克隆仓库
```bash
git clone https://github.com/morsoli/aimangastudio.git
cd aimangastudio
```

### 2. 安装依赖
```bash
npm install
# 或
# yarn
```

### 3. 配置环境变量
项目根目录已提供 `.env.example`，复制为 `.env` 并填入你的 API 密钥：

```bash
cp .env.example .env
```

编辑 `.env` 文件，至少配置以下密钥：

```env
# 文字生成（默认 DeepSeek-V4-Flash）
TEXT_PROVIDER=deepseek
TEXT_MODEL=deepseek-v4-flash
TEXT_API_KEY=your_deepseek_api_key

# 图片生成（默认 Minimax image-01-live）
IMAGE_PROVIDER=minimax
IMAGE_MODEL=image-01-live
IMAGE_API_KEY=your_minimax_tokenplan_api_key

# 视频生成仍需 Gemini API Key
GEMINI_API_KEY=your_gemini_api_key
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

## 技术栈
- 前端：React + Vite + TypeScript
- 后端：Node.js + Express + TypeScript
- AI：Google GenAI、DeepSeek、阶跃星辰 Step、Minimax、OpenAI Compatible

## 模型配置

本项目支持通过界面或环境变量自定义文字生成与图片生成模型。

### 支持的模型提供商

| 类型 | 提供商 | 默认模型 |
|------|--------|----------|
| 文字生成 | DeepSeek | `deepseek-v4-flash` |
| 文字生成 | Google Gemini | Gemini 系列 |
| 文字生成 | OpenAI Compatible | 任意兼容 OpenAI API 的模型 |
| 图片生成 | Minimax (Tokenplan) | `image-01-live` |
| 图片生成 | 阶跃星辰 Step | `step-image-edit-2` |
| 图片生成 | Google Gemini | Gemini 系列 |
| 图片生成 | OpenAI Compatible | 任意兼容 OpenAI API 的模型 |

### 通过界面配置

1. 启动项目后，点击顶部工具栏的「模型配置」按钮。
2. 在「文字模型」标签页选择 DeepSeek 并填入 API 密钥，模型名称默认为 `deepseek-v4-flash`。
3. 在「图片模型」标签页切换为 Minimax 或阶跃星辰 Step：
   - Minimax：模型名称 `image-01-live`，使用 Minimax Tokenplan API Key。
   - Step：模型名称 `step-image-edit-2`，使用阶跃星辰 API Key。
4. 可自定义 Base URL、请求超时时间（毫秒）以及额外参数（JSON 格式）。
5. 点击「保存」即可生效，配置会保存在浏览器本地存储中。

### 通过环境变量配置

除界面配置外，你也可以直接修改 `.env` 文件：

```env
# 文字生成
TEXT_PROVIDER=deepseek
TEXT_MODEL=deepseek-v4-flash
TEXT_API_KEY=your_api_key
TEXT_BASE_URL=https://api.deepseek.com
TEXT_TIMEOUT=60000
TEXT_EXTRA_PARAMS={"temperature":0.7}

# 图片生成 - Minimax
IMAGE_PROVIDER=minimax
IMAGE_MODEL=image-01-live
IMAGE_API_KEY=your_minimax_tokenplan_api_key
IMAGE_BASE_URL=https://api.minimaxi.chat/v1
IMAGE_TIMEOUT=120000

# 图片生成 - 阶跃星辰 Step（可选）
# IMAGE_PROVIDER=step
# IMAGE_MODEL=step-image-edit-2
# IMAGE_API_KEY=your_step_api_key
# IMAGE_BASE_URL=https://api.stepfun.com/v1
```

### 注意事项
- API 密钥仅在浏览器本地存储中保存，不会上传到服务器。
- 视频生成功能目前仍依赖 Google Gemini API Key，请确保 `GEMINI_API_KEY` 已配置。
- 切换模型提供商后，模型名称和 Base URL 会自动更新为对应默认值，也可手动覆盖。


## 一键部署
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/morsoli/aimangastudio)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/morsoli/aimangastudio)


## 目标用户
- 独立创作者
- 漫画爱好者
- 内容工作室
- 自媒体运营者

## 故事创作（系列漫画引导式生成）

应用启动后默认进入 **「连载工作台」**。整个过程是 AI 全自动的 5 步流程：

### 步骤 1：灵感
填写「漫画标题」+「一句话故事简介」+ 可选的「画风偏好」，点 **下一步**。

### 步骤 2：世界观
AI 根据简介生成时代 / 画风 / 色调 / 背景设定。如果不满意，点 **重新生成**。

### 步骤 3：角色
AI 自动创建 3-4 个核心角色（主角 + 配角/反派），并为每个角色生成一张「角色参考图」。之后每页画到该角色都会用这张图保持一致。

可以手动添加角色，也可以点 **重新生成参考图** 换一张。

### 步骤 4：章节拆分
填入目标总页数（推荐 8-20 页），AI 自动拆分成多章。点页面缩略图直接进入该页编辑。

### 步骤 5：逐页生成
对每一页：

1. 点 **① 拆解分镜** — AI 把这一页拆成 2-8 个分镜，每个分镜指定出场角色
2. 点 **② 生成全部图** — AI 按分镜逐张生成图片，每张都会带上对应角色的参考图保证一致性
3. **不满意？** 在每个分镜下面点 **「改这一格」**，用自然语言告诉 AI 怎么改（例如「换成特写」「让角色微笑」「加一把剑」）
4. 整页不满意？点 **🪄 用一句话改这一页**，AI 重写整个页面的分镜描述并重新出图
5. 想要下一页？点 **✨ 一键续写下一页** — AI 根据前面所有页的剧情，自动续写下一章第一页

### 跨页一致性机制

- **角色参考图**：每个角色生成一张"身份证"图，每页画到该角色都会带上这张图
- **场景连续性**：生成下一张图时传入前一页的图作为参考，保证服饰 / 场景 / 色调延续
- **剧情连续性**：所有已完成页的描述作为上下文传给文字模型，续写时自动衔接

### 数据存储

所有系列数据存储在 `server/series-data.json`，重启服务后保留。手动删除该文件可清空所有系列。

### 一键导出

顶部「导出」按钮会逐张下载所有页的分镜图（PNG）。

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
