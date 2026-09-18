import React from 'react';
import type { Series, Chapter, Arc } from '../../types';
import { PlusIcon, RedoAltIcon } from '../icons';
import { toRoman } from './ui';

function ChaptersCard({
  series, targetPages, setTargetPages, onGenerate, onGenerateArcs, onGenerateArcChapters, onAppendNextChapter, onPickEpisode, onEditChapter, onPreviewChapter, busy,
}: {
  series: Series;
  targetPages: number;
  setTargetPages: (n: number) => void;
  onGenerate: (target: number) => Promise<Chapter[] | null>;
  onGenerateArcs: () => Promise<Arc[] | null>;
  onGenerateArcChapters: (arcId: string, opts?: { targetPageCount?: number; hint?: string }) => Promise<Chapter[] | null>;
  onAppendNextChapter: (arcId: string, opts?: { pageCount?: number; hint?: string }) => Promise<Chapter | null>;
  onPickEpisode: (chapterId: string) => void;
  onEditChapter: (ch: Chapter) => void;
  onPreviewChapter: (ch: Chapter, chapterIndex: number) => void;
  busy: boolean;
}) {
  const arcBlueprints = series.worldview?.arcBlueprints ?? [];
  const hasArcStructure = !!(series.arcs && series.arcs.length > 0);
  const legacyChapters = series.chapters ?? [];
  const totalChapters = hasArcStructure
    ? (series.arcs ?? []).reduce((n, a) => n + (a.chapters?.length ?? 0), 0)
    : legacyChapters.length;

  // —— 1. 新结构：还没建季 ——
  if (!hasArcStructure && arcBlueprints.length === 0 && totalChapters === 0) {
    return (
      <div>
        <p className="deck" style={{ marginBottom: '1rem' }}>
          世界观还没给出季蓝图。先回到 §II 点「重新生成」让 AI 给出 2-6 季的整体规划。
        </p>
        <div style={{ fontSize: '0.75rem', color: 'var(--ink-3)' }}>（旧版兼容路径：直接拆话目）</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginTop: '0.75rem', marginBottom: '1rem' }}>
          <label className="field-label" style={{ marginBottom: 0 }}>目标批数</label>
          <input
            type="number" min={4} max={60} value={targetPages}
            onChange={e => setTargetPages(Number(e.target.value))}
            style={{ width: '5rem', padding: '0.375rem 0.5rem', border: '1px solid var(--rule-soft)', fontSize: '0.875rem', fontFamily: 'var(--font-mono)', textAlign: 'center' }}
          />
        </div>
        <button onClick={() => onGenerate(targetPages)} disabled={busy} className="btn btn--primary">
          {busy ? '拆分中…' : '按剧情大纲切分话目 ▸'}
        </button>
      </div>
    );
  }

  // —— 2. 新结构：蓝图已就绪，季结构还没物化 ——
  if (!hasArcStructure && arcBlueprints.length > 0) {
    return (
      <div>
        <p className="deck" style={{ marginBottom: '0.75rem' }}>
          世界观给出了 {arcBlueprints.length} 季的整体规划：
        </p>
        <ol style={{ margin: '0 0 1rem 1.125rem', padding: 0, fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.7 }}>
          {arcBlueprints.map((b, i) => (
            <li key={i}>
              <strong>{b.title}</strong>（{b.premise} · 计划 {b.plannedChapterCount} 章）
            </li>
          ))}
        </ol>
        <button onClick={() => onGenerateArcs()} disabled={busy} className="btn btn--primary">
          {busy ? '生成中…' : '生成季骨架 ▸'}
        </button>
      </div>
    );
  }

  // —— 3. 新结构：季骨架就绪 ——
  if (hasArcStructure) {
    // 话号全局连续：每个 arc 的话从前面所有 arc 的话数之后接着编
    let episodeOffset = 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {totalChapters === 0 && (
          <p className="deck" style={{ margin: 0 }}>
            季骨架已就绪（还没有拆出任何话）。点某一季的「生成本季话目」开始，或在右侧创作助手说「**开始拆分**」按蓝图整批拆。
          </p>
        )}
        {series.arcs.map((arc) => {
          const node = (
            <React.Fragment key={arc.id}>
              <ArcBlock
                arc={arc}
                episodeOffset={episodeOffset}
                busy={busy}
                targetPages={targetPages}
                setTargetPages={setTargetPages}
                onGenerateArcChapters={(opts) => onGenerateArcChapters(arc.id, opts || {})}
                onAppendNextChapter={(opts) => onAppendNextChapter(arc.id, opts || {})}
                onPickEpisode={onPickEpisode}
                onEditChapter={onEditChapter}
                onPreviewChapter={onPreviewChapter}
              />
            </React.Fragment>
          );
          episodeOffset += arc.chapters.length;
          return node;
        })}
      </div>
    );
  }

  // —— 4. 旧结构（仅 chapters，无 arcs，无蓝图）——
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {legacyChapters.map((ch: Chapter, i: number) => {
          const panels = ch.pages.flatMap(p => p.panels);
          const done = panels.filter(pn => !!pn.imageUrl).length;
          const firstImg = panels.find(pn => pn.imageUrl)?.imageUrl;
          return (
          <div key={ch.id} style={{ background: 'var(--bg-soft)', padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.0625rem', fontWeight: 600 }}>
                <span className="chapter-num" style={{ fontSize: '1rem', marginRight: '0.375rem' }}>§{toRoman(i + 1)}</span>
                第 {i + 1} 话《{ch.title}》
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="mono tnum" style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>
                  {panels.length > 0 ? `已生成 ${done}/${panels.length} 格` : '未拆解'}
                </span>
                <button onClick={() => onPreviewChapter(ch, i + 1)} className="btn btn--link" style={{ fontSize: '0.75rem', padding: 0, color: 'var(--accent)' }}>公众号预览</button>
                <button onClick={() => onEditChapter(ch)} className="btn btn--link" style={{ fontSize: '0.75rem', padding: 0 }}>编辑</button>
              </div>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: '0.75rem' }}>{ch.summary}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(2.25rem, 1fr))', gap: '0.375rem', maxWidth: '24rem' }}>
              {ch.pages.map((p, pi) => {
                const firstImgOfPage = p.panels.find(pn => pn.imageUrl)?.imageUrl;
                return (
                  <button
                    key={p.id}
                    onClick={() => onPickEpisode(ch.id)}
                    className="panel-thumb"
                    style={{ aspectRatio: '3 / 4', border: '1px solid var(--rule-soft)', cursor: 'pointer', background: firstImgOfPage ? 'transparent' : 'var(--bg-paper-2)' }}
                    title={`进入第 ${i + 1} 话《${ch.title}》`}
                  >
                    {firstImgOfPage
                      ? <img src={firstImgOfPage} alt="" />
                      : <span style={{ color: p.status === 'done' ? 'var(--accent)' : 'var(--ink-3)', fontSize: '0.625rem' }}>批 {pi + 1}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>
      <hr className="rule-soft" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <button onClick={() => onGenerate(targetPages)} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
          <RedoAltIcon className="w-3.5 h-3.5" />{busy ? '生成中…' : '重新拆分'}
        </button>
        <label className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>目标 {targetPages} 批</label>
      </div>
    </div>
  );
}

function ArcBlock({
  arc, episodeOffset, busy, targetPages, setTargetPages, onGenerateArcChapters, onAppendNextChapter, onPickEpisode, onEditChapter, onPreviewChapter,
}: {
  arc: Arc;
  /** 本 arc 前面所有 arc 的话数之和 —— 用于"第 X 话"全局连续编号 */
  episodeOffset: number;
  busy: boolean;
  targetPages: number;
  setTargetPages: (n: number) => void;
  onGenerateArcChapters: (opts?: { targetPageCount?: number; hint?: string }) => Promise<Chapter[] | null>;
  onAppendNextChapter: (opts?: { pageCount?: number; hint?: string }) => Promise<Chapter | null>;
  onPickEpisode: (chapterId: string) => void;
  onEditChapter: (ch: Chapter) => void;
  onPreviewChapter: (ch: Chapter, chapterIndex: number) => void;
}) {
  const noChapters = arc.chapters.length === 0;
  return (
    <div style={{ background: 'var(--bg-soft)', padding: '1rem 1.25rem', borderLeft: '3px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.375rem' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600 }}>
          <span className="kicker" style={{ fontSize: '0.625rem', marginRight: '0.5rem', color: 'var(--accent)' }}>第 {arc.index} 季</span>
          {arc.title}
        </h3>
        <span className="mono" style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>
          {arc.chapters.length} / {arc.plannedChapterCount} 话 ·{' '}
          约 {arc.chapters.reduce((n, c) => n + c.pages.length * 6, 0)} 格
        </span>
      </div>
      {arc.premise && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: '0.75rem' }}>
          {arc.premise}
        </p>
      )}

      {noChapters && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginTop: '0.5rem' }}>
          <label className="field-label" style={{ marginBottom: 0, fontSize: '0.75rem' }}>目标批数</label>
          <input
            type="number" min={4} max={120} value={targetPages}
            onChange={e => setTargetPages(Number(e.target.value))}
            style={{ width: '5rem', padding: '0.375rem 0.5rem', border: '1px solid var(--rule-soft)', fontSize: '0.875rem', fontFamily: 'var(--font-mono)', textAlign: 'center' }}
          />
          <button onClick={() => onGenerateArcChapters({ targetPageCount: targetPages })} disabled={busy} className="btn btn--primary">
            {busy ? '生成中…' : '生成本季话目 ▸'}
          </button>
          <span className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>每话约 15 格（内部按 6 格/批生成）</span>
        </div>
      )}

      {arc.chapters.map((ch, ci) => {
        const panels = ch.pages.flatMap(p => p.panels);
        const done = panels.filter(pn => !!pn.imageUrl).length;
        const firstImg = panels.find(pn => pn.imageUrl)?.imageUrl;
        const total = panels.length;
        const complete = total > 0 && done === total;
        return (
          <div key={ch.id} style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--rule-soft)' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              {/* 话封面：首格图或话号占位（替代旧的页码方块） */}
              <button
                onClick={() => onPickEpisode(ch.id)}
                className="panel-thumb"
                style={{ width: '3rem', aspectRatio: '3 / 4', flexShrink: 0, border: '1px solid var(--rule-soft)', cursor: 'pointer', background: firstImg ? 'transparent' : 'var(--bg-paper-2)' }}
                title={`进入第 ${episodeOffset + ci + 1} 话《${ch.title}》`}
              >
                {firstImg
                  ? <img src={firstImg} alt="" />
                  : <span style={{ fontSize: '0.75rem', color: 'var(--ink-3)' }}>{episodeOffset + ci + 1}</span>}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '0.9375rem', fontWeight: 600 }}>
                    <span className="kicker" style={{ fontSize: '0.5625rem', marginRight: '0.375rem', color: 'var(--ink-3)' }}>第 {episodeOffset + ci + 1} 话</span>
                    《{ch.title}》
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="mono tnum" style={{ fontSize: '0.6875rem', color: complete ? 'var(--accent)' : 'var(--ink-3)' }}>
                      {total > 0 ? `已生成 ${done}/${total} 格` : '未拆解'}
                    </span>
                    <button onClick={() => onPreviewChapter(ch, episodeOffset + ci + 1)} className="btn btn--link" style={{ fontSize: '0.75rem', padding: 0, color: 'var(--accent)' }}>公众号预览</button>
                    <button onClick={() => onEditChapter(ch)} className="btn btn--link" style={{ fontSize: '0.75rem', padding: 0 }}>编辑</button>
                  </div>
                </div>
                {ch.summary && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 0 }}>{ch.summary}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!noChapters && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px solid var(--rule-soft)' }}>
          <button onClick={() => onAppendNextChapter({ pageCount: 3 })} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
            <PlusIcon className="w-3.5 h-3.5" />扩写下一话
          </button>
          <span className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>
            追加 1 话（约 18 格；基于本季已生成话 + 前文剧情，自动续写）
          </span>
        </div>
      )}
    </div>
  );
}

export { ChaptersCard, ArcBlock };
