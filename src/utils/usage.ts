import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

// ============ AI 调用用量记录 ============
// 每次调用 AI（三餐估算 / 运动消耗 / AI 对话 / 饮食建议 / 食物分析）后，
// 由 model.ts 把本次 token 用量写入这里，便于事后分析「哪个功能、哪个模型花了多少 token」。

export interface AiUsageRecord {
  ts: number; // 调用时间戳（ms）
  feature: string; // 调用来源：三餐估算 / 三餐估算(批量) / 运动消耗 / AI对话 / 饮食建议 / 食物分析
  brand: string; // 品牌：glm / doubao / deepseek / gemini
  modelId: string; // 实际模型标识
  promptTokens: number; // 输入 token
  completionTokens: number; // 输出 token
  totalTokens: number; // 总 token
}

const AI_USAGE_KEY = 'ai_usage_log';
const MAX_RECORDS = 2000;

// 写入一条用量记录（自动追加，最多保留最近 2000 条）
export const recordAiUsage = async (rec: Omit<AiUsageRecord, 'ts'>): Promise<void> => {
  try {
    const full: AiUsageRecord = { ts: Date.now(), ...rec };
    const raw = await AsyncStorage.getItem(AI_USAGE_KEY);
    const list: AiUsageRecord[] = raw ? (JSON.parse(raw) as AiUsageRecord[]) : [];
    list.push(full);
    if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
    await AsyncStorage.setItem(AI_USAGE_KEY, JSON.stringify(list));
    // 任何用量变更也触发自动备份，保证记录不丢
  } catch (e) {
    console.error('[usage] record failed', e);
  }
};

export const getAiUsageLog = async (): Promise<AiUsageRecord[]> => {
  try {
    const raw = await AsyncStorage.getItem(AI_USAGE_KEY);
    return raw ? (JSON.parse(raw) as AiUsageRecord[]) : [];
  } catch {
    return [];
  }
};

export const clearAiUsageLog = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(AI_USAGE_KEY);
  } catch (e) {
    console.error('[usage] clear failed', e);
  }
};

export interface UsageSummary {
  totalTokens: number;
  totalPrompt: number;
  totalCompletion: number;
  count: number;
  byModel: Record<string, number>; // modelId -> tokens
  byFeature: Record<string, number>; // feature -> tokens
}

// 汇总统计（总 token / 输入 / 输出 / 次数 / 按模型 / 按功能）
export const summarizeAiUsage = (list: AiUsageRecord[]): UsageSummary => {
  const s: UsageSummary = { totalTokens: 0, totalPrompt: 0, totalCompletion: 0, count: list.length, byModel: {}, byFeature: {} };
  for (const r of list) {
    s.totalTokens += r.totalTokens;
    s.totalPrompt += r.promptTokens;
    s.totalCompletion += r.completionTokens;
    s.byModel[r.modelId] = (s.byModel[r.modelId] || 0) + r.totalTokens;
    s.byFeature[r.feature] = (s.byFeature[r.feature] || 0) + r.totalTokens;
  }
  return s;
};

export interface AiUsageExportFile {
  app: string;
  exportedAt: string;
  summary: UsageSummary;
  records: AiUsageRecord[];
}

// 单独导出 AI 用量记录：生成一份 JSON（含汇总 + 原始明细）并通过系统分享面板保存/发送。
// 返回文件名；若没有任何记录则返回 null（调用方提示「无数据」）。
export const exportAiUsage = async (): Promise<string | null> => {
  const list = await getAiUsageLog();
  if (list.length === 0) return null;

  const file: AiUsageExportFile = {
    app: 'dailytrace',
    exportedAt: new Date().toISOString(),
    summary: summarizeAiUsage(list),
    records: list,
  };

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fileName = `日迹AI用量记录-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  const jsonStr = JSON.stringify(file, null, 2);
  await FileSystem.writeAsStringAsync(fileUri, jsonStr, { encoding: FileSystem.EncodingType.UTF8 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: '导出 AI 用量记录',
      UTI: 'public.json',
    });
  }
  return fileName;
};

// ============ AI 原始返回记录（调试用）============
// 把每次 AI 最原始的返回文本存下来，方便在「AI 用量记录 → 调试·原始返回」里直接查看模型到底回了什么，
// 排查「有输入有输出但解析失败」这类问题（例如批量估算返回的是 {results:[...]} 还是 {早餐:{...}}）。
const AI_RAW_KEY = 'ai_raw_log';
const MAX_RAW = 15;

export interface AiRawRecord {
  ts: number;
  feature: string;
  modelId: string;
  text: string; // 原始返回文本（已截断到 6000 字）
}

export const recordAiRaw = async (feature: string, modelId: string, text: string): Promise<void> => {
  try {
    const full: AiRawRecord = { ts: Date.now(), feature: feature || 'AI调用', modelId, text: (text || '').slice(0, 6000) };
    const raw = await AsyncStorage.getItem(AI_RAW_KEY);
    const list: AiRawRecord[] = raw ? JSON.parse(raw) : [];
    list.push(full);
    if (list.length > MAX_RAW) list.splice(0, list.length - MAX_RAW);
    await AsyncStorage.setItem(AI_RAW_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('[usage] recordAiRaw failed', e);
  }
};

export const getAiRawLog = async (): Promise<AiRawRecord[]> => {
  try {
    const raw = await AsyncStorage.getItem(AI_RAW_KEY);
    return raw ? (JSON.parse(raw) as AiRawRecord[]) : [];
  } catch {
    return [];
  }
};

export const clearAiRawLog = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(AI_RAW_KEY);
  } catch (e) {
    console.error('[usage] clearAiRaw failed', e);
  }
};

// 导出原始返回（含最近若干次完整文本），便于把模型实际返回贴给助手排查。
export const exportAiRaw = async (): Promise<string | null> => {
  const list = await getAiRawLog();
  if (list.length === 0) return null;
  const file = { app: 'dailytrace', exportedAt: new Date().toISOString(), records: list };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fileName = `日迹AI原始返回-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(file, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: '导出 AI 原始返回', UTI: 'public.json' });
  }
  return fileName;
};
