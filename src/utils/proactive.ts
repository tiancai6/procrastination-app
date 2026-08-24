// AI 主动问候：判断何时主动找用户聊天、问候内容如何生成、次数与免打扰的持久化。
// 触发条件（全部满足才弹卡）：开关开启 + 不在免打扰时段 + 今日次数未用尽 + 未点「不打扰」
//   +（有未结束话题 或 设置允许纯闲聊）。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getChatSessions, upsertChatSession, toDateStr, getChatSummary } from './storage';
import { callModel } from '../utils/model';

export type ProactiveContentMode = 'unfinished' | 'both';

export interface ProactiveSettings {
  enabled: boolean;
  maxPerDay: number; // 1 | 2 | 3
  quietStartHour: number; // 免打扰起始（含），0-23
  quietEndHour: number; // 免打扰结束（不含），0-23
  contentMode: ProactiveContentMode;
  smartGreeting: boolean; // 让 AI 自行判断延续话题/自拟感兴趣话题（默认开）
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
  smartGreeting: true,
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

// —— 智能问候：让 AI 判断能否延续历史话题，或自拟用户可能感兴趣的话题 ——

interface RecentSessionBrief {
  id: string;
  title: string;
  msgs: string[];
}

const gatherContext = async (): Promise<{ summary: string; recent: RecentSessionBrief[] }> => {
  const summary = (await getChatSummary()).trim();
  const sessions = (await getChatSessions()).slice(0, 3); // 最近 3 个会话
  const recent: RecentSessionBrief[] = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    msgs: s.messages.slice(-6).map((m) => {
      const who = m.role === 'user' ? '我' : 'AI';
      const text = (m.content || '').replace(/\n/g, ' ').slice(0, 120);
      return `${who}：${text}`;
    }),
  }));
  return { summary, recent };
};

const SMART_SYSTEM_PROMPT = `你是 App 的「主动问候」助手。用户没有明确要求你找他，但 App 会在合适的时候主动开启一段对话。
你的任务：先读【个人画像】和【近期聊天】，判断是否能自然延续某个话题——不要求用户说过"下次再聊"这类话，只要话题明显还能接（例如他问了什么还没得到回应、抛出一个还没展开的想法、或上次聊到一半）就视为可延续，并填对应的会话 id；若没有明显可延续的话题，就自拟一个用户可能感兴趣的开场。
开场可以是：观点探讨、冷知识、生活/效率建议；如果你有联网或实时搜索能力，也可以引用近期新闻或时事动态，并自然带出一句看法或提问。
输出要求：一句温暖、自然、像朋友随口开口的中文问候（1-3 句），引导用户接话。不要油腻、不要过度热情、不要使用"亲"等称呼。
只输出一个 JSON 对象，不要任何额外文字、不要代码块标记：
{"mode":"continue"|"new","sessionId":"<若能延续填会话id，否则空字符串>","text":"<问候语>"}`;

// 从模型返回里尽量解析出 JSON；解析失败则把整段文本当闲聊文案
const parseSmartResult = (raw: string): { mode: 'continue' | 'new'; sessionId?: string; text: string } | null => {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!text) return null;
    const mode: 'continue' | 'new' = obj.mode === 'continue' ? 'continue' : 'new';
    const sessionId = typeof obj.sessionId === 'string' && obj.sessionId ? obj.sessionId : undefined;
    return { mode, sessionId, text };
  } catch {
    return null;
  }
};

// 生成智能问候；无模型 / 网络失败 / 解析失败 → 返回 null（交由上层退回本地逻辑）
export const generateSmartGreeting = async (): Promise<GreetingResult | null> => {
  try {
    const { summary, recent } = await gatherContext();
    const recentText = recent.length
      ? recent.map((r) => `会话「${r.title}」（id: ${r.id}）\n${r.msgs.join('\n')}`).join('\n\n')
      : '（暂无近期聊天）';
    const userContent = `【个人画像】\n${summary || '（暂无）'}\n\n【近期聊天】\n${recentText}\n\n请判断并只输出 JSON。`;
    const text = await callModel(
      [
        { role: 'system', content: SMART_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      false,
      { feature: '主动问候', maxTokens: 300 },
    );
    const parsed = parseSmartResult(text);
    if (!parsed) {
      const t = text.trim().slice(0, 200);
      return t ? { text: t, isCasual: true } : null;
    }
    return {
      text: parsed.text,
      sessionId: parsed.mode === 'continue' ? parsed.sessionId : undefined,
      isCasual: parsed.mode !== 'continue',
    };
  } catch (e) {
    console.warn('[proactive] generateSmartGreeting 失败，退回本地逻辑', e);
    return null;
  }
};

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

  // 智能判断：让 AI 决定延续话题还是自拟话题（失败退回本地）
  if (settings.smartGreeting) {
    const smart = await generateSmartGreeting();
    if (smart) return smart;
  }

  // 本地兜底逻辑
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
