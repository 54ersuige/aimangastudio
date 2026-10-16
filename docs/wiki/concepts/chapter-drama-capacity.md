---
title: 一话必须有戏剧张力 —— 规划时校验 summary 撑不撑得起它声明的格数
created: 2026-10-16
updated: 2026-10-16
type: concept
tags: [product-decision, prompt, routes, component, known-issue]
behavior-change: true
verified: "npm run check exit 0 · npm run build exit 0 · vitest 117 passed"
---

# 一话必须有戏剧张力

> 用户 2026-10-16 的原话：
> **「每一话都要有一些戏剧张力啊，这样才好，要改的。」**
> 更早的一条纠正同样关键：**「我说错了，是一话一天。」**

## 先把发布模型说对

之前的理解错了：一直以为 page（批次）是发布单位。
用户澄清是 **一话 = 一天 = 一条长图 = 一次发布**。

这一句改写了一切。「每话 12-18 格」因此不是体量审美指标，
而是 **「这一话够不够演完一件有戏剧张力的事」**。
一格就是一个画面点，6 格是最低可演出的动作序列，12-18 格才有转折的余地。

## 病根（真实数据，不是推断）

《加油啊》现有 4 话，summary 字数与 pageCount：

| 话 | summary 字数 | pageCount | 声明容量 | 实际够几拍 |
|---|---|---|---|---|
| 报到 | 104 | 3 | 18 格 | **5 拍** |
| 加班 | 104 | 3 | 18 格 | 5 拍 |
| 哈哈 | 102 | 3 | 18 格 | 5 拍 |
| 十一点 | 101 | 3 | 18 格 | 5 拍 |

决定性的一条：**《报到》的 6 格与 summary 里的 6 句话一一对应，一格不差。**

```
报到 → 电梯玻璃倒影 → 前台递工牌 → 看见靠窗工位 → 周敏扫一眼 → 坐下
```

也就是说 summary 的信息量**只够撑 1 批（6 格）**，容量却预留了 3 批。
剩下 12 格是没有剧情可写的空批次 —— 4 个话全部如此。

## 界面在把「还没填」误报成「不够」

进度显示把「已填 6 格」当成「只规划了 6 格」，于是给出：

> 本话规划 3 批（6 格），低于每话目标 12-18 格 —— 剧情没讲完就点续写

这句话把用户往硬编内容的坑里推：为了凑格数去注水，
而 [[review-thresholds-relaxed]] 刚刚才把审核门槛调低，两个问题正好互相打架。

## 判据：画面点估计，不是数句子

`server/series-routes/chapter-capacity.ts` 是「一话该有多少内容」的唯一判据，
三个规划入口共用同一个函数与同一段 prompt 约束（`CHAPTER_CAPACITY_RULE`）：

- `CHARS_PER_PANEL = 20` —— 每格约 20 字画面描述
- `PANELS_PER_BATCH = 6`
- `PANELS_PER_EPISODE_MIN / MAX = 12 / 18`

**为什么用字数 ÷ 20 估拍数、而不是数句子：**
模型爱写长句（「周敏扫了一眼，靠窗那个工位空着，像是早就给她留的」），
一句能藏三个画面点。数句子会系统性低估，让真正合格的 summary 被误杀。

撑不起就打回重写，返工指令是**可执行的**，不是「写长一点」：

1. 具体字数目标（这 104 字只够 5 拍，需要 18 格）
2. 必须拆出确切数量的画面点
3. 必须有冲突或转折
4. 结尾停在未解决的地方

## pageCount 的四重不一致（此前目标从未被强制）

| 位置 | 原来的范围 |
|---|---|
| `ChaptersSchema` | 1-12 |
| prompt 告诉模型 | 2-6 |
| append 端点 | 2-8 |
| `UpdateChapterSchema` | 2-8 |

**四个地方四个范围。** 结论是「每话 12-18 格」这个目标在规划阶段
**根本没有被强制过** —— 它只是 UI 上的一句提示文字。
现统一为 2-3（12-18 格），`ChapterListZ.pageCount` 同步。

## 按钮语义：同一个动作此前有三种名字

`拆解分镜` / `续写本话` / `续写本话（追加一批）` —— 后端是同一个动作。

而且**本话全满时按钮仍叫「续写本话」，但会去填下一话的第一批**，
名实不符，用户无从察觉。

现在按「本话还剩几个空批次」给准确文案：

- 本话还有空格 → **「拆解第 N 批」**
- 本话全满 → **「进入下一话」**

## 改动清单

| 文件 | 改动 |
|---|---|
| `server/series-routes/chapter-capacity.ts` | 新建，容量判据唯一来源 |
| `server/series-routes/chapters.ts` | 三处规划入口接入规则 + 校验 |
| `server/series-routes/helpers.ts` | `ChapterListZ.pageCount` 统一 2-3 |
| `src/components/series-workbench/EpisodeCard.tsx` | 进度分「规划/已拆解/已出图」+ 按钮语义 |
| `src/components/SeriesWorkbench.tsx` | 传 `onNextEpisode` |
| `tools/capacity-audit.ts` | 新建，拿真实数据验证判据会触发 |

## 验证

- `npm run check` exit 0 · `npm run build` exit 0
- vitest **117 passed**（新增 15 项容量判据测试）
- 真实数据跑 `capacity-audit`：4 话 **全部被判打回**（104 字 → 够 5 拍 / 需 18 格）

判据会触发，说明它不是摆设。

## known-issue

现有 4 话的 summary 生成于新规则之前，**不会被自动改写**
（自动改写 = 悄悄改掉用户写过的剧情，不可接受）。
要让它们撑满 18 格，需要重新规划或手动扩写 summary。
`tools/capacity-audit.ts` 能指出哪些话需要处理。

## 相关

- [[episode-unit-model]] — 话=最小创作/发布单位，本次澄清把「page 是发布单位」纠正了
- [[review-thresholds-relaxed]] — 审核放宽与容量收紧方向相反，会互相打架，见「界面在把『还没填』误报成『不够』」
- [[series-routes]] — `chapters.ts` 属于该模块
