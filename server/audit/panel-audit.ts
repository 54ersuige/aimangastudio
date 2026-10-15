/**
 * 分镜出图审计（2026-09-07 反馈层 P1）。
 *
 * 设计目标：每出一张图，写一条 JSONL 记录到 server/data/audit/panel-audit/YYYY-MM-DD.jsonl，
 * 字段覆盖：
 *  - prompt 长度 / 参考图数 / styleRef 数 / DNA key
 *  - limb-guard 检测结果（多胳膊 / 多手指）
 *  - gender-consistency 检测结果（林屿变女性这类）
 *  - 自动重生成次数与原因
 *  - 最终落盘图片 hash / 耗时
 *
 * JSONL 而不是 JSON：append-only，避免大文件读写放大；
 * UI 的「审计 Tab」读最近 N 条（默认 100）按 ts 倒序展示。
 *
 * 2026-10-15：落盘位置从 server/logs/ 改为 server/data/audit/。
 * 原先写在 logs/ 下，而 logs/ 是「每次启动脚本清空」的临时目录 ——
 * 实测审计记录已全部消失，导致「四道闸到底有没有用、重画有没有真的提分」
 * 这类问题只能靠感觉回答。server/data/ 已在 .gitignore 内，
 * 既是用户内容目录，又不会随启动清理。
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = resolve(SERVER_DIR, '..', 'data', 'audit', 'panel-audit');

/** 单条审计记录。 */
export interface PanelAuditRecord {
  ts: string;
  seriesId: string;
  seriesTitle?: string;
  pageNumber: number;
  panelIndex: number;
  chapterTitle?: string;
  /** 出图动作：generate / regenerate / panel-generate / panel-rewrite 等。 */
  action: string;
  dnaKey: string;
  promptLen: number;
  refCount: number;
  styleRefCount: number;
  /** limb-guard 检测结果。null 表示未启用 / 调用失败（视作通过）。 */
  limbGuard: {
    abnormal: boolean;
    reason: string;
    confidence: number;
  } | null;
  /** 性别一致性检测结果。null 表示未启用 / 调用失败 / 没有可校验的主角。 */
  genderAudit: {
    mismatch: boolean;
    expected: string;
    observed: string[];
    reason: string;
    confidence: number;
  } | null;
  /** 8 维连载漫画评审结果（2026-09-07）。null 表示未启用 / 调用失败。 */
  review: {
    overall: number;                       // 加权总分 0-100
    dimensions: Record<string, { score: number; reason: string }>;
    topIssue: string;
    verdict: 'publish' | 'revise' | 'reject';
    confidence: number;
  } | null;
  /** 图文对齐门禁结果（2026-09-11）。null 表示未启用 / 抽取或核验失败（视作通过）。 */
  alignmentAudit?: {
    ok: boolean;                           // 全部可核验要素都画出来了
    items: string[];                       // 抽取的核验清单
    missing: string[];                     // 出图中缺失/画错的要素
    reason: string;                        // 一句汇总
    confidence: number;
  } | null;
  /** 本次任务第几次尝试成功的（1 表示首张就过）。 */
  attempt: number;
  /** 重生成累计尝试次数（含失败）。 */
  totalAttempts: number;
  /** 重生成原因（首次为 'ok'）。 */
  regenReason: string;
  /** 最终落盘图片的 sha1（用于去重 + UI 缓存）。 */
  finalImageHash: string;
  /** 出图总耗时（ms）。 */
  costMs: number;
  /** 失败原因（成功时为空）。 */
  error?: string;
}

/** 计算 dataURL 的 sha1（不存原始图，避免日志爆炸）。 */
export function hashImageDataUrl(dataUrl: string): string {
  const b64 = dataUrl.startsWith('data:') ? dataUrl.split(',', 2)[1] ?? '' : dataUrl;
  return createHash('sha1').update(b64.slice(0, 200_000)).digest('hex').slice(0, 12);
}

/** 获取当天的日志文件路径。 */
function dayLogPath(date = new Date()): string {
  const ymd = date.toISOString().slice(0, 10);
  return resolve(AUDIT_DIR, `${ymd}.jsonl`);
}

/** 写一条审计记录（append-only）。 */
export function appendPanelAudit(record: PanelAuditRecord): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
  } catch { /* ignore */ }
  try {
    appendFileSync(dayLogPath(), JSON.stringify(record) + '\n', 'utf-8');
  } catch (e) {
    console.warn('[audit] 写 panel-audit 失败：', e);
  }
}

/**
 * 读取最近 N 条审计记录（跨天拼接，倒序）。
 * 默认 100 条 —— 足够 UI "审计 Tab" 展示，又不会卡 IO。
 */
export function readRecentAudits(limit = 100): PanelAuditRecord[] {
  try {
    if (!existsSync(AUDIT_DIR)) return [];
  } catch { return []; }
  // 按文件名（日期）倒序读
  // 2026-09-08 修复：原来用 require('fs')，ESM 下抛 ReferenceError 被 catch 吞掉，
  // 导致 API 永远返回空列表。改为顶部静态导入的 readdirSync。
  let files: string[];
  try {
    files = readdirSync(AUDIT_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const out: PanelAuditRecord[] = [];
  for (const f of files) {
    if (out.length >= limit) break;
    const p = resolve(AUDIT_DIR, f);
    let stat;
    try { stat = statSync(p); } catch { continue; }
    if (!stat) continue;
    let raw: string;
    try { raw = readFileSync(p, 'utf-8'); } catch { continue; }
    // 每行一条 JSON，倒序读
    const lines = raw.trim().split('\n').reverse();
    for (const line of lines) {
      if (out.length >= limit) break;
      try {
        out.push(JSON.parse(line));
      } catch { /* 跳过坏行 */ }
    }
  }
  return out;
}

/**
 * 2026-09-07 重写：连载质量分（取代旧的「driftScore = 元数据反推」虚架子）。
 *
 * 真正的"连载漫画审核大师"分：以最近 N 次 review 的 overall 字段做核心，再看
 * limb-guard / gender-audit / 重生成次数做轻度惩罚。
 *
 * 分级（与审计卡 UI 一致）：
 *  - 85+：健康（publishable）
 *  - 70-85：注意（revise）  —— 评审阈值
 *  - 50-70：警告（reject）
 *  - <50：严重问题
 *
 * 没有 review 数据时（vision 未启用 / 出图还没评审过） → 返回 null 而非虚假高分。
 */
export function computeDriftScore(seriesId: string, recent: PanelAuditRecord[] = readRecentAudits(500)): number | null {
  const subset = recent.filter(r => r.seriesId === seriesId).slice(0, 200);
  if (subset.length === 0) return null;
  // 只取有 review 数据的
  const reviewed = subset.filter(r => r.review != null);
  if (reviewed.length === 0) return null;
  const sumOverall = reviewed.reduce((n, r) => n + (r.review?.overall ?? 0), 0);
  const avgOverall = sumOverall / reviewed.length;
  // 轻度惩罚：gender / limb 失败额外 -3 / -5
  let penalty = 0;
  for (const r of reviewed) {
    if (r.genderAudit?.mismatch) penalty += 3;
    if (r.limbGuard?.abnormal) penalty += 5;
    if (r.totalAttempts > 1) penalty += 0.5 * (r.totalAttempts - 1);
  }
  // 惩罚按"有问题的格子占比"换算
  const adjusted = avgOverall - (penalty / reviewed.length);
  return Math.max(0, Math.min(100, Math.round(adjusted)));
}

/**
 * 8 维评审的平均分（用于 UI 雷达图：8 维各自平均）。
 * 如果没有数据，返回每维都为 null 的对象。
 */
export function computeDimensionAverages(seriesId: string, recent: PanelAuditRecord[] = readRecentAudits(500)): Record<string, number | null> {
  const subset = recent.filter(r => r.seriesId === seriesId && r.review != null).slice(0, 200);
  const dims = ['D1_character_consistency','D2_cinematography','D3_composition','D4_style_consistency','D5_expression_emotion','D6_outfit_consistency','D7_scene_continuity','D8_visual_pacing'];
  const out: Record<string, number | null> = {};
  for (const d of dims) {
    if (subset.length === 0) {
      out[d] = null;
      continue;
    }
    const sum = subset.reduce((n, r) => n + (r.review?.dimensions?.[d]?.score ?? 0), 0);
    out[d] = Math.round((sum / subset.length) * 10) / 10; // 0..10, 1 位小数
  }
  return out;
}