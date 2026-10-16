/**
 * DNA 文件自身完整性保护。
 *
 * 问题场景：开发者改了某个 dna/*.ts 的正文，但忘记同步 docs/style-dna/*.md，
 * 或者反过来。两个文件会出现"设计意图"与"实际注入"漂移。
 *
 * 解决：
 *  - 每个 dna/*.ts 文件首部以 `// @dna-checksum: <sha256>` 自我声明一个 checksum
 *    （针对该文件主体内容计算，剔除声明行本身）。
 *  - 启动时 registry 重新计算每个文件的真实 checksum，与声明对比。
 *    不一致 → console.error 警告（不阻断启动——避免半夜叫醒用户）。
 *  - 同样的算法对每个 .md 镜像重算，并对比 .ts 的内容指纹——保证两份"一对"。
 *    （注：逐字比对 .md 与 .ts 是做不到的，前者是散文、后者是代码。
 *      registry 里真正实现的是"镜像存在且非空"检查，见 verifyDnaMirrors()。
 *      内容是否同步仍靠人工 review——这里只保证不会"镜像丢了却没人知道"。）
 *
 *  自动化：dna/registry.ts 在 startup 自动调用 verifyAllDna()。
 *  手动重算脚本（开发者在改完 DNA 后手动跑一次，会打印新的 checksum）：
 *    node --import tsx server/dna/checksum.ts
 */

import { createHash } from 'crypto';

/**
 * 计算单个 DNA 文件正文（剔除所有 `// @dna-checksum:` 声明行）的 sha256。
 * —— 与"声明里写的"对比，若不一致即视为该文件被未声明地修改过。
 *
 * ⚠ 必须归一行尾与 BOM，否则这个校验本身就是坏的：
 * 本仓库 core.autocrlf=true 且没有 .gitattributes，同一个文件在 Windows 检出是
 * CRLF、在 Linux 检出是 LF，原始字节不同 → sha256 必然不同。
 * 那种情况下校验报的是"行尾不同"，不是"内容被改过"，属纯误报。
 * （2026-10-16 实测：new-yorker-noir.ts 是全目录唯一 CRLF 的文件，
 *   三个 LF 文件全部 OK，只有它长期报警——先查行尾再下结论。）
 */
export function fingerprint(content: string): string {
  const body = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^\s*\/\/\s*@dna-checksum:\s*[0-9a-f]{64}\s*$/.test(line))
    .join('\n');
  return createHash('sha256').update(body, 'utf-8').digest('hex');
}

/** 从文件首部提取声明的 checksum（若有），否则返回 null。 */
export function declaredChecksum(content: string): string | null {
  const m = content.replace(/^\uFEFF/, '')
    .match(/^\s*\/\/\s*@dna-checksum:\s*([0-9a-f]{64})\s*$/m);
  return m ? m[1] : null;
}

/** 单个 DNA 文件的校验结果。 */
export interface DnaVerifyReport {
  file: string;
  declared: string | null;
  actual: string;
  ok: boolean;
}

/** 校验一个 DNA TS 文件（声明 vs 实际）。 */
export function verifyDnaSource(name: string, content: string): DnaVerifyReport {
  const actual = fingerprint(content);
  const declared = declaredChecksum(content);
  return {
    file: name,
    declared,
    actual,
    ok: declared === actual,
  };
}