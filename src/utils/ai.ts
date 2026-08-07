import { TimerSession, QuickMemo, LedgerEntry } from '../types';
import { getMonthExpense, getMonthIncome, getCategoryBreakdown } from './ledger';
import {
  getCachedInsight,
  saveCachedInsight,
  getCachedMemoAnalysis,
  saveCachedMemoAnalysis,
} from './storage';
import { getActiveConfig } from './modelConfig';
import { postChat, parseJsonContent } from './model';
import {
  calculateCategoryStats,
  calculateTaskTypeStats,
  calculateTimePatterns,
  calculateWeeklyTrend,
} from './analytics';

export interface AITrigger {
  时段: string;
  风险: '高' | '中' | '低';
  原因: string;
}

export interface AIInsightResult {
  findings: string[];
  triggers: AITrigger[];
  suggestions: string[];
}

export const GLM_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// 固定系统提示词（约 200 字，每次请求都带，但不含任何用户数据）
const SYSTEM_PROMPT = `你是一位温和、专业的专注行为分析师。用户会给你一份已经脱敏的专注时长统计摘要（仅含匿名数字，无任何个人身份信息）。
请基于这些数字，输出一份结构化的中文分析，必须严格返回如下 JSON 格式（不要输出任何 JSON 以外的文字）：
{
  "findings": ["", ""],        // 3-5 条核心发现，指出专注的模式与高峰，每条一句话
  "triggers": [{"时段": "", "风险": "高|中|低", "原因": ""}],  // 1-3 个低专注时段及成因
  "suggestions": ["", ""]      // 3-5 条可执行的改善建议，具体、可落地
}
要求：语气友善、不评判；结论必须有数据支撑；不要编造统计里没有的信息。`;

// 只在本地算好的聚合摘要，约 300 字，不含原始记录/备注/身份
const buildSummary = (period: string, records: TimerSession[]) => {
  const totalDuration = records.reduce((s, r) => s + r.duration, 0);
  const count = records.length;
  const longest = records.length ? Math.max(...records.map((r) => r.duration)) : 0;
  const avg = count ? Math.round(totalDuration / count) : 0;
  const days = period === 'day' ? 1 : period === 'year' ? 365 : period === 'month' ? 30 : 7;

  const category = calculateCategoryStats(records)
    .slice(0, 5)
    .map((c) => ({ 分类: c.name, 占比: c.percentage, 时长分钟: c.duration }));

  const taskType = calculateTaskTypeStats(records).map((t) => ({
    类型: t.name === 'work' ? '工作' : t.name === 'study' ? '学习' : t.name === 'exercise' ? '运动' : t.name === 'life' ? '生活' : t.name === 'rest' ? '休息' : '其他',
    占比: t.percentage,
  }));

  const hourDistribution = calculateTimePatterns(records).map((p) => ({
    小时: p.hour,
    时长分钟: p.duration,
  }));

  const weeklyTrend = calculateWeeklyTrend(records).map((w) => ({
    星期: w.day,
    时长分钟: w.duration,
  }));

  return {
    周期: period,
    总时长分钟: totalDuration,
    次数: count,
    日均分钟: Math.round(totalDuration / days),
    平均单次分钟: avg,
    最长单次分钟: longest,
    分类占比: category,
    任务类型占比: taskType,
    小时分布: hourDistribution,
    周趋势: weeklyTrend,
  };
};

// 数据指纹：只取会变化的统计字段，用于判断是否需要重新分析
const makeFingerprint = (period: string, summary: Record<string, unknown>): string => {
  const { 周期, 总时长分钟, 次数, 分类占比, 周趋势 } = summary;
  return JSON.stringify({ 周期, 总时长分钟, 次数, 分类占比, 周趋势 });
};

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天
const isExpired = (ts: number) => Date.now() - ts > CACHE_TTL;

const normalize = (raw: any): AIInsightResult => ({
  findings: Array.isArray(raw?.findings)
    ? raw.findings.filter((x: unknown) => typeof x === 'string')
    : [],
  triggers: Array.isArray(raw?.triggers)
    ? raw.triggers
        .filter((t: unknown) => t && typeof t === 'object')
        .map((t: any) => ({
          时段: String(t?.时段 ?? ''),
          风险: ['高', '中', '低'].includes(t?.风险) ? t.风险 : '中',
          原因: String(t?.原因 ?? ''),
        }))
    : [],
  suggestions: Array.isArray(raw?.suggestions)
    ? raw.suggestions.filter((x: unknown) => typeof x === 'string')
    : [],
});

const callGLM = async (
  summary: Record<string, unknown>,
): Promise<AIInsightResult | null> => {
  try {
    const cfg = await getActiveConfig(false);
    if (!cfg) return null;
    const content = await postChat(
      cfg,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `以下是我的专注时长统计摘要（已脱敏）：\n${JSON.stringify(summary, null, 2)}\n请输出分析 JSON。`,
        },
      ],
      { temperature: 0.7, maxTokens: 900 },
    );
    return normalize(parseJsonContent(content));
  } catch (e) {
    console.error('[AI] GLM call failed', e);
    return null;
  }
};

export const getAIInsights = async (
  period: 'day' | 'week' | 'month' | 'year',
  records: TimerSession[],
  force = false,
): Promise<{ result: AIInsightResult | null; source: 'cache' | 'api' | 'none' }> => {
  const cfg = await getActiveConfig(false);
  if (!cfg || records.length === 0) {
    return { result: null, source: 'none' };
  }

  const summary = buildSummary(period, records);
  const fingerprint = makeFingerprint(period, summary);

  if (!force) {
    const cached = await getCachedInsight(period);
    if (cached && cached.fingerprint === fingerprint && !isExpired(cached.timestamp)) {
      return { result: cached.result, source: 'cache' };
    }
  }

  const result = await callGLM(summary);
  if (result) {
    await saveCachedInsight(period, { fingerprint, result, timestamp: Date.now() });
    return { result, source: 'api' };
  }

  // 调用失败：回退到任意已有缓存（即使过期），保证页面有内容
  const stale = await getCachedInsight(period);
  if (stale) return { result: stale.result, source: 'cache' };
  return { result: null, source: 'none' };
};

export const hasApiKey = async (): Promise<boolean> => !!(await getActiveConfig(false));

// 仅读取已有缓存（不联网），用于进入页面时展示历史分析结果
export const loadCachedInsight = async (
  period: 'day' | 'week' | 'month' | 'year',
): Promise<AIInsightResult | null> => {
  const cached = await getCachedInsight(period);
  if (cached && !isExpired(cached.timestamp)) {
    return cached.result;
  }
  return null;
};

// ============ 随手记 AI 区间分析 ============

export interface MemoAnalysisResult {
  mainThemes: string[];
  keyEvents: string[];
  topTopics: string[];
  mood: string;
  reflections: string[];
}

const MEMO_SYSTEM_PROMPT = `你是一位温和、善于倾听的生活记录分析师。用户会给你一段时间内的"随手记"文本（已脱敏，不含任何身份信息）。其中用 ==重点== 标出的内容，是用户自己在 App 里划线标记的重点，请格外重视。
请总结这段时间内用户生活的"主线"，必须严格返回如下 JSON 格式（不要输出任何 JSON 以外的文字）：
{
  "mainThemes": ["", ""],   // 3-5 条主线主题：这段时间用户主要在关注/经历什么
  "keyEvents": ["", ""],     // 2-5 条关键事件
  "topTopics": ["", ""],     // 高频出现的主题/标签
  "mood": "",               // 一句话总结整体情绪基调
  "reflections": ["", ""]   // 3-5 条温和的反思或下一步小建议
}
要求：基于文本、不编造；语气像朋友而非说教；重点内容要被充分参考。`;

const buildMemoText = (memos: QuickMemo[]): string => {
  return memos
    .map((m) => {
      let text = m.content || '';
      const sorted = [...m.highlightRanges].sort((a, b) => b.start - a.start);
      for (const r of sorted) {
        const s = Math.max(0, Math.min(r.start, text.length));
        const e = Math.max(s, Math.min(r.end, text.length));
        text = text.slice(0, s) + '==' + text.slice(s, e) + '==' + text.slice(e);
      }
      const mediaNote = m.media.length ? ` [含${m.media.length}个媒体]` : '';
      const tagNote = m.tags.length ? ' ' + m.tags.map((t) => '#' + t).join(' ') : '';
      const d = new Date(m.createdAt);
      const ds = `${d.getMonth() + 1}/${d.getDate()}`;
      return `- (${ds})${tagNote} ${text}${mediaNote}`;
    })
    .join('\n');
};

const makeMemoFingerprint = (range: string, memos: QuickMemo[]): string => {
  const count = memos.length;
  const totalChars = memos.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const latest = memos.length ? Math.max(...memos.map((m) => m.updatedAt)) : 0;
  return JSON.stringify({ range, count, totalChars, latest });
};

const normalizeMemo = (raw: any): MemoAnalysisResult => ({
  mainThemes: Array.isArray(raw?.mainThemes) ? raw.mainThemes.filter((x: unknown) => typeof x === 'string') : [],
  keyEvents: Array.isArray(raw?.keyEvents) ? raw.keyEvents.filter((x: unknown) => typeof x === 'string') : [],
  topTopics: Array.isArray(raw?.topTopics) ? raw.topTopics.filter((x: unknown) => typeof x === 'string') : [],
  mood: typeof raw?.mood === 'string' ? raw.mood : '',
  reflections: Array.isArray(raw?.reflections) ? raw.reflections.filter((x: unknown) => typeof x === 'string') : [],
});

const callGLMForMemos = async (
  rangeLabel: string,
  text: string,
): Promise<MemoAnalysisResult | null> => {
  try {
    const cfg = await getActiveConfig(false);
    if (!cfg) return null;
    const content = await postChat(
      cfg,
      [
        { role: 'system', content: MEMO_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `以下是${rangeLabel}的随手记：\n${text}\n请输出分析 JSON。`,
        },
      ],
      { temperature: 0.7, maxTokens: 1200 },
    );
    if (!content) return null;
    return normalizeMemo(parseJsonContent(content));
  } catch (e) {
    console.error('[AI] GLM memo call failed', e);
    return null;
  }
};

export const analyzeMemos = async (
  range: string,
  rangeLabel: string,
  memos: QuickMemo[],
  force = false,
): Promise<{ result: MemoAnalysisResult | null; source: 'cache' | 'api' | 'none' }> => {
  const cfg = await getActiveConfig(false);
  if (!cfg || memos.length === 0) {
    return { result: null, source: 'none' };
  }
  const fingerprint = makeMemoFingerprint(range, memos);
  if (!force) {
    const cached = await getCachedMemoAnalysis(range);
    if (cached && cached.fingerprint === fingerprint && !isExpired(cached.timestamp)) {
      return { result: cached.result, source: 'cache' };
    }
  }
  const text = buildMemoText(memos);
  const result = await callGLMForMemos(rangeLabel, text);
  if (result) {
    await saveCachedMemoAnalysis(range, { fingerprint, result, timestamp: Date.now() });
    return { result, source: 'api' };
  }
  const stale = await getCachedMemoAnalysis(range);
  if (stale) return { result: stale.result, source: 'cache' };
  return { result: null, source: 'none' };
};

export const loadCachedMemoAnalysis = async (range: string): Promise<MemoAnalysisResult | null> => {
  const cached = await getCachedMemoAnalysis(range);
  if (cached && !isExpired(cached.timestamp)) return cached.result;
  return null;
};

// ============ 记账消费 AI 总结 ============

const LEDGER_SYSTEM_PROMPT = `你是一位贴心的个人理财助手。用户会给你一段时期的记账汇总（仅含脱敏的类别与金额数字，无任何个人身份信息与原始备注文本）。请输出一段亲切、可执行的中文消费总结，必须严格返回如下 JSON 格式（不要输出任何 JSON 以外的文字）：
{
  "summary": "一段 100-200 字的中文总结：指出该时期主要花销方向、是否有异常波动、与收入相比的结余情况，并给 1-2 条温和的省钱或理财小建议。"
}
要求：基于给定数字、不编造；语气像朋友而非说教。`;

const buildLedgerSummary = (entries: LedgerEntry[]) => {
  const monthExpense = getMonthExpense(entries);
  const monthIncome = getMonthIncome(entries);
  const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const end = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime() - 1;
  const breakdown = getCategoryBreakdown(entries, 'expense', start, end);
  const topExpense = breakdown.slice(0, 3).map((b) => ({ 类别: b.category, 金额: b.total, 占比: b.percentage }));
  const recent = entries.slice(0, 10).map((e) => ({
    类型: e.type === 'expense' ? '支出' : '收入',
    类别: e.category,
    金额: e.amount,
    日期: `${new Date(e.occurredAt).getMonth() + 1}/${new Date(e.occurredAt).getDate()}`,
  }));
  return {
    本月支出: monthExpense,
    本月收入: monthIncome,
    本月结余: Math.round((monthIncome - monthExpense) * 100) / 100,
    主要支出方向: topExpense,
    近期记录样本: recent,
    笔数: entries.length,
  };
};

export const summarizeLedger = async (
  entries: LedgerEntry[],
): Promise<{ result: string | null; status: 'ok' | 'nokey' | 'error' }> => {
  const cfg = await getActiveConfig(false);
  if (!cfg) return { result: null, status: 'nokey' };
  if (entries.length === 0) return { result: null, status: 'nokey' };
  try {
    const content = await postChat(
      cfg,
      [
        { role: 'system', content: LEDGER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `以下是我的记账汇总（已脱敏）：\n${JSON.stringify(buildLedgerSummary(entries), null, 2)}\n请输出总结 JSON。`,
        },
      ],
      { temperature: 0.7, maxTokens: 600 },
    );
    const parsed = parseJsonContent(content);
    const summary: string = typeof parsed?.summary === 'string' ? parsed.summary : '';
    return { result: summary || null, status: summary ? 'ok' : 'error' };
  } catch (e) {
    console.error('[AI] GLM ledger call failed', e);
    return { result: null, status: 'error' };
  }
};
