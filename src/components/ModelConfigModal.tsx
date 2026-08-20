import React, { useState, useEffect } from 'react';
import { useLocalization } from '../hooks/useLocalization';
import type {
  ModelConfig,
  TextProvider,
  ImageProvider,
  DnaKey,
  DnaMeta,
} from '../services/modelConfig';
import { DEFAULT_DNA_KEY } from '../services/modelConfig';

interface ModelConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  dnaList?: DnaMeta[];
  onChange: (config: ModelConfig) => void;
  onSave: () => void;
  isLoading: boolean;
  error: string | null;
}

const textProviders: { value: TextProvider; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'agnes', label: 'Agnes AI (免费)' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
];

const imageProviders: { value: ImageProvider; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'step', label: '阶跃星辰 Step' },
  { value: 'minimax', label: 'Minimax (Tokenplan)' },
  { value: 'agnes', label: 'Agnes AI (免费)' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
];

const defaultModels: Record<TextProvider | ImageProvider, string> = {
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-v4-flash',
  agnes: 'agnes-2.5-flash',
  step: 'step-image-edit-2',
  minimax: 'image-01-live',
  'openai-compatible': 'gpt-4o',
};

const defaultBaseUrls: Partial<Record<TextProvider | ImageProvider, string>> = {
  deepseek: 'https://api.deepseek.com',
  agnes: 'https://apihub.agnes-ai.cn/v1',
  step: 'https://api.stepfun.com/v1',
  minimax: 'https://api.minimaxi.chat/v1',
};

export function ModelConfigModal({
  isOpen,
  onClose,
  config,
  dnaList = [],
  onChange,
  onSave,
  isLoading,
  error,
}: ModelConfigModalProps): React.ReactElement | null {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'dna'>('text');
  const [localConfig, setLocalConfig] = useState<ModelConfig>(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config, isOpen]);

  if (!isOpen) return null;

  const updateText = (updates: Partial<ModelConfig['text']>) => {
    const next = { ...localConfig, text: { ...localConfig.text, ...updates } };
    setLocalConfig(next);
    onChange(next);
  };

  const updateImage = (updates: Partial<ModelConfig['image']>) => {
    const next = { ...localConfig, image: { ...localConfig.image, ...updates } };
    setLocalConfig(next);
    onChange(next);
  };

  const updateDna = (dnaKey: DnaKey) => {
    const next = { ...localConfig, dnaKey };
    setLocalConfig(next);
    onChange(next);
  };

  const handleProviderChange = (type: 'text' | 'image', provider: TextProvider | ImageProvider) => {
    const updater = type === 'text' ? updateText : updateImage;
    const model = defaultModels[provider];
    const baseUrl = defaultBaseUrls[provider] || '';
    updater({ provider: provider as any, model, baseUrl });
  };

  const handleExtraParamsChange = (type: 'text' | 'image', value: string) => {
    const updater = type === 'text' ? updateText : updateImage;
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      updater({ extraParams: parsed });
    } catch {
      // Allow invalid JSON while typing; only save valid JSON on submit.
    }
  };

  const textConfig = localConfig.text;
  const imageConfig = localConfig.image;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">{t('modelConfigTitle')}</h2>
          <p className="text-sm text-gray-600 mt-1">{t('modelConfigDescription')}</p>
        </div>

        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 py-3 text-sm font-medium ${
              activeTab === 'text'
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t('textModelTab')}
          </button>
          <button
            onClick={() => setActiveTab('image')}
            className={`flex-1 py-3 text-sm font-medium ${
              activeTab === 'image'
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t('imageModelTab')}
          </button>
          <button
            onClick={() => setActiveTab('dna')}
            className={`flex-1 py-3 text-sm font-medium ${
              activeTab === 'dna'
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="dna-tab"
          >
            视觉风格
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {activeTab === 'text' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('provider')}</label>
                <select
                  value={textConfig.provider}
                  onChange={(e) => handleProviderChange('text', e.target.value as TextProvider)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {textProviders.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('modelName')}</label>
                <input
                  type="text"
                  value={textConfig.model}
                  onChange={(e) => updateText({ model: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('apiKey')}</label>
                <input
                  type="password"
                  value={textConfig.apiKey || ''}
                  onChange={(e) => updateText({ apiKey: e.target.value })}
                  placeholder={t('apiKeyPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-1">{t('apiKeyStorageWarning')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('baseUrl')}</label>
                <input
                  type="text"
                  value={textConfig.baseUrl || ''}
                  onChange={(e) => updateText({ baseUrl: e.target.value })}
                  placeholder="https://api.example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('timeout')} (ms)</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={textConfig.timeout}
                  onChange={(e) => updateText({ timeout: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('extraParams')} (JSON)</label>
                <textarea
                  value={JSON.stringify(textConfig.extraParams, null, 2)}
                  onChange={(e) => handleExtraParamsChange('text', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                />
              </div>
            </div>
          )}

          {activeTab === 'image' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('provider')}</label>
                <select
                  value={imageConfig.provider}
                  onChange={(e) => handleProviderChange('image', e.target.value as ImageProvider)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {imageProviders.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('modelName')}</label>
                <input
                  type="text"
                  value={imageConfig.model}
                  onChange={(e) => updateImage({ model: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('apiKey')}</label>
                <input
                  type="password"
                  value={imageConfig.apiKey || ''}
                  onChange={(e) => updateImage({ apiKey: e.target.value })}
                  placeholder={t('apiKeyPlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-500 mt-1">{t('apiKeyStorageWarning')}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('baseUrl')}</label>
                <input
                  type="text"
                  value={imageConfig.baseUrl || ''}
                  onChange={(e) => updateImage({ baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('timeout')} (ms)</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={imageConfig.timeout}
                  onChange={(e) => updateImage({ timeout: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('extraParams')} (JSON)</label>
                <textarea
                  value={JSON.stringify(imageConfig.extraParams, null, 2)}
                  onChange={(e) => handleExtraParamsChange('image', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                />
              </div>
            </div>
          )}

          {activeTab === 'dna' && (
            <div className="space-y-4" data-testid="dna-panel">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">默认视觉风格 DNA</h3>
                <p className="text-xs text-gray-600 mb-4">
                  选择一个 DNA 预设。系统会把它注入到所有出图/出文请求中，确保视觉一致性。
                  已创建的系列 DNA 在创建时锁定，<strong>此处修改只影响此后新建的系列</strong>。
                </p>
              </div>
              <div className="space-y-3">
                {dnaList.map((dna) => {
                  const selected = (localConfig.dnaKey || DEFAULT_DNA_KEY) === dna.key;
                  return (
                    <label
                      key={dna.key}
                      className={`block border rounded-lg p-4 transition cursor-pointer ${
                        selected
                          ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                      data-testid={`dna-option-${dna.key}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="dnaKey"
                          value={dna.key}
                          checked={selected}
                          onChange={() => updateDna(dna.key)}
                          className="mt-1 h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                        />
                        <div className="flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold text-gray-900">{dna.name}</span>
                            <span className="text-xs text-gray-500 font-mono">{dna.key}</span>
                          </div>
                          <p className="text-sm text-gray-700 mt-1">{dna.tagline}</p>
                          {dna.genres.length > 0 && (
                            <p className="text-xs text-gray-500 mt-2">
                              适合题材：{dna.genres.join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {dnaList.length === 0 && (
                <p className="text-xs text-gray-500">正在从服务器加载 DNA 列表…</p>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            {t('cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
