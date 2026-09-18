import { Router } from 'express';
import { z } from 'zod';
import { sendError } from '../utils.js';
import type { DnaKey } from '../../shared/types.js';
import { DNA_KEYS } from '../dna/registry.js';
import { getTask, listTasks } from '../task-queue.js';
import { listSeries, getSeries, createSeries, updateSeries, deleteSeries } from '../series-store.js';

const router = Router();

// ========== 系列 CRUD ==========

router.get('/series', (_req, res) => {
  res.json({ series: listSeries() });
});

router.post('/series', (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(100),
    logline: z.string().min(1).max(2000),
    /**
     * 创建系列时锁定的 DNA key。非法值会被 createSeries 内部降级到 config.dnaKey。
     * 创建后该字段在系列上冻结，不允许 PATCH 修改（防风格漂移）。
     */
    dnaKey: z.enum(DNA_KEYS as unknown as [DnaKey, ...DnaKey[]]).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const series = createSeries(parsed.data as { title: string; logline: string; dnaKey?: string });
  res.json({ series });
});

router.get('/series/:id', (req, res) => {
  const series = getSeries(req.params.id);
  if (!series) return sendError(res, 404, 'Series not found');
  res.json({ series });
});

/**
 * PATCH 端点 —— 显式拒绝 style / dnaKey 字段。
 * 设计：dnaKey 在创建时冻结（防风格漂移）；style 字段已从 Series 整体移除。
 * 只允许改 title / logline 这类"项目元数据"。
 */
router.patch('/series/:id', (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(100).optional(),
    logline: z.string().min(1).max(2000).optional(),
  }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, parsed.error.message);
  const series = updateSeries(req.params.id, parsed.data);
  if (!series) return sendError(res, 404, 'Series not found');
  res.json({ series });
});

router.delete('/series/:id', (req, res) => {
  const ok = deleteSeries(req.params.id);
  if (!ok) return sendError(res, 404, 'Series not found');
  res.json({ success: true });
});

// ========== 任务轮询（P1-6）==========

router.get('/tasks/:taskId', (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return sendError(res, 404, '任务不存在（服务可能已重启），请重新发起生成');
  res.json({ task });
});

// 调试：列出当前内存中所有 task（任何状态）。仅本地使用。
router.get('/tasks', (_req, res) => {
  res.json({ tasks: listTasks() });
});

export default router;
