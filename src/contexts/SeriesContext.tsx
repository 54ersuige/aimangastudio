import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  Series,
  SeriesCharacter,
  Worldview,
  Chapter,
  SeriesPage,
  StoryCreatorStep,
} from '../types';
import {
  listSeries as apiListSeries,
  createSeries as apiCreateSeries,
  getSeries as apiGetSeries,
  patchSeries as apiPatchSeries,
  deleteSeries as apiDeleteSeries,
  generateWorldview,
  generateCharacters,
  addCharacter as apiAddCharacter,
  updateCharacter as apiUpdateCharacter,
  deleteCharacter as apiDeleteCharacter,
  regenerateCharacterImage,
  generateArcs,
  generateArcChapters,
  appendNextChapter,
  generateChapters,
  breakdownPage,
  generatePage,
  regeneratePage,
  generatePanel,
  rewritePage,
  rewritePanel,
  continueNextPage,
  updateChapter as apiUpdateChapter,
  moveChapter as apiMoveChapter,
  deleteChapter as apiDeleteChapter,
  updatePage as apiUpdatePage,
  replacePanels as apiReplacePanels,
  insertPanel as apiInsertPanel,
  deletePanelApi as apiDeletePanel,
  updatePanelDialogue as apiUpdatePanelDialogue,
  updatePanelText as apiUpdatePanelText,
  rewritePanelText as apiRewritePanelText,
} from '../services/seriesClient';
import type { AddCharacterInput } from '../services/seriesClient';
import type { Arc } from '../types';

interface SeriesContextValue {
  // 列表
  seriesList: Series[];
  loadingList: boolean;
  refreshList: () => Promise<void>;
  // 当前系列
  currentSeries: Series | null;
  setCurrentSeriesId: (id: string | null) => void;
  createSeries: (input: { title: string; logline: string; dnaKey?: import('../services/modelConfig').DnaKey }) => Promise<Series>;
  patchSeries: (patch: Partial<Pick<Series, 'title' | 'logline'>>) => Promise<Series | null>;
  deleteSeries: (id: string) => Promise<void>;
  refreshCurrent: () => Promise<void>;
  // 步骤状态
  step: StoryCreatorStep;
  setStep: (s: StoryCreatorStep) => void;
  // Step 1 → Step 2（hint = 用户对上一版的修改意见，透传给生成端点）
  generateWorldviewForCurrent: (hint?: string) => Promise<Worldview | null>;
  // Step 2 → Step 3
  generateCharactersForCurrent: (hint?: string) => Promise<SeriesCharacter[] | null>;
  addCharacterToCurrent: (input: AddCharacterInput) => Promise<SeriesCharacter | null>;
  updateCharacterInCurrent: (id: string, patch: Partial<SeriesCharacter>) => Promise<void>;
  deleteCharacterFromCurrent: (id: string) => Promise<void>;
  regenerateCharacterImageInCurrent: (id: string) => Promise<void>;
  /** 单镜头重生成：只替换角色 referenceImages 中指定的那一张。 */
  regenerateCharacterShotInCurrent: (id: string, shot: 'sheet') => Promise<void>;
  // Step 3（季结构）
  generateArcsForCurrent: () => Promise<Arc[] | null>;
  generateArcChaptersForCurrent: (arcId: string, opts?: { targetPageCount?: number; hint?: string }) => Promise<Chapter[] | null>;
  appendNextChapterForCurrent: (arcId: string, opts?: { pageCount?: number; hint?: string }) => Promise<Chapter | null>;
  // Step 3（旧结构兼容）
  generateChaptersForCurrent: (targetPageCount?: number) => Promise<Chapter[] | null>;
  // Step 4
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
  /** Card V 当前选中的话（创作/发布最小单位；供话级 UI 与创作助手共享） */
  selectedEpisodeId: string | null;
  setSelectedEpisodeId: (id: string | null) => void;
  breakdownSelectedPage: () => Promise<SeriesPage | null>;
  generateSelectedPage: () => Promise<SeriesPage | null>;
  regenerateSelectedPage: () => Promise<SeriesPage | null>;
  rewriteSelectedPage: (instruction: string) => Promise<SeriesPage | null>;
  rewriteSelectedPanel: (panelIndex: number, instruction: string) => Promise<void>;
  continueFromSelectedPage: () => Promise<SeriesPage | null>;
  // Step 4 —— 显式 pageId 版本（话级 UI / 卡片操作用，不依赖 selectedPageId）
  breakdownPageInCurrent: (pageId: string) => Promise<SeriesPage | null>;
  generatePageInCurrent: (pageId: string) => Promise<SeriesPage | null>;
  regeneratePageInCurrent: (pageId: string) => Promise<SeriesPage | null>;
  rewritePageInCurrent: (pageId: string, instruction: string) => Promise<SeriesPage | null>;
  rewritePanelInCurrent: (pageId: string, panelIndex: number, instruction: string) => Promise<void>;
  continuePageInCurrent: (pageId: string) => Promise<SeriesPage | null>;
  /** 单格（重）生成：只出这一格的图，不改文字。已有图时视为重掷。 */
  generatePanelInCurrent: (pageId: string, panelIndex: number) => Promise<SeriesPage | null>;
  // 状态
  busy: boolean;
  /**
   * 进行中出图任务的进度 0-100；无任务进行中时为 null。
   * 2026-10-15 新增 —— 此前后端虽然上报 progress，但前端从未消费，
   * 用户面对几分钟的出图只能看到一个没有数字的"生成中"。
   */
  taskProgress: number | null;
  error: string | null;
  clearError: () => void;
  // 手动编辑（不依赖 AI 对话）
  updateChapterInCurrent: (id: string, patch: Partial<Pick<Chapter, 'title' | 'summary' | 'conflict' | 'pageCount'>>) => Promise<void>;
  moveChapterInCurrent: (id: string, direction: 'up' | 'down') => Promise<void>;
  deleteChapterInCurrent: (id: string) => Promise<void>;
  updatePageInCurrent: (id: string, patch: Partial<Pick<SeriesPage, 'title' | 'sceneDescription' | 'characterIds'>>) => Promise<void>;
  /**
   * 直接更新某一格的 dialogue 字段（旁白或对话），不重生成图片。
   * 与 updatePageInCurrent 区别：本函数是 per-panel 的精细编辑。
   */
  updatePanelDialogueInCurrent: (pageId: string, panelIndex: number, dialogue: string) => Promise<void>;
  /**
   * 2026-09-03：三合一改写 —— 同时可改 dialogue / narration（上帝叙述）/ innerThought（内心独白）。
   * 仅改用户改过的字段（未改动由后端自动忽略）。
   */
  updatePanelTextInCurrent: (pageId: string, panelIndex: number, text: { dialogue?: string; narration?: string; innerThought?: string }) => Promise<void>;
  /**
   * 2026-09-03：让 AI 仅重写一格的"图下文字"（不动 description、不重出图）。
   * 比 LLM 重画图便宜得多，是"我对这格的文字不满意"的标准修法。
   */
  rewritePanelTextInCurrent: (pageId: string, panelIndex: number, instruction: string) => Promise<void>;
  replacePanelsInCurrent: (pageId: string, panels: import('../services/seriesClient').PanelInput[]) => Promise<void>;
  insertPanelInCurrent: (pageId: string, insertAt?: number) => Promise<void>;
  deletePanelInCurrent: (pageId: string, panelId: string) => Promise<void>;
}

const SeriesContext = createContext<SeriesContextValue | null>(null);

/**
 * 把一个系列里的所有 chapter 平铺为数组。
 * 兼容：旧 series 直接挂顶层 chapters；新 series 通过 arcs 嵌套。
 * 返回的数组不会为 undefined —— 这正是前端展示/计算所需要的「null-safe view」。
 */
export function flattenSeriesChapters(series: Series | null | undefined): Chapter[] {
  if (!series) return [];
  if (series.arcs && series.arcs.length > 0) {
    return series.arcs.flatMap(a => a.chapters ?? []);
  }
  return series.chapters ?? [];
}

export function useSeries(): SeriesContextValue {
  const ctx = useContext(SeriesContext);
  if (!ctx) throw new Error('useSeries must be used within SeriesProvider');
  return ctx;
}

export function SeriesProvider({ children }: { children: React.ReactNode }) {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [currentSeries, setCurrentSeries] = useState<Series | null>(null);
  const [step, setStep] = useState<StoryCreatorStep>('logline');
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskProgress, setTaskProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 传给 postTask 的进度回调（2026-10-15）。
   * `report` 为 false 时用于不涉及出图的任务（角色/章节生成等），此时不污染进度条。
   */
  const progressOpts = useCallback(
    (report: boolean) => (report ? { onProgress: (p: number) => setTaskProgress(p) } : undefined),
    [],
  );

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await apiListSeries();
      setSeriesList(res.series || []);
    } catch (e: any) {
      setError(e.message || '获取系列列表失败');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const refreshCurrent = useCallback(async () => {
    if (!currentSeries) return;
    try {
      const res = await apiGetSeries(currentSeries.id);
      setCurrentSeries(res.series);
    } catch (e: any) {
      setError(e.message || '刷新系列失败');
    }
  }, [currentSeries]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const setCurrentSeriesId = useCallback(async (id: string | null) => {
    if (!id) {
      setCurrentSeries(null);
      setSelectedPageId(null);
      setStep('logline');
      return;
    }
    try {
      const res = await apiGetSeries(id);
      const s = res.series;
      setCurrentSeries(s);
      // 根据已完成的步骤自动跳转到对应位置
      const allChapters = flattenSeriesChapters(s);
      const allPages = allChapters.flatMap((ch: any) => ch.pages);
      let nextStep: StoryCreatorStep = 'logline';
      if (allPages.some((p: any) => p.panels && p.panels.length > 0)) {
        nextStep = 'pages';
        const firstReady = allPages.find((p: any) => p.panels && p.panels.length > 0);
        if (firstReady) setSelectedPageId(firstReady.id);
      } else if (allChapters.length > 0) {
        nextStep = 'chapters';
      } else if (s.characters.length > 0) {
        nextStep = 'characters';
      } else if (s.worldview) {
        nextStep = 'worldview';
      }
      setStep(nextStep);
    } catch (e: any) {
      setError(e.message || '加载系列失败');
    }
  }, []);

  const create = useCallback(async (input: { title: string; logline: string; dnaKey?: import('../services/modelConfig').DnaKey }) => {
    setBusy(true); setError(null);
    try {
      const res = await apiCreateSeries(input);
      setCurrentSeries(res.series);
      setStep('worldview');
      await refreshList();
      return res.series;
    } catch (e: any) {
      setError(e.message || '创建系列失败');
      throw e;
    } finally {
      setBusy(false);
    }
  }, [refreshList]);

  const patch = useCallback(async (patchObj: Partial<Pick<Series, 'title' | 'logline'>>) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await apiPatchSeries(currentSeries.id, patchObj);
      setCurrentSeries(res.series);
      await refreshList();
      return res.series;
    } catch (e: any) {
      setError(e.message || '更新系列失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshList]);

  const remove = useCallback(async (id: string) => {
    setBusy(true); setError(null);
    try {
      await apiDeleteSeries(id);
      if (currentSeries?.id === id) setCurrentSeries(null);
      await refreshList();
    } catch (e: any) {
      setError(e.message || '删除系列失败');
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshList]);

  const genWorldview = useCallback(async (hint?: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generateWorldview(currentSeries.id, hint);
      await refreshCurrent();
      setStep('characters');
      return res.worldview;
    } catch (e: any) {
      setError(e.message || '生成世界观失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const genCharacters = useCallback(async (hint?: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generateCharacters(currentSeries.id, hint);
      await refreshCurrent();
      setStep('chapters');
      return res.characters;
    } catch (e: any) {
      setError(e.message || '生成角色失败');
      // 后端"文字已保存、仅图片失败"时也会抛错 —— 刷新一次让已保存的角色可见
      await refreshCurrent().catch(() => {});
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const addChar = useCallback(async (input: AddCharacterInput) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await apiAddCharacter(currentSeries.id, input);
      await refreshCurrent();
      return res.character;
    } catch (e: any) {
      setError(e.message || '添加角色失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const updateChar = useCallback(async (id: string, patchObj: Partial<SeriesCharacter>) => {
    if (!currentSeries) return;
    setError(null);
    try {
      await apiUpdateCharacter(currentSeries.id, id, patchObj);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '更新角色失败');
    }
  }, [currentSeries, refreshCurrent]);

  const deleteChar = useCallback(async (id: string) => {
    if (!currentSeries) return;
    setError(null);
    try {
      await apiDeleteCharacter(currentSeries.id, id);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '删除角色失败');
    }
  }, [currentSeries, refreshCurrent]);

  const regenCharImg = useCallback(async (id: string) => {
    if (!currentSeries) return;
    setBusy(true); setError(null);
    try {
      await regenerateCharacterImage(currentSeries.id, id);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '重生成角色图失败');
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  // 单镜头重生成：复用同一个 seriesClient，传 shot
  const regenCharShot = useCallback(async (id: string, shot: 'sheet') => {
    if (!currentSeries) return;
    setBusy(true); setError(null);
    try {
      await regenerateCharacterImage(currentSeries.id, id, shot);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '重生成角色图失败');
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const genChapters = useCallback(async (targetPageCount = 12) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generateChapters(currentSeries.id, targetPageCount);
      await refreshCurrent();
      setStep('pages');
      // 默认选第一页（兼容旧结构）
      const { series: refreshed } = await apiGetSeries(currentSeries.id);
      const allChapters = refreshed.chapters ?? [];
      const firstPage = allChapters[0]?.pages?.[0];
      if (firstPage) setSelectedPageId(firstPage.id);
      return res.chapters;
    } catch (e: any) {
      setError(e.message || '生成章节失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  // —— 季结构 ——
  const genArcs = useCallback(async () => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generateArcs(currentSeries.id);
      await refreshCurrent();
      return res.arcs;
    } catch (e: any) {
      setError(e.message || '生成季结构失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const genArcChapters = useCallback(async (arcId: string, opts?: { targetPageCount?: number; hint?: string }) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generateArcChapters(currentSeries.id, arcId, opts);
      await refreshCurrent();
      setStep('pages');
      // 默认跳到该季首章首页
      const firstPage = res.chapters?.[0]?.pages?.[0];
      if (firstPage) setSelectedPageId(firstPage.id);
      return res.chapters;
    } catch (e: any) {
      setError(e.message || '生成本季章节失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const appendChapter = useCallback(async (arcId: string, opts?: { pageCount?: number; hint?: string }) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await appendNextChapter(currentSeries.id, arcId, opts);
      await refreshCurrent();
      if (res.chapter?.pages?.[0]) setSelectedPageId(res.chapter.pages[0].id);
      return res.chapter;
    } catch (e: any) {
      setError(e.message || '扩写下一章失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  // —— Step 4 核心实现：显式 pageId 版本（话级 UI 用，不依赖 selectedPageId） ——

  const breakdownById = useCallback(async (pageId: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await breakdownPage(currentSeries.id, pageId);
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '拆解分镜失败');
      return null;
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  }, [currentSeries, refreshCurrent]);

  const generateById = useCallback(async (pageId: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generatePage(currentSeries.id, pageId, progressOpts(true));
      await refreshCurrent();
      // 后端在生成失败时会把 page.status = 'error' 并写 errorMessage；这里读出来给用户看。
      const updated = res.page;
      if (updated?.status === 'error' && updated.errorMessage) {
        setError('生成失败：' + updated.errorMessage);
      }
      return res.page;
    } catch (e: any) {
      setError(e.message || '生成页面失败');
      return null;
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  }, [currentSeries, refreshCurrent]);

  const regenerateById = useCallback(async (pageId: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await regeneratePage(currentSeries.id, pageId, progressOpts(true));
      await refreshCurrent();
      const updated = res.page;
      if (updated?.status === 'error' && updated.errorMessage) {
        setError('重生失败：' + updated.errorMessage);
      }
      return res.page;
    } catch (e: any) {
      setError(e.message || '重生页面失败');
      return null;
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  }, [currentSeries, refreshCurrent]);

  const rewritePageById = useCallback(async (pageId: string, instruction: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await rewritePage(currentSeries.id, pageId, instruction, progressOpts(true));
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '改写页面失败');
      return null;
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  }, [currentSeries, refreshCurrent]);

  const rewritePanelById = useCallback(async (pageId: string, panelIndex: number, instruction: string) => {
    if (!currentSeries) return;
    setBusy(true); setError(null);
    try {
      await rewritePanel(currentSeries.id, pageId, panelIndex, instruction);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '改写分镜失败');
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const continuePageById = useCallback(async (pageId: string) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await continueNextPage(currentSeries.id, pageId);
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '续写失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  /** 单格（重）生成：只出这一格的图，不改文字。已有图时视为重掷。 */
  const generatePanelById = useCallback(async (pageId: string, panelIndex: number) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generatePanel(currentSeries.id, pageId, panelIndex, progressOpts(true));
      await refreshCurrent();
      const updated = res.page;
      if (updated?.status === 'error' && updated.errorMessage) {
        setError('单格生成失败：' + updated.errorMessage);
      }
      return res.page;
    } catch (e: any) {
      setError(e.message || '单格生成失败');
      return null;
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  }, [currentSeries, refreshCurrent]);

  // —— 兼容包装：以 selectedPageId 为目标（agent 桥 / 快捷键继续使用） ——

  const breakdown = useCallback(async () => {
    return selectedPageId ? breakdownById(selectedPageId) : null;
  }, [selectedPageId, breakdownById]);

  const gen = useCallback(async () => {
    return selectedPageId ? generateById(selectedPageId) : null;
  }, [selectedPageId, generateById]);

  const regen = useCallback(async () => {
    return selectedPageId ? regenerateById(selectedPageId) : null;
  }, [selectedPageId, regenerateById]);

  const rewritePg = useCallback(async (instruction: string) => {
    return selectedPageId ? rewritePageById(selectedPageId, instruction) : null;
  }, [selectedPageId, rewritePageById]);

  const rewritePn = useCallback(async (panelIndex: number, instruction: string) => {
    if (!selectedPageId) return;
    await rewritePanelById(selectedPageId, panelIndex, instruction);
  }, [selectedPageId, rewritePanelById]);

  const continueNext = useCallback(async () => {
    if (!selectedPageId) return null;
    const res = await continuePageById(selectedPageId);
    if (res?.id) setSelectedPageId(res.id);
    return res;
  }, [selectedPageId, continuePageById]);

  // ============ 手动编辑（不依赖 AI 对话） ============

  const updateChapterInCurrent = useCallback(async (id: string, patch: Partial<Pick<Chapter, 'title' | 'summary' | 'conflict' | 'pageCount'>>) => {
    if (!currentSeries) return;
    try {
      await apiUpdateChapter(currentSeries.id, id, patch);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '保存章节失败');
    }
  }, [currentSeries, refreshCurrent]);

  const moveChapterInCurrent = useCallback(async (id: string, direction: 'up' | 'down') => {
    if (!currentSeries) return;
    try {
      await apiMoveChapter(currentSeries.id, id, direction);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '调整章节顺序失败');
    }
  }, [currentSeries, refreshCurrent]);

  const deleteChapterInCurrent = useCallback(async (id: string) => {
    if (!currentSeries) return;
    try {
      await apiDeleteChapter(currentSeries.id, id);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '删除章节失败');
    }
  }, [currentSeries, refreshCurrent]);

  const updatePageInCurrent = useCallback(async (id: string, patch: Partial<Pick<SeriesPage, 'title' | 'sceneDescription' | 'characterIds'>>) => {
    if (!currentSeries) return;
    try {
      await apiUpdatePage(currentSeries.id, id, patch);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '保存页面失败');
    }
  }, [currentSeries, refreshCurrent]);

  const updatePanelDialogueInCurrent = useCallback(async (pageId: string, panelIndex: number, dialogue: string) => {
    if (!currentSeries) return;
    try {
      await apiUpdatePanelDialogue(currentSeries.id, pageId, panelIndex, dialogue);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '保存分镜文字失败');
    }
  }, [currentSeries, refreshCurrent]);

  const updatePanelTextInCurrent = useCallback(async (
    pageId: string,
    panelIndex: number,
    text: { dialogue?: string; narration?: string; innerThought?: string },
  ) => {
    if (!currentSeries) return;
    try {
      // 2026-09-03：三合一改写。后端对每个字段独立判断：缺省不动，传 '' 视作主动清空。
      // 前端只把"用户改过"的字段传过去（UI 里也是这么判断的）。
      await apiUpdatePanelText(currentSeries.id, pageId, panelIndex, text);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '保存分镜文字失败');
    }
  }, [currentSeries, refreshCurrent]);

  const rewritePanelTextInCurrent = useCallback(async (
    pageId: string,
    panelIndex: number,
    instruction: string,
  ) => {
    if (!currentSeries) return;
    try {
      // 2026-09-03：让 AI 仅重写文字（不动 description、不重出图）。
      // 复用了上下文生成（最近几话），但与 generatePanel/rewritePanel 不同的是
      // 它只在文字层做工，所以更快、更便宜。
      await apiRewritePanelText(currentSeries.id, pageId, panelIndex, instruction);
      await refreshCurrent();
    } catch (e: any) {
      // 2026-09-03：rewritePanelTextInCurrent 用自己专属提示，与 updatePanelDialogue 区分
      setError(e.message || 'AI 重写文字失败');
    }
  }, [currentSeries, refreshCurrent]);

  const replacePanelsInCurrent = useCallback(async (pageId: string, panels: import('../services/seriesClient').PanelInput[]) => {
    if (!currentSeries) return;
    try {
      await apiReplacePanels(currentSeries.id, pageId, panels);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '保存分镜失败');
    }
  }, [currentSeries, refreshCurrent]);

  const insertPanelInCurrent = useCallback(async (pageId: string, insertAt?: number) => {
    if (!currentSeries) return;
    try {
      await apiInsertPanel(currentSeries.id, pageId, insertAt);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '插入分镜失败');
    }
  }, [currentSeries, refreshCurrent]);

  const deletePanelInCurrent = useCallback(async (pageId: string, panelId: string) => {
    if (!currentSeries) return;
    try {
      await apiDeletePanel(currentSeries.id, pageId, panelId);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '删除分镜失败');
    }
  }, [currentSeries, refreshCurrent]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<SeriesContextValue>(() => ({
    seriesList, loadingList, refreshList,
    currentSeries, setCurrentSeriesId, createSeries: create, patchSeries: patch, deleteSeries: remove, refreshCurrent,
    step, setStep,
    generateWorldviewForCurrent: genWorldview,
    generateCharactersForCurrent: genCharacters,
    addCharacterToCurrent: addChar,
    updateCharacterInCurrent: updateChar,
    deleteCharacterFromCurrent: deleteChar,
    regenerateCharacterImageInCurrent: regenCharImg,
    regenerateCharacterShotInCurrent: regenCharShot,
    generateChaptersForCurrent: genChapters,
    generateArcsForCurrent: genArcs,
    generateArcChaptersForCurrent: genArcChapters,
    appendNextChapterForCurrent: appendChapter,
    selectedPageId, setSelectedPageId,
    selectedEpisodeId, setSelectedEpisodeId,
    breakdownSelectedPage: breakdown,
    generateSelectedPage: gen,
    regenerateSelectedPage: regen,
    rewriteSelectedPage: rewritePg,
    rewriteSelectedPanel: rewritePn,
    continueFromSelectedPage: continueNext,
    breakdownPageInCurrent: breakdownById,
    generatePageInCurrent: generateById,
    regeneratePageInCurrent: regenerateById,
    rewritePageInCurrent: rewritePageById,
    rewritePanelInCurrent: rewritePanelById,
    continuePageInCurrent: continuePageById,
    generatePanelInCurrent: generatePanelById,
    updateChapterInCurrent, moveChapterInCurrent, deleteChapterInCurrent,
    updatePageInCurrent, replacePanelsInCurrent, insertPanelInCurrent, deletePanelInCurrent,
    updatePanelDialogueInCurrent,
    updatePanelTextInCurrent,
    rewritePanelTextInCurrent,
    busy, error, clearError, taskProgress,
  }), [
    seriesList, loadingList, refreshList,
    currentSeries, setCurrentSeriesId, create, patch, remove, refreshCurrent,
    step, genWorldview, genCharacters, addChar, updateChar, deleteChar, regenCharImg, regenCharShot, genChapters,
    selectedPageId, breakdown, gen, regen, rewritePg, rewritePn, continueNext, busy, error, clearError, taskProgress,
    progressOpts,
    selectedEpisodeId,
    breakdownById, generateById, regenerateById, rewritePageById, rewritePanelById, continuePageById, generatePanelById,
    updateChapterInCurrent, moveChapterInCurrent, deleteChapterInCurrent,
    updatePanelDialogueInCurrent,
    updatePanelTextInCurrent,
    rewritePanelTextInCurrent,
  ]);

  return <SeriesContext.Provider value={value}>{children}</SeriesContext.Provider>;
}
