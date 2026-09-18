/** 公众号文章草稿的结构质量分析。
 *
 * 这是一组可解释的前端规则，用于提醒用户哪些发布内容可能还不完整；
 * 不做相似度、原创性、敏感词或平台审核，也不替代发布平台的人工判断。
 */
import type { ArticleDraft, DraftBlock } from '../types';

export type QualityLevel = 'good' | 'warning';

export interface QualityCheck {
  label: string;
  detail: string;
  level: QualityLevel;
  score: number;
  maxScore: number;
}

export interface QualityReport {
  score: number;
  level: 'ready' | 'review';
  checks: QualityCheck[];
  suggestions: string[];
}

function blockText(block: DraftBlock): string {
  if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') {
    return (block.text || '').trim();
  }
  if (block.kind === 'panel') {
    return (block.dialogue || '').trim();
  }
  if (block.kind === 'page') {
    return (block.summary || '').trim();
  }
  if (block.kind === 'cast') {
    // 人物表也算有效文字：有标题或至少一个角色简介即视为有内容。
    return block.characters.some(c => (c.intro || '').trim()) ? (block.title || '主要人物') : '';
  }
  return '';
}

function countKind(blocks: DraftBlock[], kind: DraftBlock['kind']): number {
  return blocks.filter(block => block.kind === kind).length;
}

/** 分析草稿是否具备可读、可发布的文章结构。 */
export function analyzeArticleDraft(draft: ArticleDraft): QualityReport {
  const title = draft.title.trim();
  const subtitle = (draft.subtitle || '').trim();
  const textBlocks = draft.blocks.filter(block => blockText(block).length > 0);
  const imageBlocks = draft.blocks.filter(block => block.kind === 'image' || block.kind === 'panel');
  const dialogueBlocks = draft.blocks.filter(block => block.kind === 'panel' && (block.dialogue || '').trim().length > 0);
  const emptyBlocks = draft.blocks.length - textBlocks.length;
  const checks: QualityCheck[] = [];
  const suggestions: string[] = [];

  checks.push({
    label: '标题',
    detail: title.length >= 8 ? '标题长度适合公众号阅读' : '标题较短，建议补充关键词或情绪',
    level: title.length >= 8 ? 'good' : 'warning',
    score: title.length >= 8 ? 20 : 10,
    maxScore: 20,
  });
  if (title.length < 8) suggestions.push('将标题扩展到 8 个字以上，让读者更快理解主题。');

  checks.push({
    label: '导语',
    detail: subtitle ? '已设置导语，阅读前更有上下文' : '可选添加一句话导语，帮助读者进入故事',
    level: subtitle ? 'good' : 'warning',
    score: subtitle ? 10 : 0,
    maxScore: 10,
  });
  if (!subtitle) suggestions.push('补充一句导语，交代这篇文章要讲什么。');

  checks.push({
    label: '图片',
    detail: imageBlocks.length > 0 ? `已加入 ${imageBlocks.length} 个图片内容块` : '尚未加入图片，可导入章节分镜',
    level: imageBlocks.length > 0 ? 'good' : 'warning',
    score: imageBlocks.length > 0 ? 25 : 0,
    maxScore: 25,
  });
  if (imageBlocks.length === 0) suggestions.push('从章节或分镜中导入至少一张漫画图片。');

  checks.push({
    label: '正文',
    detail: textBlocks.length > 0 ? `已加入 ${textBlocks.length} 段可读文字` : '尚未加入正文文字',
    level: textBlocks.length > 0 ? 'good' : 'warning',
    score: textBlocks.length > 0 ? 20 : 0,
    maxScore: 20,
  });
  if (textBlocks.length === 0) suggestions.push('添加段落、引用或分镜对白作为公众号正文。');

  checks.push({
    label: '对白',
    detail: dialogueBlocks.length > 0 ? `已加入 ${dialogueBlocks.length} 段漫画对白` : '没有对白时，文章会更像插画合集',
    level: dialogueBlocks.length > 0 ? 'good' : 'warning',
    score: dialogueBlocks.length > 0 ? 15 : 0,
    maxScore: 15,
  });
  if (dialogueBlocks.length === 0) suggestions.push('为关键分镜补充对白，让图文漫画更像一篇连载文章。');

  checks.push({
    label: '空白块',
    detail: emptyBlocks === 0 ? '没有待编辑的空内容块' : `还有 ${emptyBlocks} 个空内容块`,
    level: emptyBlocks === 0 ? 'good' : 'warning',
    score: emptyBlocks === 0 ? 10 : Math.max(0, 10 - emptyBlocks * 2),
    maxScore: 10,
  });
  if (emptyBlocks > 0) suggestions.push('删除空标题、空段落或空引用，保持发布稿整洁。');

  const score = Math.max(0, Math.min(100, checks.reduce((sum, check) => sum + check.score, 0)));
  return {
    score,
    level: score >= 70 ? 'ready' : 'review',
    checks,
    suggestions,
  };
}

/** 做无损的结构整理：只删除空文字块，不改变用户的有效内容。 */
export function optimizeArticleDraft(draft: ArticleDraft): ArticleDraft {
  return {
    ...draft,
    blocks: draft.blocks.filter(block => {
      if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') {
        return block.text.trim().length > 0;
      }
      if (block.kind === 'image') return Boolean(block.url);
      if (block.kind === 'panel') return Boolean(block.imageUrl);
      return true;
    }),
    updatedAt: Date.now(),
  };
}

export function hasOptimizableContent(draft: ArticleDraft): boolean {
  return draft.blocks.some(block => {
    if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') {
      return !block.text.trim();
    }
    return false;
  });
}

export { countKind };
