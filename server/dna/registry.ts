/**
 * DNA 预设注册表 —— 系统级"风格注册中心"。
 *
 * 设计原则（架构审查要求）：
 *  - 三套 DNA（new-yorker-noir / shonen-vintage / cinematic-realism），
 *    用户可切换但**不自定义**；不允许运行时拼接多套 DNA（防风格漂移）。
 *  - 每个 Series 在创建时锁定一个 dnaKey，**创建后不可改**；
 *    改 DNA 等于重画全部页面，本系统不提供该功能。
 *  - 注入路径唯一：routes.ts / series-routes.ts 通过 withDna{Image,Text}Prompt
 *    调用本注册表的 getDna(key) 取出对应 DNA，不允许绕开。
 *
 * 启动行为：
 *  - verifyAllDna() 在 index.ts 启动时执行一次；
 *    发现声明 checksum 与实际不符 → console.error 警告（不阻断）。
 *  - 若 key 拼写错（路由调用了一个未注册 key）→ 抛错，绝不静默回退。
 *
 * 人类可读 .md 镜像：
 *  - docs/style-dna/new-yorker-noir.md
 *  - docs/style-dna/shonen-vintage.md
 *  - docs/style-dna/cinematic-realism.md
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as newYorkerNoir from './new-yorker-noir.js';
import * as shonenVintage from './shonen-vintage.js';
import * as cinematicRealism from './cinematic-realism.js';
import { verifyDnaSource, type DnaVerifyReport } from './checksum.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
// registry.ts 自身在 server/dna/，所以「上层」就是 server 目录。
// 注意：之前用 SERVER_DIR + 'dna/xxx' 会变成 server/dna/dna/xxx（双层），
// 正确路径是 SERVER_DIR 的「父目录 + dna/xxx」。
const FILES_DIR = join(SERVER_DIR, '..');
const REPO_ROOT = join(SERVER_DIR, '..', '..');

/**
 * 系统支持的 DNA key 列表（单一事实来源）。
 * 顺序即为前端 UI 展示顺序。第一个即为默认值。
 */
export const DNA_KEYS = ['new-yorker-noir', 'shonen-vintage', 'cinematic-realism'] as const;
export type DnaKey = typeof DNA_KEYS[number];

/** 默认 DNA key。新系列、config 中未指定时使用。 */
export const DEFAULT_DNA_KEY: DnaKey = 'new-yorker-noir';

/**
 * 单个 DNA 预设对外暴露的统一形状（编译期强约束）。
 * 所有 DNA 文件必须导出全部这些字段 —— 否则 TS 编译失败。
 */
export interface DnaPreset {
  key: DnaKey;
  /** 中文短名（UI 展示） */
  name: string;
  /** 一句话简介（UI 展示） */
  tagline: string;
  /** 适合的题材类型（前端 tooltip 用） */
  genres: string[];
  /** 导出字段（按固定顺序，dna-inject 会调用） */
  VISUAL_DEFINITION: string;
  VISUAL_KEYWORDS: string[];
  VISUAL_FORBIDDEN: string[];
  IMAGE_NEGATIVE_PROMPT: string;
  IMAGE_SYSTEM_PROMPT: string;
  CHARACTER_HARD_CONSTRAINTS: string;
  COMPOSITION_HARD_CONSTRAINTS: string;
  SCENE_HARD_CONSTRAINTS: string;
  TEXT_VS_IMAGE_RULES: string;
  EXPRESSION_HARD_CONSTRAINTS: string;
  VISUAL_PHILOSOPHY: string;
  STORYTELLING_RULES: string;
  STORYTELLING_TONE_RULES: string;
  IMAGE_SELF_CHECK_ITEMS: Array<{ id: string; question: string; failMeans: string }>;
}

/** 内部 source 形状（key/name/tagline/genres 不在 dna/*.ts 内，由本表补齐）。 */
type DnaSource = Omit<DnaPreset, 'key' | 'name' | 'tagline' | 'genres'>;

const META: Record<DnaKey, { name: string; tagline: string; genres: string[]; source: DnaSource }> = {
  'new-yorker-noir': {
    name: '纽约客·城市叙事',
    tagline: 'New Yorker 单幅 × Tomine 都市写实 × Graphic Novel 文学气质',
    genres: ['都市情感', '生活观察', '公众号长漫', '慢叙事'],
    source: newYorkerNoir as unknown as DnaSource,
  },
  'shonen-vintage': {
    name: '少年漫画·热血复古',
    tagline: '80-90s 少年漫画风——热血 / 友情 / 成长 / 速度感',
    genres: ['热血少年', '运动竞技', '青春羁绊', '冒险成长'],
    source: shonenVintage as unknown as DnaSource,
  },
  'cinematic-realism': {
    name: '电影化写实',
    tagline: '韩国/意大利现实主义电影感——胶片截帧、自然光、人物日常',
    genres: ['家庭剧', '刑侦律政', '医疗现实', '社会派'],
    source: cinematicRealism as unknown as DnaSource,
  },
};

/**
 * 取指定 DNA 预设（运行时主入口）。
 *  - 未知 key → 抛 Error（绝不静默回退到默认——会导致用户预期之外的画风突变）
 *  - 取出的对象是只读快照，调用方不应改其字段
 */
export function getDna(key: string): DnaPreset {
  if (!isValidDnaKey(key)) {
    throw new Error(`Unknown dnaKey: "${key}". Valid keys: ${DNA_KEYS.join(', ')}`);
  }
  const meta = META[key];
  return Object.freeze({
    key,
    name: meta.name,
    tagline: meta.tagline,
    genres: [...meta.genres],
    ...meta.source,
  });
}

export function isValidDnaKey(key: string | undefined | null): key is DnaKey {
  return typeof key === 'string' && (DNA_KEYS as readonly string[]).includes(key);
}

/** 所有 DNA 元数据（供前端 /api/dna 列出）。 */
export function listDna(): Array<Pick<DnaPreset, 'key' | 'name' | 'tagline' | 'genres'>> {
  return DNA_KEYS.map(key => {
    const m = META[key];
    return { key, name: m.name, tagline: m.tagline, genres: [...m.genres] };
  });
}

/**
 * 启动时对每个 DNA .ts 文件做完整性校验。
 * 任何不一致都会 console.error 警告（不抛——避免半夜叫醒用户）。
 * 调用方：server/index.ts 的 startup。
 */
export function verifyAllDna(): DnaVerifyReport[] {
  const files: Array<{ key: DnaKey; path: string }> = [
    { key: 'new-yorker-noir', path: join(FILES_DIR, 'dna', 'new-yorker-noir.ts') },
    { key: 'shonen-vintage', path: join(FILES_DIR, 'dna', 'shonen-vintage.ts') },
    { key: 'cinematic-realism', path: join(FILES_DIR, 'dna', 'cinematic-realism.ts') },
  ];
  const reports: DnaVerifyReport[] = [];
  for (const { key, path: p } of files) {
    if (!existsSync(p)) {
      console.error(`[dna/registry] DNA 文件缺失: ${key} → ${p}`);
      continue;
    }
    const content = readFileSync(p, 'utf-8');
    const r = verifyDnaSource(key, content);
    if (!r.ok) {
      console.error(`[dna/registry] ⚠ DNA 文件 checksum 不一致: ${key}`);
      console.error(`  声明: ${r.declared ?? '(无声明)'}`);
      console.error(`  实际: ${r.actual}`);
      console.error(`  → 该 DNA 可能被未声明地修改过，请人工 review 并跑：node --import tsx server/dna/checksum.ts --write`);
    } else {
      console.log(`[dna/registry] ✓ ${key} checksum OK (${r.actual.slice(0, 12)}…)`);
    }
    reports.push(r);
  }
  return reports;
}

/** 前端 .md 镜像路径列表（开发时核对）。 */
export const DNA_DOCS_PATHS: Record<DnaKey, string> = {
  'new-yorker-noir': join(REPO_ROOT, 'docs', 'style-dna', 'new-yorker-noir.md'),
  'shonen-vintage': join(REPO_ROOT, 'docs', 'style-dna', 'shonen-vintage.md'),
  'cinematic-realism': join(REPO_ROOT, 'docs', 'style-dna', 'cinematic-realism.md'),
};

/** CLI：手动重算并打印 checksum（带 --write 自动写回）。 */
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const write = process.argv.includes('--write');
  for (const key of DNA_KEYS) {
    const p = join(FILES_DIR, 'dna', `${key}.ts`);
    const content = readFileSync(p, 'utf-8');
    const fp = verifyDnaSource(key, content).actual;
    console.log(`${key}\t${fp}`);
    if (write) {
      // 不实现写回逻辑——自动写回易引入合并冲突，建议开发者手贴。
      console.log(`  （请手动将 ${fp} 写入 ${key}.ts 首部的 @dna-checksum 行）`);
    }
  }
}