# 话（Episode）= 最小创作/发布单位

> 2026-09-02 行为变更。用户决策：「我要的最小单位就是话，每话的每格可以单独生成。」

## 模型

- **话（Chapter）** = 发布单元（≈15 格，一件完整的事），UI/导出/预览的全部主语。
- **批（Page，内部名）** = 内部 6 格一批的生成批次，**不进入任何用户可见文案**（UI 上只以「第 a–b 格」批次分隔条出现）。
- **格（Panel）** = 独立可操作的生成单位：可单独生成/重掷、AI 改写、手改文字。

## 后端变更（server/series-routes/pages.ts）

1. `POST /pages/:pageId/generate` 改为**增量语义**：只画缺失格（`!imageUrl`），已有图不动；全部已有图时返回 400「本批分镜图已齐全」。整批重画走原有 `regenerate`。
2. 新增 `POST /pages/:pageId/panels/:panelIndex/generate`：单格（重）生成。不改文字；已有图视为重掷。任务键复用 `page:{pageId}`（同页互斥）；**不整页置 generating**（避免其余格显示"生成中"），完成后按"是否全部格有图"收敛 status（done/draft）。

## 前端变更

- `seriesClient.generatePanel` + SeriesContext `generatePanelInCurrent` 等 7 个显式 pageId action（breakdownPageInCurrent / generatePageInCurrent / regeneratePageInCurrent / rewritePageInCurrent / rewritePanelInCurrent / continuePageInCurrent / generatePanelInCurrent）。
- 原 `*SelectedPage` 系 action 保留为兼容包装（AgentWorkbench agent 桥 + 快捷键仍依赖 selectedPageId）；`pickEpisode` 选话时把 selectedPageId 同步到该话第一批。
- `PageCard.tsx` 删除，新 `EpisodeCard.tsx`：话选择器（前后翻话）、整话格列表跨批合并、**格号整话连续**、每格独立操作、批次分隔条挂高级操作（手动编辑/重拆/重画/整批改写）。
- `PagesOverview.tsx` 重写为 `EpisodesOverview`（话级总览卡：全局话号 + 进度）。
- 话号**全局连续**（跨章/季）：ChaptersCard ArcBlock 用 `episodeOffset`、EpisodePreview 用 allChapters 全局 index。
- 导出收敛：`exportSeriesAsStrips`/`exportPageAsStrip`（旧页级版式）删除；新增 `exportSeriesAsEpisodeStrips(series)`，顶栏「导出全部」与 AgentWorkbench「导出」都走它（每话一张话级长图）。`EpisodeStripInput` 增加 `isLastEpisode`（页脚 全篇完/未完待续）。

## 已知注意点

- `handleGenerateAllMissing` 逐批串行调用增量 generate，一批失败即停（保留已生成部分）。
- 单格生成期间前端用本地 `panelBusy` 指示该格 spinner；后端 status 不动。
