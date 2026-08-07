// 把用户勾选的个人数据拼成给 AI 的上下文。
// 支持类别（餐饮/规划打卡/专注计时/随手记/聊天记录）、两档（总结/原始明细）、时间范围（今天/近7天/本月）。

export type DataCategory = 'meal' | 'plan' | 'focus' | 'memo' | 'chat' | 'health';
export type ContextLevel = 'summary' | 'raw';
export type DateRange = 'today' | '7d' | 'month';

import { getMeals } from './nutrition';
import {
  getPlans,
  getCheckinRecords,
  getHabits,
  getCheckins,
  getTimerSessions,
  getQuickMemos,
  getChatMessages,
  getAllHealthDaily,
  getAllDailyActivity,
  getBodyProfile,
} from './storage';
import { calcBMR, BASE_LEVEL_LABEL, DEFAULT_BODY_PROFILE, ACTIVITY_FACTOR } from './activity';

const MEAL_LABEL: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

const rangeStart = (range: DateRange): number => {
  const now = new Date();
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === '7d') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

const rangeLabel = (range: DateRange): string =>
  range === 'today' ? '今天' : range === '7d' ? '近7天' : '本月';

const fmtDate = (d: string): string => d; // 餐饮/打卡已经是 YYYY-MM-DD

// 本地时区的 YYYY-MM-DD（打卡数据都用这个格式，别用 toLocaleDateString，会得到 2026/8/5）
const toDayStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// ============ 各品类聚合 ============

const buildMeal = async (level: ContextLevel, start: number): Promise<string> => {
  const meals = await getMeals();
  const inRange = meals.filter((m) => new Date(`${m.date}T00:00:00`).getTime() >= start);
  if (inRange.length === 0) return '【餐饮】该时间段无记录';
  if (level === 'summary') {
    const byDate: Record<string, { c: number; p: number; n: number }> = {};
    for (const m of inRange) {
      const n = m.nutrition;
      if (!n) continue;
      byDate[m.date] = byDate[m.date] || { c: 0, p: 0, n: 0 };
      byDate[m.date].c += n.calories || 0;
      byDate[m.date].p += n.protein || 0;
      byDate[m.date].n += 1;
    }
    const lines = Object.entries(byDate).map(
      ([d, v]) => `${d}: ${v.n}餐, 约${Math.round(v.c)}kcal, 蛋白${Math.round(v.p)}g`,
    );
    return `【餐饮·摘要】\n${lines.join('\n')}`;
  }
  const lines = inRange.map((m) => {
    const nut = m.nutrition
      ? ` (蛋白${Math.round(m.nutrition.protein)}g/热量${Math.round(m.nutrition.calories)}kcal)`
      : '';
    return `${fmtDate(m.date)} ${MEAL_LABEL[m.type] || m.type}: ${m.content}${nut}`;
  });
  return `【餐饮·明细】\n${lines.join('\n')}`;
};

const buildPlan = async (level: ContextLevel, start: number): Promise<string> => {
  const plans = await getPlans();
  const habits = await getHabits();
  const planChecks = await getCheckinRecords();
  const habitChecks = await getCheckins();
  // ⚠️ 打卡记录的 date 是 'YYYY-MM-DD' 字符串，不能直接和时间戳比大小，统一转成日期串比较
  const startStr = toDayStr(new Date(start));
  const todayStr = toDayStr(new Date());

  if (level === 'summary') {
    const lines: string[] = [];
    for (const p of plans) {
      const done = planChecks.filter((c) => c.planId === p.id);
      const todayDone = done.some((c) => c.date === todayStr);
      lines.push(`计划「${p.name || ''}」：今日${todayDone ? '已打卡✓' : '未打卡'}（累计${done.length}次）`);
    }
    for (const h of habits) {
      const checked = habitChecks.some((c) => c.habitId === h.id && c.date === todayStr);
      lines.push(`习惯「${h.name || ''}」：今日${checked ? '已打卡✓' : '未打卡'}`);
    }
    return `【规划打卡·摘要】\n${lines.join('\n') || '无记录'}`;
  }
  const lines: string[] = [];
  for (const p of plans) {
    const recs = planChecks.filter((c) => c.planId === p.id && c.date >= startStr).map((c) => c.date);
    lines.push(`计划「${p.name || ''}」打卡日期：${recs.join(', ') || '无'}`);
  }
  for (const h of habits) {
    const recs = habitChecks.filter((c) => c.habitId === h.id && c.date >= startStr).map((c) => c.date);
    lines.push(`习惯「${h.name || ''}」打卡日期：${recs.join(', ') || '无'}`);
  }
  return `【规划打卡·明细】\n${lines.join('\n') || '无记录'}`;
};

// 手环数据 + 当天活动量/TDEE
const buildHealth = async (level: ContextLevel, start: number): Promise<string> => {
  const startStr = toDayStr(new Date(start));
  const healthMap = await getAllHealthDaily();
  const actMap = await getAllDailyActivity();
  const profile = (await getBodyProfile()) || DEFAULT_BODY_PROFILE;
  const bmr = calcBMR(profile);

  const dates = Array.from(new Set([...Object.keys(healthMap), ...Object.keys(actMap)]))
    .filter((d) => d >= startStr)
    .sort()
    .reverse();
  if (dates.length === 0) return '【运动与手环】该时间段无记录';

  const header = `身体：${profile.gender === 'male' ? '男' : '女'} ${profile.age}岁 ${profile.height}cm ${profile.weight}kg，基础代谢约${bmr}kcal`;

  const lineOf = (d: string): string => {
    const h = healthMap[d];
    const a = actMap[d];
    const exKcal = a ? a.exercises.reduce((s, e) => s + (e.kcal || 0), 0) : 0;
    const tdee = a ? Math.round(bmr * ACTIVITY_FACTOR[a.baseLevel] + exKcal) : undefined;
    const seg = [
      a ? `活动量${BASE_LEVEL_LABEL[a.baseLevel]}` : '',
      a && a.exercises.length
        ? `运动：${a.exercises.map((e) => `${e.type}${e.durationMin}分钟${e.kcal ? `(${e.kcal}kcal)` : ''}`).join('、')}`
        : '',
      tdee !== undefined ? `总消耗约${tdee}kcal` : '',
      h?.steps !== undefined ? `${h.steps}步` : '',
      h?.sleepMin !== undefined ? `睡眠${Math.round((h.sleepMin / 60) * 10) / 10}h` : '',
      h?.restingHr !== undefined ? `静息心率${h.restingHr}` : '',
      h?.activeKcal !== undefined ? `手环活动消耗${h.activeKcal}kcal` : '',
    ].filter(Boolean);
    return `${d}: ${seg.join(' · ')}`;
  };

  if (level === 'summary') {
    return `【运动与手环·摘要】${header}\n${dates.slice(0, 7).map(lineOf).join('\n')}`;
  }
  return `【运动与手环·明细】${header}\n${dates.slice(0, 60).map(lineOf).join('\n')}`;
};

const buildFocus = async (level: ContextLevel, start: number): Promise<string> => {
  const sessions = await getTimerSessions();
  const inRange = sessions.filter((s) => s.startTime >= start);
  if (inRange.length === 0) return '【专注计时】该时间段无记录';
  const totalMin = inRange.reduce((s, x) => s + (x.duration || 0), 0);
  if (level === 'summary') {
    const byCat: Record<string, number> = {};
    for (const s of inRange) byCat[s.category || '未分类'] = (byCat[s.category || '未分类'] || 0) + (s.duration || 0);
    const dist = Object.entries(byCat)
      .map(([k, v]) => `${k} ${v}分钟`)
      .join('、');
    return `【专注计时·摘要】${inRange.length}次, 共${totalMin}分钟；分布：${dist}`;
  }
  const lines = inRange
    .slice(-50)
    .map((s) => {
      const t = new Date(s.startTime).toLocaleString('zh-CN');
      return `${t} ${s.category || ''} ${s.duration || 0}分钟${s.what ? `：${s.what}` : ''}`;
    });
  return `【专注计时·明细】\n${lines.join('\n')}`;
};

const buildMemo = async (level: ContextLevel, start: number): Promise<string> => {
  const memos = await getQuickMemos();
  const inRange = memos.filter((m) => (m.createdAt || 0) >= start);
  if (inRange.length === 0) return '【随手记】该时间段无记录';
  if (level === 'summary') {
    return `【随手记·摘要】${inRange.length}条；最近：${inRange
      .slice(-3)
      .map((m) => (m.content || '').slice(0, 40))
      .join(' / ')}`;
  }
  const lines = inRange.slice(-50).map((m) => `· ${m.content || ''}${m.tags?.length ? ` [${m.tags.join(',')}]` : ''}`);
  return `【随手记·明细】\n${lines.join('\n')}`;
};

const buildChat = async (level: ContextLevel, start: number): Promise<string> => {
  const msgs = await getChatMessages();
  const inRange = msgs.filter((m) => (m.ts || 0) >= start);
  if (inRange.length === 0) return '【聊天记录】该时间段无记录';
  if (level === 'summary') {
    const recent = inRange.slice(-6).map((m) => `${m.role === 'user' ? '我' : 'AI'}：${(m.content || '').slice(0, 50)}`);
    return `【聊天记录·摘要】\n${recent.join('\n')}`;
  }
  const lines = inRange.slice(-50).map((m) => `${m.role === 'user' ? '我' : 'AI'}：${m.content || ''}`);
  return `【聊天记录·明细】\n${lines.join('\n')}`;
};

export const buildChatContext = async (
  selected: DataCategory[],
  level: ContextLevel,
  range: DateRange,
): Promise<string> => {
  if (selected.length === 0) return '';
  const start = rangeStart(range);
  const label = rangeLabel(range);
  const parts: string[] = [];

  if (selected.includes('meal')) parts.push(await buildMeal(level, start));
  if (selected.includes('plan')) parts.push(await buildPlan(level, start));
  if (selected.includes('focus')) parts.push(await buildFocus(level, start));
  if (selected.includes('memo')) parts.push(await buildMemo(level, start));
  if (selected.includes('chat')) parts.push(await buildChat(level, start));
  if (selected.includes('health')) parts.push(await buildHealth(level, start));

  if (parts.length === 0) return '';
  return `以下是用户选择携带的个人数据（${label}${level === 'summary' ? '·总结' : '·原始明细'}），请参考作答：\n\n${parts.join('\n\n')}`;
};
