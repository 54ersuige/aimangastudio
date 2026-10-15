---
type: concept
created: 2026-10-15
tags: [审核, vision, 出图管线, 性能]
---

# 四闸合一

出图后原来有四道闸，各调一次 vision：

| 闸 | 模块 | 输入图 | maxTokens | 内部重试 |
|---|---|---|---|---|
| limb-guard | `server/limb-guard.ts` | 1 张 | 8000 | — |
| gender-audit | `server/limb-guard.ts` | 1 张 | 8000 | — |
| comic-reviewer | `server/audit/comic-reviewer.ts` | 1 + ≤4 参考图 | 16000 | 3 |
| alignment-guard | `server/alignment-guard.ts` | 1 张 | 8000 | — |

**典型 4 次、最坏 6 次调用**，其中 3 次读同一张图、问互相独立的子问题。
推理型视觉模型的开销主要在思考 token —— 把同一张图重读三遍不会让它想得更准，
只是把同一份推理付三遍钱。

`server/panel-gate.ts` 把四块合并为 **1 次调用**（`runPanelGate`），
一次返回肢体 / 性别 / 8 维评分 / 图文对齐。

## 合并的边界：检测合并，修复不动

肢体 **inpaint 局部修补**（`repairLimbRegions`）保留且独立。
理由：局部修补是唯一能保住"已付费的好图"的手段 —— 整张重抽等于再花钱且可能更差。
所以从 `guardedImage` 里把修复逻辑抽成独立函数，检测改由合一闸负责。

`guardedImage` 本身保留，服务角色参考表（`characters.ts`）与风格参考图两条路径。

## 判定规则一字未改

阈值全部集中在 `panel-gate.judgePanel`，与拆分版逐字一致：

- limb：置信度 ≥ 0.6 才算异常（低置信度误报会白丢一张好图）
- gender：`ambiguous` 视为通过，不误判中性角色
- review：`overall < REGENERATE_THRESHOLD(70)` → 重画
- alignment：缺任意 1 项 → 重画；无清单时不参与判定

任一块解析失败 → 该块 `null` → fail-open 视作通过。
四块全解析不出来会打醒目 warn —— 静默放行会掩盖"模型换了返回结构"这类问题。

## 省 token 的三招

1. **一次调用代替四次**（最大头）。
2. **按图片 + 输入指纹缓存**：`buildGateKey` = 图片 hash + 场景/分镜/角色摘要/
   参考图 hash/画风/期望性别/对齐清单/复核模式。刻意把**参考图 hash** 算进去 ——
   D1/D6 是拿参考图比对出来的，换了参考图就换了判分依据。
   少算一项 = 把"参考图已换"的旧结论当新结论，这是最危险的一种缓存错误。
3. **定向复审**：第 2 轮起只让模型重述上一轮"没到 8 分"的维度，
   其余维度由 `previousReview` **继承真实分数**。
   不落到 parser 的"未评分 = 5 分"默认值 —— 否则审计数据被污染，
   而审计的用途恰恰是回答"审核到底有没有用"。

内部重试从 3 次降到 **0 次**（直接调用）。理由：网关偶发空响应确实存在，
但一次调用失败时这张图已经被其余三块判过了；真正的兜底是
"审查失败 → 视作通过 → 图照常落盘"，用户永远不会因为审核失败而拿不到图。

## 唯一回到 2 次调用的路径

肢体异常 → inpaint 修补 → **图变了，四闸必须在新图上重跑**。
否则审计记的是修补前的判断。只在"肢体真的画坏了"时发生。

## 实测

运行时探针（真实 Agnes provider，坏图触发 400）：
`runPanelGate` 捕获异常 → 四块全 null → fail-open → 出图不阻塞。
这条安全属性是设计意图，本次在真实环境验证过，不是只在单测里成立。

## 一处必须写下来的坑：审计变量跨轮残留

`limbGuardResult` / `genderResult` / `reviewResult` / `alignmentResult` 声明在
**重试循环外**（审计落盘在循环之后，引用它们）。

写成 `if (gate.gender) genderAudit = ...` 就会出事：第 1 轮判定"性别不符"，
第 2 轮图已经修好、但闸没回 gender 块，于是**第 1 轮的结论被记在了第 2 轮那张图上** ——
表现为「审计说这张图性别不符，但它其实没问题」。

判定本身不受影响（`judgePanel` 读的是 `gate`），**受影响的只有审计记录**。
但 audit 的存在意义恰恰是回答"审核到底有没有用、重画有没有真的提分"，
被污染的审计比没有审计更糟。

修法不是加一个 `else`，而是把翻译逻辑抽成纯函数 `gateToAuditFields`，
让"每轮全覆盖"由返回类型保证，不依赖谁记得多写一个 else。

## 相关

- [[panel-generation-concurrency]] — 同一条出图链路的并发化
- [[orphan-image-gc]] — 同一次审查发现的存储侧浪费
