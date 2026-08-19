# AI Manga Studio · 重构方案

> 范围：**一次性大改**（布局 + 视觉 + 缺失功能）
> 视觉方向：**明亮杂志风**（Monocle / The New Yorker 编辑设计语言）

---

## 一、Nielsen 启发式审计 · 现状问题

| # | 启发式 | 现状问题 | 严重度 |
|---|---|---|---|
| **H1** | 系统状态可见性 | 没有"删除项目"入口；项目/页/分镜进度看不到聚合；loading 反馈分散 | 4 |
| **H3** | 用户控制自由 | 创建后无法删除（数据堆积）；聊天面板不能关闭 | 4 |
| **H4** | 一致性 | 同时存在 chat 和 workbench 两种驱动，行为重复；步骤条 + 项目条 + 顶栏 3 层导航冲突 | 3 |
| **H5** | 错误预防 | 生成整页没有二次确认；删除/破坏性操作没有 | 3 |
| **H6** | 识别而非回忆 | 操作全靠 step 编号（1-5）；不显示「现在是哪步」「下一步是什么」 | 3 |
| **H7** | 灵活高效 | 没有键盘快捷键、没有批量操作、面板宽窄不能调 | 2 |
| **H8** | 美学极简 | 通用 Tailwind 灰底紫按钮；与"做漫画"的产品调性不符；字体是默认 sans | 3 |
| **H9** | 错误恢复 | "生成失败：生成失败"——只 echo 后端 message，前端不解释含义 | 2 |
| **H10** | 帮助文档 | 没有任何 onboarding / 空状态引导 | 3 |

**总分：严重 2 / 主要 6 / 次要 2** — 值得重做。

---

## 二、设计原则（明亮杂志风）

1. **编辑感排版**：标题用衬线（如 *Source Serif 4* / *Newsreader*），正文用 *Inter*，所有数字用 tabular-nums。
2. **强主色 + 1 强辅色**：报纸米黄 `#F8F5EE` 底、深墨色 `#1A1A1A` 主、辣椒红 `#D14836` 强辅。
3. **细分栏栅格**：12 栏对齐、卡片留白 24px、章节条用 1px 实线分隔（报纸分割线）。
4. **克制装饰**：仅分镜页可加漫画网点/对话框气泡；其他区域禁止 emoji 满天飞。
5. **状态即装饰**：进度（n/m 页）直接以杂志"目录页"风格数字列出，而非按钮。
6. **字体符号化**：用 OpenType 数字 oldstyle 让页码 / 章节号看上去像出版物。

---

## 三、信息架构（重构后）

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER  Logo │ 项目名 │ 当前阶段 │ 进度 3/8页 │ 账号/设置 │  ← 一行
├──────────────────────────┬──────────────────────────────────┤
│                          │                                  │
│   WORKBENCH（主区）      │   ASSISTANT（侧栏，可折叠）      │
│   ─────────────          │   ─────────────                  │
│                          │                                  │
│  Step 卡片化（不是步骤条）│   • 状态摘要                     │
│  每个 step 一张大卡片     │   • 1 段话进度说明               │
│  卡片里有：内容 + 行动   │   • 快捷提问 5 个 chip            │
│                          │   • 自由聊天（可关闭）           │
│                          │                                  │
└──────────────────────────┴──────────────────────────────────┘
```

**主流程卡片化**（不再是 5 个 step 按钮来回切）：

```
┌─ INSPIRATION ─────────────────────────────┐
│  标题 [____________________]              │
│  一句话简介 [____________________]        │
│  画风偏好 [____________________]          │
│                                            │
│              [ 开始创作 ▸ ]                │
└────────────────────────────────────────────┘

↓  创建后自动展开下一张卡片

┌─ WORLDVIEW ───────────────────────────────┐
│  已生成 · 一句话总结                       │
│  ┌───────┬───────┬───────┐                │
│  │ 时代  │ 画风  │ 色调  │                │
│  └───────┴───────┴───────┘                │
│  背景设定（可展开）                        │
│                                            │
│  [ 通过 ✓ ]      [ 重新生成 ]              │
└────────────────────────────────────────────┘

↓  ...

┌─ CHARACTERS ─────────────────────────────┐
│  4 个角色 网格                             │
│  [林默] [周明远] [老陈] [沈若男]           │
│                                            │
│  [ + 添加角色 ]    [ 全部重新生成 ]        │
└────────────────────────────────────────────┘

↓  ...

┌─ CHAPTERS ───────────────────────────────┐
│  § Ⅰ 透明人 ────────── 1 页  ▸ 已完成 ✓   │
│  § Ⅱ 裂缝 ──────────── 1 页  ▸ 草稿       │
│  § Ⅲ 深渊 ──────────── 2 页  ▸ 草稿       │
│  § Ⅳ 抉择 ──────────── 2 页  ▸ 草稿       │
│  § Ⅴ 清扫者 ────────── 2 页  ▸ 草稿       │
│                                            │
│  [ 重新拆章 ]                              │
└────────────────────────────────────────────┘

↓  ...

┌─ PAGES · 3/8 ─────────────────────────────┐
│  § Ⅰ 透明人                               │
│  ┌─┬─┬─┐                                  │
│  │1│2│3│  ← 缩略图网格，点击展开          │
│  └─┴─┴─┘                                  │
│                                            │
│  § Ⅱ 裂缝                                 │
│  ┌─┐                                      │
│  │1│  草稿                                │
│  └─┘                                      │
│                                            │
│  [ 一键续写下一页 ]                        │
└────────────────────────────────────────────┘
```

要点：
- **不再有"步骤条 1-5"**。所有卡片纵向展开在主区，**滚动即流程**。
- **当前活跃的卡片高亮**（左缘 3px 红条 + 米黄底）。
- **章节用罗马数字 §** 而不是 "第一章"。
- **进度永远显示 n/m 形式**，不是按钮态。

---

## 四、缺失功能补齐

| 功能 | 现状 | 改造 |
|---|---|---|
| 删除项目 | ❌ 无 | 项目列表每项右侧 hover 显示"⋯" → 删除（二次确认） |
| 空状态引导 | ❌ 无 | 首次进入显示 3 张"杂志专栏卡片"教程 |
| 进度聚合 | ❌ 无 | HEADER 中央永远显示 `■■■□□ 3/8 页` |
| 长任务反馈 | ⚠️ 只有 "生成中…" | 顶部 toast + 全局进度条 + 预估剩余 |
| 删除确认 | ❌ 无 | 所有破坏性操作走 Modal 二次确认 |
| 世界观卡片内容缺失 | ✅ 已修（兜底） | 同时改版为「目录页式」展示 |
| 键盘快捷键 | ❌ 无 | `← →` 翻页、`R` 重新生成当前页、`Cmd/Ctrl+S` 导出当前页 |
| 多语言 | ⚠️ 仅 i18n | 加 EN/JP 切换；视觉排版不破坏 |

---

## 五、视觉规范（明亮杂志风）

### 字体
- **Display**：`'Source Serif 4', 'Noto Serif SC', serif` —— 标题/项目名/章节号
- **Body**：`'Inter', 'PingFang SC', system-ui, sans-serif` —— 正文/按钮
- **Mono**：`'JetBrains Mono', monospace` —— 仅页码 / 数字

### 配色（CSS 变量）
```
--paper:    #F8F5EE   /* 报纸米黄 */
--ink:      #1A1A1A   /* 主文字 */
--ink-2:    #555      /* 次要文字 */
--rule:     #1A1A1A   /* 分割线（粗 1px） */
--accent:   #D14836   /* 辣椒红，强辅 */
--highlight:#E9B44C  /* 琥珀黄，当前选中 */
--bg-card:  #FFFFFF
--bg-soft:  #EFE9DC
```

### 组件规则
- **卡片**：`bg-white border border-ink/10 p-6`，hover 时左侧 3px 红条伸出
- **按钮**：
  - Primary：`bg-ink text-paper`，hover `bg-accent`
  - Ghost：`border-b border-ink`，无背景（杂志下划线链接）
- **数字**：font-variant-numeric: tabular-nums oldstyle-nums
- **不要的**：圆角 16px 的大紫按钮、Emoji 当主图、`bg-indigo-600` 这类 Tailwind 默认色

### 排版
- 项目标题：`text-5xl serif`（编辑大标）
- 卡片标题：`text-xs uppercase tracking-widest`（小标 caps，像杂志栏目标签）
- 正文：`text-base leading-relaxed`
- 章节号：`text-3xl serif italic`（斜体罗马数字 §）

---

## 六、待修改文件清单

| 文件 | 改动 |
|---|---|
| [index.html](file:///d:/26_Agent_Project/AI_comic/index.html) | 引入 Source Serif 4 + Newsreader 字体；加 `font-variant-numeric` |
| [src/index.tsx](file:///d:/26_Agent_Project/AI_comic/src/index.tsx) | 微调 |
| [public/index.css](file:///d:/26_Agent_Project/AI_comic/public/index.css) | 加 CSS 变量、字体、全局规则 |
| [src/components/Header.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/Header.tsx) | 重写：单行 header，中央进度数字 |
| [src/components/AgentWorkbench.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/AgentWorkbench.tsx) | 重写：双栏（workbench + assistant），可折叠 assistant |
| [src/components/SeriesWorkbench.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/SeriesWorkbench.tsx) | **大改**：步骤条删掉，改纵向卡片流；加空状态、加进度徽章 |
| [src/components/AgentChatPanel.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/AgentChatPanel.tsx) | 杂志栏排版；快捷提问 chip；可折叠 |
| [src/contexts/SeriesContext.tsx](file:///d:/26_Agent_Project/AI_comic/src/contexts/SeriesContext.tsx) | 新增 `deleteSeries` UI 接入；新增 toast/notification |
| [src/components/Toast.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/Toast.tsx) | **新增**：杂志风 toast（取代硬塞的错误条） |
| [src/components/EmptyState.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/EmptyState.tsx) | **新增**：首次使用引导卡 |
| [src/components/ConfirmDialog.tsx](file:///d:/26_Agent_Project/AI_comic/src/components/ConfirmDialog.tsx) | **新增**：破坏性操作二次确认 |
| [src/hooks/useKeyboard.ts](file:///d:/26_Agent_Project/AI_comic/src/hooks/useKeyboard.ts) | **新增**：全局快捷键 |

---

## 七、交付顺序

1. **基础** — 字体引入、CSS 变量、Reset
2. **骨架** — Header / 双栏布局 / ProjectSwitcher / 空状态
3. **核心** — 重写 SeriesWorkbench 为纵向卡片流（保留所有现有功能）
4. **功能补齐** — 删除项目、Toast、ConfirmDialog、快捷键
5. **打磨** — 微动效、加载骨架屏、错误文案优化、键盘可访问性

**预计改动**：
- 修改 7 个文件
- 新增 4 个组件 + 1 个 hook
- 不动后端、不动数据格式、不动 i18n（已有）