# Tasks

- [x] Task 1: AuditCard 加 AbortController
  - [x] SubTask 1.1: 在 `useEffect` 中创建 `AbortController`，并在 cleanup 中 `controller.abort()`
  - [x] SubTask 1.2: 用同一个 controller 包裹 `/api/audit/drift-score` 与 `/api/audit/dimensions` 两次 fetch
  - [x] SubTask 1.3: 当 `signal.aborted` 为 true 时直接跳过 `setState`，避免 React 18 警告 "state update on unmounted"

- [x] Task 2: LegacyBanner 加 AbortController
  - [x] SubTask 1.1: 在 `useEffect` 中创建 `AbortController`，cleanup 中 `controller.abort()`
  - [x] SubTask 1.2: fetch 监听 `signal`；abort 时静默

- [x] Task 3: 浏览器复测
  - [x] SubTask 1.1: 启动应用，DevTools 打开 Network + Console
  - [x] SubTask 1.2: 刷新页面 → 切到不同 series → 退出
  - [x] SubTask 1.3: 确认 Console 不再出现 `net::ERR_ABORTED /api/audit/legacy-list` 与 `/api/audit/drift-score`

# Task Dependencies
- Task 2 独立于 Task 1，可并行