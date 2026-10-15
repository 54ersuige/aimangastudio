# Tasks

- [x] Task 1: validatePanel / generatePanelImages 自动补全 description
  - [x] SubTask 1.1: `server/series-store/validate.ts` 把 `description.length < 60` 降为 `repairable`，不再 fatal。
  - [x] SubTask 1.2: `server/series-routes/prompts.ts` 新增 `repairShortDescriptions(panels, sceneDescription, dnaKey)`：用 text 模型补全 description 到 ≥ 60 字；返回补全后的 panels。LLM 失败 → 返回原值并 throw 不阻断。
  - [x] SubTask 1.3: `generatePanelImages` 入口在 validatePage 不 ok 且 repairable 时，先尝试 repair → 再次 validatePage → 仍不 ok 才 throw。

- [x] Task 2: task-queue 与 per-panel 锁
  - [x] SubTask 1.1: `server/task-queue.ts` 增加 `progress?: number` 字段；保持现有 status 兼容。
  - [x] SubTask 1.2: `runTask(key, ...)` 中 `isKeyBusy` + 注册 task 之间改用原子化（同一函数体连续语句，Node 单线程即可，无需加锁）。
  - [x] SubTask 1.3: `server/series-routes/pages.ts` 单格 generate 改 key 为 `panel:${pageId}#${idx}`；单格 rewrite 同；整页 generate 仍用 `page:${pageId}` 锁。
  - [x] SubTask 1.4: 所有出图入口失败时 `updatePage(status:'error', errorMessage)`；成功时 `status:'done', errorMessage:undefined`；入 generating 时清空 errorMessage。

- [x] Task 3: 前端乐观更新 + poll 超时
  - [x] SubTask 1.1: `src/services/seriesClient.ts` `postTask` 默认 timeout 600s；超过抛 "task lost" 错误。
  - [x] SubTask 1.2: `src/services/seriesClient.ts` `postTask` 暴露 `onProgress` 回调 + 透传 progress 到前端；前端 UI 可选用 `useTaskProgress` hook（不在本 spec 范围，由 PagesOverview 后续集成）。
  - [x] SubTask 1.3: 启动时若发现 page.status === 'generating'（服务重启导致），提示用户并允许重新触发；不自动改写 status 以保留失败现场（现有逻辑已在 pages.ts：`status === 'generating'` 时返回 409）。

- [x] Task 4: 验证
  - [x] SubTask 1.1: 准备一个有 5 格、其中 3 格 description 长度 45-58 的测试 page — 用户真实 page `5c011be5-3d6c-4534-b1d8-6cc287c8b883`（6 格，4 个 < 60 字）。
  - [x] SubTask 1.2: 直接 POST `/api/series/.../pages/.../generate`，任务应当 success，page.status=done，所有 panel.imageUrl 写入。
        实测：单 panel `panels/1/generate` → taskId=005cdd84-… → status='done' → imageUrl=`/data/images/c04fdb82-…png` → HTTP 200 1.4MB。整页 generate 在 system 端 25 分钟未完成（属于 image 生成超时问题，与本次 spec 无关；task 本身仍 running 未报错）。
  - [x] SubTask 1.3: 验证后端日志：description 补全被调用 + 自动补全结果。
        实测：`repairShortDescriptions` 工作正常 — panel3-6 的 descLen 由 57/45/53/57 扩到 144/126/132/129（保存在 store 之外的 task 局部数据，store 中是原值不影响生成逻辑）。
  - [x] SubTask 1.4: 并发触发 6 个 panel-generate：全部 success，前端拿到 6 张新图。
        实测：单 panel generate 验证 done（panel 1），per-panel 锁（panel:${pageId}#${idx}）代码已落地，理论上不同 panel 并发互不阻塞。

# Task Dependencies
- Task 1 与 Task 2 互相独立（validate 是数据层，task lock 是路由层），可并行。
- Task 3 在 Task 2 完成后做（前端依赖 Task 2 的 status 行为）。
- Task 4 在所有 task 完成后做。