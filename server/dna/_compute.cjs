// 一次性脚本：计算 3 个 DNA 文件的 checksum 并打印（开发者在改完 DNA 后手动跑）
const fs = require('fs');
const c = require('crypto');
const path = require('path');
const ROOT = path.resolve(__dirname);
const KEYS = ['new-yorker-noir', 'shonen-vintage', 'cinematic-realism'];
for (const k of KEYS) {
  const t = fs.readFileSync(path.join(ROOT, k + '.ts'), 'utf-8');
  const body = t.split('\n').filter(l => !/^\s*\/\/\s*@dna-checksum:\s*[0-9a-f]{64}\s*$/.test(l)).join('\n');
  const h = c.createHash('sha256').update(body, 'utf-8').digest('hex');
  console.log(`${k}\t${h}`);
}