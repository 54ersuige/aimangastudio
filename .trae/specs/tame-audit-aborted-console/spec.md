# 静默审计接口的 ERR_ABORTED 控制台噪音

## Why
启动 UI 时，浏览器开发者工具会重复打印两条 `net::ERR_ABORTED`：
- `GET /api/audit/legacy-list`（来自 `LegacyBanner.tsx`）
- `GET /api/audit/drift-score?seriesId=...`（来自 `AuditCard.tsx`）

后端接口本身是 200 的（已实测），错误来自浏览器在 React 18 StrictMode 双调用 / Vite HMR 触发的 fetch abort。这并不影响功能，但会污染用户控制台、掩盖真正的错误。

## What Changes
- [ ] **AuditCard.tsx**：使用 AbortController 跟随步骤取消 `fetch('/api/audit/drift-score')` 和 `fetch('/api/audit/dimensions')`；在 cleanup 中 `controller.abort()`。
- [ ] **AuditCard.tsx**：避免在组件首次渲染时一次性发两个串行调用 → 改为按 seriesId 准备好后用一次 `Promise.all` 触发，并在 abort 时不抛错。
- [ ] **LegacyBanner.tsx**：使用 AbortController 跟随步骤取消 `fetch('/api/audit/legacy-list')`。
- [ ] **保持后端不变**：现状 200 是对的，只是前端没正确处理 abort。

> 不引入新依赖；不修改后端协议；保持现有 UI 行为不变。

## Impact
- Affected specs: 控制台噪音 / 审计 UI
- Affected code:
  - `src/components/series-workbench/AuditCard.tsx`
  - `src/components/series-workbench/LegacyBanner.tsx`

## ADDED Requirements
### Requirement: 审计接口请求跟随步骤 abort
The system SHALL cancel in-flight audit fetches when the component unmounts or when its seriesId changes, so that StrictMode double-invoke / Vite HMR no longer surfaces as `ERR_ABORTED` in the browser console.

#### Scenario: 组件卸载
- **WHEN** the user navigates away or React unmounts AuditCard / LegacyBanner during their first request
- **THEN** the pending fetch is aborted, no console `ERR_ABORTED` is emitted, and no unhandled rejection is logged

#### Scenario: seriesId 切换
- **WHEN** the user switches to a different series while the previous request is still pending
- **THEN** the previous request is aborted before the new one is issued; the new request resolves normally

## REMOVED Requirements
*(none)*