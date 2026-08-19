import { useState, useEffect, useCallback } from 'react';
import type { ModelConfig } from '../services/modelConfig';
import { loadModelConfig, saveModelConfig, DEFAULT_MODEL_CONFIG } from '../services/modelConfig';
import { fetchServerConfig, updateServerConfig } from '../services/modelClient';

export const useModelConfig = () => {
  const [config, setConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const local = loadModelConfig();
    setConfig(local);

    // Try to sync with server config (e.g. from .env) on first load.
    fetchServerConfig()
      .then((serverConfig) => {
        const merged: ModelConfig = {
          text: { ...DEFAULT_MODEL_CONFIG.text, ...local.text, ...serverConfig.text },
          image: { ...DEFAULT_MODEL_CONFIG.image, ...local.image, ...serverConfig.image },
        };
        setConfig(merged);
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
    setConfig,
    updateConfig,
    isModalOpen,
    setIsModalOpen,
    saveToServer,
    isLoading,
    error,
    clearError: () => setError(null),
  };
};
