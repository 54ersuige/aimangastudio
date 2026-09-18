// 合并两个数据源（dist/data 里的测试系列 + server/data 里的"老油条"）到一个权威位置。
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';

const DIST_DATA = 'D:/26_Agent_Project/AI_comic/server/dist/data/series-data.json';
const SRC_DATA = 'D:/26_Agent_Project/AI_comic/server/data/series-data.json';

const distArr = JSON.parse(readFileSync(DIST_DATA, 'utf-8'));
const srcArr = JSON.parse(readFileSync(SRC_DATA, 'utf-8'));

console.log('dist/data has:', distArr.length, distArr.map(s => s.title));
console.log('server/data has:', srcArr.length, srcArr.map(s => s.title));

// 合并（按 id 去重）
const merged = [...srcArr];
for (const d of distArr) {
  if (!merged.find(m => m.id === d.id)) merged.push(d);
}
console.log('merged:', merged.length, merged.map(s => s.title));

writeFileSync(SRC_DATA, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
console.log('written to', SRC_DATA);