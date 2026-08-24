// AI 主动问候：判断何时主动找用户聊天、问候内容如何生成、次数与免打扰的持久化。
// 触发条件（全部满足才弹卡）：开关开启 + 不在免打扰时段 + 今日次数未用尽 + 未点「不打扰」
//   +（有未结束话题 或 设置允许纯闲聊）。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChatSessions, upsertChatSession, toDateStr } from './storage';

export type ProactiveContentMode = 'unfinished' | 'both';

export interface ProactiveSettings {
  enabled: boolean;
  maxPerDay: number; // 1 | 2 | 3
  quietStartHour: number; // 免打扰起始（含），0-23
  quietEndHour: number; // 免打扰结束（不含），0-23
  contentMode: ProactiveContentMode;
}

export interface ProactiveState {
  date: string; // YYYY-MM-DD
  usedCount: number; // 今日已弹出问候卡次数
  lastTriggerAt: number;
  dismissedToday: boolean; // 点过「不打扰」
  snoozeUntil: number; // 冷却到该时间戳前不再弹
}

const SETTINGS_KEY = 'proactive_settings';
const STATE_KEY = 'proactive_state';

// 弹出后多久内不重复弹（避免切走又切回立刻再弹），30 分钟
const SHOW_COOLDOWN_MS = 30 * 60 * 1000;
// 「等下再说」的冷却，3 小时
const SNOOZE_MS = 3 * 60 * 60 * 1000;

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  enabled: true,
  maxPerDay: 3,
  quietStartHour: 0,
  quietEndHour: 6,
  contentMode: 'both',
};

export const getProactiveSettings = async (): Promise<ProactiveSettings> => {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PROACTIVE_SETTINGS };
    return { ...DEFAULT_PROACTIVE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PROACTIVE_SETTINGS };
  }
};

export const saveProactiveSettings = async (s: ProactiveSettings): Promise<void> => {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
};

const emptyState = (): ProactiveState => ({
  date: '',
  usedCount: 0,
  lastTriggerAt: 0,
  dismissedToday: false,
  snoozeUntil: 0,
});

export const getProactiveState = async (): Promise<ProactiveState> => {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    return emptyState();
  }
};

export const saveProactiveState = async (s: ProactiveState): Promise<void> => {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(s));
};

// 跨日则清零
const ensureToday = (state: ProactiveState, today: string): ProactiveState => {
  if (state.date !== today) return { ...emptyState(), date: today };
  return state;
};

const isQuietHour = (hour: number, start: number, end: number): boolean => {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // 跨午夜，如 22→6
};

export interface UnfinishedTopic {
  sessionId: string;
  snippet: string;
}

// 找「未结束话题」：最近 7 天内有互动、且最后一条是用户发文的会话，取最近的一个。
export const detectUnfinishedTopic = async (): Promise<UnfinishedTopic | null> => {
  const sessions = await getChatSessions();
  const cutoff = Date.now() - 7 * 86400000;
  for (const s of sessions) {
    if (s.updatedAt < cutoff) continue;
    const msgs = s.messages;
    if (!msgs.length) continue;
    const last = msgs[msgs.length - 1];
    if (last.role === 'user' && last.content && last.content.trim()) {
      const snippet = last.content.trim().replace(/\n/g, ' ').slice(0, 24);
      return { sessionId: s.id, snippet };
    }
  }
  return null;
};

export const buildCasualGreeting = (now: Date): string => {
  const h = now.getHours();
  if (h >= 6 && h < 11) return '早呀，今天有什么计划吗？';
  if (h >= 11 && h < 14) return '中午好，午饭吃了什么？';
  if (h >= 14 && h < 18) return '下午好，今天过得怎么样？';
  if (h >= 18 && h < 23) return '晚上好，今天有什么想记录的吗？';
  return '嗨，在忙什么呢？';
};

export interface GreetingResult {
  text: string;
  sessionId?: string; // 未结束话题 → 打开对应会话；纯闲聊 → 点「聊两句」时新建
  isCasual: boolean;
}

// 评估是否应该弹出问候卡；返回 null 表示不弹。
export const evaluateGreeting = async (): Promise<GreetingResult | null> => {
  const settings = await getProactiveSettings();
  if (!settings.enabled) return null;
  const now = new Date();
  if (isQuietHour(now.getHours(), settings.quietStartHour, settings.quietEndHour)) return null;

  const state = ensureToday(await getProactiveState(), toDateStr(now));
  if (state.usedCount >= settings.maxPerDay) return null;
  if (state.dismissedToday) return null;
  if (now.getTime() < state.snoozeUntil) return null;

  const unfinished = await detectUnfinishedTopic();
  if (unfinished) {
    return {
      text: `你之前提到「${unfinished.snippet}」，要现在接着聊聊吗？`,
      sessionId: unfinished.sessionId,
      isCasual: false,
    };
  }
  if (settings.contentMode === 'both') {
    return { text: buildCasualGreeting(now), isCasual: true };
  }
  return null;
};

// 弹卡即消耗一次（并设 30 分钟冷却，避免反复弹）
export const markGreetingShown = async (): Promise<void> => {
  const now = new Date();
  const today = toDateStr(now);
  const state = ensureToday(await getProactiveState(), today);
  state.date = today;
  state.usedCount += 1;
  state.lastTriggerAt = now.getTime();
  state.snoozeUntil = Math.max(state.snoozeUntil, now.getTime() + SHOW_COOLDOWN_MS);
  await saveProactiveState(state);
};

export const snoozeGreeting = async (): Promise<void> => {
  const now = new Date();
  const today = toDateStr(now);
  const state = ensureToday(await getProactiveState(), today);
  state.date = today;
  state.snoozeUntil = now.getTime() + SNOOZE_MS;
  await saveProactiveState(state);
};

export const dismissGreetingToday = async (): Promise<void> => {
  const now = new Date();
  const today = toDateStr(now);
  const state = ensureToday(await getProactiveState(), today);
  state.date = today;
  state.dismissedToday = true;
  await saveProactiveState(state);
};

export const remainingToday = async (): Promise<number> => {
  const settings = await getProactiveSettings();
  const now = new Date();
  const state = ensureToday(await getProactiveState(), toDateStr(now));
  return Math.max(0, settings.maxPerDay - state.usedCount);
};

// 纯闲聊点「聊两句」时，新建一个会话并把问候语作为 AI 首条消息预置进去。
export const createCasualGreetingSession = async (greeting: string): Promise<string> => {
  const now = Date.now();
  const session = {
    id: `casual_${now}`,
    title: 'AI 主动问候',
    messages: [{ id: `${now}_a`, role: 'assistant' as const, content: greeting, ts: now }],
    createdAt: now,
    updatedAt: now,
    carryProfile: true,
    carryDataCats: [] as any,
    ctxLevel: 'summary' as any,
    ctxRange: 'today' as any,
  };
  await upsertChatSession(session);
  return session.id;
};
