/**
 * 连载连贯性辅助。
 *
 * - summarizeChapters(series)：把已有章节压成"上下文摘要串"，给作者 / AI 参考，
 *   写新章节时可以快速看到上一章结尾发生了什么、人物最近状态。
 * - buildTransitionBlock(previousChapter, nextChapter)：根据前后章节自动生成
 *   一段"承上启下"的过渡文案（模板化、可编辑），让两章衔接更自然。
 *
 * 设计原则：不联网、不调模型，纯粹基于章节内已有素材拼接。
 */
import type { Chapter, Series, SeriesPage } from '../types';

export interface ChapterSnapshot {
  id: string;
  title: string;
  pageCount: number;
  /** 该章最后一句对话（用作"上一章在……"的钩子）。 */
  lastDialogue: string;
  /** 该章最后一段场景描述（裁剪 80 字）。 */
  lastScene: string;
  /** 涉及的角色名（粗略去重，最多 5 个）。 */
  characters: string[];
  /** 一句话剧情摘要：第一章/页数/角色。 */
  blurb: string;
}

/** 从章节里粗略抽取出现的角色：扫描 dialogue 里的"角色：……"格式。 */
function collectCharacters(pages: SeriesPage[]): string[] {
  const set = new Set<string>();
  pages.forEach(pg => pg.panels.forEach(p => {
    const d = p.dialogue || '';
    const m = d.match(/^([^：:]{1,12})[：:]/);
    if (m && m[1].length <= 8) set.add(m[1].trim());
  }));
  return Array.from(set).slice(0, 5);
}

export function snapshotChapter(chapter: Chapter): ChapterSnapshot {
  const pages = chapter.pages;
  let lastDialogue = '';
  let lastScene = '';
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const pg = pages[i];
    const panels = pg.panels;
    for (let j = panels.length - 1; j >= 0; j -= 1) {
      if (panels[j].dialogue && !lastDialogue) lastDialogue = panels[j].dialogue;
    }
    if (!lastScene && pg.sceneDescription) lastScene = pg.sceneDescription.slice(0, 80);
    if (lastDialogue && lastScene) break;
  }
  const characters = collectCharacters(pages);
  const blurb = `共 ${pages.length} 页 · ${characters.length > 0 ? characters.join('、') : '无人称独白'}`;
  return {
    id: chapter.id,
    title: chapter.title,
    pageCount: pages.length,
    lastDialogue: lastDialogue.slice(0, 80),
    lastScene,
    characters,
    blurb,
  };
}

export function summarizeChapters(series: Series): ChapterSnapshot[] {
  const out: ChapterSnapshot[] = [];
  const arcs = series.arcs || [];
  arcs.forEach(arc => {
    arc.chapters.forEach(ch => {
      out.push(snapshotChapter(ch));
    });
  });
  return out;
}

/** 在多章节列表中找出"上一章"。 */
export function findPreviousChapter(series: Series, currentChapterId: string): Chapter | null {
  const arcs = series.arcs || [];
  const flat: Chapter[] = [];
  arcs.forEach(arc => arc.chapters.forEach(ch => flat.push(ch)));
  const idx = flat.findIndex(c => c.id === currentChapterId);
  if (idx > 0) return flat[idx - 1];
  return null;
}

/** 生成一段过渡文案（模板化、可编辑）。 */
export function buildTransitionBlock(
  previous: ChapterSnapshot | null,
  nextTitle: string,
): string {
  if (!previous) {
    return `这是「${nextTitle}」的开篇，承接作品的开端。`;
  }
  const parts: string[] = [];
  parts.push(`上一章「${previous.title}」${previous.blurb}。`);
  if (previous.lastDialogue) {
    parts.push(`结尾处：${previous.lastDialogue}……`);
  } else if (previous.lastScene) {
    parts.push(`结尾画面：${previous.lastScene}……`);
  } else {
    parts.push(`请在「${nextTitle}」开头交代上章末尾发生了什么。`);
  }
  parts.push(`本章「${nextTitle}」需要让读者自然从上一章过渡过来。`);
  return parts.join('\n');
}

/** 一句话衔接提示，用来给作者看："上章→本章"应该补什么。 */
export function buildContinuityHint(
  previous: ChapterSnapshot | null,
  next: ChapterSnapshot | null,
): string[] {
  const out: string[] = [];
  if (!previous) {
    out.push('这是第一话，建议用一段场景把主角、时间和冲突一起交代清楚。');
    return out;
  }
  if (!next) return out;

  // 角色延续
  const lost = previous.characters.filter(c => !next.characters.includes(c));
  if (lost.length > 0 && next.characters.length > 0) {
    out.push(`上章关键角色 ${lost.join('、')} 没有在本章出现，可能需要交代去向。`);
  }

  // 页数衔接
  if (next.pageCount === 0) {
    out.push(`本章尚未生成任何分镜，建议先创建至少 1 页。`);
  }

  // 对白钩子
  if (previous.lastDialogue && !next.lastDialogue) {
    out.push(`上一章末尾对白是「${previous.lastDialogue}」，本章首段可以呼应或反转。`);
  }

  // 场景延续
  if (previous.lastScene && next.lastScene && previous.lastScene === next.lastScene) {
    out.push('两章首尾场景几乎相同，可能让读者感到重复，可考虑换时间或换地点。');
  }

  if (out.length === 0) {
    out.push(`「${previous.title}」→「${next.title}」结构上衔接自然。`);
  }
  return out;
}
