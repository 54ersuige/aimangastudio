/**
 * 孤儿图判定回归测试（2026-10-15）。
 *
 * 这里锁的是**判定规则**，不是 IO。孤儿 GC 会 unlink 用户的图，
 * 判错一条就是不可逆的数据损失 —— 所以规则必须被测住，不能靠"看一眼觉得对"。
 */
import { describe, it, expect } from 'vitest';
import { extractReferencedImages } from './orphan-gc.js';

describe('extractReferencedImages', () => {
  it('抽出 panel.imageUrl 里的图片', () => {
    const json = JSON.stringify({
      chapters: [{ pages: [{ panels: [{ index: 0, imageUrl: '/data/images/aaa.png' }] }] }],
    });
    expect([...extractReferencedImages(json)]).toEqual(['aaa.png']);
  });

  it('抽出角色参考图（字段是 referenceImage / referenceImages[] 都认）', () => {
    const json = JSON.stringify({
      characters: [
        { name: '林澈', referenceImage: '/data/images/lin.png' },
        { name: '赵姐', referenceImages: ['/data/images/zhao.png', '/data/images/zhao2.jpg'] },
      ],
    });
    expect([...extractReferencedImages(json)].sort()).toEqual(['lin.png', 'zhao.png', 'zhao2.jpg']);
  });

  it('去重：同一张图被多个字段引用只算一次', () => {
    const json = JSON.stringify({
      characters: [{ referenceImage: '/data/images/same.png' }],
      chapters: [{ pages: [{ panels: [{ imageUrl: '/data/images/same.png' }] }] }],
    });
    expect(extractReferencedImages(json).size).toBe(1);
  });

  it('对新增字段免疫：只要值长得像图片路径就认出来', () => {
    // 未来新增 character.faceSheet[] / page.backgroundUrl 等字段时不需要改这里
    const json = JSON.stringify({
      characters: [{ faceSheet: ['/data/images/face1.png'] }],
      pages: [{ backgroundUrl: '/data/images/bg.png' }],
    });
    expect([...extractReferencedImages(json)].sort()).toEqual(['bg.png', 'face1.png']);
  });

  it('忽略非 /data/images/ 路径（风格参考图等不在回收范围内）', () => {
    const json = JSON.stringify({
      styleRefs: ['/data/style-refs/new-yorker-noir/ref.png'],
      chapters: [{ pages: [{ panels: [{ imageUrl: '/data/images/real.png' }] }] }],
    });
    expect([...extractReferencedImages(json)]).toEqual(['real.png']);
  });

  it('空 JSON / 无图 → 空集合', () => {
    expect(extractReferencedImages('{}').size).toBe(0);
    expect(extractReferencedImages('').size).toBe(0);
    expect(extractReferencedImages('{"a":1}').size).toBe(0);
  });

  it('嵌套路径不会误把目录名当文件名收进来', () => {
    // 若缺负向前瞻，`/data/images/sub/x.png` 会把 "sub" 收进引用集 ——
    // 它不指向真实文件，却可能挡住一张同名的图不被回收。
    const json = JSON.stringify({ a: '/data/images/sub/dir/x.png' });
    expect(extractReferencedImages(json).size).toBe(0);
  });

  it('带 query 串的图片路径仍算引用（?v=2 是缓存戳，磁盘上的文件就是 a.png）', () => {
    expect(extractReferencedImages('"/data/images/a.png?v=2"').has('a.png')).toBe(true);
  });
});
