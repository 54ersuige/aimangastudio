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


## [2026-10-15] behavior-change | 审计日志改写到 server/data/audit/
- panel-audit 落盘位置 server/logs/ → server/data/audit/panel-audit
- 根因：logs/ 是「每次启动清理」的临时目录，实测审计记录已全部消失 —— 导致「四道闸到底有没有用、重画有没有真的提分」只能靠感觉回答
- server/data/ 已在 .gitignore 内，既是用户内容目录又不会随启动清理
- 详见 [[four-gate-fusion]]

## [2026-10-15] create | 孤儿图回收（server/orphan-gc.ts）
- 根因：deleteStoredImage 在生图路径上从未被调用；446 张图里 443 张（663.3 MB / 99.3%）无任何引用
- 判定只认 series-data.json（唯一事实源），不用 mtime —— mtime 会误删用户正在看但元数据未写回的图
- 安全护栏：默认 dry-run、只删 uuid.ext、MAX_DELETE_PER_RUN=500
- 入口：npm run gc:orphans [-- --apply]
- 真实数据 dry-run 已跑：443 张 / 663.3 MB（未执行 --apply）
- 详见 [[orphan-image-gc]]

## [2026-10-15] behavior-change | 四道闸合一（server/panel-gate.ts）
- limb / gender / comic-reviewer / alignment 四次 vision 调用 → runPanelGate 一次；典型 4 次（最坏 6 次）降到 1 次
- 边界：肢体 inpaint 局部修复保留并独立抽出（repairLimbRegions）—— 局部修补是唯一能保住已付费好图的手段；guardedImage 保留给角色参考表/风格参考图两条路径
- 判定阈值一字未改，集中到 judgePanel（limb 0.6 / review<70 / alignment 缺一即重画 / gender ambiguous 视作通过）
- 瘦身：内部重试 3→0；按图片+输入指纹缓存 24h；第 2 轮起定向复审，未复核维度继承 previousReview 真实分数（不落到 parser 的 5 分默认值，否则污染审计）
- 缓存键刻意含参考图 hash：D1/D6 是拿参考图比对出来的
- 验证：tsc exit 0；vitest +19（panel-gate.test.ts 19 项）；运行时探针用真实 Agnes provider 触发 400 → 捕获 → 四闸全 null → fail-open 出图不阻塞
- 自查中发现并修掉一处真 bug：limbGuardResult / genderResult / reviewResult 声明在重试循环外却只条件赋值 → 第 1 轮结论会漏进第 2 轮审计（表现为「审计说这张图性别不符，但它其实没问题」）。修法不是加 else，而是把翻译逻辑抽成纯函数 gateToAuditFields，让"每轮全覆盖"由返回类型保证；补 6 项回归测试锁住（含「第二轮只回一半 → 前半段必须清空」）
- 详见 [[four-gate-fusion]]
## [2026-10-15] fix | 实跑抓出两个静默失效的审核 bug
四闸合一上线后跑第一次真实出图（6 格 / 并发 3），暴露两个单测发现不了的 bug：

- **合一闸 30s 超时**：server/config.ts 里 vision.timeout 默认 90000，
  但 server/runtime-config.json 存的是 30000，被旧配置盖住。
  合并前 4 个轻调用各自能塞进 30s；合并后一次要吃 5 图 + 4 块输出 + 20000 tokens，必然超时。
  6 格里 2 格四块全 null。→ 改运行时配置回 90000（只是恢复代码默认值）
- **对齐闸一直是死的**：schema 要 {"items":[{"text":...}]}，模型稳定返回 {"items":["..."]}，
  每次抽取都 zod 失败走 null。日志累计 alignment-extract-schema-fail 15 次。
  → schema 改 z.union 同时接受两种形状，prompt 改成模型自然会给的简单形式
- 补 server/alignment-items-schema.test.ts（4 项）锁住"两种形状都吃下"
- 验证：typecheck exit 0；vitest 91 passed（原 87）
- 详见 [[live-run-retro-2026-10-15]]

## [2026-10-15] chore | 过程产物全量出库（git 历史同步清理）
- 发现"从工作区删除 + 加 gitignore"**不动 git 历史**，blob 照样会被推上去：
  清完 PDF 后 .git 仍有 93.5MB
- 一并 purge：tools/style-bakeoff/(80.1MB 风格对比图) · .npm-cache/(1.3MB) ·
  根目录 og.webp(1.1MB 旧副本) · *.jpg(1.3MB 4 张 2025-09 旧 UI 截图，无任何文档引用) ·
  tools/_probe.png
- .git 从 93.5MB → 11.2MB
- 刻意保留（资产非产物）：docs/references/*.png(4.16MB 生图要读) · public/og.webp(1.13MB README 用)
- 判据写进 .gitignore 注释：删掉后应用还能不能正常画图 / 文档里还有没有引用
- 已推送 https://github.com/54ersuige/aimangastudio（origin），原作者保留为 upstream 只读

## [2026-10-15] behavior-change | 审核标准下调（用户拍板：轻量化，别停滞）
依据是 6 格真实出跑的审计数据：5 格里 4 格烧满 3 次重试（126s~265s/格），
而用户看原图的评价是「故事说得清、情绪也对」—— 这些重试基本白花。

- review 重画线 70 → 78
- 对齐判据：缺任意 1 项 → 呈现率 ≥ 60%（3 项画 2 项 = 67% 通过；全缺或过半才重画）
- 肢体置信度 0.6 → 0.7（低置信度触发 inpaint 可能把没问题的区域改坏）
- 重试上限 3 → 2（即使不达标也只多花一轮，保证不会卡在重试里出不来）
- 三层都放宽但底线还在：对齐仍要求至少 1 项画出、肢体仍要求有 bbox、review 仍是硬门槛
- 补 7 项测试（isAlignmentAcceptable 判据 + 阈值断言同步）
- 验证：typecheck exit 0；vitest 98 passed（原 91）
- 详见 [[review-thresholds-relaxed]]

## [2026-10-16] behavior-change | 一话必须有戏剧张力：规划时校验 summary 撑不撑得起它声明的格数
用户澄清发布模型：**一话 = 一天 = 一条长图 = 一次发布**（此前误以为 page 是发布单位）。
故「每话 12-18 格」不是体量审美指标，而是「这一话够不够演完一件有戏剧张力的事」。

- 实测四话 summary 字数 104/104/102/101，pageCount 全 3（→18 格容量），但各只够约 5 拍
- 决定性证据：《报到》6 格与 summary 的 6 句话一一对应，一格不差 → 剩下 12 格是空批次
- 新增 server/series-routes/chapter-capacity.ts：判据唯一来源，三处规划入口共用同一函数与同一段 prompt
- 判据用「画面点估计」（字数 ÷ 20）而非数句子 —— 模型爱写长句，数句子会系统性低估导致误杀
- pageCount 此前四处不一致（1-12 / 2-6 / 2-8 / 2-8），「12-18 格」在规划阶段从未被强制过，现统一 2-3
- prompt 增加戏剧张力硬要求：必须有冲突或转折、结尾停在未解决处、禁止同义句凑字数
- 界面进度分「规划容量 / 已拆解 / 已出图」，去掉误导的「低于目标要续写」
- 按钮语义统一：本话有空批次→「拆解第 N 批」，本话全满→「进入下一话」
  （此前该状态下按钮叫「续写本话」却去填下一话，名实不符）
- 新增 tools/capacity-audit.ts + 15 项测试
- 验证：typecheck exit 0；build exit 0；vitest 117 passed；真实数据 audit 四话全部被判打回
- known-issue：现有 4 话 summary 生成于新规则之前，不会自动改写，需重新规划或手动扩写
- 详见 [[chapter-drama-capacity]]
## [2026-10-16] fix | GitHub 推送凭据：环境里的失效 GITHUB_TOKEN 抢占 gh 登录态
- 症状：`git push` 报 Invalid username or token，但 `gh auth status` 显示账号是登入的
- 根因：宿主进程环境里有一个**已失效**的 GITHUB_TOKEN（User 级，ghp_…），
  gh 优先用它而不是 Windows 凭据管理器里那个有效登录态
- 清掉 User 级变量后仍失败：宿主进程 env 仍持有旧值，每次新 shell 都从它继承，
  **要重启宿主才会真正消失**
- 根治：新增 `~/.local/bin/gh-cred.cmd` 包装器，内部先清空 GITHUB_TOKEN/GH_TOKEN
  再调 gh auth git-credential，配置为 github.com 的 credential helper
  —— 从此推送不再受污染环境影响
- 验证：`git ls-remote origin` exit 0、`git push` exit 0（当时环境仍带坏 token）

## [2026-10-16] fix | DNA checksum：报的是「行尾不同」，不是「内容被改」
用户主推的 new-yorker-noir 长期报警。查下来是三个缺陷叠在一起：

- `fingerprint()` 按原始字节算 sha256，而 core.autocrlf=true 且无 .gitattributes，
  同一份内容 Windows 检出 CRLF / Linux 检出 LF → 两台机器两个哈希。
  new-yorker-noir 是全目录**唯一** CRLF 文件，所以只有它报警
- 行尾归一后仍与声明不符 → 声明本身也确实失效（且两个历史提交都对不上）
- `DNA_DOCS_PATHS` 导出后**零调用**，checksum.ts 头注释承诺的 .md 镜像校验根本没写

处理：fingerprint 归一行尾+BOM；新增 verifyDnaMirrors() 接上死代码并由启动时调用；
4 个 DNA 重算声明、new-yorker-noir 行尾归一；新建 .gitattributes 固定行尾；
新增 checksum.test.ts（12 项，含「内容真变了哈希必须变」防恒值退化那条）
- 详见 [[dna-integrity-check]]

## [2026-10-16] behavior-change | 一话容量：实跑之后抓出的四个问题
前一版只做了代码审查和静态验证。真跑一次之后才暴露：

- **prompt 字数要求与代码差整整一倍**：prompt 手写「pageCount=3 需 ≥180 字」，
  代码实际要求 360 字。模型照 prompt 写必然被打回、反复返工直到停滞。
  更糟的是测试把 bug 一起锁住了（断言 rule 里含 '120'/'180'）。
  → 规则里的数字全部改为常量推导，并加测试断言「rule 下界 == 常量算出的下界」
- **pageCount 三处自相矛盾**：append prompt 要 4 批但 schema 只允许 3；
  generate-chapters 要 pageCount 之和 = 话数×4 而每话最多 3（永远达不到）；
  UpdateChapterSchema 还能手动设到 8（「12-18 格」只对 AI 生效、对人不生效）
  → 新增 feasibleTotalBatches() 把总数夹进真正可达的区间
- **第一版实跑张力跑偏成暧昧**：453 字容量合格，但主角全程被动、没有代价、
  冲突写成办公室言情暗示 → 规则补第 3/4/7 条（主动选择 / 有代价 / 暧昧≠冲突）
- **没有「重新规划已有话」的入口**：三个生成端点全是新建。
  → 新增 POST /series/:id/chapters/:chapterId/replan，两条硬线：
  不静默丢已出好的图（pageCount 变小也不删已有批次）、如实返回 stalePanels 提示旧图已与新剧情脱节

实跑四话结果（62-116s/话）：469/537/830/672 字 = 23/26/41/33 拍，需求 18 拍。
**张力标准 4/4 达成**（主角主动选择 + 具体代价 + 结尾未解决）。
- 但暴露两个新问题：(1) 判据只卡下限不管上限，比值 1.28-2.28
  → checkChapterDensity() 阈值 1.5（照实测定的），**只提示不拦截**
  (2) 四话全是「施压→拒绝→代价落在妈妈」同一形态，套路化才是可持续张力的真正威胁
  → 规则补第 8/9 条；⚠ 这两条未实跑验证，下一话才生效

## [2026-10-16] feat | 失败格保留旧图时显式标记
整批重画失败格保留旧图的策略不变（宁可留旧图也不要留空洞），
但「6 格齐全」可能是假象 —— 用户以为自己看过新版了。
Panel 新增 stale / staleReason，重画失败时标记、成功时清除，界面打「旧图」红标。

- 验证：npm run check exit 0；npm run build exit 0；vitest 148 passed（13 files）
- 详见 [[chapter-drama-capacity]]
## [2026-10-16] bugfix | 「生成话没反应」：它转了 8 分钟，而不是卡死
用户原话：「生成话的时候，没有反应啊」。排查排除了服务/模型/队列/前端全部猜测后，
从日志 kind 统计里看到真相：`arc-chapters` 请求 33 次、响应 27 次 —— 差的 6 次就是没回来的。

完整时间线：
- 16:13:33 用户第一次点
- 16:19:25 第 1 次尝试返回，字数不够（371/368/353/346 < 要求 360）→ 整轮重写
- 16:21:40 第 2 次成功，4 话生成完毕
- 用户在 16:15 又点了一次 → 撞 409「该季已有 chapter」→ 局面更乱

**两个独立缺陷：**

1. **三个话目端点是同步 HTTP**，前端只有一句不动的「生成中…」。
   8 分钟不动和真卡死长得一模一样，用户据此重蹈覆辙。
   → 改走 runTask 队列，立刻返回 taskId；callStructuredJson 新增 onProgress；
   重试阶段也上报（"内容不够，正在重写"是最容易被误判为卡死的时刻）；
   重复点击返回人话 409「请等它跑完（通常 5~10 分钟）——不用重复点击」；
   按钮旁加进度条并事先告知时长。

2. **text 模型超时 240s，而批量出 4 话实测要 5~8 分钟** → 任务在 4 分钟处
   被「请求超时」掐断，用户看到的是彻底失败。这条更阴险：
   模型跑得快时能过去，属于「运气好时看起来没问题」。
   → callStructuredJson 支持 per-call timeoutMs 覆盖，**每次尝试单独放宽**
   （否则第 2 次重试会被第 1 次消耗的墙钟时间误伤）；
   generate-chapters 480s，append/replan 300s。
   **不全局抬高**：那会让所有短任务失败时也干等 10 分钟。

为什么慢：M3 输出里 84% 是思考 token（21143 字符里 17783 是思考），
它在纠结一个真实歧义 ——「把季"新人"…拆分成话目」里"新人"是季标题还是话内容。
且 callStructuredJson 从未设 maxTokens，思考时长完全由模型自定。

实测验证：HTTP 返回 0s 拿到 taskId · 重复点击被 409 挡 · 后台正常执行
新增 server/series-routes/long-task-timeout.test.ts（11 项，锁超时/队列/人话提示）
- 详见 [[long-task-progress]]
### 补记：修超时覆盖时自己踩的坑

造好了 attemptConfig 却仍然 `generateText(config, req)`。表面看「覆盖已实现」，
测试也全绿（timeoutMs / perAttemptMs / attemptConfig 三个字符串都在），
但超时一点没变 —— 又一次「请求超时（240s 内未返回）」。

补的测试不只断言「覆盖对象存在」，而是断言它被用上了：
    for (const site of HELPERS.match(/provider\.generateText\(\s*\w+\s*,/g) || [])
      expect(site).toContain('attemptConfig');
    expect(HELPERS).not.toMatch(/provider\.generateText\(\s*config\s*,/);

**断言存在性 ≠ 断言生效性。** 静态断言查不出「造了但没传进去」，
这类 bug 只有端到端真跑一次才会暴露 —— 而真跑这次撞上了 429 额度上限。
## [2026-10-19] bugfix | 丢数据根因：防抖没有上限，一次生成 5~8 分钟期间磁盘一次没动

**先记账**：《加油啊》4 话（约 500 字/话）丢了，只剩 10/16 的 `%TEMP%` 备份。
排查后定位到机制，本条修掉。

### 根因

`server/series-store.ts` 的 `saveAll()` 是纯「尾部防抖」：每次变更都
`clearTimeout` 再重排一个 800ms 定时器。**一次生成要跑 5~8 分钟，期间每隔几百
毫秒就 save 一次，于是定时器被无限往后推 —— 整场任务期间一次都没落过盘。**

磁盘上的文件冻结在任务开始那一刻。进程一旦被杀掉：

- 改一行服务端代码 → `tsx watch` 热重启
- 崩溃 / `taskkill /F`

`beforeExit` / `SIGINT` / `SIGTERM` 处理器**统统不执行**（硬杀不跑信号回调），
挂起的那次写入连同整场任务的成果一起消失。原注释写的是「崩溃时最多丢失最后
800ms 内的变更」—— 这句话对突发小改动成立，对长任务**完全错误**。

对照实验（`server/logs/debounce-control.mjs`，一次跑，非测试）：

```
模拟连续忙碌 15214ms（每 5ms 一次存盘，共 ~3043 次）
  旧写法（纯防抖 800ms）                落盘 0 次
  新写法（防抖 800ms + 上限 5000ms）     落盘 3 次
=> 旧写法全程 0 次落盘。磁盘冻结在任务开始那一刻，进程被杀则成果全丢。
```

### 修法（三层）

1. **最长等待上限**（`server/save-scheduler.ts`，新建）：无论多忙，5000ms 内
   必定落一次盘。丢数据窗口从「整场任务」压到 5 秒；空闲时仍按 800ms 合并突发，
   没有把原有的防抖优化白拆掉。调度器独立成模块，是为了能用假时钟**真跑出行为**
   而不是断言常量存在。
2. **写前备份**：`atomicWrite` 覆盖前把上一代复制成 `series-data.json.bak`，
   永远保留「上一代」。
3. **启动恢复**：主库缺失或 JSON 损坏时从 `.bak` 拉回（`recoverFromBackup`）。
   主库能正常解析时**绝不碰**——哪怕它是空的，那也可能是用户真的删光了，
   回滚反而制造「删不掉的东西」。

### 教训

- **注释里的免责声明不等于行为**。「最多丢 800ms」这句话在长任务下是假的，
  而它躺在代码里让人以为问题已经想过。防抖类优化必须问一句「busy 期间会怎样」。
- 防抖和写盘这类基础设施，值得为它单独写一次**对照实验**。这次如果只是
  「加个 .bak 就完事」，根因还在，下次照样丢。

### 验证

`npm run check` exit 0；`npm run build` exit 0；vitest **189 passed（16 files）**
（原 176，新增 save-scheduler 7 项 + backup-recovery 6 项）。
`save-scheduler.test.ts` 用假时钟把「8 分钟连续调度」真跑一遍，断言 flush
发生 >90 次；另有一条断言「空闲突发仍然只写 1 次」，防止上限把防抖优化白拆。
`backup-recovery.test.ts` 全程用临时目录，**不碰用户真实数据**。

### 同批提交：心跳进度 + 传输层重试（`231e179` 之后未提交的部分）

- `task-queue.startTaskHeartbeat()`：区间内线性爬升、永不撞终点（上限 0.97），
  解决「进度条卡在 0% 让人以为死了」。实测轨迹 `1%→3%→7%→…→48%`，跨过
  240s 仍在运行，确认 per-call 超时覆盖生效。
- `callStructuredJson` 接 `heartbeat` / `onHeartbeatStart`，传输层错误自动重试
  一次（退避 1200ms）；`isRetryableTransportError()` **先把不可重试放前面**
  （429/配额/401/403/400），因为真实 429 报错文案里常混着 `fetch failed` 描述，
  顺序反了会把配额问题误判成可重试。

### 仍未解决：约 250 秒处 `fetch failed`

第三轮端到端验证：进度正常爬升 → 44% 时重试（掉回 13%，证明重试真的跑了）
→ 两次尝试分别在约 250s / 320s 被网络层掐断，最终 FAILED at +618s。
**规律稳定复现，不是偶发。** 一次生成 4 话需 5~8 分钟，连续两次都被切断。

这是外部网络/服务商的长连接限制，不是代码 bug。根本解法是把一次生成 4 话
拆成 4 次单话调用（每次约 60~120s），还能逐条校验、中途失败不用重跑前面的——
但这会改变 API 契约与工作流（「一键生成整季」→「逐话生成」），
**属于方向性决策，待用户拍板后再动**。
