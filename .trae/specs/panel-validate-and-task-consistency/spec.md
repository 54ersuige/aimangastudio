# 分镜校验 / 每话出图 / 任务一致性 彻底解决

## Why
当前出图链路有 3 类核心故障，用户频繁遇到：

1. **分镜 description 太短直接 fatal 拒绝**：validatePanel 把 `description.length < 60` 标为 fatal，generatePanelImages 入口直接 throw `分镜校验失败：第 N 格：description 太短 57/60 字…`。LLM 写 50~58 字很常见，少几字就被完全卡死，整页生成不出来。
2. **每话生成图片的"重生成"按钮触发后状态错乱**：用户点 R 重生成，前端轮询 task 状态常常停在 "generating"，明明后端已经写完图，前端却仍报错 / 不刷新。根本原因是 `runTask('page:${pageId}', ...)` 同时被 `panel-generate` 和 `page-generate` 共用，单格重生成把整页锁住；同时单格重生成之间互相 409。
3. **图片任务一致性**：任务结果未落到前端可见的 update 状态 / 任务状态在内存 30 分钟丢失 / 并发重复触发 / 死锁。

## What Changes
- [ ] `validatePanel`：把 `description < 60 字` 降为 `repairable` 而非 `fatal`，新增自动补全路径（LLM 续写到 ≥ 60 字再 generate）。
- [ ] `generatePanelImages`（prompts.ts）：校验失败时调用 `repairShortDescriptions` 补全 description，再重新 validatePage。补全失败时降级为 warning，不再 throw。
- [ ] `task-queue`：task 状态字段保留兼容（status: 'running'|'done'|'error'），同时导出 `progress` 字段供前端进度条。
- [ ] `series-routes/pages.ts`：每格 `panel-generate` 改用 `panel:${pageId}#${idx}` 锁，整页 `page-generate` 继续用 `page:${pageId}` 锁，互不干扰。
- [ ] `series-routes/pages.ts`：所有路径（generate / regenerate / panel-generate / panel-rewrite）成功后明确 `updatePage(..., status:'done', errorMessage:undefined)`，失败明确 `status:'error', errorMessage`，**避免 status 卡死**。
- [ ] `src/services/seriesClient.ts`：pollTask 增加超时（默认 10 分钟），超时则把 task 标记为 lost 并 throw 友好错误，避免 UI 永久转。
- [ ] `src/components/.../PagesOverview.tsx` 等 UI 层：`R 重生成` 点击后立刻把对应 panel 标记为 generating（乐观更新），不需要等 task。

> 不引入新依赖；不修改 API 路径；保持现有 task 协议。

## Impact
- Affected specs: 分镜校验 / 出图链路 / 任务队列
- Affected code:
  - `server/series-store/validate.ts`
  - `server/series-routes/prompts.ts`
  - `server/series-routes/pages.ts`
  - `server/task-queue.ts`
  - `src/services/seriesClient.ts`
  - UI 端 PagesOverview / PagesCard（点击乐观更新）

## ADDED Requirements

### Requirement: description 短文自动补全
The system SHALL automatically extend any panel description shorter than 60 characters to at least 60 characters via LLM continuation, rather than throwing a fatal error and refusing to generate.

#### Scenario: LLM output 45 chars
- **WHEN** validatePanel sees a panel whose description is 45 characters
- **THEN** generatePanelImages calls `repairShortDescriptions(panel, ...)`; if repair yields ≥ 60 chars and the repaired panel passes revalidation, generation proceeds; if repair fails, the panel is logged as warning and generation continues for other panels rather than aborting the whole page.

#### Scenario: 大段修复失败
- **WHEN** all repair attempts fail (LLM down / too short)
- **THEN** page-level error is `description 太短无法生成图像（已尝试自动补全）`, page.status = 'error', UI 红条提示；用户可在编辑面板手动补全后再次点击「重生成」。

### Requirement: per-panel task lock
The system SHALL use distinct task keys per panel so that single-panel regeneration and whole-page regeneration can run concurrently on different panels.

#### Scenario: 多个 panel-generate 并发
- **WHEN** user triggers regeneration on panels 1, 2, 3 in quick succession
- **THEN** each panel's image is regenerated independently without 409 errors; the page status reflects whether all panels have imageUrl.

#### Scenario: 整页 generate 与单格 generate 互不阻塞
- **WHEN** panel-generate for panel 2 is in flight and user clicks "整页 generate"
- **THEN** the page-generate proceeds (different lock key) but does not overwrite panel 2's imageUrl; both finish and page status is computed correctly.

### Requirement: 任务状态一致性
The system SHALL keep the persisted page status in sync with task completion: success → `done`, error → `error`, in-progress → `generating`.

#### Scenario: task 抛异常
- **WHEN** an in-flight task throws
- **THEN** the page is updated to `status: 'error', errorMessage: <message>` and the UI red banner shows the message; subsequent retries work after the user fixes the underlying issue.

#### Scenario: 服务重启
- **WHEN** the server restarts mid-task
- **THEN** on next access, any page with `status: 'generating'` is reset to `status: 'draft'` (or surfaced as "lost connection" so user can re-trigger).

### Requirement: 前端乐观更新
The system SHALL mark a panel/page as regenerating immediately on user click, without waiting for the task to start on the server.

#### Scenario: 用户点 R 重生成
- **WHEN** the user clicks the regenerate button
- **THEN** the UI sets the panel to a loading state within 16ms, then waits for the task to complete; if the task fails, the UI rolls back the optimistic state.

## REMOVED Requirements
*(none)*