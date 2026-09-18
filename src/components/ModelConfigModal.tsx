import React, { useState, useEffect } from 'react';
import { useLocalization } from '../hooks/useLocalization';
import type {
  ModelConfig,
  TextProvider,
  ImageProvider,
  VisionProvider,
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
  { value: 'minimax', label: 'Minimax (Tokenplan)' },
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

// 2026-09-03：vision 专用的 provider 下拉。
// 2026-09-10：加入 DeepSeek —— V4.1 Flash 起为原生多模态（此前 deepseek 系纯文本，已剔除）。
const visionProviders: { value: VisionProvider; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini（推荐）' },
  { value: 'deepseek', label: 'DeepSeek V4.1 Flash（原生多模态）' },
  { value: 'minimax', label: 'Minimax (Tokenplan)' },
  { value: 'agnes', label: 'Agnes AI (免费)' },
  { value: 'openai-compatible', label: 'OpenAI Compatible' },
];

const defaultModels: Record<TextProvider | ImageProvider | VisionProvider, string> = {
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-v4-flash',
  minimax: 'MiniMax-M3',
  agnes: 'agnes-2.0-flash',
  step: 'step-image-edit-2',
  'openai-compatible': 'gpt-4o',
};

// 图模型默认（与 defaultModels 分开）—— minimax 文本/图像同名 modelName 不同。
// 保留 minimax 图像默认 image-01-live。
const defaultImageModels: Partial<Record<ImageProvider, string>> = {
  agnes: 'agnes-image-2.0-flash',
  step: 'step-image-edit-2',
  minimax: 'image-01-live',
};

// 2026-09-03：vision 专用 model 默认（gemini 最简单，其他厂商需要用户填）。
// minimax 不再写默认 —— minimax 视觉模型名属于用户私有 tokenplan 清单，
// 我们不确定是不是 V-01 / V-Lite / V-Next，强制让用户填。
const defaultVisionModels: Partial<Record<VisionProvider, string>> = {
  gemini: 'gemini-2.5-flash',
  agnes: 'agnes-vision-2.1-flash',
  // 2026-09-10：DeepSeek V4.1 Flash 的官方 API 模型 id（旧名 deepseek-v4-flash 会路由到它）。
  deepseek: 'deepseek-flash',
};

/** 当用户把图像 provider 切到 agnes / step / minimax 等时，默认填的图模型名。 */

const defaultBaseUrls: Partial<Record<TextProvider | ImageProvider | VisionProvider, string>> = {
  deepseek: 'https://api.deepseek.com',
  agnes: 'https://apihub.agnes-ai.cn/v1',
  step: 'https://api.stepfun.com/v1',
  minimax: 'https://api.minimaxi.com/v1',
  // vision: gemini 走它自家 GoogleGenAI SDK；agnes / openai-compatible 走 OpenAI 协议 v1。
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
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
  // 2026-09-03：vision 加进可选 tab。
  const [activeTab, setActiveTab] = useState<'text' | 'image' | 'vision' | 'dna'>('text');
  const [localConfig, setLocalConfig] = useState<ModelConfig>(config);
  const [emptyKeyWarned, setEmptyKeyWarned] = useState(false);

  useEffect(() => {
    setLocalConfig(config);
  }, [config, isOpen]);

  // 用户填上 key 后自动撤销警示
  useEffect(() => {
    if (localConfig.text.apiKey) setEmptyKeyWarned(false);
  }, [localConfig.text.apiKey]);

  // ESC 关闭 —— 与 ConfirmDialog/ManualEditors 的紧急出口保持一致
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

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

  // 2026-09-03：vision 的更新入口。
  const updateVision = (updates: Partial<ModelConfig['vision']>) => {
    const next = { ...localConfig, vision: { ...localConfig.vision, ...updates } };
    setLocalConfig(next);
    onChange(next);
  };

  const updateDna = (dnaKey: DnaKey) => {
    const next = { ...localConfig, dnaKey };
    setLocalConfig(next);
    onChange(next);
  };

  const handleSave = () => {
    // 兜底防护：如果 text.apiKey 为空（用户没填），后续"按世界观生成角色"会 500。
    // 拦截：首次点保存时在弹窗内展示警示，用户可以回去填 key，或再点一次"保存"确认用环境变量。
    if (!localConfig.text.apiKey && !emptyKeyWarned) {
      setEmptyKeyWarned(true);
      return;
    }
    onSave();
  };

  const handleProviderChange = (type: 'text' | 'image' | 'vision', provider: TextProvider | ImageProvider | VisionProvider) => {
    if (type === 'text') {
      const updater = updateText;
      // 文本与图像的默认模型不同（如 agnes 文本是 agnes-2.0-flash，图像是 agnes-image-2.0-flash）。
      // 之前共用 defaultModels，导致切到 agnes 出图时填入了文本模型名，服务器 404。
      const model = defaultModels[provider];
      const baseUrl = defaultBaseUrls[provider] || '';
      // **不再清空 apiKey** —— 上次清空导致用户在某次切换后没有"主动填 key"这一步，
      // 保存到 runtime-config.json 后 text.apiKey=''，下次按世界观生成角色时直接 500。
      // key 的安全保护改为：默认 baseUrl 与之前不同（即确实是切到不同平台）时再清；
      // 同平台切 provider（如 agnes→agnes 但 model 变了）则保留 key。
      const current = localConfig.text;
      const sameBaseUrl = (current.baseUrl || '') === (baseUrl || '');
      const keepKey = sameBaseUrl ? (current.apiKey || '') : '';
      updater({ provider: provider as TextProvider, model, baseUrl, apiKey: keepKey });
      return;
    }
    if (type === 'image') {
      const updater = updateImage;
      const model = defaultImageModels[provider as ImageProvider] ?? defaultModels[provider];
      const baseUrl = defaultBaseUrls[provider] || '';
      const current = localConfig.image;
      const sameBaseUrl = (current.baseUrl || '') === (baseUrl || '');
      const keepKey = sameBaseUrl ? (current.apiKey || '') : '';
      updater({ provider: provider as ImageProvider, model, baseUrl, apiKey: keepKey });
      return;
    }
    // type === 'vision'
    const updater = updateVision;
    // 2026-09-03：vision 有专用 defaultVisionModels，没匹配走通用 fallback。
    const model = defaultVisionModels[provider as VisionProvider] ?? defaultModels[provider];
    const baseUrl = defaultBaseUrls[provider] || '';
    const current = localConfig.vision;
    const sameBaseUrl = (current.baseUrl || '') === (baseUrl || '');
    const keepKey = sameBaseUrl ? (current.apiKey || '') : '';
    updater({ provider: provider as VisionProvider, model, baseUrl, apiKey: keepKey } as any);
  };

  const handleExtraParamsChange = (type: 'text' | 'image' | 'vision', value: string) => {
    const updater = type === 'text' ? updateText : type === 'image' ? updateImage : updateVision;
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      updater({ extraParams: parsed } as any);
    } catch {
      // Allow invalid JSON while typing; only save valid JSON on submit.
    }
  };

  const textConfig = localConfig.text;
  const imageConfig = localConfig.image;
  const visionConfig = localConfig.vision;

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
          {/* 2026-09-03：vision Tab —— 多模态视觉模型（limb-guard 用） */}
          <button
            onClick={() => setActiveTab('vision')}
            className={`flex-1 py-3 text-sm font-medium ${
              activeTab === 'vision'
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
            data-testid="vision-tab"
          >
            视觉模型
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

          {/* 2026-09-03：视觉模型 panel —— 控制 limb-guard「多胳膊/多手指」自动巡检。
              启用后，每张角色参考图和分镜图生成后会先由视觉模型打分，异常则自动 inpaint。 */}
          {activeTab === 'vision' && (
            <div className="space-y-4" data-testid="vision-panel">
              <div className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visionConfig.enabled}
                    onChange={(e) => updateVision({ enabled: e.target.checked })}
                    className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    data-testid="vision-enabled"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900">
                      启用「肢体异常自动巡检」
                    </span>
                    <p className="text-xs text-gray-600 mt-1">
                      启用后，每张角色参考图 / 分镜图在落盘前都会由独立的视觉模型打一次分。
                      检测到「多胳膊 / 多手指 / 手与道具粘连 / 镜像人形」时会自动局部重画（inpaint）。
                      失败/超时都不影响主流程 —— 至少保证原图能保存。
                    </p>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Provider
                </label>
                <select
                  value={visionConfig.provider}
                  onChange={(e) =>
                    handleProviderChange('vision', e.target.value as VisionProvider)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={!visionConfig.enabled}
                >
                  {visionProviders.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model Name
                </label>
                <input
                  type="text"
                  value={visionConfig.model}
                  onChange={(e) => updateVision({ model: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={!visionConfig.enabled}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={visionConfig.apiKey || ''}
                  onChange={(e) => updateVision({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={!visionConfig.enabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  仅用于 limb-guard 图像巡检，与 text / image 模型互不影响。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={visionConfig.baseUrl || ''}
                  onChange={(e) => updateVision({ baseUrl: e.target.value })}
                  placeholder="https://generativelanguage.googleapis.com/v1beta"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={!visionConfig.enabled}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timeout (ms)
                </label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={visionConfig.timeout}
                  onChange={(e) => updateVision({ timeout: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={!visionConfig.enabled}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Extra Params (JSON)
                </label>
                <textarea
                  value={JSON.stringify(visionConfig.extraParams, null, 2)}
                  onChange={(e) => handleExtraParamsChange('vision', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                  disabled={!visionConfig.enabled}
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

        {emptyKeyWarned && !localConfig.text.apiKey && (
          <div className="px-6 pb-2">
            <p className="text-xs" style={{ color: '#B0413E' }}>
              文本模型 API key 为空。如果你已在 .env 里配置了 TEXT_API_KEY，可以再点一次「保存」继续；否则请回到文本页填写。
            </p>
          </div>
        )}

        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
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
