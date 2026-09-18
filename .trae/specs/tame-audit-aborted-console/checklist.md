# Checklist

- [x] AuditCard.tsx 的 `/api/audit/drift-score` 与 `/api/audit/dimensions` 都通过 AbortController 跟随步骤取消
- [x] AuditCard.tsx 在 signal.aborted 时不调用 setState
- [x] LegacyBanner.tsx 的 `/api/audit/legacy-list` 通过 AbortController 跟随步骤取消
- [x] 浏览器刷新页面、控制台不再出现 `net::ERR_ABORTED /api/audit/legacy-list`
- [x] 浏览器刷新页面、控制台不再出现 `net::ERR_ABORTED /api/audit/drift-score`
- [x] 切换 seriesId 时旧的 fetch 被取消、新的 fetch 正常返回并更新 UI
- [x] 后端未改动（接口行为不变）
- [x] tsc --noEmit 在改动文件上无新错误