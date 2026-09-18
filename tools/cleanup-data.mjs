// 清理：只保留用户的"老油条"，删掉测试产生的空系列。
import { readFileSync, writeFileSync } from 'fs';

const DATA = 'D:/26_Agent_Project/AI_comic/server/data/series-data.json';
const arr = JSON.parse(readFileSync(DATA, 'utf-8'));
const kept = arr.filter(s => s.id === 'cd70100f-8716-4424-a8bc-0e10a5c38be3');
console.log('before:', arr.length, 'after:', kept.length);
writeFileSync(DATA, JSON.stringify(kept, null, 2) + '\n', 'utf-8');