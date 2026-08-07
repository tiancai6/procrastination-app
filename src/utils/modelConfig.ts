import AsyncStorage from '@react-native-async-storage/async-storage';
import { autoBackup } from './autoBackup';

// ============ 多模型配置 ============
// 支持按品牌（GLM / 豆包 / DeepSeek / Gemini）配置「多个」模型，
// 例如 GLM 可以同时配 glm-4.7-flash 与 glm-5.2，互不影响。
// 所有 AI 功能（对话 / 三餐估算 / 专注分析）统一从这里取「默认模型」。

export type ModelBrand = 'glm' | 'doubao' | 'deepseek' | 'gemini';

export interface ModelConfig {
  id: string;
  brand: ModelBrand;
  name: string; // 显示名，如「GLM 4.7-flash」
  apiKey: string;
  baseUrl: string; // OpenAI 兼容的完整 endpoint
  modelId: string; // 实际模型标识，如 glm-4.7-flash
  isVision: boolean; // 是否支持图片（视觉模型）
  webSearch: boolean; // 是否默认开启联网搜索
  isDefault: boolean; // 默认文本模型
  isDefaultVision: boolean; // 默认视觉模型（发图片时用）
}

export interface BrandPreset {
  label: string;
  baseUrl: string;
  models: string[];
  // 该品牌联网搜索的工具名；null 表示无内置搜索
  searchTool: 'web_search' | 'google_search' | null;
  notes: string;
}

export const BRAND_PRESETS: Record<ModelBrand, BrandPreset> = {
  glm: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: ['glm-4.7-flash', 'glm-4-flash', 'glm-5.2', 'glm-4.5', 'glm-4v-flash'],
    searchTool: 'web_search',
    notes: '国内直连最稳；glm-4.7-flash 长期免费档',
  },
  doubao: {
    label: '豆包 / 火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    models: ['doubao-seed-2.0-lite', 'doubao-seed-2.0-pro', 'doubao-seed-2.0-mini'],
    searchTool: 'web_search',
    notes: '需先在火山方舟「组件管理」开启联网内容插件，联网搜索每月免费 2 万次',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    searchTool: null,
    notes: '无内置搜索；中文/代码强、成本低',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    searchTool: 'google_search',
    notes: '联网搜索=Gemini grounding（免费层每月 5000 次，超出 $14/千次）',
  },
};

const MODEL_CONFIGS_KEY = 'model_configs';

export const getModelConfigs = async (): Promise<ModelConfig[]> => {
  try {
    const raw = await AsyncStorage.getItem(MODEL_CONFIGS_KEY);
    return raw ? (JSON.parse(raw) as ModelConfig[]) : [];
  } catch {
    return [];
  }
};

const persist = async (list: ModelConfig[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(MODEL_CONFIGS_KEY, JSON.stringify(list));
    // 任何模型配置的变更都触发自动备份，保证崩溃恢复 / 自动备份不漏最新配置
    autoBackup();
  } catch (e) {
    console.error('[modelConfig] persist failed', e);
  }
};

export const addModelConfig = async (m: Omit<ModelConfig, 'id'>): Promise<ModelConfig> => {
  const list = await getModelConfigs();
  const cfg: ModelConfig = {
    ...m,
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  };
  // 第一个模型自动设为默认（文本 + 视觉）
  if (list.length === 0) {
    cfg.isDefault = true;
    if (cfg.isVision) cfg.isDefaultVision = true;
  }
  list.push(cfg);
  await persist(list);
  return cfg;
};

export const updateModelConfig = async (id: string, patch: Partial<ModelConfig>): Promise<void> => {
  const list = await getModelConfigs();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  await persist(list);
};

export const deleteModelConfig = async (id: string): Promise<void> => {
  let list = await getModelConfigs();
  list = list.filter((x) => x.id !== id);
  // 删掉默认后，自动补一个默认
  if (!list.some((x) => x.isDefault) && list.length) list[0].isDefault = true;
  if (!list.some((x) => x.isDefaultVision)) {
    const v = list.find((x) => x.isVision);
    if (v) v.isDefaultVision = true;
  }
  await persist(list);
};

export const setDefaultModel = async (id: string): Promise<void> => {
  const list = await getModelConfigs();
  list.forEach((x) => (x.isDefault = x.id === id));
  await persist(list);
};

export const setDefaultVisionModel = async (id: string): Promise<void> => {
  const list = await getModelConfigs();
  list.forEach((x) => (x.isDefaultVision = x.id === id));
  await persist(list);
};

export const getDefaultModel = async (): Promise<ModelConfig | null> => {
  const list = await getModelConfigs();
  return list.find((x) => x.isDefault) || list[0] || null;
};

export const getDefaultVisionModelCfg = async (): Promise<ModelConfig | null> => {
  const list = await getModelConfigs();
  return list.find((x) => x.isDefaultVision) || list.find((x) => x.isVision) || null;
};

// 取当前要用的模型配置：发图片用视觉模型，否则用默认文本模型
export const getActiveConfig = async (useVision: boolean): Promise<ModelConfig | null> => {
  if (useVision) {
    const v = await getDefaultVisionModelCfg();
    return v || (await getDefaultModel());
  }
  return await getDefaultModel();
};

export const hasModelConfig = async (): Promise<boolean> => (await getModelConfigs()).length > 0;

// 首次迁移：老用户只配过单个 GLM Key，自动转成一条 GLM 配置，避免丢失
export const migrateFromLegacy = async (legacyKey: string | null, legacyModel: string, legacyVision: string): Promise<void> => {
  const list = await getModelConfigs();
  if (list.length > 0 || !legacyKey) return;
  const isVision = legacyModel.includes('v') || legacyModel.includes('4v');
  await addModelConfig({
    brand: 'glm',
    name: legacyModel || 'glm-4-flash',
    apiKey: legacyKey,
    baseUrl: BRAND_PRESETS.glm.baseUrl,
    modelId: legacyModel || 'glm-4-flash',
    isVision,
    webSearch: false,
    isDefault: true,
    isDefaultVision: isVision,
  });
  // 若视觉模型与文本模型不同，补一条
  if (legacyVision && legacyVision !== legacyModel) {
    await addModelConfig({
      brand: 'glm',
      name: legacyVision,
      apiKey: legacyKey,
      baseUrl: BRAND_PRESETS.glm.baseUrl,
      modelId: legacyVision,
      isVision: true,
      webSearch: false,
      isDefault: false,
      isDefaultVision: true,
    });
  }
};

const LEGACY_MODEL = 'glm-4-flash';
const LEGACY_VISION = 'glm-4v-flash';

// App 启动时调用：若还没有任何模型配置，但老字段里有 GLM Key，则自动迁移
export const migrateIfNeeded = async (): Promise<void> => {
  const list = await getModelConfigs();
  if (list.length > 0) return;
  const legacyKey = await AsyncStorage.getItem('ai_api_key');
  if (!legacyKey) return;
  const legacyModel = (await AsyncStorage.getItem('ai_model')) || LEGACY_MODEL;
  const legacyVision = (await AsyncStorage.getItem('ai_vision_model')) || LEGACY_VISION;
  await migrateFromLegacy(legacyKey, legacyModel, legacyVision);
  // 迁移完成后清除旧字段，避免用户删光模型后下次启动又「复活」一条 GLM 配置
  await AsyncStorage.multiRemove(['ai_api_key', 'ai_model', 'ai_vision_model']);
};
