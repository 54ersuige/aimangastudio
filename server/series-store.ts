import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { randomUUID } from 'crypto';

// 系列漫画的数据结构
export interface Worldview {
  background: string;
  era: string;
  artStyle: string;
  paletteMood: string;
  summary: string;
}

export interface SeriesCharacter {
  id: string;
  name: string;
  role: 'protagonist' | 'antagonist' | 'supporting';
  description: string;
  appearance: string;
  referenceImage?: string; // base64 data URL
  voiceTone: string;
}

export interface Panel {
  index: number;
  description: string;
  dialogue?: string;
  characterIds: string[];
  imageUrl?: string;
}

export interface SeriesPage {
  id: string;
  pageNumber: number;
  title: string;
  sceneDescription: string;
  panels: Panel[];
  generatedImage?: string;
  characterIds: string[];
  status: 'draft' | 'generating' | 'done' | 'error';
  errorMessage?: string;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  pageCount: number;
  pages: SeriesPage[];
}

export interface Series {
  id: string;
  title: string;
  logline: string; // 用户最初的一句话
  worldview?: Worldview;
  style: string;
  characters: SeriesCharacter[];
  chapters: Chapter[];
  createdAt: string;
  updatedAt: string;
}

const DATA_PATH = resolve(process.cwd(), 'series-data.json');

function ensureDir(): void {
  const dir = dirname(DATA_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadAll(): Series[] {
  if (!existsSync(DATA_PATH)) return [];
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(raw) as Series[];
  } catch (e) {
    console.warn('Failed to load series data:', e);
    return [];
  }
}

function saveAll(series: Series[]): void {
  ensureDir();
  writeFileSync(DATA_PATH, JSON.stringify(series, null, 2));
}

export function listSeries(): Series[] {
  return loadAll();
}

export function getSeries(id: string): Series | undefined {
  return loadAll().find(s => s.id === id);
}

export function createSeries(input: { title: string; logline: string; style?: string }): Series {
  const now = new Date().toISOString();
  const series: Series = {
    id: randomUUID(),
    title: input.title,
    logline: input.logline,
    style: input.style || '日式漫画',
    characters: [],
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };
  const all = loadAll();
  all.push(series);
  saveAll(all);
  return series;
}

export function updateSeries(id: string, patch: Partial<Series>): Series | undefined {
  const all = loadAll();
  const idx = all.findIndex(s => s.id === id);
  if (idx === -1) return undefined;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  saveAll(all);
  return all[idx];
}

export function deleteSeries(id: string): boolean {
  const all = loadAll();
  const next = all.filter(s => s.id !== id);
  if (next.length === all.length) return false;
  saveAll(next);
  return true;
}

export function addCharacter(seriesId: string, character: Omit<SeriesCharacter, 'id'>): SeriesCharacter | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const newChar: SeriesCharacter = { ...character, id: randomUUID() };
  series.characters.push(newChar);
  updateSeries(seriesId, { characters: series.characters });
  return newChar;
}

export function updateCharacter(seriesId: string, characterId: string, patch: Partial<SeriesCharacter>): SeriesCharacter | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const idx = series.characters.findIndex(c => c.id === characterId);
  if (idx === -1) return undefined;
  series.characters[idx] = { ...series.characters[idx], ...patch };
  updateSeries(seriesId, { characters: series.characters });
  return series.characters[idx];
}

export function removeCharacter(seriesId: string, characterId: string): boolean {
  const series = getSeries(seriesId);
  if (!series) return false;
  const next = series.characters.filter(c => c.id !== characterId);
  if (next.length === series.characters.length) return false;
  updateSeries(seriesId, { characters: next });
  return true;
}

export function setChapters(seriesId: string, chapters: Chapter[]): Chapter[] | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  // Ensure each chapter has stable IDs
  const normalized = chapters.map(ch => ({
    ...ch,
    id: ch.id || randomUUID(),
    pages: ch.pages.map(p => ({ ...p, id: p.id || randomUUID() })),
  }));
  updateSeries(seriesId, { chapters: normalized });
  return normalized;
}

export function updatePage(seriesId: string, chapterId: string, pageId: string, patch: Partial<SeriesPage>): SeriesPage | undefined {
  const series = getSeries(seriesId);
  if (!series) return undefined;
  const chapter = series.chapters.find(c => c.id === chapterId);
  if (!chapter) return undefined;
  const pageIdx = chapter.pages.findIndex(p => p.id === pageId);
  if (pageIdx === -1) return undefined;
  chapter.pages[pageIdx] = { ...chapter.pages[pageIdx], ...patch };
  updateSeries(seriesId, { chapters: series.chapters });
  return chapter.pages[pageIdx];
}
