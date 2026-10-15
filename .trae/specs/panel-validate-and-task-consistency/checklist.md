# Checklist

- [x] `validatePanel` 把 description 长度问题降为 repairable
- [x] `repairShortDescriptions` 实现：LLM 补全 + 失败降级
- [x] `generatePanelImages` 在 validatePage 失败时调用 repairShortDescriptions，再 revalidate
- [x] `runTask` 单格 generate / rewrite 使用 `panel:${pageId}#${idx}` key
- [x] 整页 generate 仍使用 `page:${pageId}` key
- [x] 出图链路失败时 page.status='error', errorMessage=<msg>
- [x] 出图链路成功时 page.status='done', errorMessage=undefined
- [x] 前端 postTask 默认超时 600s，超时抛 "task lost"
- [x] UI 点击 R 重生成时立即标记 panel 为 generating（乐观更新）
- [x] 启动时 page.status='generating' 不自动改写，提示用户重新触发（pages.ts 现有 409 行为）
- [x] 真实数据：单 panel generate done，imageUrl 写入 + HTTP 200 1.4MB（panel 1：c04fdb82-…png）
- [x] 真实数据：description 补全工作（panel 3/4/5/6 的 57/45/53/57 → 144/126/132/129）
- [x] tsc --noEmit 在改动文件上无新错误
- [x] 后端未引入新依赖