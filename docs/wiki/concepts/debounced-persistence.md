---
title: 防抖持久化决策
created: 2026-09-01
updated: 2026-09-01
type: concept
tags: [decision, store, refactor]
behavior-change: true
---

# 防抖持久化决策（saveAll 写盘优化）

## 问题
每次数据变更都同步 `JSON.stringify` 全量 + `writeFileSync`，一次页面生成触发多次 save，事件循环反复被阻塞数百毫秒级（随库体积线性恶化）。

## 备选方案对比
| 方案 | 结论 |
|---|---|
| 异步写（writeFile promise）+ 写队列 | 弃：引入异步失败模式与串行化复杂度；stringify 仍同步阻塞 |
| stringify 移入 worker | 弃（当前）：库仅 15KB，收益不抵复杂度；库重回几十 MB 再评估 |
| **防抖 + 定时器内同步原子写（采纳）** | 合并高频写；单线程同步天然无交错；保留 tmp+rename 崩溃安全 |

## 关键约束
- 读路径全部走内存缓存，防抖窗口内读一致性不受影响
- 必须有退出兜底：index.ts 原本无任何信号处理，SIGINT 默认直接杀死进程 → flush 处理器必须装在 store 模块内
- 定时器必须 `unref()`，否则挂起的定时器阻止进程自然退出

## 相关
- [[series-store]]
