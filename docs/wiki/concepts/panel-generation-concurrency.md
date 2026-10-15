---
title: 出图并发与失败隔离
created: 2026-10-15
updated: 2026-10-15
type: concept
tags: [server, prompt, decision, regression]
behavior-change: true
verified: "npm run check exit 0；npx vitest run 54 passed；npm run build exit 0"
---

# 出图并发与失败隔离

## 决策

出图并发数取 **3**（用户拍板）。取 3 而不是更高：每格最坏 3 轮 × 5 次模型调用，
并发越高同时打出去的上游请求越多，429 限流与「多张同时失败要重烧的钱」都线性上升。
3 是「明显提速」与「不打爆限流」的折中。值集中在
`prompts.ts` 的 `DEFAULT_PANEL_CONCURRENCY`，设 `concurrency: 1` 可退回串行排查。

## 为什么原来是串行的

`generatePanelImages` 的循环体从第一天就是 `for (const panel of sorted)`。
每格最坏 16 次外部调用（1 次文本抽取 + 3 轮 × 5 次），6 格整页最坏 ~96 次、
**最坏 72 分钟**，而前端 `postTask` 总超时是 10 分钟 —— 用户看到失败，后端还在烧钱。

**关键认知**：「用户看不到进度」不是 UI 问题，是后端根本没在并发跑。
第 1 格没画完前 progress 必然是 0，把进度条做出来也没用。

## 三条硬约束

1. **保序**：`paths` 与入参 `panels` 同序等长。4 个调用点普遍用 `paths[i]` 对应
   `panels[i]` 写回 `imageUrl` —— 顺序错了就是张冠李戴。
   `mapConcurrent` 按**下标**回填而非按完成顺序 push，就是为了保证这点。
2. **失败隔离**：一格失败不得中断整批。返回值刻意用
   `{ paths: (string|null)[], failures: PanelGenFailure[] }` 而不是 `T | Error` 混合数组 ——
   后者会让每个调用点都要写 `instanceof` 判断，漏一处就把 Error 当正常结果传下去了。
3. **全灭才抛**：部分失败时成功的格必须写回。抛错的唯一合法场景是一无所获。

## 共享状态为什么安全

循环体唯一跨格共享的是 `appendPanelAudit`，它用 `appendFileSync`（同步调用）。
Node 单线程下同步调用天然原子，并发写 jsonl 不会交错。
`resolveImageData` / `saveDataUrlImage` 同理（`readFileSync` / `writeFileSync`）。

## 失败文案是有功能的

`describePanelFailures` 不是日志，是**用户决策依据**。必须明说
"成功几格已保留、可只重试失败的格，不必重画整批" —— 否则用户看到红色报错
会以为整页白跑，把已经付过钱的图重画一遍，正是这次改造要避免的行为。
回归测试 `panel-failure-message.test.ts` 锁的就是这句承诺。

## 进度链路曾经两头都断

`setTaskProgress` 定义了零调用点，前端 `onProgress` 定义了零传入 —— 两端各自单测都过，
串起来什么都不发生。现链路：`runTask(…, taskId)` → `mapConcurrent.onSettled`
→ `setTaskProgress` → HTTP `progress` → `postTask.onProgress` → `SeriesContext.taskProgress`
→ `EpisodeCard`。回归测试 `panel-gen-progress.test.ts` 按整条链路断言（0→100、单调不回退）。

**教训**：加字段必须同时改「生产者 + 传输 + 消费者」三处，漏一处不会报错、只会静默空转。

## 前端超时曾经是假的

`postTask` 轮询的 fetch 无 `AbortController`，超时检查在循环顶部。
请求一挂住 `await` 永不返回 → 检查永远轮不到 → UI 无限转圈。
现已给单次轮询加 `AbortSignal.timeout(20s)`，且单次查询抖动不再终止整个任务
（只有"任务不存在/服务重启"才放弃），真正的兜底交给总超时 + 真实 progress。

## 并发原语为什么用「抢下标」而非分片

分片（`items.slice(i*limit, (i+1)*limit)` 给每个 worker）在任务耗时不均时严重拖尾 ——
一个 worker 干等它那条最慢的。抢下标（`const index = next++`）只要有空闲立刻拿下一个，
尾延迟明显更短。`next++` 到读取之间没有 `await`，Node 单线程下天然原子，无需锁。

相关：[[episode-unit-model]]、[[series-routes]]
