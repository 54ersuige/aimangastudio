/**
 * 文章原创性辅助（前端启发式规则）。
 *
 * 不做相似度比对 / 不联网检测 / 不替代平台审核。
 * 这里只做三件事：
 *  1) 检测"AI 味"模板化短语（如"在这个……的时代""值得注意的是"等常见机器腔）。
 *  2) 检测连续 N 字重复 / 段落高度雷同，给出改写建议。
 *  3) 检测段落长度异常（短到不像人话，或长到一大段没换气）。
 *
 * 输出可解释的报告，由用户决定是否调整，避免把"AI 写作"包装成"原创检测"。
 */
import type { ArticleDraft, DraftBlock } from '../types';

export interface OriginalityHint {
  /** 命中片段所在的 block 索引，便于在编辑器里定位。 */
  blockIndex: number;
  /** 问题类别。 */
  kind: 'template-phrase' | 'repetition' | 'paragraph-shape' | 'duplicate-block';
  /** 一句话解释。 */
  message: string;
  /** 命中片段（裁剪到 40 字）。 */
  excerpt: string;
}

export interface OriginalityReport {
  /** 0~100，越高越"像人写的"。 */
  score: number;
  level: 'human' | 'review';
  hints: OriginalityHint[];
  /** 一句话总结，前端直接展示给作者。 */
  summary: string;
}

const TEMPLATE_PHRASES = [
  '在这个', '在当下', '值得注意的是', '总而言之', '综上所述',
  '首先', '其次', '再次', '最后,', '最后，',
  '随着', '与此同时', '不难发现', '由此可见', '毫无疑问',
  '所谓', '作为', '当……时，', '身处', '面对',
  '然而,', '然而，', '因此,', '因此，',
  '一篇好的', '让我们一起', '愿我们', '愿你',
  '深入探讨', '深入分析', '不难看出', '不可否认',
];

/** 抽取文字块的可读文本。 */
function blockText(block: DraftBlock): string {
  if (block.kind === 'heading' || block.kind === 'paragraph' || block.kind === 'quote') {
    return (block.text || '').trim();
  }
  if (block.kind === 'panel') return (block.dialogue || '').trim();
  if (block.kind === 'page') return (block.summary || '').trim();
  if (block.kind === 'cast') return block.characters.map(c => c.intro || '').join(' ') || block.title || '';
  return '';
}

/** 简单中文分句：句号、问号、感叹号、引号。 */
function splitSentences(text: string): string[] {
  return text
    .replace(/[…]/g, '。')
    .split(/[。！？!?]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** 找出所有命中模板短语的位置。 */
function findTemplatePhrases(text: string): string[] {
  const found = new Set<string>();
  for (const phrase of TEMPLATE_PHRASES) {
    if (text.includes(phrase)) found.add(phrase);
  }
  return Array.from(found);
}

/** 检测段落长度异常（<8 字或 >180 字）。 */
function paragraphShape(text: string): 'ok' | 'short' | 'long' {
  if (text.length === 0) return 'ok';
  if (text.length < 8) return 'short';
  if (text.length > 180) return 'long';
  return 'ok';
}

/** 检测 N-gram 重复：连续 4 字串出现 ≥3 次。 */
function findRepetitionNgrams(text: string): string[] {
  if (text.length < 8) return [];
  const counts = new Map<string, number>();
  for (let i = 0; i <= text.length - 4; i += 1) {
    const g = text.slice(i, i + 4);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
}

/** 检测段落雷同：归一化后做 set 比较，找出完全相同的段落。 */
function findDuplicateBlocks(blocks: DraftBlock[]): number[] {
  const seen = new Map<string, number>();
  const dupIndexes: number[] = [];
  blocks.forEach((block, i) => {
    const t = blockText(block);
    if (t.length < 12) return;
    const norm = t.replace(/\s+/g, '');
    if (seen.has(norm)) {
      dupIndexes.push(i);
    } else {
      seen.set(norm, i);
    }
  });
  return dupIndexes;
}

export function analyzeOriginality(draft: ArticleDraft): OriginalityReport {
  const hints: OriginalityHint[] = [];
  const blocks = draft.blocks;

  // 1. 模板短语
  blocks.forEach((block, i) => {
    const t = blockText(block);
    if (!t) return;
    const phrases = findTemplatePhrases(t);
    if (phrases.length > 0) {
      hints.push({
        blockIndex: i,
        kind: 'template-phrase',
        message: `出现 ${phrases.length} 处常见模板化短语（${phrases.slice(0, 2).join('、')}${phrases.length > 2 ? '…' : ''}），建议换成自己的口吻。`,
        excerpt: t.slice(0, 40),
      });
    }
  });

  // 2. 段落长度异常
  blocks.forEach((block, i) => {
    const t = blockText(block);
    const shape = paragraphShape(t);
    if (shape === 'short') {
      hints.push({
        blockIndex: i,
        kind: 'paragraph-shape',
        message: '段落太短（不足 8 字），读者会觉得是凑字。',
        excerpt: t,
      });
    } else if (shape === 'long') {
      hints.push({
        blockIndex: i,
        kind: 'paragraph-shape',
        message: '段落超过 180 字，建议拆成 2 段或加入一句过渡。',
        excerpt: t.slice(0, 40) + '…',
      });
    }
  });

  // 3. 全文 N-gram 重复
  const allText = blocks.map(blockText).filter(Boolean).join('');
  const reps = findRepetitionNgrams(allText);
  reps.forEach(g => {
    hints.push({
      blockIndex: -1,
      kind: 'repetition',
      message: `全文重复出现「${g}」类短语，考虑换种说法或删除。`,
      excerpt: g,
    });
  });

  // 4. 段落完全雷同
  const dup = findDuplicateBlocks(blocks);
  dup.forEach(i => {
    hints.push({
      blockIndex: i,
      kind: 'duplicate-block',
      message: '这段文字与前面某段几乎一模一样，可能是误粘贴。',
      excerpt: blockText(blocks[i]).slice(0, 40),
    });
  });

  // 计算分数：每条 hint 扣 8 分，最低 0。
  const raw = 100 - hints.length * 8;
  const score = Math.max(0, Math.min(100, raw));

  let summary = '';
  if (hints.length === 0) {
    summary = '没有发现明显 AI 痕迹或重复段落，可以发布。';
  } else if (score >= 70) {
    summary = `发现 ${hints.length} 处可优化的地方，整体可读，建议发布前再扫一眼。`;
  } else {
    summary = `发现 ${hints.length} 处 AI 味或重复问题，建议先改写再发布。`;
  }

  return {
    score,
    level: score >= 70 ? 'human' : 'review',
    hints,
    summary,
  };
}

/** 给一段文本返回"建议改写"的启发式：不联网、不调模型，只做局部替换。 */
export function suggestRewrites(text: string): string[] {
  const out: string[] = [];
  TEMPLATE_PHRASES.forEach(p => {
    if (text.includes(p)) out.push(`把「${p}…」改成具体场景或直接说结论。`);
  });
  if (out.length === 0 && text.length > 0) {
    out.push('尝试：第一句先抛出冲突 / 把抽象词换成画面 / 删掉"显然""可见"类判断。');
  }
  return out.slice(0, 3);
}
