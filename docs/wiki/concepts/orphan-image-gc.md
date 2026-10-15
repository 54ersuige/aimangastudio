---
type: concept
created: 2026-10-15
tags: [存储, 数据安全, 清理]
---

# 孤儿图回收

## 根因

`saveDataUrlImage` 每次生成都写一个新 UUID 文件，
而 `deleteStoredImage` 在**生图路径上从来没被调用过**。

于是下列任一情况都会让图永远留在盘上：

- 整页出图中途失败，前面几格已落盘的图从不被写回 `imageUrl`
- 分镜改写 / 章节重建，旧 `pages` 被整体替换，里面的图全部失去引用
- 世界观重生成导致角色参考图被换掉
- 用户删章节 / 删页时没有级联删图

实测该系列：446 张图里 **443 张（663.3 MB）没有任何引用**，占 99.3%。

## 判定：只认唯一事实源

`server/orphan-gc.ts` 只认 `server/data/series-data.json` 里出现的每一个图片路径。
**元数据没有 = 无人引用 = 可回收。**

为什么不用 mtime："多久没被访问"会误删用户正在看、但元数据还没写回的那张图。
时间戳是猜测，元数据是事实。

用正则从 JSON 原文抽 `/data/images/xxx.png`，而不是遍历对象结构 ——
字段路径会随版本变化（`character.referenceImage` / `referenceImages[]` / `panel.imageUrl` …），
正则对新增字段天然免疫：只要值长得像图片路径就会被认出来。

正则末尾的负向前瞻是必需的：否则 `/data/images/sub/x.png` 会把 `sub` 当文件名收进来，
既不指向任何真实文件，又可能意外挡住一张同名的图不被回收。

## 安全约束（不可逆操作）

- **默认 dry-run**，只报告不删 —— 「看一眼」和「真动手」必须是两个明确动作
- 只删 `server/data/images/` 下 png/jpg，文件名必须是纯 `uuid.ext`（防目录穿越）
- 单次上限 `MAX_DELETE_PER_RUN = 500`，超出的下次继续

```bash
npm run gc:orphans              # dry-run：只报告
npm run gc:orphans -- --apply   # 真删
```

## 已知未做

**没有级联删图**。删章节 / 删页时磁盘上的图仍会留下，只能靠 GC 回收。
根治要动 series-store 的删除路径，让它顺带调 `deleteStoredImage` ——
但那会在删数据的同一时刻引入另一处不可逆动作，风险收益比不划算，暂缓。

## 相关

- [[four-gate-fusion]] — 同一次审查发现的另一处浪费（vision 调用）
