# Wiki Log

> 重构动作日志，append-only。格式：`## [YYYY-MM-DD] action | subject`

## [2026-10-15] behavior-change | 出图并发化 + 失败隔离 + 进度真正上线
- 用户决策：并发数取 **3**（提速明显且不打爆上游限流）
- **根因**：原来 `prompts.ts` 里 `for (const panel of sorted)` **完全串行**，每格最坏 3 轮 × 5 次模型调用；6 格整页最坏 ~96 次外部调用、**最坏 72 分钟**，而前端 10 分钟就超时 —— 用户看到失败、后端还在烧钱。这就是"跑图不知道进度"的真实来源：不是没做进度条，是后端根本没在并发跑，第 1 格没画完前 progress 必然是 0
- 新增 `server/concurrency.ts` 的 `mapConcurrent`：有界并发，**保序回填 + 失败隔离**。worker 用"抢下标"而非分片（分片会拖尾），`onSettled` 覆盖成功与失败项，保证进度一定走完全程
- `generatePanelImages` 返回值从 `string[]` 改为 `{ paths: (string|null)[]; failures: PanelGenFailure[] }`，**保序等长是硬要求**（调用方普遍按 `paths[i]` 对应 `panels[i]` 写回）
- **单格失败不再炸整页**：原来 `prompts.ts` 末尾直接 `throw 分镜 N 三次尝试均失败`，前面几格已落盘的图 `imageUrl` 从未写回 → 已付费的图变孤儿文件。改为收集 failures 继续跑；**全灭才抛**。4 个调用点全部改写：generate / regenerate / panel-generate / page-rewrite
- 失败文案 `describePanelFailures` 明确告诉用户"成功几格已保留、可只重试失败的格，不必重画整批" —— 否则用户看到红条会以为整页白跑，从而重复扣费
- 进度接线（此前是**两头都断的空转**）：`runTask` 的执行体形参新增 `taskId`（旧调用方忽略即可，无需改动）→ `generatePanelImages` 的 `onProgress` → `setTaskProgress`；前端 `seriesClient` 的 4 个出图端点透传 `PostTaskOptions` → `SeriesContext` 新增 `taskProgress` → `EpisodeCard` 显示"生成中 N%"
- 顺手修掉**假超时**：`postTask` 的轮询 fetch 此前无 `AbortController`，请求一挂住 `await` 永不返回，位于循环顶部的总超时检查**永远执行不到**，UI 无限转圈。现加 `AbortSignal.timeout(20s)`，且单次查询抖动不再终止整个任务（只有"任务不存在"才放弃）
- 总超时 10 分钟 → **30 分钟**，与并发后最坏耗时对齐（原先比后端短，等于逼用户重试）
- 验证：`npm run check` exit 0；`npx vitest run` **54 passed**（新增 21 个：并发原语 12 + 进度链路 4 + 失败文案 5）；`npm run build` exit 0
- 详见 [[panel-generation-concurrency]]

## [2026-10-15] baseline | 地基工程：typecheck / strict / 测试
- **typecheck 接线**：root 与 server 各加 `typecheck` script，root 加 `npm run check` 一次跑两端。此前 typecheck 没有任何入口，等于前端完全没有类型保护
- **根因修复（最大单点收益）**：`@types/react` / `@types/react-dom` 从未安装，且 `tsconfig.json` 的 `"types": ["node"]` 把 React 类型整个切掉。开 strict 后前端一次性冒出 **2229 个错误**，其中 1890 个是 TS7026（JSX 无类型声明）—— 即"缺一个 devDependency"，不是 1890 个代码缺陷。装上 + 修正 types 后降到 **30 个**
- **开启 `strict`**：30 个错误全清，前后端 `tsc --noEmit` 均 exit 0。分三类修：
  - `agentEngine.ts` 19 处 TS2564 —— `setDeps` 注入的依赖改用 definite assignment (`!`) 声明
  - `addCharacter` 入参类型三处内联副本互不一致（seriesClient / SeriesContext interface / addChar 实现），SeriesContext 那份漏 `visualAnchors` → 提取为 `AddCharacterInput` 单一事实源
  - `replacePanels` 载荷类型与实际报文不符（前端刻意抹掉 index 交给后端编号）→ 新增 `PanelInput`（index 可选）与 `ReplacePanelsSchema` 对齐
- **修掉一个真 bug**：`platformCompliance.ts` 的 `draft.author.trim()` —— `ArticleDraft.author` 是可选字段，未署名时打开合规面板直接抛 TypeError，连带整个面板崩掉。收敛为 `(draft.author ?? '').trim()`
- **引入 vitest**（root devDep + `vitest.config.ts` + `npm test`），首批 **31 个回归测试**覆盖契约层与任务队列。重点锁住两条易被"顺手重构"掉的行为：
  - `validatePanel`：description < 60 字是 **repairable 而非 fatal**（2026-09-18 改动），且 `repairable` 聚合语义——混入任一 fatal 则整体不可修复
  - `task-queue`：同 key 互斥、progress 仅 running 期可上报且夹到 0-100、30 分钟 TTL 惰性清理、listTasks 不泄露内部 key
- 验证：`npm run check` exit 0；`npx vitest run` 31 passed；`npm run build` exit 0

## [2026-10-15] cleanup | 死代码与仓库瘦身
- 删除已入库且严重过期的备份：`server/series-routes/{helpers,pages,prompts}.ts.bak-focus-2026-09-03`（prompts 版差 619 行）、`server/tsc-out.txt`（0 字节）
- 删除 21 个一次性调试脚本（tools/probe-*、watch-page / reset-page / wait-task / list-procs，以及根目录 3 个与 `start.ps1` 功能重叠的 start-*.ps1）
- 仓库瘦身：`tools/style-bakeoff/` 28 张对照 PNG 共 **80MB**（是 `style-bakeoff.mjs` 等脚本的可再生产物，结论已沉淀进 `docs/style-dna/*.md` 与 `server/dna/*.ts`）；`.npm-cache/` 35 个缓存文件 2.3MB。两项均加入 `.gitignore`
- **安全**：移除 `tools/bug-confirm.mjs` / `tools/regen-style-refs.mjs` 中硬编码的明文 API key，改读 `IMAGE_API_KEY` 环境变量。⚠️ 该 key 已存在于 `b5b7255` / `01d5086` / `23c84eb` 三个提交，**仍需在服务端吊销并重发**
- 清理全部走 mavis-trash（可恢复）；入库文件亦可 `git checkout` 取回

## [2026-10-15] incident | 待用户决策：characters PATCH 路由遮蔽
- **现象**：`server/series-routes/characters.ts` 注册了**两个** `PATCH /series/:id/characters/:characterId`
  - `:344` 窄版 schema（仅 `name/role/description/appearance/voiceTone/referenceImage`），末尾 `res.json()`，从不调 `next()`
  - `:391` 完整 `UpdateCharacterSchema`（含 `visualAnchors/gender/ageBand/outfit/personality/motivation/archetype/referenceImages`）+ 2026-09-07 加的 `validateCharacter` 契约校验
- **后果**：Express 先注册的先响应 → 窄版永远生效，`:391` 起整段是死代码。Zod v3 的 `z.object()` 默认**剥离**未声明字段，因此改角色的视觉锚点 / 性别 / 服装会**返回 200 但字段被静默丢弃**
- 这正好打在"角色跨页一致性"这个反复出现的痛点上。`log.md` 2026-09-01 条目记过"characters 重复 PATCH 路由（pre-existing，未改）"，但当时只当重复路由记，未评估影响
- 按 wiki `Update Policy`「发现 pre-existing bug：不改，记 known-issue，报给用户决定」—— 已上报，**未改动**

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

