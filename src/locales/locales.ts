export const locales = {
  zh: {
    // 通用
    export: "导出",
    cancel: "取消",
    save: "保存",
    saving: "保存中...",

    // Model Config
    modelConfig: "模型配置",
    modelConfigTitle: "模型配置",
    modelConfigDescription: "自定义文字生成与图片生成模型、API密钥、超时时间等参数。",
    textModelTab: "文字模型",
    imageModelTab: "图片模型",
    provider: "服务提供商",
    modelName: "模型名称",
    apiKey: "API密钥",
    apiKeyPlaceholder: "输入您的API密钥...",
    apiKeyStorageWarning: "注意：API密钥仅保存在本地（浏览器存储 + 服务器本地配置文件），不会上传到任何外部服务。",
    baseUrl: "Base URL",
    timeout: "请求超时时间",
    extraParams: "额外参数",
  },
  en: {
    // Common
    export: "Export",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving...",

    // Model Config
    modelConfig: "Model Config",
    modelConfigTitle: "Model Configuration",
    modelConfigDescription: "Customize text and image generation models, API keys, timeout, and other parameters.",
    textModelTab: "Text Model",
    imageModelTab: "Image Model",
    provider: "Provider",
    modelName: "Model Name",
    apiKey: "API Key",
    apiKeyPlaceholder: "Enter your API key...",
    apiKeyStorageWarning: "Note: API key is stored locally only (browser storage + server local config file) and never uploaded to any external service.",
    baseUrl: "Base URL",
    timeout: "Request Timeout",
    extraParams: "Extra Params",
  },
  ja: {
    // 共通
    export: "エクスポート",
    cancel: "キャンセル",
    save: "保存",
    saving: "保存中...",

    // モデル設定
    modelConfig: "モデル設定",
    modelConfigTitle: "モデル設定",
    modelConfigDescription: "テキスト生成と画像生成のモデル、APIキー、タイムアウトなどのパラメータをカスタマイズします。",
    textModelTab: "テキストモデル",
    imageModelTab: "画像モデル",
    provider: "プロバイダー",
    modelName: "モデル名",
    apiKey: "APIキー",
    apiKeyPlaceholder: "APIキーを入力...",
    apiKeyStorageWarning: "注：APIキーはローカルのみ（ブラウザストレージとサーバーのローカル設定ファイル）に保存され、外部サービスには送信されません。",
    baseUrl: "Base URL",
    timeout: "リクエストタイムアウト",
    extraParams: "追加パラメータ",
  },
};

export type Language = keyof typeof locales;
export type LocaleKeys = keyof typeof locales['en'];
