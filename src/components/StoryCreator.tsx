import React, { useEffect, useMemo, useState } from 'react';
import { useSeries } from '../contexts/SeriesContext';
import type { SeriesCharacter, Chapter, SeriesPage, StoryCreatorStep } from '../types';
import {
  XIcon, SparklesIcon, PlusIcon, TrashIcon, RedoAltIcon, BookOpenIcon, CheckCircleIcon,
} from './icons';

interface StoryCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onImportToCanvas?: (payload: {
    worldview?: string;
    characters?: SeriesCharacter[];
    firstPageDescription?: string;
  }) => void;
}

const STEPS: { key: StoryCreatorStep; label: string; description: string }[] = [
  { key: 'logline', label: '故事灵感', description: '用一句话描述你想画的漫画' },
  { key: 'worldview', label: '世界设定', description: 'AI 为你设计时代/风格/色调' },
  { key: 'characters', label: '角色设计', description: 'AI 为主角/配角生成参考图' },
  { key: 'chapters', label: '章节拆分', description: '把故事拆成多章多页' },
  { key: 'pages', label: '逐页生成', description: 'AI 自动分镜并出图' },
];

export function StoryCreator({ isOpen, onClose, onImportToCanvas }: StoryCreatorProps) {
  const ctx = useSeries();
  const {
    currentSeries, setCurrentSeriesId, createSeries, patchSeries, deleteSeries, seriesList, refreshList,
    step, setStep,
    generateWorldviewForCurrent, generateCharactersForCurrent,
    addCharacterToCurrent, updateCharacterInCurrent, deleteCharacterFromCurrent, regenerateCharacterImageInCurrent,
    generateChaptersForCurrent,
    selectedPageId, setSelectedPageId,
    breakdownSelectedPage, generateSelectedPage, regenerateSelectedPage,
    busy, error, clearError,
  } = ctx;

  // 初始进入时只刷新列表
  useEffect(() => {
    if (isOpen) void refreshList();
  }, [isOpen, refreshList]);

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[480px] bg-white border-l border-gray-200 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-gray-800">故事创作</h2>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100" title="关闭">
          <XIcon className="w-5 h-5 text-gray-500" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={clearError} className="text-xs underline">关闭</button>
        </div>
      )}

      {/* Step tabs */}
      <div className="px-3 py-2 border-b border-gray-200 flex gap-1 overflow-x-auto">
        {STEPS.map((s, i) => {
          const isActive = step === s.key;
          return (
            <button
              key={s.key}
              onClick={() => currentSeries && setStep(s.key)}
              disabled={!currentSeries}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${
                isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50'
              }`}
            >
              {i + 1}. {s.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!currentSeries ? (
          <SeriesListStep
            seriesList={seriesList}
            onCreate={createSeries}
            onOpen={setCurrentSeriesId}
            onDelete={deleteSeries}
          />
        ) : (
          <>
            <div className="mb-3 text-xs text-gray-500">
              当前系列：<span className="font-semibold text-gray-700">{currentSeries.title}</span>
              <button
                onClick={() => { setCurrentSeriesId(null); setStep('logline'); }}
                className="ml-2 text-indigo-600 hover:underline"
              >切换 / 新建</button>
            </div>
            {step === 'logline' && <LoglineStep series={currentSeries} onCreate={createSeries} onPatch={patchSeries} />}
            {step === 'worldview' && <WorldviewStep onGenerate={generateWorldviewForCurrent} series={currentSeries} />}
            {step === 'characters' && (
              <CharactersStep
                series={currentSeries}
                busy={busy}
                onGenerate={generateCharactersForCurrent}
                onAdd={addCharacterToCurrent}
                onUpdate={updateCharacterInCurrent}
                onDelete={deleteCharacterFromCurrent}
                onRegenImage={regenerateCharacterImageInCurrent}
                onNext={() => setStep('chapters')}
              />
            )}
            {step === 'chapters' && (
              <ChaptersStep
                series={currentSeries}
                busy={busy}
                onGenerate={generateChaptersForCurrent}
                onNext={() => setStep('pages')}
              />
            )}
            {step === 'pages' && (
              <ImportToCanvasStep
                series={currentSeries}
                onImport={() => {
                  if (!onImportToCanvas) {
                    alert('当前页面没有挂载导入回调');
                    return;
                  }
                  // 拼接世界观（背景+时代+风格+色调）
                  const w = currentSeries.worldview;
                  const worldviewText = w
                    ? `${w.summary}\n\n时代：${w.era}\n美术风格：${w.artStyle}\n色调：${w.paletteMood}\n\n${w.background}`
                    : '';
                  // 取第一章的概要作为第一页场景描述
                  const firstChapter = currentSeries.chapters[0];
                  const firstPage = firstChapter?.pages?.[0];
                  const firstPageDescription = firstChapter
                    ? `${firstChapter.title}\n\n${firstChapter.summary}`
                    : '';
                  onImportToCanvas({
                    worldview: worldviewText,
                    characters: currentSeries.characters,
                    firstPageDescription,
                  });
                }}
                onImportSinglePage={(pageId) => {
                  if (!onImportToCanvas) return;
                  // 找到对应章节和该页
                  let targetChapter: any = null;
                  let targetPage: any = null;
                  for (const ch of currentSeries.chapters) {
                    const p = ch.pages.find(pp => pp.id === pageId);
                    if (p) { targetChapter = ch; targetPage = p; break; }
                  }
                  if (!targetPage) return;
                  const w = currentSeries.worldview;
                  const worldviewText = w
                    ? `${w.summary}\n\n时代：${w.era}\n美术风格：${w.artStyle}\n色调：${w.paletteMood}\n\n${w.background}`
                    : '';
                  const panelDesc = targetPage.panels
                    .slice().sort((a, b) => a.index - b.index)
                    .map(p => `[分镜${p.index}] ${p.description}${p.dialogue ? `（对白："${p.dialogue}"）` : ''}`)
                    .join('\n');
                  const firstPageDescription = `${targetChapter.title} - 第${targetPage.pageNumber}页\n\n${targetPage.sceneDescription}\n\n分镜：\n${panelDesc}`;
                  onImportToCanvas({
                    worldview: worldviewText,
                    characters: currentSeries.characters,
                    firstPageDescription,
                  });
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============ Step: 系列列表 / 新建 ============

function SeriesListStep({
  seriesList, onCreate, onOpen, onDelete,
}: {
  seriesList: import('../types').Series[];
  onCreate: (input: { title: string; logline: string; style?: string }) => Promise<import('../types').Series>;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [logline, setLogline] = useState('');
  const [style, setStyle] = useState('日式漫画');
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !logline.trim()) return;
    setBusy(true);
    try {
      await onCreate({ title: title.trim(), logline: logline.trim(), style: style.trim() || '日式漫画' });
      setTitle(''); setLogline(''); setStyle('日式漫画');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-md font-bold text-gray-800 mb-2">开始一个新系列</h3>
        <p className="text-sm text-gray-500 mb-3">用一句话告诉我你想画什么，AI 会帮你拆成章节、生成角色、绘制分镜。</p>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">系列名</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：觉醒纪元"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">故事简介（一句话）</label>
        <textarea
          value={logline}
          onChange={(e) => setLogline(e.target.value)}
          rows={3}
          placeholder="例如：2077 年东京，AI 觉醒了。一个少女和觉醒 AI 一起对抗试图奴役人类的企业巨头……"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">整体风格</label>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option>日式漫画</option>
          <option>赛璐璐平涂</option>
          <option>水墨写意</option>
          <option>美式漫画</option>
          <option>赛博朋克</option>
          <option>治愈系</option>
        </select>
      </div>
      <button
        onClick={handleCreate}
        disabled={busy || !title.trim() || !logline.trim()}
        className="w-full bg-indigo-600 text-white font-semibold py-2 rounded-md text-sm hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? '创建中…' : '创建并开始创作'}
      </button>

      {seriesList.length > 0 && (
        <div className="pt-4 border-t">
          <h3 className="text-md font-bold text-gray-800 mb-2">我的系列</h3>
          <ul className="space-y-2">
            {seriesList.map(s => (
              <li key={s.id} className="border rounded-md p-3 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-800 truncate">{s.title}</div>
                  <div className="text-xs text-gray-500 line-clamp-2">{s.logline}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {s.chapters.length} 章 · {s.chapters.reduce((a, c) => a + c.pages.length, 0)} 页 · {s.characters.length} 角色
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => onOpen(s.id)} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded">打开</button>
                  <button onClick={() => { if (confirm(`删除「${s.title}」？`)) void onDelete(s.id); }} className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded">删除</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============ Step: 一句话 logline（编辑中） ============

function LoglineStep({ series, onCreate, onPatch }: { series: import('../types').Series; onCreate: any; onPatch: any }) {
  const [title, setTitle] = useState(series.title);
  const [logline, setLogline] = useState(series.logline);
  const [style, setStyle] = useState(series.style);
  const { setStep } = useSeries();

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">检查并完善基础设定，然后让 AI 帮你设计世界观。</p>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">系列名</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">故事简介</label>
        <textarea value={logline} onChange={(e) => setLogline(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-md text-sm" />
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-600 mb-1 block">风格</label>
        <input value={style} onChange={(e) => setStyle(e.target.value)} className="w-full px-3 py-2 border rounded-md text-sm" />
      </div>
      <button
        onClick={async () => {
          await onPatch({ title, logline, style });
          // 移到 worldview
          setStep('worldview');
        }}
        className="w-full bg-gray-800 text-white py-2 rounded-md text-sm font-semibold"
      >保存并继续</button>
    </div>
  );
}

// ============ Step: 世界观 ============

function WorldviewStep({ onGenerate, series }: { onGenerate: () => Promise<any>; series: import('../types').Series }) {
  const { busy } = useSeries();
  const w = series.worldview;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">基于你的简介，AI 会自动设计时代背景、美术风格和色调氛围。</p>
      {!w ? (
        <button
          onClick={() => void onGenerate()}
          disabled={busy}
          className="w-full bg-indigo-600 text-white py-2 rounded-md text-sm font-semibold disabled:opacity-50"
        >
          {busy ? '生成中…' : '生成世界观'}
        </button>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="bg-indigo-50 p-3 rounded-md">
            <div className="font-bold text-indigo-800">{w.summary}</div>
          </div>
          <div><span className="font-semibold text-gray-700">时代：</span>{w.era}</div>
          <div><span className="font-semibold text-gray-700">美术风格：</span>{w.artStyle}</div>
          <div><span className="font-semibold text-gray-700">色调：</span>{w.paletteMood}</div>
          <div className="bg-gray-50 p-3 rounded-md text-gray-700 whitespace-pre-wrap">{w.background}</div>
          <button
            onClick={() => void onGenerate()}
            disabled={busy}
            className="w-full bg-gray-200 text-gray-800 py-2 rounded-md text-sm font-semibold hover:bg-gray-300 disabled:opacity-50"
          >
            <RedoAltIcon className="w-4 h-4 inline" /> 重新生成
          </button>
        </div>
      )}
    </div>
  );
}

// ============ Step: 角色 ============

function CharactersStep({
  series, busy,
  onGenerate, onAdd, onUpdate, onDelete, onRegenImage, onNext,
}: {
  series: import('../types').Series;
  busy: boolean;
  onGenerate: () => Promise<any>;
  onAdd: (input: any) => Promise<any>;
  onUpdate: (id: string, patch: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRegenImage: (id: string) => Promise<void>;
  onNext: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    name: '', role: 'supporting' as 'protagonist' | 'antagonist' | 'supporting',
    description: '', appearance: '', voiceTone: '',
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">为这个故事创建主要角色。AI 会为每个角色生成参考图，跨章节保持一致。</p>

      {series.characters.length === 0 ? (
        <button
          onClick={() => void onGenerate()}
          disabled={busy}
          className="w-full bg-indigo-600 text-white py-2 rounded-md text-sm font-semibold disabled:opacity-50"
        >
          {busy ? '生成中…（含 AI 配图）' : 'AI 自动生成 3-4 个角色'}
        </button>
      ) : (
        <>
          <ul className="space-y-2">
            {series.characters.map(c => (
              <li key={c.id}>
                <CharacterCard
                  character={c}
                  busy={busy}
                  onUpdate={(patch) => onUpdate(c.id, patch)}
                  onDelete={() => { if (confirm(`删除「${c.name}」？`)) void onDelete(c.id); }}
                  onRegenImage={() => onRegenImage(c.id)}
                />
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => void onGenerate()}
              disabled={busy}
              className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-md text-sm font-semibold hover:bg-gray-300 disabled:opacity-50"
            ><RedoAltIcon className="w-4 h-4 inline" /> 重新生成全部</button>
            <button
              onClick={() => setAdding(true)}
              className="flex-1 bg-indigo-600 text-white py-2 rounded-md text-sm font-semibold"
            ><PlusIcon className="w-4 h-4 inline" /> 手动添加</button>
          </div>
          <button
            onClick={onNext}
            disabled={busy}
            className="w-full bg-gray-800 text-white py-2 rounded-md text-sm font-semibold"
          >下一步：拆分章节 →</button>
        </>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-4 w-full max-w-sm">
            <h3 className="font-bold mb-2">添加新角色</h3>
            <input placeholder="名字" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full px-2 py-1 border rounded mb-2 text-sm" />
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as any })} className="w-full px-2 py-1 border rounded mb-2 text-sm">
              <option value="protagonist">主角</option>
              <option value="antagonist">反派</option>
              <option value="supporting">配角</option>
            </select>
            <textarea placeholder="背景描述" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} className="w-full px-2 py-1 border rounded mb-2 text-sm" />
            <textarea placeholder="外貌描述（AI 生图用）" value={draft.appearance} onChange={(e) => setDraft({ ...draft, appearance: e.target.value })} rows={2} className="w-full px-2 py-1 border rounded mb-2 text-sm" />
            <input placeholder="说话风格（可选）" value={draft.voiceTone} onChange={(e) => setDraft({ ...draft, voiceTone: e.target.value })} className="w-full px-2 py-1 border rounded mb-3 text-sm" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setAdding(false)} className="px-3 py-1 text-sm border rounded">取消</button>
              <button
                onClick={async () => {
                  if (!draft.name || !draft.appearance) return;
                  await onAdd({ ...draft, autoGenerateImage: true });
                  setDraft({ name: '', role: 'supporting', description: '', appearance: '', voiceTone: '' });
                  setAdding(false);
                }}
                disabled={busy}
                className="px-3 py-1 text-sm bg-indigo-600 text-white rounded disabled:opacity-50"
              >添加（含 AI 配图）</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterCard({ character, busy, onUpdate, onDelete, onRegenImage }: {
  character: SeriesCharacter;
  busy: boolean;
  onUpdate: (patch: Partial<SeriesCharacter>) => Promise<void>;
  onDelete: () => void;
  onRegenImage: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="border rounded-md p-2 flex gap-2">
      {character.referenceImage ? (
        <img src={character.referenceImage} alt={character.name} className="w-20 h-20 object-cover rounded-md border flex-shrink-0" />
      ) : (
        <div className="w-20 h-20 bg-gray-100 rounded-md flex items-center justify-center text-xs text-gray-400 flex-shrink-0">无图</div>
      )}
      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-1">
            <input defaultValue={character.name} onBlur={(e) => onUpdate({ name: e.target.value })} className="w-full px-1 py-0.5 text-xs border rounded" />
            <textarea defaultValue={character.appearance} onBlur={(e) => onUpdate({ appearance: e.target.value })} rows={2} className="w-full px-1 py-0.5 text-xs border rounded" />
            <button onClick={() => setEditing(false)} className="text-xs text-indigo-600">完成</button>
          </div>
        ) : (
          <>
            <div className="font-semibold text-sm">{character.name}
              <span className="ml-1 text-xs text-gray-500">({character.role === 'protagonist' ? '主角' : character.role === 'antagonist' ? '反派' : '配角'})</span>
            </div>
            <div className="text-xs text-gray-500 line-clamp-2">{character.description}</div>
            <div className="text-xs text-gray-400 line-clamp-2 italic">外貌：{character.appearance}</div>
          </>
        )}
        <div className="flex gap-2 mt-1">
          <button onClick={() => setEditing(!editing)} className="text-xs text-gray-600 hover:underline">编辑</button>
          <button onClick={onRegenImage} disabled={busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-50">重生配图</button>
          <button onClick={onDelete} className="text-xs text-red-500 hover:underline">删除</button>
        </div>
      </div>
    </div>
  );
}

// ============ Step: 章节拆分 ============

function ChaptersStep({ series, busy, onGenerate, onNext }: {
  series: import('../types').Series;
  busy: boolean;
  onGenerate: (target: number) => Promise<any>;
  onNext: () => void;
}) {
  const [target, setTarget] = useState(series.chapters.reduce((a, c) => a + c.pages.length, 0) || 12);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">设定目标总页数，AI 会根据剧情节奏拆成多章。</p>
      {series.chapters.length > 0 ? (
        <div className="space-y-2">
          {series.chapters.map(ch => (
            <div key={ch.id} className="border rounded-md p-2">
              <div className="font-semibold text-sm text-gray-800">{ch.title}</div>
              <div className="text-xs text-gray-500 line-clamp-2">{ch.summary}</div>
              <div className="text-xs text-gray-400 mt-1">{ch.pages.length} 页</div>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => void onGenerate(target)} disabled={busy} className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-md text-sm font-semibold disabled:opacity-50">
              <RedoAltIcon className="w-4 h-4 inline" /> 重新拆分
            </button>
            <button onClick={onNext} className="flex-1 bg-gray-800 text-white py-2 rounded-md text-sm font-semibold">下一步：开始生成 →</button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">目标总页数</label>
            <input type="number" min={1} max={60} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-full px-3 py-2 border rounded-md text-sm" />
          </div>
          <button onClick={() => void onGenerate(target)} disabled={busy} className="w-full bg-indigo-600 text-white py-2 rounded-md text-sm font-semibold disabled:opacity-50">
            {busy ? '生成中…' : '生成章节拆分'}
          </button>
        </>
      )}
    </div>
  );
}

// ============ Step: 导入到画布 ============

function ImportToCanvasStep({ series, onImport, onImportSinglePage }: {
  series: import('../types').Series;
  onImport: () => void;
  onImportSinglePage: (pageId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 p-3 rounded-md">
        <div className="text-sm font-semibold text-indigo-800">🎉 准备工作完成！</div>
        <div className="text-xs text-indigo-700 mt-1">
          已生成：{series.characters.length} 个角色 · {series.chapters.length} 个章节 · {series.chapters.reduce((a, c) => a + c.pages.length, 0)} 个页面
        </div>
        <div className="text-xs text-indigo-600 mt-1">
          点击下方按钮，把世界观、角色、场景脚本导入到主画布。
        </div>
      </div>

      <button
        onClick={onImport}
        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold py-3 rounded-md text-sm hover:from-indigo-700 hover:to-purple-700 shadow-md"
      >
        ✨ 导入到主画布（开始编辑第一章）
      </button>

      <div className="text-xs text-gray-500 my-1">或导入指定页面：</div>

      <div className="border rounded-md p-2 max-h-72 overflow-y-auto">
        {series.chapters.map(ch => (
          <div key={ch.id} className="mb-2 last:mb-0">
            <div className="text-xs font-semibold text-gray-700 mb-1">{ch.title}</div>
            <div className="grid grid-cols-4 gap-1">
              {ch.pages.map(p => (
                <button
                  key={p.id}
                  onClick={() => onImportSinglePage(p.id)}
                  className="aspect-[2/3] border border-gray-200 rounded text-xs hover:border-indigo-500 hover:bg-indigo-50 flex flex-col items-center justify-center p-1"
                  title={`导入第${p.pageNumber}页`}
                >
                  <span className="font-semibold">{p.pageNumber}</span>
                  {p.status === 'done' && <span className="text-[10px] text-green-600 mt-0.5">已生成</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
        <div className="font-semibold">📌 提示</div>
        <div className="mt-1">导入到主画布后：</div>
        <ul className="list-disc pl-4 mt-1 space-y-0.5">
          <li>角色会出现在主画布的「角色」面板，可直接拖入分镜</li>
          <li>场景描述会填入当前页的「场景脚本」</li>
          <li>世界观会保存到主画布的「世界观」字段</li>
          <li>接下来你可以在主画布上：手画分镜格子 / 拖入角色 / 编辑 / 笔刷蒙版 / 一键生图</li>
        </ul>
      </div>
    </div>
  );
}

// ============ Step: 逐页生成（保留备用） ============

function PagesStep({ series, selectedPageId, setSelectedPageId, busy, onBreakdown, onGenerate, onRegenerate }: {
  series: import('../types').Series;
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
  busy: boolean;
  onBreakdown: () => Promise<any>;
  onGenerate: () => Promise<any>;
  onRegenerate: () => Promise<any>;
}) {
  const allPages = useMemo(() => {
    return series.chapters.flatMap(ch => ch.pages.map(p => ({ ...p, chapterTitle: ch.title, chapterId: ch.id })));
  }, [series]);
  const selected = allPages.find(p => p.id === selectedPageId) || null;

  // 按章节分组
  const byChapter = useMemo(() => {
    const map = new Map<string, { title: string; pages: typeof allPages }>();
    for (const p of allPages) {
      if (!map.has(p.chapterId)) map.set(p.chapterId, { title: p.chapterTitle, pages: [] });
      map.get(p.chapterId)!.pages.push(p);
    }
    return Array.from(map.entries());
  }, [allPages]);

  if (allPages.length === 0) {
    return <p className="text-sm text-gray-500">还没有页面，请先返回上一步生成章节。</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">从左侧选一页 → AI 拆解分镜 → 生成图片。</p>

      <div className="border rounded-md p-2 max-h-60 overflow-y-auto">
        {byChapter.map(([chId, ch]) => (
          <div key={chId} className="mb-2 last:mb-0">
            <div className="text-xs font-semibold text-gray-700 mb-1">{ch.title}</div>
            <div className="grid grid-cols-4 gap-1">
              {ch.pages.map(p => {
                const isActive = p.id === selectedPageId;
                const isDone = p.status === 'done';
                const isGen = p.status === 'generating';
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPageId(p.id)}
                    className={`aspect-[2/3] border-2 rounded text-xs flex items-center justify-center ${
                      isActive ? 'border-indigo-600 bg-indigo-50' : isDone ? 'border-green-300' : isGen ? 'border-yellow-300' : 'border-gray-200'
                    }`}
                    title={p.title}
                  >
                    {p.generatedImage ? (
                      <img src={p.generatedImage} alt={p.title} className="w-full h-full object-cover rounded" />
                    ) : (
                      <span>{p.pageNumber}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && <PageDetail page={selected} busy={busy} onBreakdown={onBreakdown} onGenerate={onGenerate} onRegenerate={onRegenerate} />}
    </div>
  );
}

function PageDetail({ page, busy, onBreakdown, onGenerate, onRegenerate }: {
  page: SeriesPage & { chapterTitle: string; chapterId: string };
  busy: boolean;
  onBreakdown: () => Promise<any>;
  onGenerate: () => Promise<any>;
  onRegenerate: () => Promise<any>;
}) {
  const hasPanels = page.panels.length > 0;
  const hasImages = page.panels.some(p => p.imageUrl);
  const isGenerating = page.status === 'generating' || busy;
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div>
        <div className="text-xs text-gray-500">{page.chapterTitle} · 第 {page.pageNumber} 页</div>
        <div className="font-semibold text-sm text-gray-800">{page.title || '未命名'}</div>
        {page.sceneDescription && <div className="text-xs text-gray-600 mt-1">{page.sceneDescription}</div>}
      </div>

      {hasPanels && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-700">分镜（{page.panels.length}）</div>
          {page.panels.slice().sort((a, b) => a.index - b.index).map(p => (
            <div key={p.index} className="text-xs bg-gray-50 p-2 rounded">
              <div className="font-semibold text-gray-700">[{p.index}] {p.description}</div>
              {p.dialogue && <div className="text-gray-600 italic mt-0.5">「{p.dialogue}」</div>}
              <div className="text-gray-400 mt-0.5">角色：{p.characterIds.length} 个</div>
              {p.imageUrl && <img src={p.imageUrl} alt={`panel-${p.index}`} className="mt-1 w-full rounded border" />}
            </div>
          ))}
        </div>
      )}

      {!hasPanels && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
          这页还没拆解分镜。请点击下方「AI 拆解分镜」按钮，让 AI 自动拆出 2-8 个分镜。
        </div>
      )}

      {page.generatedImage && (
        <div className="rounded overflow-hidden border">
          <img src={page.generatedImage} alt={page.title} className="w-full" />
        </div>
      )}
      {page.errorMessage && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{page.errorMessage}</div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => void onBreakdown()} disabled={isGenerating} className="flex-1 bg-gray-200 text-gray-800 py-1.5 rounded text-xs font-semibold disabled:opacity-50">
          {hasPanels ? '重新拆解分镜' : 'AI 拆解分镜'}
        </button>
        <button
          onClick={() => void onGenerate()}
          disabled={isGenerating || !hasPanels}
          title={!hasPanels ? '请先拆解分镜' : ''}
          className="flex-1 bg-indigo-600 text-white py-1.5 rounded text-xs font-semibold disabled:opacity-50"
        >
          {page.status === 'generating' ? '生成中…' : hasImages ? '重新生成分镜图' : '生成这页'}
        </button>
      </div>
    </div>
  );
}
