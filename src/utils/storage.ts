import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { ProcrastinationRecord, UserStats, TaskPlan, Plan, CheckinRecord, RewardRecord, QuickMemo, LedgerEntry } from '../types';
import type { AIInsightResult, MemoAnalysisResult } from './ai';
import type { ChatMessage, ChatMeta } from './chat';
import { autoBackup } from './autoBackup';
import { emitDataReset } from './appEvents';

const RECORDS_KEY = 'procrastination_records';
const STATS_KEY = 'procrastination_stats';
const PROFILE_IMAGE_KEY = 'procrastination_profile_image';
const TASK_PLANS_KEY = 'procrastination_task_plans';
const PLANS_KEY = 'procrastination_plans';
const CHECKIN_RECORDS_KEY = 'procrastination_checkin_records';
const REWARD_RECORDS_KEY = 'procrastination_reward_records';
const AI_INSIGHTS_CACHE_KEY = 'ai_insights_cache';
const AI_API_KEY = 'ai_api_key';
const AI_MODEL = 'ai_model';
const DEFAULT_AI_MODEL = 'glm-4-flash';
const QUICK_MEMOS_KEY = 'quick_memos';
const MEMO_ANALYSIS_CACHE_KEY = 'memo_analysis_cache';

export interface CachedInsight {
  fingerprint: string;
  result: AIInsightResult;
  timestamp: number;
}
export interface AIInsightCache {
  [period: string]: CachedInsight;
}

export const clearAllData = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([
      RECORDS_KEY,
      STATS_KEY,
      PROFILE_IMAGE_KEY,
      TASK_PLANS_KEY,
      PLANS_KEY,
      CHECKIN_RECORDS_KEY,
      REWARD_RECORDS_KEY,
      AI_INSIGHTS_CACHE_KEY,
      QUICK_MEMOS_KEY,
      MEMO_ANALYSIS_CACHE_KEY,
      AI_API_KEY,
      AI_MODEL,
      CHAT_MESSAGES_KEY,
      CHAT_SUMMARY_KEY,
      CHAT_META_KEY,
      LEDGER_KEY,
      // 注意：last_manual_export_at 不清除，避免清除后立即弹备份提醒
      // last_auto_backup_at 也不清除，保留上次备份时间便于参考
    ]);
    // 随手记媒体文件存于沙盒 documentDirectory/memos/，非 AsyncStorage，需单独删除
    try {
      const MEMO_MEDIA_BASE = `${FileSystem.documentDirectory}memos/`;
      await FileSystem.deleteAsync(MEMO_MEDIA_BASE, { idempotent: true });
    } catch (e) {
      console.error('Failed to clear memo media:', e);
    }
    console.log('All data cleared');
  } catch (error) {
    console.error('Failed to clear data:', error);
  } finally {
    // 通知所有已挂载页面重新拉取，保证清除后 UI 同步清空
    emitDataReset();
  }
};

export const saveRecord = async (record: ProcrastinationRecord): Promise<void> => {
  try {
    const records = await getRecords();
    records.push(record);
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    autoBackup();
  } catch (error) {
    console.error('Failed to save record:', error);
  }
};

export const getRecords = async (): Promise<ProcrastinationRecord[]> => {
  try {
    const data = await AsyncStorage.getItem(RECORDS_KEY);
    const records = data ? JSON.parse(data) : [];
    const seen = new Set<string>();
    const deduplicated = records.filter((record: ProcrastinationRecord) => {
      if (seen.has(record.id)) {
        console.warn(`Duplicate record ID found: ${record.id}`);
        return false;
      }
      seen.add(record.id);
      return true;
    });
    return deduplicated;
  } catch (error) {
    console.error('Failed to get records:', error);
    return [];
  }
};

export const getTodayRecords = async (): Promise<ProcrastinationRecord[]> => {
  const records = await getRecords();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  return records.filter(record => record.startTime >= todayTimestamp);
};

export const getWeekRecords = async (): Promise<ProcrastinationRecord[]> => {
  const records = await getRecords();
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);
  const mondayTimestamp = monday.getTime();
  
  return records.filter(record => record.startTime >= mondayTimestamp);
};

export const getMonthRecords = async (): Promise<ProcrastinationRecord[]> => {
  const records = await getRecords();
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayTimestamp = firstDay.getTime();
  
  return records.filter(record => record.startTime >= firstDayTimestamp);
};

export const getAllRecords = async (): Promise<ProcrastinationRecord[]> => {
  return await getRecords();
};

export const updateRecord = async (record: ProcrastinationRecord): Promise<void> => {
  try {
    const records = await getRecords();
    const idx = records.findIndex((r) => r.id === record.id);
    if (idx !== -1) {
      records[idx] = record;
      await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(records));
      autoBackup();
    }
  } catch (error) {
    console.error('Failed to update record:', error);
  }
};

export const deleteRecord = async (id: string): Promise<void> => {
  try {
    const records = await getRecords();
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(records.filter((r) => r.id !== id)));
    autoBackup();
  } catch (error) {
    console.error('Failed to delete record:', error);
  }
};

export const getStats = async (): Promise<UserStats> => {
  try {
    const records = await getRecords();
    await updateStats(records);
    const data = await AsyncStorage.getItem(STATS_KEY);
    return data ? JSON.parse(data) : getDefaultStats();
  } catch (error) {
    console.error('Failed to get stats:', error);
    return getDefaultStats();
  }
};

export const updateStats = async (records: ProcrastinationRecord[]): Promise<void> => {
  try {
    const now = new Date();

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const dayOfWeek = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1);
    monday.setHours(0, 0, 0, 0);
    const mondayTimestamp = monday.getTime();

    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayTimestamp = firstDay.getTime();

    const todayRecords = records.filter(r => r.startTime >= todayTimestamp);
    const weekRecords = records.filter(r => r.startTime >= mondayTimestamp);
    const monthRecords = records.filter(r => r.startTime >= firstDayTimestamp);

    const stats: UserStats = {
      todayDuration: todayRecords.reduce((sum, r) => sum + r.duration, 0),
      todayLimit: 45,
      weekTotal: weekRecords.reduce((sum, r) => sum + r.duration, 0),
      weekCount: weekRecords.length,
      avgDuration: weekRecords.length > 0
        ? Math.round(weekRecords.reduce((sum, r) => sum + r.duration, 0) / weekRecords.length)
        : 0,
      longestDuration: records.length > 0
        ? Math.max(...records.map(r => r.duration))
        : 0,
      monthTotal: monthRecords.reduce((sum, r) => sum + r.duration, 0),
      monthCount: monthRecords.length,
    };

    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
    autoBackup();
  } catch (error) {
    console.error('Failed to update stats:', error);
  }
};

const getDefaultStats = (): UserStats => ({
  todayDuration: 0,
  todayLimit: 45,
  weekTotal: 0,
  weekCount: 0,
  avgDuration: 0,
  longestDuration: 0,
  monthTotal: 0,
  monthCount: 0,
});

export const saveProfileImage = async (imageUri: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(PROFILE_IMAGE_KEY, imageUri);
    autoBackup();
  } catch (error) {
    console.error('Failed to save profile image:', error);
  }
};

export const getProfileImage = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(PROFILE_IMAGE_KEY);
  } catch (error) {
    console.error('Failed to get profile image:', error);
    return null;
  }
};

export const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  const counter = Math.floor(Math.random() * 10000).toString(36);
  return `${timestamp}-${random}-${counter}`;
};

export const saveTaskPlan = async (plan: TaskPlan): Promise<void> => {
  try {
    const plans = await getTaskPlans();
    plans.push(plan);
    await AsyncStorage.setItem(TASK_PLANS_KEY, JSON.stringify(plans));
    autoBackup();
  } catch (error) {
    console.error('Failed to save task plan:', error);
  }
};

export const getTaskPlans = async (): Promise<TaskPlan[]> => {
  try {
    const data = await AsyncStorage.getItem(TASK_PLANS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get task plans:', error);
    return [];
  }
};

export const updateTaskPlan = async (plan: TaskPlan): Promise<void> => {
  try {
    const plans = await getTaskPlans();
    const index = plans.findIndex(p => p.id === plan.id);
    if (index !== -1) {
      plans[index] = plan;
      await AsyncStorage.setItem(TASK_PLANS_KEY, JSON.stringify(plans));
      autoBackup();
    }
  } catch (error) {
    console.error('Failed to update task plan:', error);
  }
};

export const deleteTaskPlan = async (id: string): Promise<void> => {
  try {
    const plans = await getTaskPlans();
    const filtered = plans.filter(p => p.id !== id);
    await AsyncStorage.setItem(TASK_PLANS_KEY, JSON.stringify(filtered));
    autoBackup();
  } catch (error) {
    console.error('Failed to delete task plan:', error);
  }
};

export const savePlan = async (plan: Plan): Promise<void> => {
  try {
    const plans = await getPlans();
    plans.push(plan);
    await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(plans));
    autoBackup();
  } catch (error) {
    console.error('Failed to save plan:', error);
  }
};

export const getPlans = async (): Promise<Plan[]> => {
  try {
    const data = await AsyncStorage.getItem(PLANS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get plans:', error);
    return [];
  }
};

export const updatePlan = async (plan: Plan): Promise<void> => {
  try {
    const plans = await getPlans();
    const index = plans.findIndex(p => p.id === plan.id);
    if (index !== -1) {
      plans[index] = plan;
      await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(plans));
      autoBackup();
    }
  } catch (error) {
    console.error('Failed to update plan:', error);
  }
};

export const deletePlan = async (id: string): Promise<void> => {
  try {
    const plans = await getPlans();
    const filtered = plans.filter(p => p.id !== id);
    await AsyncStorage.setItem(PLANS_KEY, JSON.stringify(filtered));
    const records = await getCheckinRecords();
    const filteredRecords = records.filter(r => r.planId !== id);
    await AsyncStorage.setItem(CHECKIN_RECORDS_KEY, JSON.stringify(filteredRecords));
    const rewards = await getRewardRecords();
    const filteredRewards = rewards.filter(r => r.planId !== id);
    await AsyncStorage.setItem(REWARD_RECORDS_KEY, JSON.stringify(filteredRewards));
    autoBackup();
  } catch (error) {
    console.error('Failed to delete plan:', error);
  }
};

export const saveCheckinRecord = async (record: CheckinRecord): Promise<void> => {
  try {
    const records = await getCheckinRecords();
    const existingIndex = records.findIndex(r => r.planId === record.planId && r.date === record.date);
    if (existingIndex !== -1) {
      records[existingIndex] = record;
    } else {
      records.push(record);
    }
    await AsyncStorage.setItem(CHECKIN_RECORDS_KEY, JSON.stringify(records));
    autoBackup();
  } catch (error) {
    console.error('Failed to save checkin record:', error);
  }
};

export const getCheckinRecords = async (): Promise<CheckinRecord[]> => {
  try {
    const data = await AsyncStorage.getItem(CHECKIN_RECORDS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get checkin records:', error);
    return [];
  }
};

export const getCheckinRecordsByPlan = async (planId: string): Promise<CheckinRecord[]> => {
  try {
    const records = await getCheckinRecords();
    return records.filter(r => r.planId === planId);
  } catch (error) {
    console.error('Failed to get checkin records by plan:', error);
    return [];
  }
};

export const getCheckinRecordsByDateRange = async (planId: string, startDate: string, endDate: string): Promise<CheckinRecord[]> => {
  try {
    const records = await getCheckinRecordsByPlan(planId);
    return records.filter(r => r.date >= startDate && r.date <= endDate);
  } catch (error) {
    console.error('Failed to get checkin records by date range:', error);
    return [];
  }
};

export const saveRewardRecord = async (record: RewardRecord): Promise<void> => {
  try {
    const records = await getRewardRecords();
    records.push(record);
    await AsyncStorage.setItem(REWARD_RECORDS_KEY, JSON.stringify(records));
    autoBackup();
  } catch (error) {
    console.error('Failed to save reward record:', error);
  }
};

export const getRewardRecords = async (): Promise<RewardRecord[]> => {
  try {
    const data = await AsyncStorage.getItem(REWARD_RECORDS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get reward records:', error);
    return [];
  }
};

export const getRewardRecordsByPlan = async (planId: string): Promise<RewardRecord[]> => {
  try {
    const records = await getRewardRecords();
    return records.filter(r => r.planId === planId);
  } catch (error) {
    console.error('Failed to get reward records by plan:', error);
    return [];
  }
};

export const updateRewardRecord = async (record: RewardRecord): Promise<void> => {
  try {
    const records = await getRewardRecords();
    const index = records.findIndex(r => r.id === record.id);
    if (index !== -1) {
      records[index] = record;
      await AsyncStorage.setItem(REWARD_RECORDS_KEY, JSON.stringify(records));
      autoBackup();
    }
  } catch (error) {
    console.error('Failed to update reward record:', error);
  }
};

// ============ AI 分析相关存储 ============

export const setApiKey = async (key: string): Promise<void> => {
  try {
    if (key && key.trim()) {
      await AsyncStorage.setItem(AI_API_KEY, key.trim());
      autoBackup();
    } else {
      await AsyncStorage.removeItem(AI_API_KEY);
      autoBackup();
    }
  } catch (error) {
    console.error('Failed to save API key:', error);
  }
};

export const getApiKey = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(AI_API_KEY);
  } catch (error) {
    console.error('Failed to get API key:', error);
    return null;
  }
};

export const setModel = async (model: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(AI_MODEL, model && model.trim() ? model.trim() : DEFAULT_AI_MODEL);
    autoBackup();
  } catch (error) {
    console.error('Failed to save model:', error);
  }
};

export const getModel = async (): Promise<string> => {
  try {
    return (await AsyncStorage.getItem(AI_MODEL)) || DEFAULT_AI_MODEL;
  } catch (error) {
    console.error('Failed to get model:', error);
    return DEFAULT_AI_MODEL;
  }
};

export const getCachedInsight = async (period: string): Promise<CachedInsight | null> => {
  try {
    const raw = await AsyncStorage.getItem(AI_INSIGHTS_CACHE_KEY);
    if (!raw) return null;
    const cache: AIInsightCache = JSON.parse(raw);
    return cache[period] || null;
  } catch (error) {
    console.error('Failed to get cached insight:', error);
    return null;
  }
};

export const saveCachedInsight = async (period: string, insight: CachedInsight): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(AI_INSIGHTS_CACHE_KEY);
    const cache: AIInsightCache = raw ? JSON.parse(raw) : {};
    cache[period] = insight;
    await AsyncStorage.setItem(AI_INSIGHTS_CACHE_KEY, JSON.stringify(cache));
    autoBackup();
  } catch (error) {
    console.error('Failed to save AI cache:', error);
  }
};

// ============ 随手记（QuickMemo）存储 ============

export interface CachedMemoAnalysis {
  fingerprint: string;
  result: MemoAnalysisResult;
  timestamp: number;
}
export interface MemoAnalysisCache {
  [range: string]: CachedMemoAnalysis;
}

export const getQuickMemos = async (): Promise<QuickMemo[]> => {
  try {
    const data = await AsyncStorage.getItem(QUICK_MEMOS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get quick memos:', error);
    return [];
  }
};

export const saveQuickMemos = async (list: QuickMemo[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(QUICK_MEMOS_KEY, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to save quick memos:', error);
  }
};

export const addQuickMemo = async (memo: QuickMemo): Promise<void> => {
  const list = await getQuickMemos();
  list.push(memo);
  await saveQuickMemos(list);
};

export const updateQuickMemo = async (memo: QuickMemo): Promise<void> => {
  const list = await getQuickMemos();
  const idx = list.findIndex((m) => m.id === memo.id);
  if (idx !== -1) list[idx] = memo;
  await saveQuickMemos(list);
};

export const deleteQuickMemo = async (id: string): Promise<void> => {
  const list = await getQuickMemos();
  await saveQuickMemos(list.filter((m) => m.id !== id));
};

export const getCachedMemoAnalysis = async (range: string): Promise<CachedMemoAnalysis | null> => {
  try {
    const raw = await AsyncStorage.getItem(MEMO_ANALYSIS_CACHE_KEY);
    if (!raw) return null;
    const cache: MemoAnalysisCache = JSON.parse(raw);
    return cache[range] || null;
  } catch (error) {
    console.error('Failed to get cached memo analysis:', error);
    return null;
  }
};

export const saveCachedMemoAnalysis = async (range: string, item: CachedMemoAnalysis): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(MEMO_ANALYSIS_CACHE_KEY);
    const cache: MemoAnalysisCache = raw ? JSON.parse(raw) : {};
    cache[range] = item;
    await AsyncStorage.setItem(MEMO_ANALYSIS_CACHE_KEY, JSON.stringify(cache));
    autoBackup();
  } catch (error) {
    console.error('Failed to save memo analysis cache:', error);
  }
};

// ============ AI 对话（Chat）存储 ============

const CHAT_MESSAGES_KEY = 'chat_messages';
const CHAT_SUMMARY_KEY = 'chat_summary';
const CHAT_META_KEY = 'chat_meta';

export const getChatMessages = async (): Promise<ChatMessage[]> => {
  try {
    const data = await AsyncStorage.getItem(CHAT_MESSAGES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get chat messages:', error);
    return [];
  }
};

export const saveChatMessages = async (list: ChatMessage[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to save chat messages:', error);
  }
};

export const getChatSummary = async (): Promise<string> => {
  try {
    return (await AsyncStorage.getItem(CHAT_SUMMARY_KEY)) || '';
  } catch (error) {
    console.error('Failed to get chat summary:', error);
    return '';
  }
};

export const saveChatSummary = async (md: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(CHAT_SUMMARY_KEY, md);
    autoBackup();
  } catch (error) {
    console.error('Failed to save chat summary:', error);
  }
};

export const getChatMeta = async (): Promise<ChatMeta> => {
  try {
    const data = await AsyncStorage.getItem(CHAT_META_KEY);
    if (data) return JSON.parse(data);
  } catch (error) {
    console.error('Failed to get chat meta:', error);
  }
  return { compressCount: 0, lastCompressedAt: null };
};

export const saveChatMeta = async (meta: ChatMeta): Promise<void> => {
  try {
    await AsyncStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
    autoBackup();
  } catch (error) {
    console.error('Failed to save chat meta:', error);
  }
};

export const clearChat = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([CHAT_MESSAGES_KEY, CHAT_SUMMARY_KEY, CHAT_META_KEY]);
    autoBackup();
  } catch (error) {
    console.error('Failed to clear chat:', error);
  }
};

// ============ 记账（Ledger）存储 ============

const LEDGER_KEY = 'ledger_entries';

export const getLedgerEntries = async (): Promise<LedgerEntry[]> => {
  try {
    const data = await AsyncStorage.getItem(LEDGER_KEY);
    const list: LedgerEntry[] = data ? JSON.parse(data) : [];
    return list.sort((a, b) => b.occurredAt - a.occurredAt);
  } catch (error) {
    console.error('Failed to get ledger entries:', error);
    return [];
  }
};

export const addLedgerEntry = async (entry: LedgerEntry): Promise<void> => {
  try {
    // getLedgerEntries 已按时间倒序，新条目直接 push 到最前
    const list = await getLedgerEntries();
    list.push(entry);
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to add ledger entry:', error);
  }
};

export const updateLedgerEntry = async (entry: LedgerEntry): Promise<void> => {
  try {
    const list = await getLedgerEntries();
    const idx = list.findIndex((e) => e.id === entry.id);
    if (idx !== -1) list[idx] = entry;
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to update ledger entry:', error);
  }
};

export const deleteLedgerEntry = async (id: string): Promise<void> => {
  try {
    const list = await getLedgerEntries();
    await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(list.filter((e) => e.id !== id)));
    autoBackup();
  } catch (error) {
    console.error('Failed to delete ledger entry:', error);
  }
};
