import React, { useState } from 'react';
import type { Series, Chapter, Arc } from '../../types';
import { PlusIcon, RedoAltIcon } from '../icons';
import { toRoman } from './ui';

function ChaptersCard({
  series, targetPages, setTargetPages, onGenerate, onGenerateArcs, onGenerateArcChapters, onAppendNextChapter, onPickEpisode, onEditChapter, onPreviewChapter, busy, taskProgress, runningArcTask,
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
  /** 2026-10-16：长任务进度（话目生成实测 8 分钟，没进度会被当成卡死） */
  taskProgress?: number | null;
  /**
   * 2026-10-19：后端真实存在的 arc-chapters 任务（刷新页面也不丢）。
   * 非 null 时「生成本季话目」全局禁用 —— 任一季在生成，所有季都锁，
   * 避免用户点下去撞 409。详见 SeriesContext.runningArcTask 的注释。
   *
   * 2026-10-20：arcId 用来判断「是不是这一季在跑」——
   * 只有那一季才显示「生成中…」和进度条。
   */
  runningArcTask?: { arcId: string | null; progress: number } | null;
}) {
  const arcBlueprints = series.worldview?.arcBlueprints ?? [];
  // 2026-10-20：本页点的是哪一季，本地记一笔。
  //
  // 为什么需要这层：后端新加的 target 字段要重启后端才生效，而重启会杀掉
  // 正在跑的任务 —— 用户等半天不该因为"要显示对"而白等。
  // 本地这份在**本页发起的场景**下就是准确答案；后端 target 到位后以它为准。
  const [activeArcId, setActiveArcId] = useState<string | null>(null);
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
                taskProgress={taskProgress}
                runningArcTask={runningArcTask}
                activeArcId={activeArcId}
                onMarkArcRunning={setActiveArcId}
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
  arc, episodeOffset, busy, taskProgress, runningArcTask, activeArcId, onMarkArcRunning, targetPages, setTargetPages, onGenerateArcChapters, onAppendNextChapter, onPickEpisode, onEditChapter, onPreviewChapter,
}: {
  arc: Arc;
  /** 本 arc 前面所有 arc 的话数之和 —— 用于"第 X 话"全局连续编号 */
  episodeOffset: number;
  busy: boolean;
  /** 2026-10-16：长任务进度（话目生成实测 8 分钟，没进度会被当成卡死） */
  taskProgress?: number | null;
  /** 2026-10-19：后端真实任务态，补上 busy 丢失的那部分真相 */
  runningArcTask?: { arcId: string | null; progress: number } | null;
  /** 2026-10-20：本页发起的季（后端 target 还没上线时的兜底） */
  activeArcId?: string | null;
  /** 2026-10-20：点击时登记"是本季在跑" */
  onMarkArcRunning?: (arcId: string) => void;
  targetPages: number;
  setTargetPages: (n: number) => void;
  onGenerateArcChapters: (opts?: { targetPageCount?: number; hint?: string }) => Promise<Chapter[] | null>;
  onAppendNextChapter: (opts?: { pageCount?: number; hint?: string }) => Promise<Chapter | null>;
  onPickEpisode: (chapterId: string) => void;
  onEditChapter: (ch: Chapter) => void;
  onPreviewChapter: (ch: Chapter, chapterIndex: number) => void;
}) {
  const noChapters = arc.chapters.length === 0;
  // 2026-10-19：两种「正在生成」，缺一不可。
  //   busy           —— 本标签页点按钮发起的，实时但活不过刷新；
  //   runningArcTask —— 后端确实在跑（补上刷新 / 创作助手发起的那部分）。
  // 两者任一为真都必须锁住按钮：后端 runTask 按 arcId 互斥，重复提交只会撞 409。
  // 采用全局锁（用户拍板）——任一季在跑，所有季的按钮一起锁。
  const locked = busy || !!runningArcTask;
  // 2026-10-20：**只有真正在跑的那一季**才算"生成中"。
  //
  // 此前判据只有 `locked`，而 busy 是全局单一布尔值 ——
  // 结果每一季都渲染出「生成中… 48%」，4 个季看起来全在跑，
  // 实际后端只有 1 个任务。用户被这个假象直接误导过。
  //
  // 现在精确认领：后端认领到的（arcId）优先；后端还没给 arcId 时，
  // 用本页点击时记下的 activeArcId 兜底。
  const thisArcRunning =
    (runningArcTask?.arcId != null && runningArcTask.arcId === arc.id)
    || (busy && runningArcTask?.arcId == null && activeArcId === arc.id);
  // 只有认领到的那一季才有进度条；认领不到就一句静态提示了事 —— 宁可少说，不可说错。
  const showProgress = thisArcRunning;
  const shownProgress = busy ? (taskProgress ?? null) : (runningArcTask?.progress ?? null);
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
          <button
            onClick={() => {
              onMarkArcRunning?.(arc.id);
              onGenerateArcChapters({ targetPageCount: targetPages });
            }}
            disabled={locked}
            className="btn btn--primary"
            title={locked && !thisArcRunning ? '已有季正在生成话目，请等它跑完再点' : undefined}
          >
            {thisArcRunning ? '生成中…' : locked ? '已有季在生成…' : '生成本季话目 ▸'}
          </button>
          {/*
            2026-10-16：进度条。
            实测这个调用要转 8 分钟（推理型模型，4 话 + 可能一轮整轮重写）。
            此前按钮只有一句不动的「生成中…」，用户据此以为失败又连点两次，
            第二次反撞 409 —— 8 分钟的正常等待被误判成故障。
            长任务没进度 = 每次都会重演这次误会。

            2026-10-19：条件从 `busy` 放宽到 `locked`。
            原来只有本标签页发起的任务才有进度条，而刷新页面后 `busy` 归零，
            后端明明还在跑、前端却退回成一句干巴巴的禁用按钮 ——
            用户完全看不出它在跑、到哪了，只会怀疑是不是卡死了。
            现在从后端任务队列取进度，刷新后照样能看见数字在爬。

            2026-10-20：条件收窄到 `showProgress`（= 本季确实在跑）。
            之前 `locked` 一开，每一季都长出同一根进度条、同一串数字，
            4 个季看上去全在跑，实际后端只有 1 个任务。
            现在只有认领到的那一季才有进度条，其余季一句静态提示了事。
          */}
          {showProgress && shownProgress != null && (
            <span className="kicker" style={{ fontSize: '0.625rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <span style={{ display: 'inline-block', width: '4rem', height: '3px', background: 'var(--rule-soft)', borderRadius: '2px', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${shownProgress}%`, background: 'var(--accent)', transition: 'width 0.4s ease' }} />
              </span>
              {busy
                ? `${shownProgress}% · 通常 5~10 分钟，请勿重复点击`
                : `已有季在生成话目 · ${shownProgress}% · 请勿重复点击`}
            </span>
          )}
          {locked && !thisArcRunning && (
            <span className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>
              另一季正在生成话目，请等它跑完
            </span>
          )}
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
