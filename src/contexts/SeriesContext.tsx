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
  generateChapters,
  breakdownPage,
  generatePage,
  regeneratePage,
  rewritePage,
  rewritePanel,
  continueNextPage,
} from '../services/seriesClient';

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
  addCharacterToCurrent: (input: {
    name: string;
    role: 'protagonist' | 'antagonist' | 'supporting';
    description: string;
    appearance: string;
    voiceTone?: string;
    autoGenerateImage?: boolean;
  }) => Promise<SeriesCharacter | null>;
  updateCharacterInCurrent: (id: string, patch: Partial<SeriesCharacter>) => Promise<void>;
  deleteCharacterFromCurrent: (id: string) => Promise<void>;
  regenerateCharacterImageInCurrent: (id: string) => Promise<void>;
  // Step 3
  generateChaptersForCurrent: (targetPageCount?: number) => Promise<Chapter[] | null>;
  // Step 4
  selectedPageId: string | null;
  setSelectedPageId: (id: string | null) => void;
  breakdownSelectedPage: () => Promise<SeriesPage | null>;
  generateSelectedPage: () => Promise<SeriesPage | null>;
  regenerateSelectedPage: () => Promise<SeriesPage | null>;
  rewriteSelectedPage: (instruction: string) => Promise<SeriesPage | null>;
  rewriteSelectedPanel: (panelIndex: number, instruction: string) => Promise<void>;
  continueFromSelectedPage: () => Promise<SeriesPage | null>;
  // 状态
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

const SeriesContext = createContext<SeriesContextValue | null>(null);

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const allPages = s.chapters.flatMap((ch: any) => ch.pages);
      let nextStep: StoryCreatorStep = 'logline';
      if (allPages.some((p: any) => p.panels && p.panels.length > 0)) {
        nextStep = 'pages';
        const firstReady = allPages.find((p: any) => p.panels && p.panels.length > 0);
        if (firstReady) setSelectedPageId(firstReady.id);
      } else if (s.chapters.length > 0) {
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
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const addChar = useCallback(async (input: {
    name: string;
    role: 'protagonist' | 'antagonist' | 'supporting';
    description: string;
    appearance: string;
    voiceTone?: string;
    autoGenerateImage?: boolean;
  }) => {
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

  const genChapters = useCallback(async (targetPageCount = 12) => {
    if (!currentSeries) return null;
    setBusy(true); setError(null);
    try {
      const res = await generateChapters(currentSeries.id, targetPageCount);
      await refreshCurrent();
      setStep('pages');
      // 默认选第一页
      const firstPage = res.chapters?.[0]?.pages?.[0];
      if (firstPage) setSelectedPageId(firstPage.id);
      return res.chapters;
    } catch (e: any) {
      setError(e.message || '生成章节失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, refreshCurrent]);

  const breakdown = useCallback(async () => {
    if (!currentSeries || !selectedPageId) return null;
    setBusy(true); setError(null);
    try {
      const res = await breakdownPage(currentSeries.id, selectedPageId);
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '拆解分镜失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, selectedPageId, refreshCurrent]);

  const gen = useCallback(async () => {
    if (!currentSeries || !selectedPageId) return null;
    setBusy(true); setError(null);
    try {
      const res = await generatePage(currentSeries.id, selectedPageId);
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '生成页面失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, selectedPageId, refreshCurrent]);

  const regen = useCallback(async () => {
    if (!currentSeries || !selectedPageId) return null;
    setBusy(true); setError(null);
    try {
      const res = await regeneratePage(currentSeries.id, selectedPageId);
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '重生页面失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, selectedPageId, refreshCurrent]);

  const rewritePg = useCallback(async (instruction: string) => {
    if (!currentSeries || !selectedPageId) return null;
    setBusy(true); setError(null);
    try {
      const res = await rewritePage(currentSeries.id, selectedPageId, instruction);
      await refreshCurrent();
      return res.page;
    } catch (e: any) {
      setError(e.message || '改写页面失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, selectedPageId, refreshCurrent]);

  const rewritePn = useCallback(async (panelIndex: number, instruction: string) => {
    if (!currentSeries || !selectedPageId) return;
    setBusy(true); setError(null);
    try {
      await rewritePanel(currentSeries.id, selectedPageId, panelIndex, instruction);
      await refreshCurrent();
    } catch (e: any) {
      setError(e.message || '改写分镜失败');
    } finally {
      setBusy(false);
    }
  }, [currentSeries, selectedPageId, refreshCurrent]);

  const continueNext = useCallback(async () => {
    if (!currentSeries || !selectedPageId) return null;
    setBusy(true); setError(null);
    try {
      const res = await continueNextPage(currentSeries.id, selectedPageId);
      await refreshCurrent();
      if (res.page?.id) setSelectedPageId(res.page.id);
      return res.page;
    } catch (e: any) {
      setError(e.message || '续写失败');
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentSeries, selectedPageId, refreshCurrent]);

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
    generateChaptersForCurrent: genChapters,
    selectedPageId, setSelectedPageId,
    breakdownSelectedPage: breakdown,
    generateSelectedPage: gen,
    regenerateSelectedPage: regen,
    rewriteSelectedPage: rewritePg,
    rewriteSelectedPanel: rewritePn,
    continueFromSelectedPage: continueNext,
    busy, error, clearError,
  }), [
    seriesList, loadingList, refreshList,
    currentSeries, setCurrentSeriesId, create, patch, remove, refreshCurrent,
    step, genWorldview, genCharacters, addChar, updateChar, deleteChar, regenCharImg, genChapters,
    selectedPageId, breakdown, gen, regen, rewritePg, rewritePn, continueNext, busy, error, clearError,
  ]);

  return <SeriesContext.Provider value={value}>{children}</SeriesContext.Provider>;
}
