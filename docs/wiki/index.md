# Wiki Index

> AI_comic 重构知识库。每页一行摘要。查任何模块前先读这里。
> Last updated: 2026-09-02 | Total pages: 7

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

## Verification
<!-- 验证记录 -->
