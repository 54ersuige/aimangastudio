---
title: DNA 完整性校验的三个缺陷 —— 它报的「内容被改」其实是「行尾不同」
created: 2026-10-16
updated: 2026-10-16
type: concept
tags: [dna, decision, regression, known-issue]
behavior-change: true
verified: "server/dna/checksum.test.ts 12 项通过 · verifyAllDna() 4 文件 + 4 镜像全 OK"
---

# DNA checksum：告警是真的，但报错了原因

> 用户 2026-10-16：「这个风格是我主推的，要修复好。」

`new-yorker-noir`（用户主推的画风）从 2025-09 起就一直报
`⚠ DNA 文件 checksum 不一致`。四个 DNA 里只有它报，另外三个都 OK。

## 先查行尾，再下结论

直觉上「只有它坏」= 「它的内容被偷改了」。**这是错的。**

| 文件 | 行尾 | 声明 | 实算 | 结果 |
|---|---|---|---|---|
| graphic-novel-ink | LF (355) | 1a40b7bd… | 1a40b7bd… | OK |
| shonen-vintage | LF (390) | f3ba7634… | f3ba7634… | OK |
| cinematic-realism | LF (432) | 442594c9… | 442594c9… | OK |
| **new-yorker-noir** | **CRLF (511)** | 16f45435… | 05658a0b… | **MISMATCH** |

**它是整个目录里唯一的 CRLF 文件。** 仓库 `core.autocrlf=true` 且没有 `.gitattributes`，
同一个文件在 Windows 检出是 CRLF、在 Linux 检出是 LF，
而 `fingerprint()` 按**原始字节**算 sha256 —— 于是同一份内容在两台机器上算出两个哈希。

更关键的一步：把 CRLF 归一后再算，得到 `f64dc6cd…`，**和声明的 `16f45435…` 仍然不符**。
所以这里有**两个独立问题**叠在一起：

1. 校验本身对行尾敏感 → 报的是「行尾不同」，不是「内容被改」（误报机制）
2. 声明值本身已经失效 → 内容确实变过（真问题）

## 内容变的是什么：是好的

`git diff b387210 0f1c7f6` 显示 224 行新增，全是带日期的复盘改进：

```
+ 幽默定位（Style Bible V1.0 融合）：New Yorker 式的幽默是"观察型"而非"表演型"
+ // 2026-08-31 复盘补充：玻璃幕墙/晨光反射类场景描述会把模型拽进摄影分布
+ // 2026-09-03 复盘：角色参考图出现「多胳膊」—— 手里拿保温杯时无肢体负面约束
+ 'extra arms', 'extra hands', 'too many fingers', ...
+ [STYLE LOCK — HIGHEST PRIORITY]
```

**没有损坏，是有人认真调过但忘了同步声明。**
所以处理方式是**补齐完整性元数据**，不是回滚内容 —— 回滚等于把用户的画风改进扔掉。

## 三个缺陷

### 1. `fingerprint()` 对行尾与 BOM 敏感

完整性校验必须**跨平台一致**，否则它报的是环境差异而不是内容差异。

```ts
.replace(/^\uFEFF/, '')   // 去 BOM
.replace(/\r\n/g, '\n')   // 归一行尾
```

`declaredChecksum()` 同样要去 BOM，否则带 BOM 的文件读不出声明。

### 2. 声明值失效，且**从来没有对过**

`b387210`（声明 800b15ee / 实算 cddeff21）和 `0f1c7f6`（声明 16f45435 / 实算 f64dc6cd）
两个提交**都不匹配**。说明这个校验从加进来那天起，对这个文件就没起过作用。

### 3. `DNA_DOCS_PATHS` 是死代码 —— 承诺的检查根本没写

`checksum.ts` 的头注释写着：

> 同样的算法对每个 .md 镜像重算，并对比 .ts 的内容指纹——保证两份"一对"。

全项目 grep `DNA_DOCS_PATHS`：**只有定义处一个命中，零调用**。
`verifyAllDna()` 只读 `.ts` 文件。**.ts 与 .md 漂移是完全不可检测的**
——而那正是这套机制宣称的用途。

> 注：逐字比对 .md 与 .ts 本来就做不到（前者散文、后者代码）。
> 真正能实现且有用的是「镜像存在且非空」——至少保证镜像丢了会有人知道。
> 内容是否同步仍靠人工 review，所以注释也一并改成实话。

## 改动

| 文件 | 改动 |
|---|---|
| `server/dna/checksum.ts` | `fingerprint()` 归一行尾+BOM；注释改为实话 |
| `server/dna/registry.ts` | 新增 `verifyDnaMirrors()`，由 `verifyAllDna()` 调用；接上死代码 |
| `server/dna/*.ts` (4 个) | 重算并写回正确声明；new-yorker-noir 行尾归一为 LF |
| `.gitattributes` | **新建**——固定行尾，防止再次漂移 |
| `server/dna/checksum.test.ts` | **新建**，12 项 |

## 测试锁的是性质，不是字符串

```ts
it('CRLF 与 LF 版本算出同一个哈希', () => {
  expect(fingerprint(SAMPLE.replace(/\n/g, '\r\n'))).toBe(fingerprint(SAMPLE));
});
it('内容真变了哈希必须变（别把归一化写成什么都返回同一个值）', () => {
  expect(fingerprint(changed)).not.toBe(fingerprint(SAMPLE));
});
```

第二条尤其重要：只写第一条的话，把 `fingerprint()` 改成恒返回常量也能绿。
另外每个真实 DNA 文件都有一条「声明 == 实算」断言 ——
以后有人改了 `.ts` 忘同步声明，测试立刻红，而不是等某天启动时
在日志角落飘一行 `console.error`、没人当回事。

## 结果

```
✓ graphic-novel-ink  ✓ new-yorker-noir  ✓ shonen-vintage  ✓ cinematic-realism
✓ 四个 .md 镜像全部存在且非空
```

## 教训

**一个长期报警的检查，先怀疑检查本身。**

如果它报的确实是真问题，那另外三个文件为什么安静？
「只有它坏」很容易读成「它的内容有问题」，
但读成「它是唯一一个落在检查的盲区里」更省事，也更接近真相。

**下一步**：出图效果仍需用户在真实系列上确认。checksum 只能证明
「文件没被偷改」，证明不了「画风好看」——那是另一回事，不该由它背书。

## 相关

- [[chapter-drama-capacity]] — 同一轮发现的另一类问题：同一个量在两处对不上账
- [[review-thresholds-relaxed]] — 同样出自实跑，同样是「规则写在文档里但没进代码」
