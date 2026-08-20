import React, { useState, useMemo, useEffect } from 'react';
import { useSeries } from '../contexts/SeriesContext';
import type { SeriesPage, SeriesCharacter, Chapter, Series } from '../types';
import {
  PlusIcon, RedoAltIcon, ChevronRightIcon, ChevronLeftIcon, ChevronDownIcon, ChevronUpIcon, DownloadIcon, EyeIcon,
} from './icons';
import { EmptyState, OnboardingArticles } from './EmptyState';
import { exportSeriesAsStrips } from '../services/stripExport';
import { fetchDnaList } from '../services/modelClient';
import { DEFAULT_DNA_KEY, type DnaKey, type DnaMeta } from '../services/modelConfig';

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
  const {
    currentSeries, setCurrentSeriesId, createSeries, seriesList, refreshList,
    step, setStep,
    generateWorldviewForCurrent, generateCharactersForCurrent,
    addCharacterToCurrent, deleteCharacterFromCurrent, regenerateCharacterImageInCurrent,
    generateChaptersForCurrent,
    selectedPageId, setSelectedPageId,
    breakdownSelectedPage, generateSelectedPage, regenerateSelectedPage,
    rewriteSelectedPage, rewriteSelectedPanel, continueFromSelectedPage,
    busy,
  } = ctx;

  const [loglineTitle, setLoglineTitle] = useState('');
  const [loglineDesc, setLoglineDesc] = useState('');
  const [loglineDnaKey, setLoglineDnaKey] = useState<DnaKey>(DEFAULT_DNA_KEY);
  const [dnaList, setDnaList] = useState<DnaMeta[]>([]);
  const [targetPages, setTargetPages] = useState(12);
  const [pageInstruction, setPageInstruction] = useState('');
  const [panelInstrOpen, setPanelInstrOpen] = useState<number | null>(null);
  const [panelInstruction, setPanelInstruction] = useState('');
  const [newCharOpen, setNewCharOpen] = useState(false);
  const [newChar, setNewChar] = useState({ name: '', role: 'supporting' as const, description: '', appearance: '' });

  const currentPage = useMemo<SeriesPage | null>(() => {
    if (!currentSeries || !selectedPageId) return null;
    for (const ch of currentSeries.chapters) {
      const p = ch.pages.find(pp => pp.id === selectedPageId);
      if (p) return p;
    }
    return null;
  }, [currentSeries, selectedPageId]);

  const allPages = useMemo(() => {
    if (!currentSeries) return [] as { chapterId: string; chapterTitle: string; page: SeriesPage }[];
    return currentSeries.chapters.flatMap(ch =>
      ch.pages.map(p => ({ chapterId: ch.id, chapterTitle: ch.title, page: p }))
    );
  }, [currentSeries]);

  const currentPageFlatIndex = useMemo(() => allPages.findIndex(x => x.page.id === selectedPageId), [allPages, selectedPageId]);
  const nextPage = currentPageFlatIndex >= 0 ? allPages[currentPageFlatIndex + 1] : null;

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

  const handleExportAll = async () => {
    if (!currentSeries) return;
    const pages = allPages.map(x => x.page);
    const n = await exportSeriesAsStrips(pages, currentSeries.title);
    if (n === 0) {
      alert('暂无可导出的分镜图');
    }
  };

  const handleRewritePanel = async (panelIndex: number) => {
    if (!panelInstruction.trim()) return;
    await rewriteSelectedPanel(panelIndex, panelInstruction);
    setPanelInstruction('');
    setPanelInstrOpen(null);
  };

  const handleAddCharacter = async () => {
    if (!newChar.name || !newChar.description || !newChar.appearance) return;
    await addCharacterToCurrent({ ...newChar, autoGenerateImage: true });
    setNewChar({ name: '', role: 'supporting', description: '', appearance: '' });
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
              const totalPages = s.chapters.reduce((sum, c) => sum + c.pages.length, 0);
              const donePages = s.chapters.reduce((sum, c) => sum + c.pages.filter(p => p.status === 'done').length, 0);
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
                    {s.chapters.length} 章 · {donePages}/{totalPages} 页
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
  const chStatus = currentSeries.chapters.length === 0 ? 'pending' : 'done';
  const pStatus = allPages.length === 0 ? 'pending' : allPages.every(p => p.page.status === 'done') ? 'done' : 'in_progress';

  return (
    <div style={{ padding: '2rem 2.5rem 4rem', maxWidth: '60rem', margin: '0 auto' }}>
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
          {currentSeries.chapters.length > 0 && (
            <button onClick={handleExportAll} className="btn btn--ghost" style={{ fontSize: '0.75rem', padding: '0.5rem 0.875rem' }}>
              <DownloadIcon className="w-3.5 h-3.5" />导出全部
            </button>
          )}
          <button onClick={() => setCurrentSeriesId(null)} className="btn btn--link" style={{ fontSize: '0.75rem' }}>
            ← 返回目录
          </button>
        </div>
      </header>

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
          busy={busy}
        />
      </CardSection>

      {/* —— Card IV · 章节 —— */}
      <CardSection
        index="IV"
        kicker="章节大纲"
        status={chStatus}
        active={step === 'chapters'}
        title={currentSeries.chapters.length > 0 ? `${currentSeries.chapters.length} 章 / ${allPages.length} 页` : '拆分章节'}
      >
        <ChaptersCard
          series={currentSeries}
          targetPages={targetPages}
          setTargetPages={setTargetPages}
          onGenerate={generateChaptersForCurrent}
          onPickPage={(id) => { setSelectedPageId(id); setStep('pages'); }}
          busy={busy}
        />
      </CardSection>

      {/* —— Card V · 逐页 —— */}
      <CardSection
        index="V"
        kicker="逐页生成"
        status={pStatus}
        active={step === 'pages'}
        title={currentPage ? currentPage.title : '逐页生成分镜'}
      >
        {currentPage ? (
          <PageCard
            series={currentSeries}
            page={currentPage}
            allPages={allPages}
            currentIndex={currentPageFlatIndex}
            onPrev={() => currentPageFlatIndex > 0 && setSelectedPageId(allPages[currentPageFlatIndex - 1].page.id)}
            onNext={() => nextPage && setSelectedPageId(nextPage.page.id)}
            onBreakdown={breakdownSelectedPage}
            onGenerate={generateSelectedPage}
            onRegenerate={regenerateSelectedPage}
            onRewritePage={async () => {
              if (!pageInstruction.trim()) return;
              await rewriteSelectedPage(pageInstruction);
              setPageInstruction('');
            }}
            pageInstruction={pageInstruction}
            setPageInstruction={setPageInstruction}
            onRewritePanel={handleRewritePanel}
            panelInstrOpen={panelInstrOpen}
            setPanelInstrOpen={setPanelInstrOpen}
            panelInstruction={panelInstruction}
            setPanelInstruction={setPanelInstruction}
            onContinue={continueFromSelectedPage}
            busy={busy}
          />
        ) : (
          <PagesOverview series={currentSeries} onPickPage={(id) => { setSelectedPageId(id); setStep('pages'); }} />
        )}
      </CardSection>

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
              <div>
                <label className="field-label">背景/性格</label>
                <textarea className="field-textarea" value={newChar.description} onChange={e => setNewChar({ ...newChar, description: e.target.value })} rows={2} placeholder="1-2 句" />
              </div>
              <div>
                <label className="field-label">外貌</label>
                <textarea className="field-textarea" value={newChar.appearance} onChange={e => setNewChar({ ...newChar, appearance: e.target.value })} rows={3} placeholder="用于 AI 生图，2-3 句" />
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
    </div>
  );
}

/* ============================================================
 * 卡片框架（kicker + 标题 + 状态徽章 + 活跃红条）
 * ============================================================ */

type CardStatus = 'pending' | 'in_progress' | 'done';

function CardSection({
  index, kicker, status, title, active, children,
}: {
  index: string;
  kicker: string;
  status: CardStatus;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const badge =
    status === 'done'
      ? { text: '已完成', color: 'var(--ink-2)', bg: 'var(--bg-soft)' }
      : status === 'in_progress'
      ? { text: '进行中', color: 'var(--paper)', bg: 'var(--accent)' }
      : { text: '未开始', color: 'var(--ink-3)', bg: 'transparent' };

  return (
    <section
      className={`card fade-in ${active ? 'card--active' : ''}`}
      style={{
        padding: '1.5rem 1.75rem',
        marginBottom: '1.5rem',
        background: active ? '#FFFCF3' : 'var(--bg-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem', borderBottom: '1px solid var(--rule-soft)', paddingBottom: '0.75rem' }}>
        <span className="chapter-num" style={{ fontSize: '1.75rem' }}>§ {index}</span>
        <div style={{ flex: 1 }}>
          <div className="kicker kicker--accent">{kicker}</div>
          <h2 className="headline headline--lg" style={{ marginTop: '0.125rem' }}>{title}</h2>
        </div>
        <span style={{
          fontSize: '0.625rem', letterSpacing: '0.18em', textTransform: 'uppercase',
          color: badge.color, background: badge.bg,
          padding: '0.25rem 0.625rem',
          border: status === 'pending' ? '1px solid var(--rule-soft)' : 'none',
        }}>
          {badge.text}
        </span>
      </div>
      <div>{children}</div>
    </section>
  );
}

/* ============================================================
 * 各卡片内容
 * ============================================================ */

function LoglineCard({ series, dnaList = [] }: { series: Series; dnaList?: DnaMeta[] }) {
  // series.dnaKey 在创建时被冻结；找不到 metadata 时回退到 key 字符串，避免「未加载 DNA 元数据」时显示空白。
  const dnaMeta = dnaList.find(d => d.key === series.dnaKey);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div>
          <div className="kicker">故事简介</div>
          <p style={{ fontSize: '1rem', lineHeight: 1.6, color: 'var(--ink)', marginTop: '0.5rem' }}>{series.logline}</p>
        </div>
        <div>
          <div className="kicker">画风 DNA（创建后不可更改）</div>
          {dnaMeta ? (
            <>
              <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--ink)', marginTop: '0.5rem' }}>{dnaMeta.name}</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.4, marginTop: '0.25rem' }}>{dnaMeta.tagline}</p>
            </>
          ) : (
            <p style={{ fontSize: '0.9375rem', color: 'var(--ink-2)', marginTop: '0.5rem' }}>{series.dnaKey || '（加载中…）'}</p>
          )}
        </div>
      </div>
      <hr className="rule-soft" />
      <div className="kicker">这些信息是后续每一步 AI 生成的依据，可在聊天中修改（画风除外）。</div>
    </div>
  );
}

function WorldviewCard({ series, onGenerate, busy }: { series: Series; onGenerate: () => void; busy: boolean }) {
  if (!series.worldview) {
    return (
      <div>
        <p className="deck" style={{ marginBottom: '1rem' }}>AI 会根据你的简介设定时代、背景、画风、色调。</p>
        <button onClick={onGenerate} disabled={busy} className="btn btn--primary">
          {busy ? '生成中…' : '生成世界观 ▸'}
        </button>
      </div>
    );
  }
  const w = series.worldview;
  return (
    <div>
      <p className="italic-serif" style={{ fontSize: '1.125rem', color: 'var(--ink-2)', marginBottom: '1rem' }}>
        {w.summary}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem', marginBottom: '1rem' }}>
        <InfoChip label="时代" value={w.era} />
        <InfoChip label="画风" value={w.artStyle} />
        <InfoChip label="色调" value={w.paletteMood} />
      </div>
      <details>
        <summary className="kicker" style={{ cursor: 'pointer' }}>展开背景设定 ▾</summary>
        <div style={{ marginTop: '0.75rem', fontSize: '0.9375rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{w.background}</div>
      </details>
      <hr className="rule-soft" />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onGenerate} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
          <RedoAltIcon className="w-3.5 h-3.5" />重新生成
        </button>
      </div>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-soft)', padding: '0.625rem 0.75rem' }}>
      <div className="kicker" style={{ fontSize: '0.5625rem' }}>{label}</div>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.35, marginTop: '0.25rem' }}>{value}</div>
    </div>
  );
}

function CharactersCard({
  series, onGenerate, onAddChar, onDeleteChar, onRegenCharImg, busy,
}: {
  series: Series;
  onGenerate: () => void;
  onAddChar: () => void;
  onDeleteChar: (id: string) => void | Promise<void>;
  onRegenCharImg: (id: string) => void | Promise<void>;
  busy: boolean;
}) {
  if (series.characters.length === 0) {
    return (
      <div>
        <p className="deck" style={{ marginBottom: '1rem' }}>AI 会创建 3-4 位角色并各自生成一张参考图；之后每页画到这个角色都会用这张图保持一致。</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onGenerate} disabled={busy} className="btn btn--primary">
            {busy ? '生成中…' : '自动生成 3-4 个角色 ▸'}
          </button>
          <button onClick={onAddChar} className="btn btn--ghost">手动添加</button>
        </div>
      </div>
    );
  }
  const roleLabel = (r: string) => r === 'protagonist' ? '主角' : r === 'antagonist' ? '反派' : '配角';
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '1rem' }}>
        {series.characters.map(c => (
          <div key={c.id} style={{ background: 'var(--bg-soft)' }}>
            <div style={{ aspectRatio: '1 / 1', background: 'var(--bg-paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {c.referenceImage ? (
                <img src={c.referenceImage} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>暂无参考图</span>
              )}
            </div>
            <div style={{ padding: '0.625rem 0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{c.name}</span>
                <span className="kicker" style={{ fontSize: '0.5625rem', color: c.role === 'protagonist' ? 'var(--accent)' : 'var(--ink-3)' }}>
                  {roleLabel(c.role)}
                </span>
              </div>
              <p style={{ fontSize: '0.6875rem', color: 'var(--ink-2)', marginTop: '0.375rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.description}</p>
              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
                <button onClick={() => onRegenCharImg(c.id)} disabled={busy} className="btn btn--link" style={{ fontSize: '0.6875rem', padding: 0 }}>重生成图</button>
                <span style={{ flex: 1 }} />
                <button onClick={() => onDeleteChar(c.id)} className="btn btn--link" style={{ fontSize: '0.6875rem', padding: 0, color: 'var(--danger)' }}>删除</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <hr className="rule-soft" />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={onGenerate} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
          <RedoAltIcon className="w-3.5 h-3.5" />{busy ? '生成中…' : '重新生成全部'}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={onAddChar} className="btn btn--ghost" style={{ fontSize: '0.8125rem' }}>
          <PlusIcon className="w-3.5 h-3.5" />手动添加
        </button>
      </div>
    </div>
  );
}

function ChaptersCard({
  series, targetPages, setTargetPages, onGenerate, onPickPage, busy,
}: {
  series: Series;
  targetPages: number;
  setTargetPages: (n: number) => void;
  onGenerate: (target: number) => Promise<Chapter[] | null>;
  onPickPage: (id: string) => void;
  busy: boolean;
}) {
  if (series.chapters.length === 0) {
    return (
      <div>
        <p className="deck" style={{ marginBottom: '1rem' }}>告诉 AI 你总共想要多少页（推荐 8-20 页），它会自动拆分成章节。</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
          <label className="field-label" style={{ marginBottom: 0 }}>目标总页数</label>
          <input
            type="number" min={4} max={60} value={targetPages}
            onChange={e => setTargetPages(Number(e.target.value))}
            style={{
              width: '5rem', padding: '0.375rem 0.5rem',
              border: '1px solid var(--rule-soft)', fontSize: '0.875rem',
              fontFamily: 'var(--font-mono)', textAlign: 'center',
            }}
          />
        </div>
        <button onClick={() => onGenerate(targetPages)} disabled={busy} className="btn btn--primary">
          {busy ? '拆分中…' : '生成章节 ▸'}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {series.chapters.map((ch: Chapter, i: number) => (
          <div key={ch.id} style={{ background: 'var(--bg-soft)', padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.0625rem', fontWeight: 600 }}>
                <span className="chapter-num" style={{ fontSize: '1rem', marginRight: '0.375rem' }}>§{toRoman(i + 1)}</span>
                {ch.title}
              </h3>
              <span className="mono" style={{ fontSize: '0.6875rem', color: 'var(--ink-3)' }}>{ch.pages.length} 页</span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: '0.75rem' }}>{ch.summary}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(2.25rem, 1fr))', gap: '0.375rem', maxWidth: '24rem' }}>
              {ch.pages.map(p => {
                const firstImg = p.panels.find(pn => pn.imageUrl)?.imageUrl;
                return (
                  <button
                    key={p.id}
                    onClick={() => onPickPage(p.id)}
                    className="panel-thumb"
                    style={{
                      aspectRatio: '3 / 4',
                      border: '1px solid var(--rule-soft)',
                      cursor: 'pointer',
                      background: firstImg ? 'transparent' : 'var(--bg-paper-2)',
                    }}
                    title={p.title}
                  >
                    {firstImg ? (
                      <img src={firstImg} alt="" />
                    ) : (
                      <span style={{ color: p.status === 'done' ? 'var(--accent)' : 'var(--ink-3)' }}>
                        {p.pageNumber}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <hr className="rule-soft" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
        <button onClick={() => onGenerate(targetPages)} disabled={busy} className="btn btn--link" style={{ fontSize: '0.8125rem' }}>
          <RedoAltIcon className="w-3.5 h-3.5" />{busy ? '生成中…' : '重新拆分'}
        </button>
        <label className="kicker" style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>目标 {targetPages} 页</label>
      </div>
    </div>
  );
}

function PagesOverview({ series, onPickPage }: { series: Series; onPickPage: (id: string) => void }) {
  return (
    <div>
      <p className="deck" style={{ marginBottom: '1rem' }}>请从上方「章节大纲」里点击任一页开始。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))', gap: '0.625rem' }}>
        {series.chapters.flatMap(ch => ch.pages.map(p => {
          const firstImg = p.panels.find(pn => pn.imageUrl)?.imageUrl;
          return (
            <button key={p.id} onClick={() => onPickPage(p.id)} className="panel-thumb" style={{ aspectRatio: '3 / 4', cursor: 'pointer' }}>
              {firstImg ? <img src={firstImg} alt="" /> : <span>{p.pageNumber}</span>}
            </button>
          );
        }))}
      </div>
    </div>
  );
}

function PageCard(props: {
  series: Series;
  page: SeriesPage;
  allPages: { chapterId: string; chapterTitle: string; page: SeriesPage }[];
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onBreakdown: () => Promise<SeriesPage | null>;
  onGenerate: () => Promise<SeriesPage | null>;
  onRegenerate: () => Promise<SeriesPage | null>;
  onRewritePage: () => Promise<void>;
  pageInstruction: string;
  setPageInstruction: (v: string) => void;
  onRewritePanel: (idx: number) => Promise<void>;
  panelInstrOpen: number | null;
  setPanelInstrOpen: (v: number | null) => void;
  panelInstruction: string;
  setPanelInstruction: (v: string) => void;
  onContinue: () => Promise<SeriesPage | null>;
  busy: boolean;
}) {
  const { page, allPages, currentIndex, onPrev, onNext, onBreakdown, onGenerate, onRegenerate, onRewritePage, pageInstruction, setPageInstruction, onRewritePanel, panelInstrOpen, setPanelInstrOpen, panelInstruction, setPanelInstruction, onContinue, busy } = props;
  const hasPanels = page.panels.length > 0;
  const isDone = page.status === 'done';
  const chapterTitle = allPages.find(x => x.page.id === page.id)?.chapterTitle || '';

  return (
    <div>
      {/* —— 页头 —— */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem' }}>
        <button onClick={onPrev} disabled={currentIndex <= 0} className="iconbtn" style={{ border: '1px solid var(--rule-soft)' }}>
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <h3 className="headline headline--lg" style={{ flex: 1 }}>
          {page.title}
        </h3>
        <span className="mono tnum" style={{ fontSize: '0.75rem', color: 'var(--ink-3)' }}>
          第 {currentIndex + 1} / {allPages.length} 页
        </span>
        <button onClick={onNext} disabled={currentIndex >= allPages.length - 1} className="iconbtn" style={{ border: '1px solid var(--rule-soft)' }}>
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      {chapterTitle && (
        <div className="kicker" style={{ marginBottom: '0.5rem' }}>来自：{chapterTitle}</div>
      )}

      {page.sceneDescription && (
        <div style={{
          background: 'var(--bg-soft)',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          fontSize: '0.875rem', lineHeight: 1.6,
          borderLeft: '3px solid var(--accent)',
        }}>
          <span className="kicker kicker--accent" style={{ marginRight: '0.5rem' }}>场景</span>
          {page.sceneDescription}
        </div>
      )}

      {/* —— 主操作行 —— */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {!hasPanels && (
          <button onClick={onBreakdown} disabled={busy} className="btn btn--primary">
            {busy ? '拆解中…' : '① 拆解分镜 ▸'}
          </button>
        )}
        {hasPanels && !isDone && (
          <button onClick={onGenerate} disabled={busy} className="btn btn--primary">
            {busy ? '生成中…' : '② 生成全部图 ▸'}
          </button>
        )}
        {hasPanels && isDone && (
          <>
            <button onClick={onRegenerate} disabled={busy} className="btn btn--ghost">
              <RedoAltIcon className="w-3.5 h-3.5" />重生成整页
            </button>
            <button
              onClick={onContinue}
              disabled={busy || currentIndex >= allPages.length - 1}
              title={currentIndex >= allPages.length - 1 ? '已是最后一页' : '基于此页自动续写下一页'}
              className="btn btn--primary"
            >
              一键续写下一页 ▸
            </button>
          </>
        )}
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: '0.625rem', letterSpacing: '0.18em', textTransform: 'uppercase',
          color: isDone ? 'var(--accent)' : page.status === 'generating' ? 'var(--ink-2)' : page.status === 'error' ? 'var(--danger)' : 'var(--ink-3)',
        }}>
          {isDone ? '已完成' : page.status === 'generating' ? '生成中' : page.status === 'error' ? '出错' : '草稿'}
        </span>
      </div>

      {page.errorMessage && (
        <div style={{ padding: '0.5rem 0.75rem', background: '#FBE9E4', color: 'var(--danger)', fontSize: '0.8125rem', marginBottom: '1rem' }}>
          {page.errorMessage}
        </div>
      )}

      {/* —— 整页改写 —— */}
      {isDone && (
        <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: '1rem', marginBottom: '1rem' }}>
          <div className="kicker kicker--accent" style={{ marginBottom: '0.5rem' }}>用一句话改这一页</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="field-input"
              value={pageInstruction}
              onChange={e => setPageInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onRewritePage()}
              placeholder="例如：把场景改成夜晚 / 主角今天穿红裙子 / 让配角先说话"
              style={{ flex: 1 }}
            />
            <button onClick={onRewritePage} disabled={busy || !pageInstruction.trim()} className="btn btn--primary">
              {busy ? '改写中…' : '应用改写'}
            </button>
          </div>
        </div>
      )}

      {/* —— 分镜网格 —— */}
      {hasPanels ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          {page.panels.slice().sort((a, b) => a.index - b.index).map(panel => (
            <div key={panel.index} className="card" style={{ overflow: 'hidden', padding: 0 }}>
              <div className="panel-thumb" style={{ aspectRatio: '3 / 4' }}>
                {panel.imageUrl ? (
                  <img src={panel.imageUrl} alt="" />
                ) : (
                  <span style={{ fontSize: '0.625rem', textAlign: 'center', padding: '0.5rem' }}>{panel.description}</span>
                )}
              </div>
              <div style={{ padding: '0.5rem 0.625rem' }}>
                <div className="kicker" style={{ fontSize: '0.5625rem' }}>第 {panel.index} 格</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--ink-2)', marginTop: '0.25rem', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{panel.description}</div>
                {panel.dialogue && (
                  <div style={{ fontSize: '0.6875rem', fontStyle: 'italic', color: 'var(--ink-2)', marginTop: '0.25rem' }}>
                    「{panel.dialogue}」
                  </div>
                )}
                {isDone && panel.imageUrl && (
                  <>
                    <button
                      onClick={() => setPanelInstrOpen(panelInstrOpen === panel.index ? null : panel.index)}
                      className="btn btn--link"
                      style={{ fontSize: '0.6875rem', padding: 0, marginTop: '0.375rem' }}
                    >
                      改这一格 {panelInstrOpen === panel.index ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
                    </button>
                    {panelInstrOpen === panel.index && (
                      <div style={{ marginTop: '0.375rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <input
                          className="field-input"
                          value={panelInstruction}
                          onChange={e => setPanelInstruction(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && onRewritePanel(panel.index)}
                          placeholder="例如：换成特写 / 让角色微笑"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0' }}
                          autoFocus
                        />
                        <button onClick={() => onRewritePanel(panel.index)} disabled={busy || !panelInstruction.trim()} className="btn btn--primary" style={{ fontSize: '0.6875rem', padding: '0.25rem 0.625rem' }}>
                          {busy ? '生成中…' : '应用'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '3rem 1rem', textAlign: 'center',
          border: '1px dashed var(--rule-soft)',
          color: 'var(--ink-3)',
        }}>
          <EyeIcon className="w-10 h-10 mx-auto mb-2" style={{ opacity: 0.4 }} />
          <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>这一页还没拆解分镜</div>
          <div style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>点击上方「① 拆解分镜」开始</div>
        </div>
      )}
    </div>
  );
}

/* —— 罗马数字 —— */
function toRoman(n: number): string {
  const map: [number, string][] = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let r = ''; let v = n;
  for (const [k, s] of map) { while (v >= k) { r += s; v -= k; } }
  return r;
}