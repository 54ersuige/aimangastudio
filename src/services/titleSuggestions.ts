/**
 * 标题建议服务（第一阶段）
 *
 * 输入：当前 series（含世界观、章节、页面）
 * 输出：3-6 条标题建议 + 简短理由。
 *
 * 注意：本阶段不调用 AI 生成（避免引入原创性检测/文风审查的链路），
 * 而是基于已有元数据（logline / worldview / 第一章标题 / 第一页标题），
 * 用一组可解释的模板做拼接。后续如接 AI 改写，再加 ai 通道。
 */
import type { Series, TitleSuggestion } from '../types';
import { flattenSeriesChapters } from '../contexts/SeriesContext';

const COPY_PATTERNS: Array<(s: Series) => TitleSuggestion | null> = [
  // 1) 直引 logline 当标题
  (s) => s.logline
    ? { text: trim(s.logline, 28), reason: '来自一句话简介' }
    : null,
  // 2) 沿用系列名
  (s) => s.title
    ? { text: s.title, reason: '使用连载标题' }
    : null,
  // 3) 「当 X 遇上 Y」式
  (s) => {
    const chars = (s.characters || []).slice(0, 2);
    if (chars.length === 2) {
      return {
        text: `当「${chars[0].name}」遇上「${chars[1].name}」`,
        reason: `来自角色：${chars[0].name} / ${chars[1].name}`,
      };
    }
    return null;
  },
  // 4) 第一话标题
  (s) => {
    const ch = flattenSeriesChapters(s)[0];
    if (!ch) return null;
    return { text: ch.title, reason: `来自第一话：${ch.title}` };
  },
  // 5) 首批场景
  (s) => {
    const ch = flattenSeriesChapters(s)[0];
    const pg = ch?.pages?.[0];
    if (!pg) return null;
    return { text: pg.title, reason: `来自开头批次：${pg.title}` };
  },
  // 6) 主题色 + 第一话
  (s) => {
    const wv = s.worldview;
    const ch = flattenSeriesChapters(s)[0];
    if (!wv?.era && !ch) return null;
    const era = wv?.era ? trim(wv.era, 6) : '';
    const chTitle = ch ? ch.title : s.title;
    return {
      text: era ? `${era}：${chTitle}` : chTitle,
      reason: '时代 + 话标题',
    };
  },
  // 7) 矛盾驱动
  (s) => {
    const c = s.worldview?.conflicts?.[0];
    if (!c) return null;
    return {
      text: trim(c, 22),
      reason: '来自核心矛盾',
    };
  },
];

function trim(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** 去重 + 过滤空。 */
function dedupe(list: TitleSuggestion[]): TitleSuggestion[] {
  const seen = new Set<string>();
  const out: TitleSuggestion[] = [];
  for (const s of list) {
    const k = s.text.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** 为一个系列生成 3-6 条标题建议。 */
export function suggestTitles(series: Series | null | undefined): TitleSuggestion[] {
  if (!series) return [];
  const raw = COPY_PATTERNS.map(p => p(series)).filter(Boolean) as TitleSuggestion[];
  return dedupe(raw).slice(0, 6);
}
