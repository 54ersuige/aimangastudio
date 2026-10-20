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
 *   - 防抖写盘：高频变更合并为 800ms 一次写盘，但**带 5000ms 最长上限**，
 *     连续 busy 时强制落盘（2026-10-19 加，详见 save-scheduler.ts 的事故记录）；
 *   - 备份：每次覆盖前把上一代复制成 .bak，启动时主库缺失/损坏自动从 .bak 恢复；
 *   - 图片落盘：加载时把所有 data URL 迁移为 /data/images/ 文件路径；
 *   - 路径基于模块真实位置（import.meta.url），与启动目录无关；
 *   - 全局页码：加载时规整为全系列连续编号；
 *   - 崩溃恢复：启动时把残留的 generating 状态标记为 error。
 *
 * 并发说明：Node 单线程内同步函数天然原子；写盘为同步调用不会交错。
 * 跨 await 的 read-modify-write 竞态由路由层用「页状态守卫 + 任务队列去重」防护。
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, copyFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { saveDataUrlImage, isDataUrl } from './image-store.js';
import { createSaveScheduler } from './save-scheduler.js';
import type {
  Series,
  SeriesCharacter,
  Chapter,
  Arc,
  SeriesPage,
  DnaKey,
} from '../shared/types.js';
import { getDna, DEFAULT_DNA_KEY, isValidDnaKey } from './dna/registry.js';
import { getConfig } from './config.js';
import { auditCharacter } from './series-store/validate.js';

export type { Series, SeriesCharacter, Chapter, Arc, SeriesPage, Worldview, Panel } from '../shared/types.js';

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

/** 原子写：临时文件 + rename，崩溃时要么旧库完整、要么新库完整。
 *  覆盖前先把当前好库复制成 .bak —— 永远保留「上一代」，
 *  配合 loadAll 的启动恢复，能兜住任何一次写坏/写丢。 */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  } catch (e) {
    // 备份失败不能挡住主写入，否则会从「丢数据」升级成「写不进去」
    console.error('[series-store] 备份 .bak 失败（不影响本次写入）:', e);
  }
  renameSync(tmp, path);
}

/** 全系列连续页码（跨季/跨章不重复），与 Agent「跳到第 X 页」的全局语义对齐。 */
function renumberPages(series: Series[]): boolean {
  let changed = false;
  let n = 0;
  for (const s of series) {
    for (const ch of iterAllChapters(s)) {
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

/** 遍历一个系列里的所有 chapter —— 兼容旧结构（series.chapters）和新结构（series.arcs）。 */
function iterAllChapters(s: Series): Chapter[] {
  if (s.arcs && s.arcs.length > 0) {
    return s.arcs.flatMap(a => a.chapters);
  }
  return s.chapters ?? [];
}

/** 是否已升级到 Arc 结构。 */
function hasArcStructure(s: Series): boolean {
  return Array.isArray(s.arcs) && s.arcs.length > 0;
}

/**
 * 把旧 series（chapters 直接挂顶层）升级为 Arc 结构。
 * 旧 chapter 全部归入一个虚拟「第 1 季」——保持页码、剧情、生成状态完全不变。
 * 升级完后 arcs.length === 1。
 */
function migrateToArcStructure(s: Series): boolean {
  if (hasArcStructure(s)) return false;
  if (!s.chapters || s.chapters.length === 0) {
    // 没 chapter 的新系列：留 arcs=[]
    s.arcs = s.arcs ?? [];
    return false;
  }
  // 把顶层 chapter 全部移到第一个 arc
  const legacyChapters = s.chapters;
  const arc: Arc = {
    id: randomUUID(),
    index: 1,
    title: '第 1 季',
    premise: '（从旧结构迁移而来）',
    plannedChapterCount: legacyChapters.length,
    chapters: legacyChapters.map(ch => ({ ...ch, arcId: undefined })),
  };
  s.arcs = [arc];
  delete s.chapters;
  return true;
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
    // 升级到 Arc 结构（一次性迁移，旧 chapter 归入虚拟「第 1 季」）
    if (migrateToArcStructure(s)) {
      console.log(`[series-store] 系列 "${s.title}" 已升级到 Arc 结构（${s.arcs.length} 季）`);
      changed = true;
    }
    // 补 arcs 字段（新创建但未升级的 series 可能是 arcs=undefined）
    if (s.arcs === undefined) {
      s.arcs = [];
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
      // referenceImages 迁移：
      //   - data URL → 文件
      //   - 旧 referenceImage 单字段 → 合并到 referenceImages（如果后者为空）
      if (!Array.isArray(c.referenceImages)) {
        c.referenceImages = [];
      }
      const cleaned: string[] = [];
      for (const ref of c.referenceImages) {
        if (typeof ref !== 'string' || !ref) continue;
        if (isDataUrl(ref)) {
          try {
            cleaned.push(saveDataUrlImage(ref));
            changed = true;
          } catch (e) {
            console.warn(`[series-store] 角色 ${c.name} referenceImages 迁移失败:`, e);
            cleaned.push(ref);
          }
        } else {
          cleaned.push(ref);
        }
      }
      if (cleaned.length !== c.referenceImages.length) {
        c.referenceImages = cleaned;
        changed = true;
      }
      // 兼容：旧 referenceImage 单字段 + referenceImages 为空 → 把它当作「主视图」放进数组
      if (c.referenceImage && c.referenceImages.length === 0) {
        c.referenceImages = [c.referenceImage];
        changed = true;
      }
    }
    for (const ch of iterAllChapters(s)) {
      for (const p of ch.pages) {
        const legacy = p as SeriesPage & { generatedImage?: string };
        if (legacy.generatedImage !== undefined) {
          delete legacy.generatedImage;
          changed = true;
        }
        if (p.status === 'generating') {
          // 2026-10-20：原来一律标成 error + 「请重新生成」，
          // 但**图其实全出好了** —— 只是进程没了、状态没写回。
          // 一刀切会让用户看到红条以为白跑了，实际上每一格都有图。
          // 所以按「有没有图」区分：有图 → done（真的完成了）；缺图 → error（确实要补）。
          const allHaveImage = p.panels.length > 0 && p.panels.every(pn => !!pn.imageUrl);
          p.status = allHaveImage ? 'done' : 'error';
          p.errorMessage = allHaveImage ? undefined : '服务重启导致生成中断，请重新生成';
          changed = true;
        } else if (
          p.status === 'error'
          && (p.errorMessage ?? '').includes('服务重启导致生成中断')
          && p.panels.length > 0
          && p.panels.every(pn => !!pn.imageUrl)
        ) {
          // 同一件事的历史遗留：已经被上面那条规则标成 error、但图其实全出好了。
          // 只认「服务重启导致」这一种来源 —— 其它 error 是真实的失败，不该被抹平。
          p.status = 'done';
          p.errorMessage = undefined;
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

/**
 * 启动恢复：主库缺失或 JSON 损坏时，从 atomicWrite 留下的 .bak 拉回上一代好数据。
 *
 * 只在这两种情况下介入 —— 主库能正常解析时绝不碰（哪怕它是空的，
 * 那也可能是用户真的删光了，回滚反而制造「删不掉的东西」）。
 * 能兜住「进程被硬杀 + 主库写坏」这一类事故，但兜不住「主库被写成了残缺但合法 JSON」——
 * 那由 saveAll 的 maxWait 上限从源头堵（见 saveAll 注释里的事故记录）。
 *
 * path 参数化是为了能在测试里用临时目录验证，不去动用户的真实数据。
 * @returns 是否发生了恢复，以及恢复回来的系列数。
 */
export function recoverFromBackup(path: string = DATA_PATH): { recovered: boolean; seriesCount: number } {
  const bak = `${path}.bak`;
  if (!existsSync(bak)) return { recovered: false, seriesCount: 0 };
  let bakRaw: string;
  let bakData: unknown;
  try {
    bakRaw = readFileSync(bak, 'utf-8');
    bakData = JSON.parse(bakRaw);
  } catch {
    return { recovered: false, seriesCount: 0 }; // .bak 自己也坏了，没什么可救的，让上层报主库的问题
  }
  if (!Array.isArray(bakData)) return { recovered: false, seriesCount: 0 };

  if (!existsSync(path)) {
    console.warn(`[series-store] ⚠️ 主库缺失，已从 .bak 恢复 ${bakData.length} 个系列`);
    writeFileSync(path, bakRaw, 'utf-8');
    return { recovered: true, seriesCount: bakData.length };
  }
  try {
    JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    console.warn(`[series-store] ⚠️ 主库已损坏，已从 .bak 恢复 ${bakData.length} 个系列`);
    writeFileSync(path, bakRaw, 'utf-8');
    return { recovered: true, seriesCount: bakData.length };
  }
  return { recovered: false, seriesCount: 0 };
}

function loadAll(): Series[] {
  if (cache) return cache;
  ensureDir();
  // 旧位置一次性搬迁
  if (!existsSync(DATA_PATH) && existsSync(LEGACY_PATH)) {
    console.log('[series-store] 迁移旧库 series-data.json → data/series-data.json');
    renameSync(LEGACY_PATH, DATA_PATH);
  }
  recoverFromBackup();
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
    // 2026-09-07 契约层 P4：启动扫描 legacy 角色（缺必填字段），
    // 把清单写到 logs/audit-legacy.jsonl，UI 启动时读取展示顶部红条。
    scanLegacyToLog(series);
    return series;
  } catch (e) {
    console.error('[series-store] 数据文件解析失败！为防覆盖，不再写入，请人工检查:', e);
    // 解析失败时返回空数组但不缓存写路径——所有写操作会基于空库。
    // 这里选择「只读降级」：缓存空列表，避免把损坏的库直接覆盖清空。
    cache = [];
    return cache;
  }
}

/**
 * 2026-09-07 契约层 P4：扫全部角色，把 legacy（缺必填字段）写到日志，
 * UI 启动时调用 getLegacyCharacters() 拉取展示。
 * 不修改 series 数据本身，只标记。
 */
const LOGS_DIR = resolve(SERVER_DIR, 'logs');
const LEGACY_LOG = join(LOGS_DIR, 'audit-legacy.jsonl');

function scanLegacyToLog(series: Series[]): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
  } catch { /* ignore */ }
  const totalChars = series.reduce((n, s) => n + s.characters.length, 0);
  const legacyChars = series.flatMap(s =>
    s.characters
      .filter(c => auditCharacter(c) === 'legacy')
      .map(c => ({
        seriesId: s.id,
        seriesTitle: s.title,
        characterId: c.id,
        characterName: c.name,
        role: c.role,
      })),
  );
  const okCount = totalChars - legacyChars.length;
  console.log(
    `[audit] 系列扫描完成：共 ${series.length} 个 series，` +
    `${totalChars} 个角色（OK: ${okCount}, legacy: ${legacyChars.length}）`,
  );
  if (legacyChars.length === 0) return;
  // 追加一行 JSONL 记录（不是全量重写 —— 避免大文件读写放大）。
  const record = {
    ts: new Date().toISOString(),
    totalSeries: series.length,
    totalChars,
    okCount,
    legacyCount: legacyChars.length,
    legacyChars,
  };
  try {
    appendFileSync(LEGACY_LOG, JSON.stringify(record) + '\n', 'utf-8');
  } catch (e) {
    console.warn('[series-store] 写 legacy 日志失败：', e);
  }
  // 控制台也打一行警告（运维一眼能看到）
  console.warn(
    `[audit] ${legacyChars.length} 个角色为 legacy 状态（缺必填字段）：\n` +
    legacyChars.slice(0, 10).map(c => `  - ${c.seriesTitle} / ${c.characterName}（${c.role}）`).join('\n') +
    (legacyChars.length > 10 ? `\n  ... 还有 ${legacyChars.length - 10} 个` : ''),
  );
}

/** 对外暴露：列出所有 legacy 角色，供 UI 红条使用。 */
export function getLegacyCharacters(): Array<{
  seriesId: string;
  seriesTitle: string;
  characterId: string;
  characterName: string;
  role: string;
}> {
  const series = loadAll();
  return series.flatMap(s =>
    s.characters
      .filter(c => auditCharacter(c) === 'legacy')
      .map(c => ({
        seriesId: s.id,
        seriesTitle: s.title,
        characterId: c.id,
        characterName: c.name,
        role: c.role,
      })),
  );
}

/** 对外：清除某个角色的 legacy 标记（成功 PATCH 后调用，给 UI 即时反馈）。 */
export function clearLegacyFlag(seriesId: string, characterId: string): boolean {
  const series = getSeries(seriesId);
  if (!series) return false;
  const c = series.characters.find(x => x.id === characterId);
  if (!c) return false;
  return auditCharacter(c) === 'ok';
}

const SAVE_DEBOUNCE_MS = 800;
/** 最长等待上限：距本轮首次挂起超过这个数就强制落盘。事故背景见 save-scheduler.ts。 */
const SAVE_MAX_WAIT_MS = 5000;
let pendingSeries: Series[] | null = null;

/** 真正把挂起变更写盘。幂等：无挂起变更时什么都不做。 */
function flushPending(): void {
  if (!pendingSeries) return;
  const snapshot = pendingSeries;
  pendingSeries = null;
  ensureDir();
  atomicWrite(DATA_PATH, JSON.stringify(snapshot, null, 2));
}

/**
 * 落盘调度器（带 maxWait 上限）——2026-10-19 加。
 * 原来这里是纯尾部防抖，一次生成 5~8 分钟期间不断 save，定时器被无限推后、
 * **全程没落过盘**；进程被 tsx watch 热重启杀掉时 beforeExit/SIGTERM 不执行，
 * 整场生成归零（《加油啊》4 话就是这样没的）。详见 save-scheduler.ts 的事故记录。
 */
const saveScheduler = createSaveScheduler(flushPending, {
  debounceMs: SAVE_DEBOUNCE_MS,
  maxWaitMs: SAVE_MAX_WAIT_MS,
});

function saveAll(series: Series[]): void {
  pendingSeries = series;
  saveScheduler.schedule();
}

/** 立即把挂起的变更同步写盘（幂等）。 */
export function flushSeriesStore(): void {
  saveScheduler.flushNow();
}

// 进程退出兜底：防抖窗口内崩溃/被杀不丢数据
process.on('beforeExit', flushSeriesStore);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    flushSeriesStore();
    process.exit(0);
  });
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
    arcs: [],
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
  // 向后兼容：旧 API 仍然可用 —— 把整本 chapter 放进新建的「第 1 季」。
  // 实际上新流程应该用 createArc + appendChaptersToArc。
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const arc: Arc = {
    id: randomUUID(),
    index: 1,
    title: '第 1 季',
    premise: '',
    plannedChapterCount: chapters.length,
    chapters: [],
  };
  const appended = appendChaptersToArcInternal(arc, chapters);
  arc.chapters = appended;
  series.arcs = [arc];
  delete series.chapters;
  updateSeries(seriesId, { arcs: series.arcs });
  return appended;
}

/**
 * 新建一季（空 chapter）。返回新建的 arc（已写入 store）。
 * 季数 = series.arcs.length + 1。
 */
export function createArc(seriesId: string, input: { title: string; premise: string; plannedChapterCount: number }): Arc | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const arc: Arc = {
    id: randomUUID(),
    index: (series.arcs?.length ?? 0) + 1,
    title: input.title,
    premise: input.premise,
    plannedChapterCount: input.plannedChapterCount,
    chapters: [],
  };
  series.arcs = [...(series.arcs ?? []), arc];
  updateSeries(seriesId, { arcs: series.arcs });
  return arc;
}

/**
 * 把一组 chapter 追加到指定 arc。已存在的 chapter.id 复用；新 chapter 分配新 id。
 * 全局连续页码由本函数保证 —— 调用方不必预填 pageNumber。
 * 返回归一化后的 chapter 列表。
 */
export function appendChaptersToArc(seriesId: string, arcId: string, chapters: Chapter[]): Chapter[] | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const arc = series.arcs?.find(a => a.id === arcId);
  if (!arc) return undefined;
  const appended = appendChaptersToArcInternal(arc, chapters);
  updateSeries(seriesId, { arcs: series.arcs });
  return appended;
}

function appendChaptersToArcInternal(arc: Arc, chapters: Chapter[]): Chapter[] {
  // 全局连续页码：先算出 arc 已有多少页
  const startN = arc.chapters.reduce((sum, c) => sum + c.pages.length, 0);
  let n = startN;
  const appended = chapters.map(ch => ({
    ...ch,
    id: ch.id || randomUUID(),
    arcId: arc.id,
    pages: ch.pages.map(p => ({ ...p, id: p.id || randomUUID(), pageNumber: ++n })),
  }));
  arc.chapters = [...arc.chapters, ...appended];
  return appended;
}

export function updatePage(seriesId: string, chapterId: string, pageId: string, patch: Partial<SeriesPage>): SeriesPage | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = iterAllChapters(series).find(c => c.id === chapterId);
  if (!chapter) return undefined;
  const pageIdx = chapter.pages.findIndex(p => p.id === pageId);
  if (pageIdx === -1) return undefined;
  chapter.pages[pageIdx] = { ...chapter.pages[pageIdx], ...patch };
  updateSeries(seriesId, { arcs: series.arcs });
  return chapter.pages[pageIdx];
}

/**
 * 改 chapter 元数据（标题、剧情摘要、核心冲突、预计页数）。
 */
export function updateChapter(seriesId: string, chapterId: string, patch: Partial<Chapter>): Chapter | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = iterAllChapters(series).find(c => c.id === chapterId);
  if (!chapter) return undefined;
  Object.assign(chapter, patch);
  updateSeries(seriesId, { arcs: series.arcs });
  return chapter;
}

/**
 * 同 arc 内调整章节顺序（与相邻交换）。
 * 返回 true 表示移动成功。
 */
export function moveChapter(seriesId: string, chapterId: string, direction: 'up' | 'down'): boolean {
  const series = getSeries(seriesId);
  if (!series) return false;
  for (const arc of series.arcs ?? []) {
    const idx = arc.chapters.findIndex(c => c.id === chapterId);
    if (idx === -1) continue;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= arc.chapters.length) return false;
    [arc.chapters[idx], arc.chapters[target]] = [arc.chapters[target], arc.chapters[idx]];
    updateSeries(seriesId, { arcs: series.arcs });
    return true;
  }
  return false;
}

/**
 * 删除一个 chapter（含其下所有 page）。
 */
export function removeChapter(seriesId: string, chapterId: string): boolean {
  const series = getSeries(seriesId);
  if (!series) return false;
  for (const arc of series.arcs ?? []) {
    const idx = arc.chapters.findIndex(c => c.id === chapterId);
    if (idx === -1) continue;
    arc.chapters.splice(idx, 1);
    updateSeries(seriesId, { arcs: series.arcs });
    return true;
  }
  return false;
}

/**
 * 用一组 panel 整体替换指定页的 panel 列表。
 * 用于手动编辑：「改一行文案」「增删格子」「拖拽重排」。
 */
export function replacePanels(
  seriesId: string,
  chapterId: string,
  pageId: string,
  panels: SeriesPage['panels']
): SeriesPage | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = iterAllChapters(series).find(c => c.id === chapterId);
  if (!chapter) return undefined;
  const page = chapter.pages.find(p => p.id === pageId);
  if (!page) return undefined;
  const normalized = panels
    .map((p, i) => ({ ...p, index: i, id: p.id || randomUUID() }))
    .sort((a, b) => a.index - b.index)
    .map((p, i) => ({ ...p, index: i }));
  page.panels = normalized;
  // 只要用户改过 panel，重新生成时不能复用旧图：把状态退回到 draft。
  page.status = 'draft';
  page.errorMessage = undefined;
  updateSeries(seriesId, { arcs: series.arcs });
  return page;
}

/**
 * 在指定页中插入一个新 panel，自动赋予 index。
 */
export function insertPanel(
  seriesId: string,
  chapterId: string,
  pageId: string,
  insertAt?: number
): SeriesPage | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = iterAllChapters(series).find(c => c.id === chapterId);
  if (!chapter) return undefined;
  const page = chapter.pages.find(p => p.id === pageId);
  if (!page) return undefined;
  const at = insertAt ?? page.panels.length;
  const newPanel: SeriesPage['panels'][number] = {
    id: randomUUID(),
    index: at,
    description: '',
    dialogue: '',
    characterIds: [],
    imageUrl: undefined,
  };
  const panels = [...page.panels];
  panels.splice(at, 0, newPanel);
  const renumbered = panels.map((p, i) => ({ ...p, index: i }));
  return replacePanels(seriesId, chapterId, pageId, renumbered);
}

/**
 * 删除指定页中的 panel。
 */
export function deletePanel(seriesId: string, chapterId: string, pageId: string, panelId: string): SeriesPage | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = iterAllChapters(series).find(c => c.id === chapterId);
  if (!chapter) return undefined;
  const page = chapter.pages.find(p => p.id === pageId);
  if (!page) return undefined;
  const next = page.panels.filter(p => p.id !== panelId).map((p, i) => ({ ...p, index: i }));
  return replacePanels(seriesId, chapterId, pageId, next);
}
