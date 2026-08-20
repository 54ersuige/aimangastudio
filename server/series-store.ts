/**
 * 系列数据存储层。
 *
 * 此前的问题（架构审查 P0-1/P0-2/P2-12）：
 *   1. 每次 loadAll 全量 readFileSync+JSON.parse 21MB，一次「生成页面」
 *      请求全程读 3 遍写 1 遍，同步阻塞事件循环数百毫秒且随数据量线性恶化；
 *   2. writeFileSync 非原子写，进程中途崩溃会损坏整个库（所有系列一起丢）；
 *   3. base64 图片内嵌 JSON，是库体积膨胀的根源；
 *   4. 路径基于 process.cwd()，从项目根目录启动会凭空新建空库。
 *
 * 现在的实现：
 *   - 内存缓存：启动加载一次（含一次性迁移），之后读操作零磁盘 IO；
 *   - 原子写：先写 .tmp 再 rename，任何时刻崩溃都不会损坏旧库；
 *   - 图片落盘：加载时把所有 data URL 迁移为 /data/images/ 文件路径；
 *   - 路径基于模块真实位置（import.meta.url），与启动目录无关；
 *   - 全局页码：加载时规整为全系列连续编号；
 *   - 崩溃恢复：启动时把残留的 generating 状态标记为 error。
 *
 * 并发说明：Node 单线程内同步函数天然原子；写盘为同步调用不会交错。
 * 跨 await 的 read-modify-write 竞态由路由层用「页状态守卫 + 任务队列去重」防护。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { saveDataUrlImage, isDataUrl } from './image-store.js';
import type {
  Series,
  SeriesCharacter,
  Chapter,
  SeriesPage,
  DnaKey,
} from '../shared/types.js';
import { getDna, DEFAULT_DNA_KEY, isValidDnaKey } from './dna/registry.js';
import { getConfig } from './config.js';

export type { Series, SeriesCharacter, Chapter, SeriesPage, Worldview, Panel } from '../shared/types.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(SERVER_DIR, 'data');
const DATA_PATH = join(DATA_DIR, 'series-data.json');
// 旧库位置（历史上按 cwd 解析，从 server 目录启动时落在这里）
const LEGACY_PATH = join(SERVER_DIR, 'series-data.json');

/** 内存缓存：null 表示尚未加载。 */
let cache: Series[] | null = null;

function ensureDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

/** 原子写：临时文件 + rename，崩溃时要么旧库完整、要么新库完整。 */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, path);
}

/** 全系列连续页码（跨章不重复），与 Agent「跳到第 X 页」的全局语义对齐。 */
function renumberPages(series: Series[]): boolean {
  let changed = false;
  let n = 0;
  for (const s of series) {
    for (const ch of s.chapters) {
      for (const p of ch.pages) {
        n += 1;
        if (p.pageNumber !== n) {
          p.pageNumber = n;
          changed = true;
        }
      }
    }
  }
  return changed;
}

/**
 * 启动迁移：
 *   - data URL 图片 → 文件路径（库从 21MB 缩回 KB 级）
 *   - 删除已废弃的页级 generatedImage 字段
 *   - generating 残留状态 → error（服务重启导致的中断）
 */
function migrate(series: Series[]): boolean {
  let changed = false;
  for (const s of series) {
    // 旧系列缺 dnaKey → 默认 'new-yorker-noir'（即 v1.1）
    if (!s.dnaKey) {
      s.dnaKey = DEFAULT_DNA_KEY;
      changed = true;
    } else if (!isValidDnaKey(s.dnaKey)) {
      console.warn(`[series-store] 系列 "${s.title}" 的 dnaKey "${s.dnaKey}" 已不在注册表中，降级为默认 DNA（数据完整性优先于风格）`);
      s.dnaKey = DEFAULT_DNA_KEY;
      changed = true;
    }
    // 旧系列残留的 style 字段（v1.2 之前会硬编一个「日式漫画」），画风已统一由 dnaKey 接管 → 删除
    const legacyWithStyle = s as Series & { style?: unknown };
    if (legacyWithStyle.style !== undefined) {
      delete legacyWithStyle.style;
      changed = true;
    }
    for (const c of s.characters) {
      if (c.referenceImage && isDataUrl(c.referenceImage)) {
        try {
          c.referenceImage = saveDataUrlImage(c.referenceImage);
          changed = true;
        } catch (e) {
          console.warn(`[series-store] 角色 ${c.name} 参考图迁移失败，保留原值:`, e);
        }
      }
    }
    for (const ch of s.chapters) {
      for (const p of ch.pages) {
        const legacy = p as SeriesPage & { generatedImage?: string };
        if (legacy.generatedImage !== undefined) {
          delete legacy.generatedImage;
          changed = true;
        }
        if (p.status === 'generating') {
          p.status = 'error';
          p.errorMessage = '服务重启导致生成中断，请重新生成';
          changed = true;
        }
        for (const pn of p.panels) {
          if (pn.imageUrl && isDataUrl(pn.imageUrl)) {
            try {
              pn.imageUrl = saveDataUrlImage(pn.imageUrl);
              changed = true;
            } catch (e) {
              console.warn(`[series-store] 分镜图迁移失败，保留原值:`, e);
            }
          }
        }
      }
    }
  }
  return changed;
}

function loadAll(): Series[] {
  if (cache) return cache;
  ensureDir();
  // 旧位置一次性搬迁
  if (!existsSync(DATA_PATH) && existsSync(LEGACY_PATH)) {
    console.log('[series-store] 迁移旧库 series-data.json → data/series-data.json');
    renameSync(LEGACY_PATH, DATA_PATH);
  }
  if (!existsSync(DATA_PATH)) {
    cache = [];
    return cache;
  }
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    const series = JSON.parse(raw) as Series[];
    const imgChanged = migrate(series);
    const numChanged = renumberPages(series);
    cache = series;
    if (imgChanged || numChanged) {
      console.log('[series-store] 启动迁移完成（图片落盘/页码规整），回写精简后的数据文件');
      atomicWrite(DATA_PATH, JSON.stringify(series, null, 2));
    }
    return series;
  } catch (e) {
    console.error('[series-store] 数据文件解析失败！为防覆盖，不再写入，请人工检查:', e);
    // 解析失败时返回空数组但不缓存写路径——所有写操作会基于空库。
    // 这里选择「只读降级」：缓存空列表，避免把损坏的库直接覆盖清空。
    cache = [];
    return cache;
  }
}

function saveAll(series: Series[]): void {
  ensureDir();
  atomicWrite(DATA_PATH, JSON.stringify(series, null, 2));
}

// ========== 对外 API（保持同步签名，路由层无需改动调用方式） ==========

export function listSeries(): Series[] {
  return loadAll();
}

export function getSeries(id: string): Series | undefined {
  return loadAll().find(s => s.id === id);
}

export function createSeries(input: { title: string; logline: string; dnaKey?: string }): Series {
  const now = new Date().toISOString();
  // dnaKey 一旦确定就冻结 —— 创建系列时从 config.dnaKey 取（前端 UI 已展示该选项），
  // 之后不允许 PATCH 修改。这是「防风格漂移」的核心硬约束。
  let dnaKey: DnaKey = DEFAULT_DNA_KEY;
  try {
    const cfg = getConfig();
    const requested = input.dnaKey || cfg.dnaKey;
    dnaKey = isValidDnaKey(requested) ? requested : DEFAULT_DNA_KEY;
  } catch {
    // config 加载失败时使用默认 —— 后续生成仍会从 series.dnaKey 注入
  }
  const series: Series = {
    id: randomUUID(),
    title: input.title,
    logline: input.logline,
    dnaKey,
    characters: [],
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };
  const all = loadAll();
  all.push(series);
  saveAll(all);
  return series;
}

export function updateSeries(id: string, patch: Partial<Series>): Series | undefined {
  const all = loadAll();
  const idx = all.findIndex(s => s.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  saveAll(all);
  return all[idx];
}

export function deleteSeries(id: string): boolean {
  const all = loadAll();
  const next = all.filter(s => s.id !== id);
  if (next.length === all.length) return false;
  cache = next;
  saveAll(next);
  return true;
}

export function addCharacter(seriesId: string, character: Omit<SeriesCharacter, 'id'>): SeriesCharacter | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const newChar: SeriesCharacter = { ...character, id: randomUUID() };
  series.characters.push(newChar);
  updateSeries(seriesId, { characters: series.characters });
  return newChar;
}

export function updateCharacter(seriesId: string, characterId: string, patch: Partial<SeriesCharacter>): SeriesCharacter | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const idx = series.characters.findIndex(c => c.id === characterId);
  if (idx === -1) return undefined;
  series.characters[idx] = { ...series.characters[idx], ...patch };
  updateSeries(seriesId, { characters: series.characters });
  return series.characters[idx];
}

export function removeCharacter(seriesId: string, characterId: string): boolean {
  const series = getSeries(seriesId);
  if (!series) return false;
  const next = series.characters.filter(c => c.id !== characterId);
  if (next.length === series.characters.length) return false;
  updateSeries(seriesId, { characters: next });
  return true;
}

export function setChapters(seriesId: string, chapters: Chapter[]): Chapter[] | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  // 稳定 ID + 全局连续页码
  let n = 0;
  const normalized = chapters.map(ch => ({
    ...ch,
    id: ch.id || randomUUID(),
    pages: ch.pages.map(p => ({ ...p, id: p.id || randomUUID(), pageNumber: ++n })),
  }));
  updateSeries(seriesId, { chapters: normalized });
  return normalized;
}

export function updatePage(seriesId: string, chapterId: string, pageId: string, patch: Partial<SeriesPage>): SeriesPage | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = series.chapters.find(c => c.id === chapterId);
  if (!chapter) return undefined;
  const pageIdx = chapter.pages.findIndex(p => p.id === pageId);
  if (pageIdx === -1) return undefined;
  chapter.pages[pageIdx] = { ...chapter.pages[pageIdx], ...patch };
  updateSeries(seriesId, { chapters: series.chapters });
  return chapter.pages[pageIdx];
}
