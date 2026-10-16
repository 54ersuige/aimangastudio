import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSeries } from '../contexts/SeriesContext';
import type { SeriesPage, SeriesCharacter, Chapter, Arc, Series, CharacterGender, CharacterAgeBand } from '../types';
import { CHARACTER_GENDERS, CHARACTER_AGE_BANDS } from '../types';
import {
  PlusIcon, RedoAltIcon, ChevronRightIcon, ChevronLeftIcon, ChevronDownIcon, ChevronUpIcon, DownloadIcon, EyeIcon,
} from './icons';
import { EmptyState, OnboardingArticles } from './EmptyState';
import { CharacterEditor, ChapterEditor, PanelsEditor, CharacterViewer } from './ManualEditors';
import { exportSeriesAsEpisodeStrips } from '../services/stripExport';
import { fetchDnaList } from '../services/modelClient';
import { DEFAULT_DNA_KEY, type DnaKey, type DnaMeta } from '../services/modelConfig';
import { CardSection } from './series-workbench/ui';
import { LoglineCard } from './series-workbench/LoglineCard';
import { WorldviewCard } from './series-workbench/WorldviewCard';
import { CharactersCard } from './series-workbench/CharactersCard';
import { ChaptersCard } from './series-workbench/ChaptersCard';
import { EpisodePreview } from './EpisodePreview';
import { useToast } from './Toast';
import { EpisodesOverview } from './series-workbench/PagesOverview';
import { EpisodeCard } from './series-workbench/EpisodeCard';
import { LegacyBanner } from './series-workbench/LegacyBanner';
import { AuditCard } from './series-workbench/AuditCard';

/**
 * 重构后的主工作台：纵向"编辑稿"卡片流
 *
 * 5 张卡从上到下：灵感 / 世界观 / 角色 / 章节 / 逐页
 * - 每张卡有自己的 kicker、状态徽章、行内行动按钮
 * - 当前活跃卡用左缘 3px 红条 + 米黄底（card--active）
 * - 滚动即流程，不再有"步骤条 1-5"
 */
export function SeriesWorkbench() {
  const ctx = useSeries();
  const toast = useToast();
  const { updatePanelDialogueInCurrent, updatePanelTextInCurrent, rewritePanelTextInCurrent } = ctx;
  const {
    currentSeries, setCurrentSeriesId, createSeries, seriesList, refreshList,
    step, setStep,
    generateWorldviewForCurrent, generateCharactersForCurrent,
    addCharacterToCurrent, deleteCharacterFromCurrent, regenerateCharacterImageInCurrent, regenerateCharacterShotInCurrent,
    generateArcsForCurrent, generateArcChaptersForCurrent, appendNextChapterForCurrent, replanChapterForCurrent,
    generateChaptersForCurrent,
    selectedPageId, setSelectedPageId,
    selectedEpisodeId, setSelectedEpisodeId,
    breakdownPageInCurrent, generatePageInCurrent, regeneratePageInCurrent,
    rewritePageInCurrent, rewritePanelInCurrent, continuePageInCurrent, generatePanelInCurrent,
    updateCharacterInCurrent,
    updateChapterInCurrent, moveChapterInCurrent, deleteChapterInCurrent,
    updatePageInCurrent, replacePanelsInCurrent, insertPanelInCurrent, deletePanelInCurrent,
    refreshCurrent,
    busy, taskProgress, error, clearError,
  } = ctx;

  const [loglineTitle, setLoglineTitle] = useState('');
  const [loglineDesc, setLoglineDesc] = useState('');
  const [loglineDnaKey, setLoglineDnaKey] = useState<DnaKey>(DEFAULT_DNA_KEY);
  const [dnaList, setDnaList] = useState<DnaMeta[]>([]);
  const [targetPages, setTargetPages] = useState(12);
  const [newCharOpen, setNewCharOpen] = useState(false);
  const [newChar, setNewChar] = useState<{
    name: string;
    role: 'protagonist' | 'antagonist' | 'supporting';
    description: string;
    appearance: string;
    roleInStory: string;
    visualAnchors: string[];
    // 2026-09-01 新增：手动添加角色时也强制要求性别 / 年龄段，
    // 这是"图片里男女老少一目了然"的第一道闸门（手动优先于 AI 推断）。
    gender?: CharacterGender;
    ageBand?: CharacterAgeBand;
  }>({
    name: '', role: 'supporting', description: '', appearance: '', roleInStory: '',
    visualAnchors: [], gender: undefined, ageBand: undefined,
  });

  // 手动编辑弹窗
  const [editingCharacter, setEditingCharacter] = useState<SeriesCharacter | null>(null);
  const [viewingCharacter, setViewingCharacter] = useState<SeriesCharacter | null>(null);
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [editingPanels, setEditingPanels] = useState<SeriesPage | null>(null);
  const [previewChapter, setPreviewChapter] = useState<{ ch: Chapter; index: number } | null>(null);

  // 统一遍历：兼容 arcs（新结构）+ chapters（旧结构）
  const allChapters = useMemo(() => {
    if (!currentSeries) return [] as Chapter[];
    if (currentSeries.arcs && currentSeries.arcs.length > 0) {
      return currentSeries.arcs.flatMap(a => a.chapters);
    }
    return currentSeries.chapters ?? [];
  }, [currentSeries]);

  const currentChapter = useMemo<Chapter | null>(() => {
    if (!currentSeries) return null;
    return allChapters.find(c => c.id === selectedEpisodeId) ?? null;
  }, [currentSeries, selectedEpisodeId, allChapters]);
  const currentEpisodeIndex = useMemo(() => allChapters.findIndex(c => c.id === selectedEpisodeId), [allChapters, selectedEpisodeId]);

  // 选话：同步 agent 桥的"当前页"到该话第一批，保证聊天指令有落点
  const pickEpisode = useCallback((chapterId: string) => {
    setSelectedEpisodeId(chapterId);
    const ch = allChapters.find(c => c.id === chapterId);
    const firstPage = ch?.pages ? [...ch.pages].sort((a, b) => a.pageNumber - b.pageNumber)[0] : undefined;
    if (firstPage) setSelectedPageId(firstPage.id);
    setStep('pages');
  }, [allChapters, setSelectedPageId, setSelectedEpisodeId, setStep]);

  const handleCreate = async () => {
    if (!loglineTitle.trim() || !loglineDesc.trim()) return;
    await createSeries({ title: loglineTitle, logline: loglineDesc, dnaKey: loglineDnaKey });
    setLoglineTitle(''); setLoglineDesc('');
  };

  // 加载系统预置 DNA 列表（创建系列时锁定一套，创建后不可改）
  useEffect(() => {
    fetchDnaList().then(r => {
      setDnaList(r.list);
      if (r.list.length > 0 && !r.list.find(d => d.key === loglineDnaKey)) {
        setLoglineDnaKey(r.list[0].key);
      }
    }).catch(() => { /* 后端未启动时静默回退到默认 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 顶栏「导出全部」：按话导出（每话一张话级长图，含文案三件套，话号全局连续）
  const handleExportAll = async () => {
    if (!currentSeries) return;
    try {
      const n = await exportSeriesAsEpisodeStrips(currentSeries);
      if (n === 0) {
        toast.push('暂无可导出的分镜图', 'error');
      } else {
        toast.push(`已导出 ${n} 话长图，请到浏览器下载目录查看`, 'success');
      }
    } catch (e: any) {
      toast.push(e.message || '导出失败', 'error');
    }
  };

  // —— 逐话生成缺图（话级）：逐批增量补齐（后端 generate 只画缺失格，已有图不动）
  const handleGenerateAllMissing = useCallback(async () => {
    if (!currentChapter) return;
    const pages = [...currentChapter.pages].sort((a, b) => a.pageNumber - b.pageNumber);
    for (const pg of pages) {
      if (pg.panels.length === 0 || pg.panels.every(pn => pn.imageUrl)) continue;
      const r = await generatePageInCurrent(pg.id);
      if (!r) break; // 出错即停，保留已生成部分
    }
  }, [currentChapter, generatePageInCurrent]);

  // 角色详情弹窗里的「重生成 sheet」按钮
  const handleRegenShot = useCallback(async (c: SeriesCharacter, shot: 'sheet') => {
    if (!c) return;
    await regenerateCharacterShotInCurrent(c.id, shot);
  }, [regenerateCharacterShotInCurrent]);

  const handleAddCharacter = async () => {
    if (!newChar.name || !newChar.description || !newChar.appearance) return;
    await addCharacterToCurrent({
      ...newChar,
      visualAnchors: newChar.visualAnchors,
      gender: newChar.gender,
      ageBand: newChar.ageBand,
      autoGenerateImage: true,
    });
    setNewChar({
      name: '', role: 'supporting', description: '', appearance: '', roleInStory: '',
      visualAnchors: [], gender: undefined, ageBand: undefined,
    });
    setNewCharOpen(false);
  };

  // ============== 视图：未选系列 ==============
  if (!currentSeries) {
    // 空状态：项目列表紧凑展示 + 新建卡占主区。窄屏时不显示侧栏。
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minHeight: '100%' }}>
        <aside style={{ background: 'var(--paper)', borderBottom: '1px solid var(--rule)', padding: '1.25rem 1.25rem 0.5rem', overflowY: 'auto' }}>
          <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>目录</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {seriesList.length === 0 && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--ink-3)' }}>还没有连载 · 在下面新建一个</div>
            )}
            {seriesList.map(s => {
              // 兼容 arcs（新结构）+ chapters（旧结构）；旧 series 通过启动迁移应该都已经迁移，
              // 但前端在迁移完成前的瞬间仍可能看到旧形态，所以这里取兼容写法。
              const flatChapters = s.arcs && s.arcs.length > 0
                ? s.arcs.flatMap(a => a.chapters)
                : (s.chapters ?? []);
              const totalPages = flatChapters.reduce((sum, c) => sum + c.pages.length, 0);
              const donePages = flatChapters.reduce((sum, c) => sum + c.pages.filter(p => p.status === 'done').length, 0);
              return (
                <button
                  key={s.id}
                  onClick={() => setCurrentSeriesId(s.id)}
                  className="card"
                  style={{
                    textAlign: 'left', padding: '0.5rem 0.75rem', cursor: 'pointer',
                    background: 'var(--bg-card)', border: '1px solid var(--rule-soft)',
                    color: 'var(--ink)', minWidth: 0,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || '（未命名）'}</div>
                  <div style={{ fontSize: '0.625rem', color: 'var(--ink-3)', marginTop: '0.125rem' }}>
                    {flatChapters.length} 章 · {donePages}/{totalPages} 页
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* —— 右：新建连载 + Onboarding —— */}
        <main style={{ padding: '2.5rem 3rem', overflowY: 'auto', background: 'var(--paper-2, var(--paper))' }}>
          <EmptyState
            title="开始一个新的连载"
            deck="用一句话告诉我你想画的漫画。AI 会帮你设计世界观、角色，并自动生成连续的分镜页面。"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
              <div>
                <label className="field-label">漫画标题</label>
                <input
                  className="field-input"
                  value={loglineTitle}
                  onChange={e => setLoglineTitle(e.target.value)}
                  placeholder="例如：机械师少女"
                />
              </div>
              <div>
                <label className="field-label">故事简介（一句话）</label>
                <textarea
                  className="field-textarea"
                  value={loglineDesc}
                  onChange={e => setLoglineDesc(e.target.value)}
                  rows={3}
                  placeholder="例如：2077 年的东京，一个修理机器人的少女意外发现自家机器人有意识，与企业巨头展开对抗。"
                />
              </div>
              <div>
                <label className="field-label">画风 DNA（创建后不可更改）</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.625rem' }}>
                  {dnaList.length === 0 ? (
                    <div style={{ fontSize: '0.875rem', color: 'var(--ink-2)' }}>默认：纽约客·城市叙事（后端不可用时）</div>
                  ) : (
                    dnaList.map(d => {
                      const selected = d.key === loglineDnaKey;
                      return (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => setLoglineDnaKey(d.key)}
                          className="btn"
                          style={{
                            textAlign: 'left',
                            padding: '0.75rem 0.875rem',
                            borderRadius: '0.5rem',
                            border: selected ? '2px solid var(--ink-2, #2a2622)' : '1px solid var(--rule)',
                            background: selected ? 'var(--paper-3, #f0e9d8)' : 'var(--paper, #fbf7ec)',
                            boxShadow: selected ? '0 1px 0 var(--ink-2, #2a2622)' : 'none',
                            display: 'flex', flexDirection: 'column', gap: '0.25rem',
                            whiteSpace: 'normal', alignItems: 'stretch', minWidth: 0,
                            transition: 'all 120ms ease',
                      }}
                        >
                          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{d.name}</span>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.4 }}>{d.tagline}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', marginTop: '0.5rem', marginBottom: 0 }}>
                  画风由系统 Art Direction 锁定为所选 DNA；简介中的题材/氛围提示会作为世界观参考。
                </p>
              </div>
              <button
                onClick={handleCreate}
                disabled={busy || !loglineTitle.trim() || !loglineDesc.trim()}
                className="btn btn--primary"
                style={{ alignSelf: 'flex-start', marginTop: '0.5rem', padding: '0.75rem 1.5rem' }}
              >
                {busy ? '创建中…' : '下一步：生成世界观 ▸'}
              </button>
            </div>
          </EmptyState>

          <hr className="rule" style={{ margin: '2.5rem 0 1.5rem' }} />
          <div style={{ marginBottom: '1rem' }}>
            <div className="kicker kicker--accent">快速上手</div>
            <h2 className="headline headline--xl">三件事，这个工具能帮你</h2>
          </div>
          <OnboardingArticles />
        </main>
      </div>
    );
  }

  // ============== 视图：已选系列，纵向卡片流 ==============

  // 决定每张卡的"状态"
  const wStatus = !currentSeries.worldview ? 'pending' : 'done';
  const cStatus = currentSeries.characters.length === 0 ? 'pending' : 'done';
  // 季蓝图/季骨架已就绪但还没拆出任何话 —— 不是"未开始"，是"待拆话目"
  const structureReady = (currentSeries.worldview?.arcBlueprints?.length ?? 0) > 0 || (currentSeries.arcs?.length ?? 0) > 0;
  const ivStatus: 'pending' | 'in_progress' | 'done' = allChapters.length > 0
    ? (allChapters.every(ch => ch.pages.every(p => p.panels.every(pn => !!pn.imageUrl))) ? 'done' : 'in_progress')
    : structureReady ? 'in_progress' : 'pending';
  const pStatus = allChapters.length === 0 ? 'pending'
    : allChapters.every(ch => ch.pages.every(p => p.panels.every(pn => !!pn.imageUrl))) ? 'done' : 'in_progress';

  return (
    <div style={{ padding: '2rem 2.5rem 4rem', maxWidth: '60rem', margin: '0 auto' }}>
      {/* —— 错误提示 —— */}
      {error && (
        <div style={{
          background: '#FBEAE8', border: '1px solid #E3B0AB', borderLeft: '4px solid #B0413E',
          color: '#5B1F1B', padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '4px',
          display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
        }}>
          <span style={{ flexShrink: 0, fontSize: '1rem' }}>⚠</span>
          <div style={{ flex: 1, fontSize: '0.875rem', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', marginBottom: '0.125rem' }}>操作失败</strong>
            <span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>
          </div>
          <button onClick={clearError} className="btn btn--link" style={{ flexShrink: 0, color: '#5B1F1B' }}>✕</button>
        </div>
      )}
      {/* —— 顶：项目"封面页" —— */}
      <header style={{ marginBottom: '2rem', borderBottom: '1px solid var(--rule)', paddingBottom: '1.5rem' }}>
        <div className="kicker kicker--accent">本期连载</div>
        <h1 className="headline headline--xxl" style={{ marginTop: '0.5rem' }}>{currentSeries.title}</h1>
        {currentSeries.logline && (
          <p className="deck" style={{ marginTop: '0.75rem', fontSize: '1.0625rem', maxWidth: '42rem' }}>
            {currentSeries.logline}
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1rem', alignItems: 'center' }}>
          {allChapters.length > 0 && (
            <button onClick={handleExportAll} className="btn btn--ghost" style={{ fontSize: '0.75rem', padding: '0.5rem 0.875rem' }}>
              <DownloadIcon className="w-3.5 h-3.5" />导出全部
            </button>
          )}
          <button onClick={() => setCurrentSeriesId(null)} className="btn btn--link" style={{ fontSize: '0.75rem' }}>
            ← 返回目录
          </button>
        </div>
      </header>

      {/* 2026-09-07 反馈层 P3：legacy 角色红条（缺必填字段时显示）。 */}
      <LegacyBanner
        onJump={(sid) => {
          // 跳到对应 series —— 若当前就是该 series，则不切；否则切换。
          if (currentSeries?.id !== sid) setCurrentSeriesId(sid);
          toast.push('已切换到对应 series，去角色卡补全字段', 'default');
        }}
      />

      {/* —— Card I · 灵感（项目元数据，可改） —— */}
      <CardSection
        index="I"
        kicker="灵感"
        status={currentSeries.logline ? 'done' : 'pending'}
        active={step === 'logline'}
        title={currentSeries.title}
      >
        <LoglineCard series={currentSeries} />
      </CardSection>

      {/* —— Card II · 世界观 —— */}
      <CardSection
        index="II"
        kicker="世界观"
        status={wStatus}
        active={step === 'worldview'}
        title={currentSeries.worldview?.summary || '设计你的世界观'}
      >
        <WorldviewCard
          series={currentSeries}
          onGenerate={generateWorldviewForCurrent}
          busy={busy}
        />
      </CardSection>

      {/* —— Card III · 角色 —— */}
      <CardSection
        index="III"
        kicker="角色"
        status={cStatus}
        active={step === 'characters'}
        title={currentSeries.characters.length > 0 ? `${currentSeries.characters.length} 位角色` : '设计主要角色'}
      >
        <CharactersCard
          series={currentSeries}
          onGenerate={generateCharactersForCurrent}
          onAddChar={() => setNewCharOpen(true)}
          onDeleteChar={deleteCharacterFromCurrent}
          onRegenCharImg={regenerateCharacterImageInCurrent}
          onRegenCharShot={regenerateCharacterShotInCurrent}
          onEdit={(c) => setEditingCharacter(c)}
          onView={(c) => setViewingCharacter(c)}
          busy={busy}
        />
      </CardSection>

      {/* —— Card IV · 季与话目 —— */}
      <CardSection
        index="IV"
        kicker="季 · 话目"
        status={ivStatus}
        active={step === 'chapters'}
        title={currentSeries.arcs && currentSeries.arcs.length > 0
            ? `${currentSeries.arcs.length} 季 · ${allChapters.length} 话`
            : allChapters.length > 0
              ? `${allChapters.length} 话`
              : structureReady ? '季蓝图已就绪，待拆话目' : '拆分连载结构'}
      >
        <ChaptersCard
          series={currentSeries}
          targetPages={targetPages}
          setTargetPages={setTargetPages}
          onGenerate={generateChaptersForCurrent}
          onGenerateArcs={generateArcsForCurrent}
          onGenerateArcChapters={generateArcChaptersForCurrent}
          onAppendNextChapter={appendNextChapterForCurrent}
          onPickEpisode={pickEpisode}
          onEditChapter={(ch) => setEditingChapter(ch)}
          onPreviewChapter={(ch, index) => setPreviewChapter({ ch, index })}
          busy={busy}
        />
      </CardSection>

      {/* —— Card V · 逐话 —— */}
      <CardSection
        index="V"
        kicker="逐话生成"
        status={pStatus}
        active={step === 'pages'}
        title={currentChapter && currentEpisodeIndex >= 0 ? `第 ${currentEpisodeIndex + 1} 话《${currentChapter.title}》` : '逐话生成分镜'}
      >
        {currentChapter && currentEpisodeIndex >= 0 ? (
          <EpisodeCard
            series={currentSeries}
            chapter={currentChapter}
            episodeIndex={currentEpisodeIndex + 1}
            episodeCount={allChapters.length}
            onPrev={() => { if (currentEpisodeIndex > 0) pickEpisode(allChapters[currentEpisodeIndex - 1].id); }}
            onNext={() => { if (currentEpisodeIndex < allChapters.length - 1) pickEpisode(allChapters[currentEpisodeIndex + 1].id); }}
            // 2026-10-16：本话拆完后的主操作。此前这个状态下按钮显示「续写本话」，
            // 但它会跑去填下一话的第一批 —— 名实不符。现在显式跳到下一话。
            onNextEpisode={() => { if (currentEpisodeIndex < allChapters.length - 1) pickEpisode(allChapters[currentEpisodeIndex + 1].id); }}
            // 2026-10-16：重新规划本话。推倒重写 summary，
            // 让它真的撑满规划容量且有戏剧张力。
            onReplan={async (chapterId) => { await replanChapterForCurrent(chapterId); }}
            busy={busy}
            taskProgress={taskProgress}
            onBreakdownBatch={async (pageId) => { await breakdownPageInCurrent(pageId); }}
            onGenerateBatch={async (pageId) => { await generatePageInCurrent(pageId); }}
            onRegenerateBatch={async (pageId) => { await regeneratePageInCurrent(pageId); }}
            onRewriteBatch={async (pageId, instruction) => { await rewritePageInCurrent(pageId, instruction); }}
            onEditBatch={(pg) => setEditingPanels(pg)}
            onGenerateAllMissing={handleGenerateAllMissing}
            onContinue={async () => {
              const pages = [...currentChapter.pages].sort((a, b) => a.pageNumber - b.pageNumber);
              const last = pages[pages.length - 1];
              if (last) await continuePageInCurrent(last.id);
            }}
            onPreview={() => setPreviewChapter({ ch: currentChapter, index: currentEpisodeIndex + 1 })}
            onGeneratePanel={async (pageId, panelIndex) => { await generatePanelInCurrent(pageId, panelIndex); }}
            onRewritePanel={async (pageId, panelIndex, instruction) => { await rewritePanelInCurrent(pageId, panelIndex, instruction); }}
            onUpdatePanelText={async (pageId, idx, dialogue) => { await updatePanelDialogueInCurrent(pageId, idx, dialogue); }}
            onUpdatePanelTextV2={async (pageId, idx, text) => { await updatePanelTextInCurrent(pageId, idx, text); }}
            onRewritePanelText={async (pageId, idx, instruction) => { await rewritePanelTextInCurrent(pageId, idx, instruction); }}
          />
        ) : (
          <EpisodesOverview series={currentSeries} onPickEpisode={pickEpisode} />
        )}
      </CardSection>

      {/* 2026-09-07 反馈层 P3：审计卡片 —— driftScore + 最近不达标记录 */}
      <AuditCard seriesId={currentSeries?.id} />

      {/* —— 新增角色弹窗 —— */}
      {newCharOpen && (
        <div className="modal-veil" onClick={() => setNewCharOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>手动添加</div>
            <h3 className="headline headline--lg" style={{ marginBottom: '0.875rem' }}>新角色</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label className="field-label">名字</label>
                <input className="field-input" value={newChar.name} onChange={e => setNewChar({ ...newChar, name: e.target.value })} placeholder="角色名字" />
              </div>
              <div>
                <label className="field-label">定位</label>
                <select className="field-input" value={newChar.role} onChange={e => setNewChar({ ...newChar, role: e.target.value as any })}>
                  <option value="protagonist">主角</option>
                  <option value="antagonist">反派</option>
                  <option value="supporting">配角</option>
                </select>
              </div>
              {/* —— 2026-09-01 新增：性别 / 年龄段下拉（手动优先于 AI 推断）。
                  如果不填，AI 偶尔会把"短发瘦小女生"画成中性偏男生面孔。 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label className="field-label">性别</label>
                  <select
                    className="field-input"
                    value={newChar.gender ?? ''}
                    onChange={e => setNewChar({ ...newChar, gender: (e.target.value || undefined) as CharacterGender | undefined })}
                  >
                    <option value="">（未指定 — 让 AI 推断）</option>
                    <option value="female">女</option>
                    <option value="male">男</option>
                    <option value="ambiguous">中性（性别模糊）</option>
                    <option value="nonbinary">非二元</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">年龄段</label>
                  <select
                    className="field-input"
                    value={newChar.ageBand ?? ''}
                    onChange={e => setNewChar({ ...newChar, ageBand: (e.target.value || undefined) as CharacterAgeBand | undefined })}
                  >
                    <option value="">（未指定 — 让 AI 推断）</option>
                      <option value="child">儿童 (&lt;13)</option>
                      <option value="teen">青少年 (13-19)</option>
                      <option value="young_adult">青年 (20-34)</option>
                      <option value="middle_aged">中年 (35-54)</option>
                      <option value="elderly">老年 (≥55)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">背景/性格</label>
                <textarea className="field-textarea" value={newChar.description} onChange={e => setNewChar({ ...newChar, description: e.target.value })} rows={2} placeholder="1-2 句" />
              </div>
              <div>
                <label className="field-label">外貌</label>
                <textarea className="field-textarea" value={newChar.appearance} onChange={e => setNewChar({ ...newChar, appearance: e.target.value })} rows={3} placeholder="用于 AI 生图，按「体型→发型→脸→眼睛→服装」顺序写，3-5 句" />
              </div>
              <div>
                <label className="field-label">故事内定位（可选）</label>
                <input className="field-input" value={newChar.roleInStory} onChange={e => setNewChar({ ...newChar, roleInStory: e.target.value })} placeholder="例：主角的职场导师" />
              </div>
              <div>
                <label className="field-label">视觉锚点（逗号分隔，3-6 条）</label>
                <input className="field-input" value={newChar.visualAnchors.join('、')} onChange={e => setNewChar({ ...newChar, visualAnchors: e.target.value.split(/[、,,]/).map(s => s.trim()).filter(Boolean) })} placeholder="例：黑色短发, 左眼下痣, 银色项链" />
                <p className="kicker" style={{ fontSize: '0.625rem', marginTop: '0.25rem', color: 'var(--ink-3)' }}>
                  这些高辨识度特征会被强制带入每一格分镜。
                </p>
              </div>
            </div>
            <hr className="rule" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setNewCharOpen(false)} className="btn btn--ghost">取消</button>
              <button onClick={handleAddCharacter} disabled={busy} className="btn btn--primary">添加并生成参考图</button>
            </div>
          </div>
        </div>
      )}

      {/* —— 手动编辑弹窗 —— */}
      <CharacterViewer
        open={!!viewingCharacter}
        character={viewingCharacter}
        onClose={() => setViewingCharacter(null)}
        onEdit={(c) => setEditingCharacter(c)}
        onRegenShot={handleRegenShot}
      />
      <CharacterEditor
        open={!!editingCharacter}
        character={editingCharacter}
        onClose={() => setEditingCharacter(null)}
        onSave={async (patch) => {
          if (!editingCharacter) return;
          await updateCharacterInCurrent(editingCharacter.id, patch);
        }}
      />
      <ChapterEditor
        open={!!editingChapter}
        chapter={editingChapter}
        siblings={allChapters.map(c => ({ id: c.id, title: c.title }))}
        onClose={() => setEditingChapter(null)}
        onSave={async (patch) => {
          if (!editingChapter) return;
          await updateChapterInCurrent(editingChapter.id, patch);
        }}
        onDelete={editingChapter ? async () => {
          // 二次确认由 ChapterEditor 内的两步按钮（删除章节 → 确认删除）承担，不再叠加原生 confirm
          await deleteChapterInCurrent(editingChapter.id);
        } : undefined}
        onMove={editingChapter ? async (dir) => {
          await moveChapterInCurrent(editingChapter.id, dir);
        } : undefined}
      />
      <PanelsEditor
        open={!!editingPanels}
        page={editingPanels}
        onClose={() => setEditingPanels(null)}
        onSavePanels={async (panels) => {
          if (!editingPanels) return;
          await replacePanelsInCurrent(editingPanels.id, panels);
        }}
        onInsertPanel={async (at) => {
          if (!editingPanels) return;
          await insertPanelInCurrent(editingPanels.id, at);
          // 重新打开时拉最新 page
          const fresh = currentSeries && (currentSeries.arcs?.flatMap(a => a.chapters).flatMap(c => c.pages).find(p => p.id === editingPanels.id));
          if (fresh) setEditingPanels(fresh);
        }}
        onDeletePanel={async (panelId) => {
          if (!editingPanels) return;
          await deletePanelInCurrent(editingPanels.id, panelId);
          const fresh = currentSeries && (currentSeries.arcs?.flatMap(a => a.chapters).flatMap(c => c.pages).find(p => p.id === editingPanels.id));
          if (fresh) setEditingPanels(fresh);
        }}
      />
      {previewChapter && currentSeries && (() => {
        // 预览期间用最新章数据（保存文案/刷新后保持同步）；话号全局连续（跨章）
        const live = allChapters.find(c => c.id === previewChapter.ch.id) ?? previewChapter.ch;
        const idx = allChapters.findIndex(c => c.id === live.id);
        const chapterIndex = idx >= 0 ? idx + 1 : previewChapter.index;
        const prevTitle = idx > 0 ? allChapters[idx - 1]?.title : undefined;
        return (
          <EpisodePreview
            series={currentSeries}
            chapter={live}
            chapterIndex={chapterIndex}
            prevChapterTitle={prevTitle}
            isLast={idx === allChapters.length - 1}
            onClose={() => setPreviewChapter(null)}
            onChanged={() => { void refreshCurrent(); }}
          />
        );
      })()}
    </div>
  );
}

