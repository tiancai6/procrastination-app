import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveConfig } from './modelConfig';
import { postChat, parseJsonContent } from './model';
import { autoBackup } from './autoBackup';
import { MealEntry, MealType, MealNutrition, MealNutritionItem, MealAdequacy } from '../types';

const MEALS_KEY = 'meal_entries';

// 当日身体/运动/手环上下文，注入到营养估算 prompt，让 AI 按真实消耗判断热量，而不是死板的 2000kcal。
export interface MealContext {
  bmr: number;
  tdee: number;
  exerciseKcal: number;
  baseLevel: 'sedentary' | 'light' | 'moderate' | 'high';
  steps?: number | null;
  activeKcal?: number | null;
  sleepMin?: number | null;
}

const BASE_LEVEL_LABEL: Record<MealContext['baseLevel'], string> = {
  sedentary: '久坐少动',
  light: '轻度活动',
  moderate: '中度活动',
  high: '高强度活动',
};

// 把当日身体/运动/手环数据拼成一段中文，注入营养估算 prompt。
const buildMealContextText = (ctx: MealContext): string => {
  const parts: string[] = [];
  parts.push('【今日身体与运动情况，用于判断这顿饭是否合适】');
  parts.push('- 基础代谢(BMR)：约 ' + ctx.bmr + ' kcal');
  parts.push('- 今日运动消耗：约 ' + ctx.exerciseKcal + ' kcal（基础活动强度：' + BASE_LEVEL_LABEL[ctx.baseLevel] + '）');
  parts.push('- 今日可摄入总量(TDEE，含运动)：约 ' + ctx.tdee + ' kcal');
  if (ctx.steps != null) parts.push('- 手环步数：' + ctx.steps + ' 步');
  if (ctx.activeKcal != null) parts.push('- 手环活动消耗：' + ctx.activeKcal + ' kcal');
  if (ctx.sleepMin != null) parts.push('- 昨晚睡眠：' + Math.floor(ctx.sleepMin / 60) + ' 小时 ' + (ctx.sleepMin % 60) + ' 分');
  parts.push('请结合「今日可摄入总量 ' + ctx.tdee + ' kcal」判断这顿饭的 adequacy：运动消耗大可放宽、久坐少动要更克制；在 comment 里点明这顿与今日运动是否匹配、建议多吃还是少吃。');
  return parts.join('\n');
};

// 每日营养推荐量（用于达标/超标判断，可按需调整）
export const PROTEIN_TARGET = 60; // g
export const CALORIE_TARGET = 2000; // kcal
export const NUTRITION_TARGETS = {
  protein: PROTEIN_TARGET, // g
  calorie: CALORIE_TARGET, // kcal
  fat: 60, // g
  carbs: 250, // g
  fiber: 25, // g
  water: 1500, // ml
};

const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

// ============ 三餐记录存储 ============

export const getMeals = async (): Promise<MealEntry[]> => {
  try {
    const data = await AsyncStorage.getItem(MEALS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to get meals:', error);
    return [];
  }
};

const saveMeals = async (list: MealEntry[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(list));
    // 与 storage.ts 中其它 save 函数保持一致：写入后触发自动备份，
    // 否则单纯修改三餐后自动备份不会立即包含，只有手动导出（经 ALL_DATA_KEYS）才完整。
    await autoBackup();
  } catch (error) {
    console.error('Failed to save meals:', error);
  }
};

// 写入一条餐记录。加餐(snack)可多条：传 id 表示更新/删除该条，不传则新增。
// content 为空：早午晚=删除该餐；snack 且传 id=删除该条，未传 id=忽略。
// 注意：更新时必须保留已有的 nutrition（AI 估算结果），否则「保存」会把刚估算的营养覆盖掉。
export const upsertMeal = async (
  type: MealType,
  date: string,
  content: string,
  id?: string,
): Promise<MealEntry[]> => {
  const list = await getMeals();
  const text = content.trim();
  if (type === 'snack') {
    if (!text) {
      if (id) await saveMeals(list.filter((m) => m.id !== id));
      return list.filter((m) => m.id !== id);
    }
    const existing = id ? list.find((m) => m.id === id) : undefined;
    const rest = id ? list.filter((m) => m.id !== id) : list;
    rest.push({ id: id || `${date}_snack_${Date.now()}`, type, content: text, date, createdAt: Date.now(), nutrition: existing?.nutrition });
    await saveMeals(rest);
    return rest;
  }
  const existing = list.find((m) => m.type === type && m.date === date);
  const rest = list.filter((m) => !(m.type === type && m.date === date));
  if (text) {
    rest.push({ id: `${date}_${type}`, type, content: text, date, createdAt: Date.now(), nutrition: existing?.nutrition });
  }
  await saveMeals(rest);
  return rest;
};

export const getMealsByDate = async (date: string): Promise<MealEntry[]> => {
  const list = await getMeals();
  return list.filter((m) => m.date === date);
};

// 把单餐的营养估算写回该条记录
export const saveMealNutrition = async (entryId: string, nutrition: MealNutrition): Promise<MealEntry[]> => {
  const list = await getMeals();
  const next = list.map((m) => (m.id === entryId ? { ...m, nutrition } : m));
  await saveMeals(next);
  return next;
};

// ============ 单条餐记录编辑 / 删除（供「像消费一样改记录」用） ============

// 更新某一条餐记录（可改餐次 / 日期 / 内容），保留已估算的营养。
// 注意：主餐（早/午/晚）按 type+date 占唯一槽位。若改完后目标槽位被另一条记录占了，
// 以本次编辑的值为准，覆盖掉那条旧记录，避免出现两条同餐次同日期的记录。
export const updateMealEntry = async (entry: MealEntry): Promise<MealEntry[]> => {
  const list = await getMeals();
  const old = list.find((m) => m.id === entry.id);
  let rest = list.filter((m) => m.id !== entry.id);
  if (entry.type !== 'snack') {
    rest = rest.filter((m) => !(m.type === entry.type && m.date === entry.date));
  }
  rest.push({
    ...entry,
    nutrition: entry.nutrition ?? old?.nutrition,
  });
  await saveMeals(rest);
  return rest;
};

// 删除某一条餐记录（按 id）
export const deleteMealEntry = async (id: string): Promise<MealEntry[]> => {
  const list = await getMeals();
  const rest = list.filter((m) => m.id !== id);
  await saveMeals(rest);
  return rest;
};

// ============ 营养汇总（由每条记录的 nutrition 计算每日合计） ============

const sumNutrition = (list: MealNutrition[]): MealNutrition => {
  const acc: MealNutrition = {
    protein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    water: 0,
    items: [],
    adequacy: '适量',
    comment: '',
  };
  list.forEach((n) => {
    acc.protein += n.protein || 0;
    acc.calories += n.calories || 0;
    acc.fat = (acc.fat || 0) + (n.fat || 0);
    acc.carbs = (acc.carbs || 0) + (n.carbs || 0);
    acc.fiber = (acc.fiber || 0) + (n.fiber || 0);
    acc.water = (acc.water || 0) + (n.water || 0);
    acc.items = acc.items.concat(n.items || []);
  });
  return acc;
};

// 单日营养合计（由当天各餐的 nutrition 相加）
export const getNutritionForDate = async (date: string): Promise<MealNutrition | null> => {
  const list = await getMeals();
  const day = list.filter((m) => m.date === date && m.nutrition);
  if (day.length === 0) return null;
  return sumNutrition(day.map((m) => m.nutrition as MealNutrition));
};

// 全部日期的营养合计（供统计面板聚合）
export const getAllNutrition = async (): Promise<{ [date: string]: MealNutrition }> => {
  const list = await getMeals();
  const out: { [date: string]: MealNutrition } = {};
  list.forEach((m) => {
    if (!m.nutrition) return;
    out[m.date] = sumNutrition([...(out[m.date] ? [out[m.date]] : []), m.nutrition]);
  });
  return out;
};

// ============ 调用 GLM 估算单餐营养 ============

const NUTRITION_SYSTEM_PROMPT = `你是一位营养师。用户会告诉你某一餐（早/午/晚/加餐）吃了什么（中文描述，可能简略）。
你的核心任务是：**把这顿饭里的每一样食物分别拆开估算**，让用户清楚知道每种营养分别是哪样食物提供的。
必须严格返回如下 JSON（不要输出任何 JSON 以外的文字）：
{
  "items": [{"name":"食物名(含大致分量)","protein":数字,"calories":数字,"fat":数字,"carbs":数字,"fiber":数字}],
  "protein": 数字,
  "calories": 数字,
  "fat": 数字,
  "carbs": 数字,
  "fiber": 数字,
  "water": 数字,
  "adequacy": "不足" | "适量" | "过量",
  "comment": "一句话点评与建议"
}
硬性要求：
1. 用户提到的**每一样食物都必须单独成为 items 里的一条**，不允许合并成「早餐」「主食」这类笼统条目。例如「鸡蛋、香蕉」必须拆成两条。
2. items 每一条都要给出 protein / calories / fat / carbs / fiber 五个数字（无则填 0），不要留空。
3. name 里带上大致分量，如「鸡蛋 2个」「香蕉 1根(约120g)」「米饭 1碗」。
4. 顶层的 protein/calories/fat/carbs/fiber **必须等于 items 各项之和**（允许微小取整误差）。
5. water 是这顿摄入的液体量(ml)，如豆浆/汤/牛奶；没有则填 0。
参考全天推荐量：蛋白约60g、热量约2000kcal、脂肪约60g、碳水约250g、膳食纤维约25g、饮水约1500ml；按这顿占全天的合理比例判断 adequacy。
基于常见食物成分表合理估算，不要编造具体品牌的营养标签；只输出 JSON。
如果用户在该餐消息里提供了「当日身体与运动情况」（基础代谢、运动消耗、今日可摄入总量TDEE、手环步数/消耗/睡眠等），请务必据此判断 adequacy：把这顿的热量与「今日可摄入总量」的对应比例对照，运动量消耗大时可放宽、久坐少动时要更克制；并在 comment 里点明这顿与今日运动是否匹配、建议用户多吃还是少吃。
`;

export interface EstimateResult {
  result: MealNutrition | null;
  status: 'ok' | 'nokey' | 'error' | 'rate';
}

const normalizeNutrition = (raw: any): MealNutrition => {
  const adequacy: MealAdequacy = ['不足', '适量', '过量'].includes(raw?.adequacy) ? raw.adequacy : '适量';
  const items: MealNutritionItem[] = Array.isArray(raw?.items)
    ? raw.items
        .filter((it: any) => it && it.name)
        .map((it: any) => ({
          name: String(it.name),
          protein: Number(it.protein) || 0,
          calories: Number(it.calories) || 0,
          fat: Number(it.fat) || 0,
          carbs: Number(it.carbs) || 0,
          fiber: Number(it.fiber) || 0,
        }))
    : [];

  // 顶层合计兜底：AI 偶尔只给明细不给合计（或给 0），此时用各项之和补上，
  // 保证「统计页合计」与「逐项明细」永远对得上。
  const sumOf = (k: keyof MealNutritionItem): number =>
    items.reduce((s, it) => s + (Number(it[k]) || 0), 0);
  const pick = (rawVal: any, k: keyof MealNutritionItem): number => {
    const v = Number(rawVal) || 0;
    return v > 0 ? v : sumOf(k);
  };

  return {
    protein: pick(raw?.protein, 'protein'),
    calories: pick(raw?.calories, 'calories'),
    fat: pick(raw?.fat, 'fat'),
    carbs: pick(raw?.carbs, 'carbs'),
    fiber: pick(raw?.fiber, 'fiber'),
    water: Number(raw?.water) || 0,
    items,
    adequacy,
    comment: typeof raw?.comment === 'string' ? raw.comment : '',
  };
};

// 估算单餐营养（返回该餐的明细 + 合计）
// 限流自动重试：免费 GLM 接口有频率上限（如每分钟若干次）。
// 一顿饭一个请求，批量估算时并发打过去很容易返回 429，这里遇到 429 就退避重试，
// 大部分情况能自己恢复，避免你看到冷冰冰的「估算失败」。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const estimateMealNutrition = async (entry: MealEntry, ctx?: MealContext): Promise<EstimateResult> => {
  const cfg = await getActiveConfig(false);
  if (!cfg) return { result: null, status: 'nokey' };
  if (!entry.content || !entry.content.trim()) return { result: null, status: 'nokey' };

  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const content = await postChat(
        cfg,
        [
          { role: 'system', content: NUTRITION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `这是今天的${MEAL_LABEL[entry.type]}：${entry.content}${ctx ? '\n' + buildMealContextText(ctx) : ''}\n请输出这顿的营养估算 JSON。`,
          },
        ],
        { temperature: 0.5, maxTokens: 1000 },
      );

      const parsed = normalizeNutrition(parseJsonContent(content));
      return { result: parsed, status: 'ok' };
    } catch (e: any) {
      const isRate = e?.message && String(e.message).includes('429');
      // 仅 429 限流才退避重试；其它错误（401/JSON 解析失败/网络）直接失败，避免无意义重试 4 次
      if (isRate && attempt < MAX_RETRIES) {
        const wait = Math.min(1500 * Math.pow(2, attempt), 6000) + Math.floor(Math.random() * 400);
        await sleep(wait);
        continue;
      }
      console.error('[Nutrition] GLM call failed', e);
      return { result: null, status: isRate ? 'rate' : 'error' };
    }
  }
  return { result: null, status: 'error' };
};

// 并发估算多餐。免费 GLM 接口有频率上限，并发太高会触发 429 限流，
// 这里把并发控制在 2：既比「一餐等完再下一餐」快很多（4 餐≈2 次往返），
// 又不至于一次性把免费额度打爆。配合 estimateMealNutrition 内部的 429 自动重试，体感顺滑。
const CONCURRENCY = 2;

const estimateInParallel = async (
  targets: MealEntry[],
  onEach?: (done: number, total: number) => void,
  ctx?: MealContext,
): Promise<Map<string, MealNutrition>> => {
  const out = new Map<string, MealNutrition>();
  let done = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      const e = targets[cursor++];
      const { result } = await estimateMealNutrition(e, ctx);
      if (result) out.set(e.id, result);
      done += 1;
      onEach?.(done, targets.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return out;
};

// 估算某天全部餐（并发调用，写入每条记录），返回最新记录列表
export const estimateDayMeals = async (
  entries: MealEntry[],
  onEach?: (done: number, total: number) => void,
  ctx?: MealContext,
): Promise<MealEntry[]> => {
  const valid = entries.filter((e) => e.content && e.content.trim());
  const results = await estimateInParallel(valid, onEach, ctx);
  // 估算期间用户可能又改了记录，这里重新读一次再合并，避免覆盖掉新内容
  const list = await getMeals();
  const next = list.map((m) => (results.has(m.id) ? { ...m, nutrition: results.get(m.id) } : m));
  await saveMeals(next);
  return next;
};

// 批量估算「缺营养」的餐（用于统计中心一键补全）。返回成功估算的餐数。
export const estimateMissingMeals = async (
  entries: MealEntry[],
  onEach?: (done: number, total: number) => void,
  ctx?: MealContext,
): Promise<number> => {
  const missing = entries.filter((m) => m.content && m.content.trim() && !m.nutrition);
  const results = await estimateInParallel(missing, onEach, ctx);
  if (results.size === 0) return 0;
  const list = await getMeals();
  const next = list.map((m) => (results.has(m.id) ? { ...m, nutrition: results.get(m.id) } : m));
  await saveMeals(next);
  return results.size;
};

// 基于已记录的三餐与当前摄入，生成「今日/区间饮食调整方案」的个性化建议
export const requestMealAdjustmentAdvice = async (
  mealsSummary: string,
  currentText: string,
  ctx?: MealContext,
): Promise<{ text: string; status: 'ok' | 'nokey' | 'error' }> => {
  const cfg = await getActiveConfig(false);
  if (!cfg) return { text: '', status: 'nokey' };
  const ctxText = ctx
    ? '\n【今日运动情况】基础代谢约' + ctx.bmr + 'kcal、运动消耗约' + ctx.exerciseKcal + 'kcal、今日可摄入总量(TDEE)约' + ctx.tdee + 'kcal' + (ctx.steps != null ? '、手环步数' + ctx.steps + '步' : '') + '。请结合今日运动消耗给出饮食调整建议。'
    : '';
  const prompt = `你是营养师。以下是某段时间的每日三餐记录与营养摄入情况：
${mealsSummary}
当前摄入情况：${currentText}${ctxText}
请综合判断「蛋白质 / 热量 / 脂肪 / 碳水 / 膳食纤维 / 饮水」各项是否达标，重点指出今天还缺什么（如蔬菜少→纤维/维C不足，喝水少→饮水不足）：
1）接下来具体该多吃或少吃什么（含具体食物与大致分量）；
2）给出 2-3 条可落地的饮食调整方案；
3）语言简洁口语化、中文、不超过 200 字。只输出建议正文，不要标题。`;
  try {
    const content = await postChat(cfg, [
      { role: 'system', content: '你是专业的营养师，善于用大白话给普通人可执行的饮食建议。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.6, maxTokens: 400 });

    return { text: content || '', status: content ? 'ok' : 'error' };
  } catch (e) {
    console.error('[Nutrition] advice call failed', e);
    return { text: '', status: 'error' };
  }
};
