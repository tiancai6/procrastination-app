import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { TimerSession, FocusStats, TaskPlan, Plan, CheckinRecord, RewardRecord, QuickMemo, LedgerEntry, Reminder, LedgerType, Habit, HabitCheckin } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './ledger';
import type { AIInsightResult, MemoAnalysisResult } from './ai';
import type { ChatMessage, ChatMeta } from './chat';
import { autoBackup } from './autoBackup';
import { emitDataReset } from './appEvents';
import { ALL_DATA_KEYS } from './keys';
import { getDefaultModel, getDefaultVisionModelCfg } from './modelConfig';

// YYYY-MM-DD（本地时区）
export const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const SESSIONS_KEY = 'timer_sessions';
const PROFILE_IMAGE_KEY = 'procrastination_profile_image';
const FOCUS_BG_KEY = 'focus_card_image';
const TASK_PLANS_KEY = 'procrastination_task_plans';
const PLANS_KEY = 'procrastination_plans';
const CHECKIN_RECORDS_KEY = 'procrastination_checkin_records';
const REWARD_RECORDS_KEY = 'procrastination_reward_records';
const AI_INSIGHTS_CACHE_KEY = 'ai_insights_cache';
const AI_API_KEY = 'ai_api_key';
const AI_MODEL = 'ai_model';
const DEFAULT_AI_MODEL = 'glm-4-flash';
const AI_VISION_MODEL = 'ai_vision_model';
const DEFAULT_VISION_MODEL = 'glm-4v-flash';
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

// 清除散落在沙盒根目录的图片文件（头像图 profile_*、首页背景图 focus_bg_*）
// 它们不是子目录，ALL_MEDIA_DIRS 删不掉，需按文件名前缀单独清理，否则会残留成孤儿文件
const clearOrphanImages = async (): Promise<void> => {
  try {
    const base = FileSystem.documentDirectory;
    if (!base) return;
    const files = await FileSystem.readDirectoryAsync(base);
    for (const f of files) {
      if (f.startsWith('focus_bg_') || f.startsWith('profile_')) {
        await FileSystem.deleteAsync(`${base}${f}`, { idempotent: true });
      }
    }
  } catch (e) {
    console.error('clearOrphanImages failed', e);
  }
};

export const clearAllData = async (): Promise<void> => {
  try {
    // 清除全部业务数据（单一可信来源 ALL_DATA_KEYS，确保不漏清）
    await AsyncStorage.multiRemove(ALL_DATA_KEYS);
    // 删除沙盒媒体目录（随手记图片、聊天图片等）
    for (const dir of ALL_MEDIA_DIRS) {
      try {
        await FileSystem.deleteAsync(dir, { idempotent: true });
      } catch (e) {
        console.error('Failed to clear media dir:', dir, e);
      }
    }
    // 删除根目录散落的头像图 / 首页背景图（避免孤儿文件残留）
    await clearOrphanImages();
    console.log('All data cleared');
  } catch (error) {
    console.error('Failed to clear data:', error);
  } finally {
    // 通知所有已挂载页面重新拉取，保证清除后 UI 同步清空
    emitDataReset();
  }
};

export const saveTimerSession = async (session: TimerSession): Promise<void> => {
  try {
    const sessions = await getTimerSessions();
    sessions.push(session);
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    autoBackup();
  } catch (error) {
    console.error('Failed to save timer session:', error);
  }
};

export const getTimerSessions = async (): Promise<TimerSession[]> => {
  try {
    const data = await AsyncStorage.getItem(SESSIONS_KEY);
    const sessions = data ? JSON.parse(data) : [];
    const seen = new Set<string>();
    return sessions.filter((s: TimerSession) => {
      if (seen.has(s.id)) {
        console.warn(`Duplicate session ID found: ${s.id}`);
        return false;
      }
      seen.add(s.id);
      return true;
    });
  } catch (error) {
    console.error('Failed to get timer sessions:', error);
    return [];
  }
};

export const getTodaySessions = async (): Promise<TimerSession[]> => {
  const sessions = await getTimerSessions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  return sessions.filter((s) => s.startTime >= todayTimestamp);
};

export const getWeekSessions = async (): Promise<TimerSession[]> => {
  const sessions = await getTimerSessions();
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);
  const mondayTimestamp = monday.getTime();
  return sessions.filter((s) => s.startTime >= mondayTimestamp);
};

export const getMonthSessions = async (): Promise<TimerSession[]> => {
  const sessions = await getTimerSessions();
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayTimestamp = firstDay.getTime();
  return sessions.filter((s) => s.startTime >= firstDayTimestamp);
};

export const getAllSessions = async (): Promise<TimerSession[]> => {
  return await getTimerSessions();
};

export const updateTimerSession = async (session: TimerSession): Promise<void> => {
  try {
    const sessions = await getTimerSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx !== -1) {
      sessions[idx] = session;
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      autoBackup();
    }
  } catch (error) {
    console.error('Failed to update timer session:', error);
  }
};

export const deleteTimerSession = async (id: string): Promise<void> => {
  try {
    const sessions = await getTimerSessions();
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.filter((s) => s.id !== id)));
    autoBackup();
  } catch (error) {
    console.error('Failed to delete timer session:', error);
  }
};

export const getTimerStats = async (): Promise<FocusStats> => {
  try {
    const sessions = await getTimerSessions();
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

    const todaySessions = sessions.filter((s) => s.startTime >= todayTimestamp);
    const weekSessions = sessions.filter((s) => s.startTime >= mondayTimestamp);
    const monthSessions = sessions.filter((s) => s.startTime >= firstDayTimestamp);

    const stats: FocusStats = {
      todayDuration: todaySessions.reduce((sum, s) => sum + s.duration, 0),
      weekTotal: weekSessions.reduce((sum, s) => sum + s.duration, 0),
      weekCount: weekSessions.length,
      avgDuration: weekSessions.length > 0
        ? Math.round(weekSessions.reduce((sum, s) => sum + s.duration, 0) / weekSessions.length)
        : 0,
      longestDuration: sessions.length > 0
        ? Math.max(...sessions.map((s) => s.duration))
        : 0,
      monthTotal: monthSessions.reduce((sum, s) => sum + s.duration, 0),
      monthCount: monthSessions.length,
    };

    return stats;
  } catch (error) {
    console.error('Failed to compute timer stats:', error);
    return getDefaultFocusStats();
  }
};

const getDefaultFocusStats = (): FocusStats => ({
  todayDuration: 0,
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

// 首页「今日专注」卡片背景图（镜像头像图的持久化模式：复制到沙盒 + 存 uri + 自动备份）
export const saveFocusBackground = async (imageUri: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(FOCUS_BG_KEY, imageUri);
    autoBackup();
  } catch (error) {
    console.error('Failed to save focus background:', error);
  }
};

export const getFocusBackground = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(FOCUS_BG_KEY);
  } catch (error) {
    console.error('Failed to get focus background:', error);
    return null;
  }
};

export const clearFocusBackground = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(FOCUS_BG_KEY);
    autoBackup();
  } catch (error) {
    console.error('Failed to clear focus background:', error);
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
    return (await getDefaultModel())?.apiKey || null;
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
    return (await getDefaultModel())?.modelId || DEFAULT_AI_MODEL;
  } catch (error) {
    console.error('Failed to get model:', error);
    return DEFAULT_AI_MODEL;
  }
};

// 视觉模型（图片识别）：与文本模型分开设置，发送图片时使用
export const setVisionModel = async (model: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(
      AI_VISION_MODEL,
      model && model.trim() ? model.trim() : DEFAULT_VISION_MODEL,
    );
    autoBackup();
  } catch (error) {
    console.error('Failed to save vision model:', error);
  }
};

export const getVisionModel = async (): Promise<string> => {
  try {
    return (await getDefaultVisionModelCfg())?.modelId || DEFAULT_VISION_MODEL;
  } catch (error) {
    console.error('Failed to get vision model:', error);
    return DEFAULT_VISION_MODEL;
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
    // 同时删除聊天图片沙盒目录（避免残留图片占用空间）
    const { clearChatImages } = await import('./chat');
    await clearChatImages();
    autoBackup();
  } catch (error) {
    console.error('Failed to clear chat:', error);
  }
};

// ============ 提醒事项（Reminder）存储 ============

const REMINDERS_KEY = 'reminders';

export const getReminders = async (): Promise<Reminder[]> => {
  try {
    const data = await AsyncStorage.getItem(REMINDERS_KEY);
    const list: Reminder[] = data ? JSON.parse(data) : [];
    return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  } catch (error) {
    console.error('Failed to get reminders:', error);
    return [];
  }
};

export const saveReminders = async (list: Reminder[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(REMINDERS_KEY, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to save reminders:', error);
  }
};

export const addReminder = async (reminder: Reminder): Promise<void> => {
  const list = await getReminders();
  list.push(reminder);
  await saveReminders(list);
};

export const updateReminder = async (reminder: Reminder): Promise<void> => {
  const list = await getReminders();
  const idx = list.findIndex((r) => r.id === reminder.id);
  if (idx !== -1) {
    list[idx] = reminder;
    await saveReminders(list);
  }
};

export const deleteReminder = async (id: string): Promise<void> => {
  const list = await getReminders();
  await saveReminders(list.filter((r) => r.id !== id));
};

// ============ 习惯打卡（Habit）存储 ============
const HABITS_KEY = 'habits';
const HABIT_CHECKINS_KEY = 'habit_checkins';

export const getHabits = async (): Promise<Habit[]> => {
  try {
    const data = await AsyncStorage.getItem(HABITS_KEY);
    const list: Habit[] = data ? JSON.parse(data) : [];
    return list.sort((a, b) => a.createdAt - b.createdAt);
  } catch (error) {
    console.error('Failed to get habits:', error);
    return [];
  }
};

export const saveHabit = async (habit: Habit): Promise<void> => {
  try {
    const list = await getHabits();
    const idx = list.findIndex((h) => h.id === habit.id);
    if (idx !== -1) list[idx] = habit;
    else list.push(habit);
    await AsyncStorage.setItem(HABITS_KEY, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to save habit:', error);
  }
};

export const deleteHabit = async (id: string): Promise<void> => {
  try {
    const list = await getHabits();
    await AsyncStorage.setItem(HABITS_KEY, JSON.stringify(list.filter((h) => h.id !== id)));
    // 同时删除该习惯的全部打卡记录
    const checks = await getCheckins();
    await AsyncStorage.setItem(HABIT_CHECKINS_KEY, JSON.stringify(checks.filter((c) => c.habitId !== id)));
    autoBackup();
  } catch (error) {
    console.error('Failed to delete habit:', error);
  }
};

export const getCheckins = async (): Promise<HabitCheckin[]> => {
  try {
    const data = await AsyncStorage.getItem(HABIT_CHECKINS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get checkins:', error);
    return [];
  }
};

// 切换某习惯在某天的打卡状态；返回切换后的「是否已打卡」
export const toggleHabitCheckin = async (habitId: string, date: string): Promise<boolean> => {
  try {
    const checks = await getCheckins();
    const idx = checks.findIndex((c) => c.habitId === habitId && c.date === date);
    if (idx !== -1) {
      checks.splice(idx, 1);
      await AsyncStorage.setItem(HABIT_CHECKINS_KEY, JSON.stringify(checks));
      return false;
    }
    checks.push({ id: generateId(), habitId, date, checkedAt: Date.now() });
    await AsyncStorage.setItem(HABIT_CHECKINS_KEY, JSON.stringify(checks));
    autoBackup();
    return true;
  } catch (error) {
    console.error('Failed to toggle checkin:', error);
    return false;
  }
};

export const isHabitChecked = async (habitId: string, date: string): Promise<boolean> => {
  const checks = await getCheckins();
  return checks.some((c) => c.habitId === habitId && c.date === date);
};

// 计算截至今天（含）的连续打卡天数
export const getHabitStreak = async (habitId: string): Promise<number> => {
  try {
    const checks = await getCheckins();
    const dates = new Set(checks.filter((c) => c.habitId === habitId).map((c) => c.date));
    let streak = 0;
    const d = new Date();
    // 若今天还没打卡，从昨天开始算（避免断签当天误判为 0）
    if (!dates.has(toDateStr(d))) d.setDate(d.getDate() - 1);
    while (dates.has(toDateStr(d))) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  } catch (error) {
    console.error('Failed to get streak:', error);
    return 0;
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

// ============ 记账分类（可自定义）============
// 默认分类来自 ledger.ts，用户可在「记账」弹窗里自行增删；自定义后持久化到这里。

const LEDGER_CATS_EXPENSE_KEY = 'ledger_cats_expense';
const LEDGER_CATS_INCOME_KEY = 'ledger_cats_income';

export const getLedgerCategories = async (type: LedgerType): Promise<string[]> => {
  const key = type === 'expense' ? LEDGER_CATS_EXPENSE_KEY : LEDGER_CATS_INCOME_KEY;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (error) {
    console.error('Failed to get ledger categories:', error);
  }
  return type === 'expense' ? [...EXPENSE_CATEGORIES] : [...INCOME_CATEGORIES];
};

export const setLedgerCategories = async (type: LedgerType, list: string[]): Promise<void> => {
  const key = type === 'expense' ? LEDGER_CATS_EXPENSE_KEY : LEDGER_CATS_INCOME_KEY;
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list));
    autoBackup();
  } catch (error) {
    console.error('Failed to set ledger categories:', error);
  }
};

// ============ 身体信息 & 每日活动量（运动量 TDEE 用）============
// 单一 key 存「按日期」的 map，便于纳入 ALL_DATA_KEYS 与自动备份。
const BODY_PROFILE_KEY = 'body_profile';
const BODY_PROFILE_HISTORY_KEY = 'body_profile_history';
const DAILY_ACTIVITY_KEY = 'daily_activity';

export interface BodyProfile {
  gender: 'male' | 'female';
  age: number;
  height: number; // cm
  weight: number; // kg
}

// 身体信息历史快照（每次保存身体信息都追加一条，用于趋势折线图）
export interface BodyProfileSnapshot {
  date: string; // YYYY-MM-DD
  gender: 'male' | 'female';
  age: number;
  height: number; // cm
  weight: number; // kg
  bmi: number; // 由身高体重算出
}
export interface ExerciseRecord {
  id: string;
  type: string; // 跑步/力量/游泳/骑行/瑜伽/其他
  durationMin: number;
  kcal?: number; // AI 或手动估算的消耗
  note?: string;
}
export interface DailyActivity {
  baseLevel: 'sedentary' | 'light' | 'moderate' | 'high'; // 久坐/轻度/中度/高强度
  exercises: ExerciseRecord[];
}

export const getBodyProfile = async (): Promise<BodyProfile | null> => {
  try {
    const raw = await AsyncStorage.getItem(BODY_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to get body profile:', error);
    return null;
  }
};

export const setBodyProfile = async (p: BodyProfile): Promise<void> => {
  try {
    await AsyncStorage.setItem(BODY_PROFILE_KEY, JSON.stringify(p));
    // 同时追加一条历史快照（去重：同日只保留最后一次）
    const bmi = p.height > 0 ? Math.round((p.weight / (p.height / 100) / (p.height / 100)) * 10) / 10 : 0;
    const date = toDateStr(new Date());
    const snap: BodyProfileSnapshot = { date, gender: p.gender, age: p.age, height: p.height, weight: p.weight, bmi };
    const rawH = await AsyncStorage.getItem(BODY_PROFILE_HISTORY_KEY);
    const history: BodyProfileSnapshot[] = rawH ? JSON.parse(rawH) : [];
    const idx = history.findIndex((h) => h.date === date);
    if (idx >= 0) history[idx] = snap;
    else history.push(snap);
    history.sort((a, b) => (a.date < b.date ? -1 : 1));
    await AsyncStorage.setItem(BODY_PROFILE_HISTORY_KEY, JSON.stringify(history));
    autoBackup();
  } catch (error) {
    console.error('Failed to save body profile:', error);
  }
};

export const getBodyProfileHistory = async (): Promise<BodyProfileSnapshot[]> => {
  try {
    const raw = await AsyncStorage.getItem(BODY_PROFILE_HISTORY_KEY);
    const list: BodyProfileSnapshot[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch (error) {
    console.error('Failed to get body profile history:', error);
    return [];
  }
};

export const getDailyActivity = async (date: string): Promise<DailyActivity> => {
  try {
    const raw = await AsyncStorage.getItem(DAILY_ACTIVITY_KEY);
    const all: Record<string, DailyActivity> = raw ? JSON.parse(raw) : {};
    return all[date] || { baseLevel: 'sedentary', exercises: [] };
  } catch (error) {
    console.error('Failed to get daily activity:', error);
    return { baseLevel: 'sedentary', exercises: [] };
  }
};

export const getAllDailyActivity = async (): Promise<Record<string, DailyActivity>> => {
  try {
    const raw = await AsyncStorage.getItem(DAILY_ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to get all daily activity:', error);
    return {};
  }
};

export const setDailyActivity = async (date: string, activity: DailyActivity): Promise<void> => {
  try {
    const raw = await AsyncStorage.getItem(DAILY_ACTIVITY_KEY);
    const all: Record<string, DailyActivity> = raw ? JSON.parse(raw) : {};
    all[date] = activity;
    await AsyncStorage.setItem(DAILY_ACTIVITY_KEY, JSON.stringify(all));
    autoBackup();
  } catch (error) {
    console.error('Failed to save daily activity:', error);
  }
};

// ============ 手环/健康数据（华为运动健康等导出后手动导入）============
// 同样用单一 key 存「按日期」的 map，方便备份与清除。
const HEALTH_DAILY_KEY = 'health_daily';

export interface HealthDaily {
  date: string; // YYYY-MM-DD
  steps?: number;
  distanceKm?: number;
  activeKcal?: number; // 手环记录的活动消耗
  sleepMin?: number; // 睡眠时长（分钟）
  restingHr?: number; // 静息心率
  source?: string; // 来源：huawei / manual
}

export const getAllHealthDaily = async (): Promise<Record<string, HealthDaily>> => {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_DAILY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to get health daily:', error);
    return {};
  }
};

export const getHealthDaily = async (date: string): Promise<HealthDaily | null> => {
  const all = await getAllHealthDaily();
  return all[date] || null;
};

export const setHealthDaily = async (date: string, data: HealthDaily): Promise<void> => {
  try {
    const all = await getAllHealthDaily();
    all[date] = { ...(all[date] || {}), ...data, date };
    await AsyncStorage.setItem(HEALTH_DAILY_KEY, JSON.stringify(all));
    autoBackup();
  } catch (error) {
    console.error('Failed to save health daily:', error);
  }
};

// 批量合并导入（同一天已有字段不被 undefined 覆盖）
export const mergeHealthDaily = async (list: HealthDaily[]): Promise<number> => {
  try {
    const all = await getAllHealthDaily();
    let n = 0;
    list.forEach((item) => {
      if (!item.date) return;
      const prev = all[item.date] || { date: item.date };
      const next: HealthDaily = { ...prev };
      (Object.keys(item) as (keyof HealthDaily)[]).forEach((k) => {
        const v = item[k];
        if (v !== undefined && v !== null && !Number.isNaN(v as number)) {
          // @ts-expect-error 动态赋值，字段类型一致
          next[k] = v;
        }
      });
      all[item.date] = next;
      n += 1;
    });
    await AsyncStorage.setItem(HEALTH_DAILY_KEY, JSON.stringify(all));
    autoBackup();
    return n;
  } catch (error) {
    console.error('Failed to merge health daily:', error);
    return 0;
  }
};

// ============ 需要随「清除全部数据」一并删除的沙盒媒体目录 ============
// 全量数据 key 清单已迁至 ./keys（ALL_DATA_KEYS），保持 storage 不反向依赖 backup/autoBackup。
export const ALL_MEDIA_DIRS = [
  `${FileSystem.documentDirectory}memos/`,
  `${FileSystem.documentDirectory}chat_images/`,
];

