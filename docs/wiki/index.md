# Wiki Index

> AI_comic 重构知识库。每页一行摘要。查任何模块前先读这里。
> Last updated: 2026-10-15 | Total pages: 12

## Entities
<!-- 模块页：拆分/重构过的模块 -->

- [[series-routes]] — server 路由层：2209 行单文件拆为聚合层 + 7 模块，等价搬移，路由数对账 32=32
- [[series-store]] — 持久层：新增防抖写盘（行为变更），tsc + 行为验证 3 PASS
- [[frontend-split]] — 前端大组件：SeriesWorkbench 1553→520 + 8 子模块；PublisherModal 保守提取 3 个纯组件

## Concepts
<!-- 决策页：架构决策与行为变更 -->

- [[debounced-persistence]] — saveAll 防抖持久化决策：为何选「定时器内同步原子写」而非异步写
- [[ux-audit-2026-09-01]] — Nielsen 可用性审计：修复 Enter 误触/确认不一致/ESC 缺失/快捷键不可见，含遗留清单
- [[episode-unit-model]] — 话=最小创作/发布单位：page 降为内部批次、单格生成端点、话号全局连续、导出收敛为按话
- [[panel-generation-concurrency]] — 出图并发 3 + 失败隔离 + 进度上线：为何串行是「没进度」的根因、保序与全灭才抛两条硬约束
- [[four-gate-fusion]] — 四道审核闸合并为 1 次 vision 调用：检测合并/修复不动、缓存键为何必须含参考图 hash、定向复审如何不污染审计
- [[orphan-image-gc]] — 443 张图（663MB）无人引用的根因：只认 series-data.json 为事实源、dry-run + 单次上限 500 的不可逆操作护栏
- [[live-run-retro-2026-10-15]] — 合一闸上线后首次实跑抓出两个静默 bug：代码默认值 90s 被运行时配置 30s 盖住导致超时、对齐闸 schema 与模型实际输出不符 15 次全废；fail-open 如何把故障伪装成通过
- [[review-thresholds-relaxed]] — 审核标准下调的决策依据：6 格里 4 格烧满 3 次重试但原图其实合格；review 70→78、对齐缺一→60% 呈现率、肢体 0.6→0.7、重试 3→2

## Verification
<!-- 验证记录 -->

- 地基：`npm run check`（前后端 typecheck，strict）· `npm test`（87 个测试）· `npm run build`
- 防复发静态检查：`server/series-routes/no-duplicate-routes.test.ts` —— 同 method+path 重复注册即失败（曾漏掉一次真实的静默丢字段事故）
- fail-open 运行时实测：真实 Agnes provider 对坏图返 400，`runPanelGate` 捕获后四闸全 null 出图不阻塞
