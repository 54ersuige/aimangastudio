import { useState, useEffect, useCallback } from 'react';
import type { ModelConfig, DnaMeta } from '../services/modelConfig';
import {
  loadModelConfig,
  saveModelConfig,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_DNA_KEY,
} from '../services/modelConfig';
import { fetchServerConfig, updateServerConfig, fetchDnaList } from '../services/modelClient';

export const useModelConfig = () => {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [dnaList, setDnaList] = useState<DnaMeta[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const local = loadModelConfig();
    setConfig(local);

    // 启动时拉取服务器 dnaKey 与 DNA 列表（3 选 1，缓存到内存即可）。
    Promise.all([fetchServerConfig(), fetchDnaList()])
      .then(([serverConfig, dnaResp]) => {
        const merged: ModelConfig = {
          text: { ...DEFAULT_MODEL_CONFIG.text, ...local.text, ...serverConfig.text },
          image: { ...DEFAULT_MODEL_CONFIG.image, ...local.image, ...serverConfig.image },
          dnaKey: local.dnaKey ?? serverConfig.dnaKey ?? DEFAULT_DNA_KEY,
        };
        setConfig(merged);
        setDnaList(dnaResp.list);
      })
      .catch((err) => {
        console.warn('Failed to fetch server config:', err);
      });
  }, []);

  const updateConfig = useCallback((updates: Partial<ModelConfig>) => {
    setConfig((prev) => {
      const next = {
        text: { ...prev.text, ...(updates.text || {}) },
        image: { ...prev.image, ...(updates.image || {}) },
        dnaKey: updates.dnaKey ?? prev.dnaKey ?? DEFAULT_DNA_KEY,
      };
      saveModelConfig(next);
      return next;
    });
  }, []);

  const saveToServer = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await updateServerConfig(config);
      saveModelConfig(config);
      setIsModalOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save model configuration.');
    } finally {
      setIsLoading(false);
    }
  }, [config]);

  return {
    config,
    dnaList,
    updateConfig,
    isModalOpen,
    setIsModalOpen,
    saveToServer,
    isLoading,
    error,
    clearError: () => setError(null),
  };
};