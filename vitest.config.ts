import { defineConfig } from 'vitest/config';

/**
 * 测试配置（2026-10-15 新增）。
 *
 * 覆盖两端：src（前端纯逻辑）与 server（后端契约层 / 任务队列）。
 * 只测纯逻辑与无副作用模块 —— 生成链路依赖 LLM 与磁盘图片，不在此范围。
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
