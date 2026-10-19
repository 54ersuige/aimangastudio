/**
 * 备份恢复行为测试（2026-10-19 新增）。
 *
 * recoverFromBackup 用临时目录跑，**绝不碰用户的真实 series-data.json**。
 * 覆盖三种该做的和两种不该做的：
 *   该做：主库缺失 → 恢复；主库损坏 → 恢复
 *   不该做：主库是合法但为空（用户真删光了）→ 不回滚；.bak 自己也坏 → 不乱写
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { recoverFromBackup } from '../series-store.js';

let dir: string;
let main: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'series-bak-'));
  main = join(dir, 'series-data.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const good = JSON.stringify([{ id: 'a', title: '加油啊' }, { id: 'b', title: '呜呜呜' }], null, 2);

describe('备份恢复 —— 主库缺失或损坏时从 .bak 拉回', () => {
  it('主库缺失 → 从 .bak 恢复', () => {
    writeFileSync(`${main}.bak`, good, 'utf-8');
    expect(existsSync(main)).toBe(false);

    const r = recoverFromBackup(main);
    expect(r.recovered).toBe(true);
    expect(r.seriesCount).toBe(2);
    expect(JSON.parse(readFileSync(main, 'utf-8')).map((s: { title: string }) => s.title)).toEqual(['加油啊', '呜呜呜']);
  });

  it('主库损坏（截断的 JSON）→ 从 .bak 恢复', () => {
    writeFileSync(`${main}.bak`, good, 'utf-8');
    writeFileSync(main, '[{"id":"a","tit', 'utf-8'); // 半截 JSON

    const r = recoverFromBackup(main);
    expect(r.recovered).toBe(true);
    expect(JSON.parse(readFileSync(main, 'utf-8'))).toHaveLength(2);
  });

  it('主库合法但为空数组 → 绝不回滚（用户可能真的删光了）', () => {
    writeFileSync(`${main}.bak`, good, 'utf-8');
    writeFileSync(main, '[]', 'utf-8');

    const r = recoverFromBackup(main);
    expect(r.recovered).toBe(false);
    expect(JSON.parse(readFileSync(main, 'utf-8'))).toEqual([]); // 保持空，不被 .bak 污染
  });

  it('.bak 自己也损坏 → 不乱写主库', () => {
    writeFileSync(`${main}.bak`, '{ broken', 'utf-8');
    writeFileSync(main, '[{"id":"live"}]', 'utf-8');

    const r = recoverFromBackup(main);
    expect(r.recovered).toBe(false);
    expect(JSON.parse(readFileSync(main, 'utf-8'))).toHaveLength(1); // 主库原样保留
  });

  it('.bak 存在但主库缺失、且 .bak 不是数组 → 放弃恢复而不是写坏文件', () => {
    writeFileSync(`${main}.bak`, '{"not":"an array"}', 'utf-8');

    const r = recoverFromBackup(main);
    expect(r.recovered).toBe(false);
    expect(existsSync(main)).toBe(false); // 没有制造出一个假的空库
  });

  it('完全没有 .bak 时安静跳过', () => {
    writeFileSync(main, '[]', 'utf-8');
    expect(recoverFromBackup(main)).toEqual({ recovered: false, seriesCount: 0 });
  });
});
