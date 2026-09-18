---
title: server/series-store
created: 2026-09-01
updated: 2026-09-01
type: entity
tags: [server, store, refactor]
behavior-change: true
verified: "npx tsc (server) exit 0 + 临时脚本行为验证 3 PASS（防抖/flush/删除恢复）"
---

# server/series-store

## 职责
系列数据持久层。内存缓存为唯一读源，磁盘只做持久化。

## 本次重构前已具备（勿重复"优化"）
内存缓存、原子写（tmp+rename）、图片落盘、全局页码、崩溃恢复、模块定位路径。详见文件头部注释。

## 本次变更：防抖写盘（行为变更）
- `saveAll` 不再立即写盘：标记 pending + 800ms 防抖定时器（`unref` 不阻退出）
- 定时器到点仍用**同步原子写**（放弃异步写方案：单线程同步无交错、无异步失败模式，合并效果相同）
- `flushSeriesStore()` 导出，幂等；`beforeExit`/`SIGINT`/`SIGTERM` 兜底 flush
- 效果：一次页面生成的 N 次变更合并为 1 次写盘；事件循环阻塞从"每变更一次"降为"每 800ms 窗口至多一次"
- 代价：进程被 SIGKILL/断电时可能丢失最后 800ms 内的变更（读路径走内存缓存，不受影响）

## 验证
- tsc exit 0
- 临时脚本行为验证（已删）：写入后 100ms 文件未变（防抖生效）→ flush 立即落盘 → 删除+flush 后文件恢复原状，3 PASS
- 数据库操作全程有备份（$TEMP/series-data.backup.json），验证后已还原

## known-issue
- 数据库当前仅 15KB（图片已落盘），防抖收益随 JSON 增长而增大；若未来库重回几十 MB，可再评估 stringify 移入 worker

## 相关
- [[series-routes]]（调用方）· [[debounced-persistence]]（决策依据）
