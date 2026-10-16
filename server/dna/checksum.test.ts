/**
 * DNA 完整性校验的回归测试（2026-10-16 新增）。
 *
 * 这个测试存在的理由是一次真实事故：
 *   new-yorker-noir.ts（用户主推的画风）长期报 checksum 不一致，
 *   但查下来内容根本没被偷改 —— 是 core.autocrlf=true 让它成了
 *   整个目录里唯一的 CRLF 文件，而 fingerprint() 按原始字节算 sha256。
 *   也就是说：**校验本身是坏的，它报的"内容被改"其实是"行尾不同"。**
 *
 * 第 4 条断言是真正的防复发闸：直接校验仓库里 4 个 DNA 文件的声明与实际。
 * 如果以后有人改了 dna/*.ts 却忘记同步声明，这个测试立刻红 —— 而不是
 * 等到某天启动时在日志角落飘一行 console.error、没人当回事。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { fingerprint, declaredChecksum, verifyDnaSource } from './checksum.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 一段带声明行的样本，模拟真实 DNA 文件结构。 */
const SAMPLE_FP = 'a'.repeat(64);
const SAMPLE = [
  `// @dna-checksum: ${SAMPLE_FP}`,
  'export const DNA = {',
  "  name: 'test',",
  '  positive: ["a", "b"],',
  '};',
].join('\n');

describe('fingerprint —— 平台无关性', () => {
  it('CRLF 与 LF 版本算出同一个哈希（否则同一份内容在两台机器上不通用）', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    expect(fingerprint(crlf)).toBe(fingerprint(SAMPLE));
  });

  it('带 BOM 与不带 BOM 算出同一个哈希', () => {
    expect(fingerprint('\uFEFF' + SAMPLE)).toBe(fingerprint(SAMPLE));
  });

  it('CRLF + BOM 的极端组合也一致', () => {
    const ugly = '\uFEFF' + SAMPLE.replace(/\n/g, '\r\n');
    expect(fingerprint(ugly)).toBe(fingerprint(SAMPLE));
  });

  it('内容真变了哈希必须变（别把归一化写成什么都返回同一个值）', () => {
    const changed = SAMPLE.replace("name: 'test'", "name: 'changed'");
    expect(fingerprint(changed)).not.toBe(fingerprint(SAMPLE));
  });
});

describe('声明行的自我排除', () => {
  it('改声明行本身不会改变指纹（否则校验是自指的死循环）', () => {
    const rewritten = SAMPLE.replace(SAMPLE_FP, 'b'.repeat(64));
    expect(fingerprint(rewritten)).toBe(fingerprint(SAMPLE));
  });

  it('declaredChecksum 能读出声明值', () => {
    expect(declaredChecksum(SAMPLE)).toBe(SAMPLE_FP);
  });

  it('BOM 开头也能读出声明值', () => {
    expect(declaredChecksum('\uFEFF' + SAMPLE)).toBe(SAMPLE_FP);
  });

  it('无声明时返回 null', () => {
    expect(declaredChecksum('export const X = 1;')).toBeNull();
  });
});

describe('仓库内 4 个 DNA 文件的声明 vs 实际', () => {
  const KEYS = [
    'graphic-novel-ink',
    'new-yorker-noir',
    'shonen-vintage',
    'cinematic-realism',
  ] as const;

  for (const key of KEYS) {
    it(`${key}.ts 声明与实际一致`, () => {
      const content = readFileSync(join(HERE, `${key}.ts`), 'utf-8');
      const r = verifyDnaSource(key, content);
      expect(r.declared, `${key} 没有声明 @dna-checksum`).not.toBeNull();
      expect(
        r.actual,
        `${key} 内容与声明不符 —— 声明: ${r.declared} 实际: ${r.actual}。` +
          `若只改了行尾请确认 fingerprint() 仍会归一；若改了正文请同步声明。`
      ).toBe(r.declared);
    });
  }
});
