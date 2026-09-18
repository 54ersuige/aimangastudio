# Wiki Log

> 重构动作日志，append-only。格式：`## [YYYY-MM-DD] action | subject`

## [2026-09-03] behavior-change | 层级术语彻底统一：季→话→格，清除 卷/章/页
- 用户决策：按公众号连载漫画最佳实践（作品→季→话→格），章/卷是小说概念不用，页仅内部批次
- 根因：prompt 术语污染——worldview 写「2-6 季/卷」、chapters 标题示例「第一章 觉醒」→ LLM 生成的 arc 标题带「卷」、话标题带「第一章」，与 UI「第X季/第X话」标签套娃
- prompt 修复：worldview（季蓝图 title 禁含结构字）、chapters（话目生成/续写/legacy 三处 prompt + Chapter title schema + 默认 page title「第N页」→「第N批」）、pages（breakdown/continue 的 单页/每页/当前页 → 批）
- UI 修复：ArcBlock「第X章」→「第X季」；话目缩略图从页码方块改为话封面（首格图/话号）+「已生成 X/Y 格」；EpisodeCard 批次条不再显示 page.title；Card IV kicker「季 · 话目」；ChaptersCard/CharactersCard/ManualEditors/titleSuggestions/continuity/PublisherModal 残留文案清理
- 存量数据：已生成的「第一卷/第一章」式标题在数据里，需重新生成世界观+话目或手动编辑话标题才会消失
- 验证：tsc exit 0
- 详见 [[episode-unit-model]]

## [2026-09-03] behavior-change | 创作助手对齐话级模型 + 状态联动
- 用户反馈：助手仍推荐"总页数 36 页"、与左侧话级实际流程脱节、生硬无用
- agentEngine：推荐逻辑改为话数（getEpisodePlan：蓝图→ΣplannedChapterCount 话，每话≈15格）；拆章路由与左侧同构（蓝图→genArcs 物化季骨架→逐季 genArcChapters；legacy 兜底）；producing 阶段指令全话化（跳到第X话/出图第X话/自动跑N话/重出第N格/续写本话/出图此批）；greet 与自由问答带实际进度上下文（X话Y格已生成Z）
- bug 修复：autoRunPages 只遍历 s.chapters（arcs 结构下失效）→ autoRunEpisodes；runBreakdownPage 找章标题同病；reviewing_chapters 无话目时「通过」直接跳 producing 的语义错误
- AgentChatPanel：步骤条 IV 话目 / V 逐话生成；话目卡显示格数；PagePreviewCard 去"页"
- 选中状态提升：selectedEpisodeId 移入 SeriesContext（AgentWorkbench 桥接 selectEpisode/getSelectedEpisodeId，跳话时左侧卡片同步）
- 验证：tsc exit 0
- 详见 [[episode-unit-model]]

## [2026-09-02] behavior-change | 话（Episode）= 最小单位，格独立生成
- 用户决策：最小单位是话；每格可独立生成。page 降级为内部批次，UI 不再出现"页"
- 后端：page generate 改增量语义（只补缺格）；新增单格生成端点 `POST /pages/:pageId/panels/:panelIndex/generate`（任务键同页互斥，不整页置 generating）
- 前端：PageCard 删除 → EpisodeCard（话级，整话格列表 + 连续格号 + 单格操作）；PagesOverview → EpisodesOverview；SeriesContext 新增 7 个显式 pageId action（SelectedPage 系保留为 agent 桥兼容包装）
- 话号全局连续（跨章）；导出收敛：删除旧页级版式（exportPageAsStrip/exportSeriesAsStrips），顶栏导出走新 `exportSeriesAsEpisodeStrips`（每话一张）；EpisodeStripInput +isLastEpisode（全篇完/未完待续）
- 附带 UX 修复（话级导出）：toast 反馈替代 alert、导出中状态、缺格 confirm、AI 覆盖确认、tagline 画布换行防溢出
- 验证：tsc exit 0（每阶段）；运行时验证待 dev server 手测
- 详见 [[episode-unit-model]]

## [2026-09-01] baseline | tsc 基线
- `npx tsc -p server/tsconfig.json --noEmit` → exit 0
- `npx tsc --noEmit`（前端）→ exit 0
- 重构前基线干净，后续任何 tsc 失败均为本次重构引入

## [2026-09-01] cleanup | 残留文件清理
- 删除 `.tmp-regen.mjs`、`test-image.png`、`shared/types.js`（旧编译产物，无运行时依赖，构建管线自行编译 shared/）
- 验证方式：grep 全仓无 `shared/types.js` 直接 import；server/tsconfig.build.json include `../shared/**/*.ts`

## [2026-09-01] incident | 前端拆分子代理中断回滚
- 现象：前端拆分子代理被打断，结果丢失；SeriesWorkbench.tsx 曾出现「删旧未建新」中间态（约 -50 行）
- 处置：与 Trae 本地历史快照（Trae CN/User/History/4d9f38b/1DkE.tsx）逐字节比对，当前文件 = 最后保存快照，0 差异，tsc exit 0 → 状态干净
- 教训：① 子代理协议必须「先建新文件、最后改主文件、每步 tsc」；② 委托前后用 IDE 快照/字节对账；③ PublisherModal 未被动过
- 决定：用户确认后以当前状态为基线重跑拆分

## [2026-09-01] refactor | server/series-routes 拆分
- 2209 行单文件 → [series-routes.ts](../../server/series-routes.ts) 15 行聚合层 + series-routes/ 下 7 模块（helpers 300 / prompts 460 / crud 75 / worldview 116 / characters 416 / chapters 290 / pages 586）
- 纯等价搬移：函数体逐字复制，仅补 export 与 import 头
- 验证：tsc exit 0（前后各一次）；路由注册对账 32=32
- 详见 [[series-routes]]；known-issue：characters 重复 PATCH 路由（pre-existing，未改）

## [2026-09-01] refactor | 前端大组件拆分（重跑成功）
- SeriesWorkbench.tsx 1553→520 行 + series-workbench/ 8 子模块；PublisherModal.tsx 1000→903 行（保守：仅提取 Section/Field/BlockRow 到 publisher-modal/parts.tsx，主体 hooks 连续不硬拆）
- 安全协议生效：先建新文件（tsc exit 0）→ 最后改主文件（tsc exit 0）
- 验证：tsc 三轮 exit 0；符号对账 16（series-workbench）+ 3（parts）全部命中
- 详见 [[frontend-split]]

## [2026-09-01] behavior-change | series-store 防抖写盘
- saveAll 改为 800ms 防抖 + 定时器内同步原子写；flushSeriesStore 导出；beforeExit/SIGINT/SIGTERM 兜底
- 验证：tsc exit 0 + 临时脚本行为验证 3 PASS（防抖生效/flush 立即落盘/删除后恢复原状）；数据库有备份并已还原
- 详见 [[series-store]]、决策依据 [[debounced-persistence]]

## [2026-09-01] polish | 前端视觉精修（印刷品质感）
- 全部在 public/index.css，零组件改动：纸张颗粒（body::before SVG 噪点 multiply 4.5%）、报头 Oxford 双线（[data-topbar]::after）、卡片 hover 边框加深+微投影、分镜格 hover 图片 scale 1.03、按钮 active 下沉 1px、modal-card 悬浮投影、prefers-reduced-motion 降级
- 设计判断：不换风格，把既有 Monocle/New Yorker 杂志风执行得更精致
- 验证：dev server + 浏览器 JS 检查（颗粒层/双线生效）；hover 截图因工具超时未拍，CSS 直接

## [2026-09-01] fix | Nielsen 可用性审计修复 4 项
- 审计报告与遗留清单见 [[ux-audit-2026-09-01]]
- ConfirmDialog：danger 模式焦点移至取消、Enter 不再触发确认（防误删）
- 章节删除：去掉 ChapterEditor 两步确认之上的冗余原生 confirm()
- ModelConfigModal：window.confirm 改为内联警示 + 二次点保存
- PublisherModal / ModelConfigModal：补 ESC 关闭；AgentWorkbench 顶栏加快捷键提示
- 验证：npx tsc --noEmit exit 0

## [2026-09-01] create | Wiki 初始化
- SCHEMA.md / index.md / log.md 建立，域：AI_comic 重构知识库

