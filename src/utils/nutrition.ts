import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveConfig } from './modelConfig';
import { postChat, postChatResponses, parseJsonContent } from './model';
import { ModelConfig } from './modelConfig';
import { autoBackup } from './autoBackup';
import { MealEntry, MealType, MealNutrition, MealNutritionItem, MealAdequacy, KnownFood } from '../types';

const MEALS_KEY = 'meal_entries';

// ============ 食物名核心词 / 分量换算（已知食物按实际吃的份量缩放营养）============

// 从食物名提取「核心食物词」，去掉括号/数字/量词，用于与三餐输入框文字做宽松匹配。
// 同时供 MealQuickSheet 复用（避免两份不一致的实现）。
export const foodNameCore = (name: string): string => {
  return (name || '')
    .replace(/[（(][^)）]*[)）]/g, '') // 去掉括号及内容
    .replace(/[\d.]+/g, '') // 去掉数字
    .replace(/[gG千卡kcalKCAL碗份根片个块只杯mlML]/g, '') // 去掉量词/单位
    .trim();
};

// 中文数字 → 阿拉伯（半=0.5，一/两/二=1/2，十/十五等常见）
const CN_NUM: Record<string, number> = { 半: 0.5, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnNumToNumber = (s: string): number | null => {
  if (!s) return null;
  const m = s.match(/^(\d+(\.\d+)?)$/);
  if (m) return parseFloat(m[1]);
  if (CN_NUM[s] != null) return CN_NUM[s];
  const ten = s.match(/^十(\d)$/);
  if (ten) return 10 + parseInt(ten[1], 10);
  const tenPre = s.match(/^(\d)十$/);
  if (tenPre) return parseInt(tenPre[1], 10) * 10;
  return null;
};

// 从「基准单位/名称」文字里解析这份食物对应的克数（如 "100g"→100，"1份20g"→20，"米饭 1碗(约150g)"→150）
export const parseBaseGrams = (text?: string): number | undefined => {
  if (!text) return undefined;
  const m = text.match(/(\d+(\.\d+)?)\s*(g|克|毫升|ml|ML)/);
  if (m) return parseFloat(m[1]);
  return undefined;
};

// 解析用户在三餐里为某已知食物实际吃的克数；解析不出返回 null（则不换算，按一份计）
const parseActualGrams = (content: string, core: string, baseGrams?: number, inputUnitGrams?: number): number | null => {
  if (!content) return null;
  const idx = content.indexOf(core);
  const win = idx >= 0 ? content.slice(Math.max(0, idx - 8), Math.min(content.length, idx + core.length + 8)) : content;
  // 1) 直接克数
  const g = win.match(/(\d+(\.\d+)?)\s*(g|克|毫升|ml|ML)/);
  if (g) return parseFloat(g[1]);
  // 2) 数字 + 量词（碗/份/个…）。「份」优先用习惯单位克数；否则用基准克数（假设基准即 1 份/1 碗）
  const qty = win.match(/(半|一|两|二|三|四|五|六|七|八|九|十|\d+(\.\d+)?)\s*(碗|份|个|片|根|块|只|杯|包)/);
  if (qty) {
    const n = cnNumToNumber(qty[1]);
    if (n == null) return null;
    if (qty[2] === '份' && inputUnitGrams != null) return n * inputUnitGrams;
    if (baseGrams != null) return n * baseGrams;
    return null;
  }
  return null;
};

// 把一条已知食物的营养按用户实际吃的份量缩放。
// 份量来自 KnownFood.grams（用户在 UI 手动填的「实际克数」；由「克」或「份×单位克数」换算得到）。
// 没填 grams 时按基准一份算（ratio=1），兼容旧数据（旧 knownFoods 无 grams 字段）。
// 这是已知食物营养的「唯一可靠来源」——不再依赖从餐文本里猜分量（原来极易估错）。
const scaleKnown = (k: KnownFood): KnownFood => {
  const base = k.baseGrams && k.baseGrams > 0 ? k.baseGrams : 100;
  const grams = k.grams && k.grams > 0 ? k.grams : base;
  const ratio = grams / base;
  if (ratio === 1) return k;
  const r1 = (v: number) => Math.round(v * ratio * 10) / 10;
  return {
    ...k,
    protein: r1(k.protein),
    calories: Math.round(k.calories * ratio),
    fat: r1(k.fat),
    carbs: r1(k.carbs),
    fiber: r1(k.fiber),
    water: k.water != null ? Math.round(k.water * ratio) : undefined,
  };
};

// 从餐文本里剔除「已关联食物库」的名字，看还剩没有需要 AI 估算的自由文本食物。
// 返回去掉已知食物名、并滤掉标点/数字/单位后的残余文字；为空 → 这餐全是已知食物，可跳过 AI。
const stripKnownText = (content: string, known: KnownFood[] | null): string => {
  let s = content || '';
  for (const k of known || []) {
    const core = foodNameCore(k.name);
    if (core) s = s.split(core).join(' ');
  }
  return s.replace(/[（()）\d.gG千卡kcal碗份根片个块只杯mlML，,、。.\s]/g, '').trim();
};

// 当日身体/运动上下文，注入到营养估算 prompt，让 AI 按真实消耗判断热量，而不是死板的 2000kcal。
export interface MealContext {
  bmr: number;
  weight: number; // 体重 kg（用于动态蛋白目标）
  tdee: number;
  exerciseKcal: number;
  baseLevel: 'sedentary' | 'light' | 'moderate' | 'high';
}

const BASE_LEVEL_LABEL: Record<MealContext['baseLevel'], string> = {
  sedentary: '久坐少动',
  light: '轻度活动',
  moderate: '中度活动',
  high: '高强度活动',
};

// 把某一天的身体/运动数据拼成一段中文，注入营养估算 prompt。
// date 省略或等于今天 → 说「今日」；补记往期 → 说具体日期，避免模型误判成今天。
const buildMealContextText = (ctx: MealContext, date?: string): string => {
  const isToday = !date || date === todayStr();
  const dayWord = isToday ? '今日' : `${date} 当日`;
  const parts: string[] = [];
  parts.push(`【${dayWord}身体与运动情况，用于判断这顿饭是否合适】`);
  parts.push('- 基础代谢(BMR)：约 ' + ctx.bmr + ' kcal');
  parts.push(`- ${dayWord}运动消耗：约 ` + ctx.exerciseKcal + ' kcal（基础活动强度：' + BASE_LEVEL_LABEL[ctx.baseLevel] + '）');
  parts.push(`- ${dayWord}可摄入总量(TDEE，含运动)：约 ` + ctx.tdee + ' kcal');
  parts.push(`请结合「${dayWord}可摄入总量 ` + ctx.tdee + ` kcal」判断这顿饭的 adequacy：运动消耗大可放宽、久坐少动要更克制；在 comment 里点明这顿与${dayWord}运动是否匹配、建议多吃还是少吃。`);
  return parts.join('\n');
};

// 每日营养推荐量（用于达标/超标判断，可按需调整）
export const PROTEIN_TARGET = 60; // g（兜底：无体重数据时）
// 蛋白目标按体重动态算：一般推荐每公斤体重约 1.0~1.2g，这里取 1.1g 取整，且不低于兜底值。
export const calcProteinTarget = (weight?: number | null): number => {
  if (!weight || weight <= 0) return PROTEIN_TARGET;
  return Math.max(PROTEIN_TARGET, Math.round(weight * 1.1));
};
export const CALORIE_TARGET = 2000; // kcal
export const NUTRITION_TARGETS = {
  protein: PROTEIN_TARGET, // g
  calorie: CALORIE_TARGET, // kcal
  fat: 60, // g
  carbs: 250, // g
  fiber: 25, // g
  water: 1500, // ml
};

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

// ============ 日期措辞（补记多天时不能再一律说「今天」）============
// 之前 prompt 固定写「这是今天的早餐」，用户攒了好几天一次性估算时，
// 模型会把 5 天的饭都当成同一天，adequacy（不足/适量/过量）判断整体失真。
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 「今天的」/「2026-08-12（周三）的」
const mealDateLabel = (date?: string): string => {
  if (!date) return '今天的';
  if (date === todayStr()) return '今天的';
  const d = new Date(date + 'T00:00:00');
  if (isNaN(d.getTime())) return `${date} 的`;
  return `${date}（${WEEK_CN[d.getDay()]}）的`;
};

// 日期块标题：「2026-08-12（周三）」，今天额外标注
const dateHeading = (date: string): string => {
  const d = new Date(date + 'T00:00:00');
  const wk = isNaN(d.getTime()) ? '' : `（${WEEK_CN[d.getDay()]}）`;
  return date === todayStr() ? `${date}${wk}·今天` : `${date}${wk}`;
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
// knownFoods 为从食物库选入的已知营养；不传则保留已有值（避免手动改文本时把已知营养清掉）。
export const upsertMeal = async (
  type: MealType,
  date: string,
  content: string,
  id?: string,
  knownFoods?: KnownFood[],
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
    rest.push({
      id: id || `${date}_snack_${Date.now()}`,
      type,
      content: text,
      date,
      createdAt: Date.now(),
      nutrition: existing?.nutrition,
      knownFoods: knownFoods ?? existing?.knownFoods,
    });
    await saveMeals(rest);
    return rest;
  }
  const existing = list.find((m) => m.type === type && m.date === date);
  const rest = list.filter((m) => !(m.type === type && m.date === date));
  if (text) {
    rest.push({
      id: `${date}_${type}`,
      type,
      content: text,
      date,
      createdAt: Date.now(),
      nutrition: existing?.nutrition,
      knownFoods: knownFoods ?? existing?.knownFoods,
    });
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
    knownFoods: entry.knownFoods ?? old?.knownFoods,
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
如果用户在该餐消息里提供了「当日身体与运动情况」（基础代谢、运动消耗、今日可摄入总量TDEE等），请务必据此判断 adequacy：把这顿的热量与「今日可摄入总量」的对应比例对照，运动量消耗大时可放宽、久坐少动时要更克制；并在 comment 里点明这顿与今日运动是否匹配、建议用户多吃还是少吃。
`;

export interface EstimateResult {
  result: MealNutrition | null;
  status: 'ok' | 'nokey' | 'error' | 'rate';
  searched?: boolean;   // 本轮是否实际发起了联网搜索（豆包因不支持搜索会为 false）
  needSearch?: boolean; // 这顿是否本应联网（含未知食物）
  message?: string;     // 失败时的具体错误信息（用于透传展示）
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

// 用「食物库已知的准确营养」覆盖 AI 对已知食物的估算结果，保证用户记录过的食物热量一定准确。
// 做法：对每条 knownFood，在 AI 返回的 items 里按名称匹配；匹配到就写入准确值，没匹配到就补一条。
// 最后按 items 重算顶层合计，确保「逐项明细」与「总合计」永远一致、且已知食物用的是你存的真实数值。
const applyKnownFoods = (n: MealNutrition, known: KnownFood[] | null | undefined): void => {
  if (!known || known.length === 0) return;
  for (const k of known) {
    const sk = scaleKnown(k); // 先按用户实际份量缩放，得到已知食物的准确值
    // 用核心词精确匹配（而非名字互相包含），避免「牛奶燕麦粥」被误当成「牛奶」覆盖成整份值
    const kc = foodNameCore(k.name);
    let it = n.items.find((i) => foodNameCore(i.name) === kc);
    if (!it) {
      it = { name: k.name, protein: 0, calories: 0, fat: 0, carbs: 0, fiber: 0 };
      n.items.push(it);
    }
    it.protein = sk.protein;
    it.calories = sk.calories;
    it.fat = sk.fat;
    it.carbs = sk.carbs;
    it.fiber = sk.fiber;
  }
  n.protein = n.items.reduce((s, i) => s + (i.protein || 0), 0);
  n.calories = n.items.reduce((s, i) => s + (i.calories || 0), 0);
  n.fat = n.items.reduce((s, i) => s + (i.fat || 0), 0);
  n.carbs = n.items.reduce((s, i) => s + (i.carbs || 0), 0);
  n.fiber = n.items.reduce((s, i) => s + (i.fiber || 0), 0);
};

// 由「已关联食物库」的已知食物本地算出一餐营养（不发 AI，0 token）。
// 已知食物已按用户实际份量缩放（scaleKnown），这里只拼成标准 MealNutrition 结构。
const localNutrition = (known: KnownFood[]): MealNutrition => {
  const items = known.map((k) => ({
    name: k.name,
    protein: k.protein,
    calories: k.calories,
    fat: k.fat,
    carbs: k.carbs,
    fiber: k.fiber,
  }));
  return normalizeNutrition({ items, adequacy: '适量', comment: '已按食物库精确值计算（未调用 AI）' });
};

// 估算单餐营养（返回该餐的明细 + 合计）
// 限流自动重试：免费 GLM 接口有频率上限（如每分钟若干次）。
// 一顿饭一个请求，批量估算时并发打过去很容易返回 429，这里遇到 429 就退避重试，
// 大部分情况能自己恢复，避免你看到冷冰冰的「估算失败」。
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const estimateMealNutrition = async (entry: MealEntry, ctx?: MealContext, cfgOverride?: ModelConfig): Promise<EstimateResult> => {
  const cfg = cfgOverride || (await getActiveConfig(false));
  if (!cfg) return { result: null, status: 'nokey' };
  if (!entry.content || !entry.content.trim()) return { result: null, status: 'nokey' };
  // 🔧 调试日志：确认营养估算实际使用的模型
  console.log(`[Nutrition] 使用模型: brand=${cfg.brand}, modelId=${cfg.modelId}, override=${!!cfgOverride}`);

  // 已知营养（来自食物库）：先按用户实际吃的份量缩放，再作为 ground truth 注入 prompt，
  // 保证「半碗米饭」也按半碗的热量算，而不是整份。
  const rawKnown = entry.knownFoods && entry.knownFoods.length ? entry.knownFoods : null;
  const known = rawKnown ? rawKnown.map((k) => scaleKnown(k)) : null;

  // 全关联且分量已填 → 本地直接算，完全不发 AI 请求（0 token，最准）
  if (known && stripKnownText(entry.content, rawKnown).length === 0) {
    const items = known.map((k) => ({ name: k.name, protein: k.protein, calories: k.calories, fat: k.fat, carbs: k.carbs, fiber: k.fiber }));
    return {
      result: normalizeNutrition({ items, adequacy: '适量', comment: '已按食物库精确值计算（未调用 AI）' }),
      status: 'ok',
      searched: false,
      needSearch: false,
    };
  }

  // 是否需要联网搜索：仅当这顿里含有「食物库没有覆盖的食物」才联网。
  // 纯已知食物（文字去掉已知食物名后已无实质内容）→ 不联网；纯未知 / 混合 → 联网。
  let needSearch = true;
  if (known && known.length) {
    let remaining = entry.content;
    known.forEach((k) => {
      const c = foodNameCore(k.name);
      if (c) remaining = remaining.split(c).join('');
    });
    const left = remaining.replace(/[（()）\d.gG千卡kcal碗份根片个块只杯mlML，,、。.\s]/g, '').trim();
    needSearch = left.length > 0;
  }

  const knownText = known
    ? '\n【以下食物的营养数据来自你的个人食物库（已准确记录，并已按你实际吃的份量换算好），请直接使用这些数值，不要再估算；把它们计入各项总和即可】\n' +
      known
        .map(
          (k) =>
            `- ${foodNameCore(k.name) || k.name}：蛋白 ${k.protein}g、热量 ${k.calories}kcal、脂肪 ${k.fat}g、碳水 ${k.carbs}g、纤维 ${k.fiber}g${k.water ? '、水 ' + k.water + 'ml' : ''}`,
        )
        .join('\n') +
      '\n上面已列出的食物请严格采用给出的数值，不要改写；若文字里还提到上面没列出的其它食物（没有营养表），请联网搜索其常见热量后再估算。'
    : '';

  // 火山（豆包）的联网搜索只在 Responses API 可用，需要联网时走 postChatResponses；其它品牌走 chat/completions。
  const useResponses = cfg.brand === 'doubao' && needSearch;
  const messages = [
    { role: 'system' as const, content: NUTRITION_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `这是${mealDateLabel(entry.date)}${MEAL_LABEL[entry.type]}：${entry.content}${ctx ? '\n' + buildMealContextText(ctx, entry.date) : ''}${knownText}\n请输出这顿的营养估算 JSON。`,
    },
  ];

  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const content = useResponses
        ? await postChatResponses(cfg, messages, { temperature: 0.2, maxTokens: 2000, forceSearch: true, jsonMode: true, feature: '三餐估算' })
        : await postChat(cfg, messages, { temperature: 0.2, maxTokens: 2000, forceSearch: needSearch, jsonMode: true, feature: '三餐估算' });

      const parsed = normalizeNutrition(parseJsonContent(content));
      // 🔧 空结果保护：模型返回了能解析的 JSON，但营养全为 0 且没有任何明细项。
      // 这种情况以前会被当成「成功」静默入库，用户看到的就是「无报错但不出结果」。
      // 这里显式判定为失败并给出可操作的提示，方便定位是模型标识填错还是接口/网关问题。
      const isEmpty =
        (!parsed.items || parsed.items.length === 0) &&
        parsed.calories === 0 &&
        parsed.protein === 0 &&
        parsed.carbs === 0 &&
        parsed.fat === 0 &&
        parsed.fiber === 0;
      if (isEmpty) {
        console.error('[Nutrition] 模型返回了空的营养数据', String(content).slice(0, 600));
        throw new Error(
          '模型返回了空的营养数据（热量/蛋白等全为 0）。常见原因：①默认模型的「模型标识」填错或该接口不支持此任务；②请求被网关/GFW 拦截（国内网络访问海外模型常见）；③该模型无法按 JSON 格式返回。请到「我的 → 管理 AI 模型」检查默认模型与接口，或换一个模型再试。',
        );
      }
      // 用食物库的准确数值（已换算）覆盖 AI 对已知食物的估算，保证「已记录食物」的热量一定准确
      applyKnownFoods(parsed, known);
      // 实际是否联网：火山走 Responses 通道、其余支持 web_search 的品牌走 chat/completions
      const searched = useResponses || (needSearch && cfg.brand !== 'doubao');
      return { result: parsed, status: 'ok', searched, needSearch };
    } catch (e: any) {
      const isRate = e?.message && String(e.message).includes('429');
      // 仅 429 限流才退避重试；其它错误（401/JSON 解析失败/网络）直接失败，避免无意义重试 4 次
      if (isRate && attempt < MAX_RETRIES) {
        const wait = Math.min(1500 * Math.pow(2, attempt), 6000) + Math.floor(Math.random() * 400);
        await sleep(wait);
        continue;
      }
      console.error('[Nutrition] GLM call failed', e);
      return { result: null, status: isRate ? 'rate' : 'error', message: e?.message, searched: false, needSearch };
    }
  }
  return { result: null, status: 'error', searched: false, needSearch };
};

// ============ 把一整天的餐次打包成一个请求，让模型对每餐分别独立计算 ============
// 设计：一次请求把全部餐次 + 运动信息喂给模型，要求它按编号 1..N 对每餐分别独立估算，
// 返回 { "1": {...}, "2": {...} } 的逐餐 JSON（解析兼容单餐不带编号 / 数组，见 requestMealBatch）。
// 整个估算只发这一次请求，不再逐餐兜底或重试——一次拿全，省 token。
const NUTRITION_BATCH_SYSTEM_PROMPT = `你是一位营养师。用户会一次提供**一批餐次**（早/午/晚/加餐，加餐可能有多条），这些餐可能分属同一天或不同日期，用户会用「—— 日期 ——」分组标明。
请对每一餐**分别独立估算**营养，最后**返回一个 JSON 数组**（不要输出任何 JSON 以外的文字），数组里每个元素按顺序对应上面列出的每一餐（第 1 个元素=【1】，第 2 个=【2】…）。

数组每个元素的结构：
{
  "meal": "这餐的餐次名（如 早餐）",
  "items": [{"name":"食物名(含大致分量)","protein":数字,"calories":数字,"fat":数字,"carbs":数字,"fiber":数字}],
  "protein": 数字, "calories": 数字, "fat": 数字, "carbs": 数字, "fiber": 数字, "water": 数字,
  "adequacy": "不足" | "适量" | "过量",
  "comment": "一句话点评与建议"
}

硬性要求：
1. 每一餐内部，用户提到的**每一样食物都必须单独成为 items 里的一条**，不允许合并成笼统条目（如「鸡蛋、香蕉」必须拆成两条）。
2. items 每一条都给出 protein/calories/fat/carbs/fiber 五个数字（无则填 0），name 带大致分量（如「鸡蛋 2个」）。
3. 每一餐顶层的 protein/calories/fat/carbs/fiber **必须等于该餐 items 各项之和**（允许微小取整误差）。
4. water 是该餐液体量(ml)，没有填 0。
5. adequacy 按该餐占**它所属那一天**推荐量的合理比例判断（参考：蛋白约60g、热量约2000kcal、脂肪约60g、碳水约250g、纤维约25g、饮水约1500ml）。
6. 若某个日期下给了「当日身体与运动情况」（含该日可摄入总量TDEE），该日期的每一餐都要据此判断 adequacy：运动消耗大可放宽、久坐少动要更克制，并在 comment 点明与当天运动是否匹配、建议多吃还是少吃。
7. **不同日期的餐互不相干，绝对不要把跨日期的餐加在一起算**：每餐只和它所属那一天的全天推荐量对比。
8. 严格返回 JSON 数组，顺序与各餐一一对应；即便某餐无法估算也要返回（items 为空、各项为 0）。
只输出 JSON 数组。`;

// 运动上下文入参：单日场景直接传一个 MealContext；
// 补记多天时传 { '2026-08-12': ctx, '2026-08-13': ctx } 按日期各给一份，避免把某天运动套到所有天。
export type MealCtxInput = MealContext | Record<string, MealContext>;

const normalizeCtxInput = (
  input: MealCtxInput | undefined,
  dates: string[],
): Record<string, MealContext> => {
  if (!input) return {};
  if (typeof (input as MealContext).bmr === 'number') {
    const single = input as MealContext;
    if (dates.length <= 1) {
      const out: Record<string, MealContext> = {};
      dates.forEach((d) => (out[d] = single));
      return out;
    }
    // 跨多天却只拿到一天的运动数据 → 宁可不注入，也不要把这一天的 TDEE 套到所有日期上误导模型
    console.warn('[Nutrition] 跨多天估算只收到单日运动上下文，已忽略以免 adequacy 判断失真');
    return {};
  }
  return input as Record<string, MealContext>;
};

// 每次请求最多打包多少餐：单餐 JSON 约 120~350 tokens，10 餐留足 4000 输出上限（GLM 等上限约 4096），
// 攒了很多天时自动拆成多批串行发送，既不超上限被截断，也远少于「一餐一个请求」的次数。
const BATCH_MEALS = 10;

// 从模型批量返回里抽取每餐营养。
// 简化后：prompt 要求模型返回「与各餐顺序一一对应的 JSON 数组」，这里按数组顺序映射到各餐即可。
// 兼容两种形态：裸数组 [ {...}, {...} ]；或外层包了 meals/foods 数组；再兜底编号对象。
const extractBatchMeals = (
  raw: any,
  chunk: MealEntry[],
  idxToEntry: Map<number, MealEntry>,
): Map<string, MealNutrition> => {
  const results = new Map<string, MealNutrition>();
  const pickOne = (obj: any): MealNutrition | null => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const n = normalizeNutrition(obj);
    const empty = (!n.items || n.items.length === 0) && n.calories === 0 && n.protein === 0 && n.carbs === 0 && n.fat === 0 && n.fiber === 0;
    return empty ? null : n;
  };
  const seqList = Array.from(idxToEntry.entries()).sort((a, b) => a[0] - b[0]);
  const setOne = (e: MealEntry, obj: any) => {
    const n = pickOne(obj);
    if (!n) return;
    applyKnownFoods(n, e.knownFoods); // 已知食物用库里准确值覆盖（按用户实际份量缩放后）
    results.set(e.id, n);
  };

  // 形态1/2：数组（裸数组 或 外层包 meals/foods）
  let arr: any[] | null = null;
  if (Array.isArray(raw)) arr = raw;
  else if (Array.isArray(raw?.meals)) arr = raw.meals;
  else if (Array.isArray(raw?.foods)) arr = raw.foods;
  if (arr) {
    arr.forEach((part: any, idx: number) => { const e = seqList[idx]?.[1]; if (e) setOne(e, part); });
    return results;
  }
  // 形态3（兜底）：编号对象 { "1":{...}, "2":{...} }
  if (seqList.every(([i]) => raw && raw[String(i)])) {
    seqList.forEach(([i, e]) => setOne(e, raw[String(i)]));
    return results;
  }
  return results;
};

// 一批「需 AI 估算」的餐 → 一个请求（关联的餐已在外部本地算好，不再进这里）。
// prompt 要求模型返回「与各餐顺序一一对应的 JSON 数组」，解析只认数组（见 extractBatchMeals）。
const requestMealBatch = async (
  cfg: ModelConfig,
  chunk: MealEntry[],
  ctxMap: Record<string, MealContext>,
): Promise<{ results: Map<string, MealNutrition>; status: 'ok' | 'error' | 'rate'; message?: string }> => {
  // 是否需要联网：任一一餐含「食物库没覆盖的自由文本食物」即联网
  let needSearch = false;
  chunk.forEach((e) => {
    const rawKnown = e.knownFoods && e.knownFoods.length ? e.knownFoods : null;
    const left = rawKnown ? stripKnownText(e.content, rawKnown).length > 0 : true;
    if (left) needSearch = true;
  });

  // 按日期分组（Map 保留插入顺序），编号在本批内全局连续 1..N
  const groups = new Map<string, MealEntry[]>();
  chunk.forEach((e) => {
    const arr = groups.get(e.date) || [];
    arr.push(e);
    groups.set(e.date, arr);
  });
  const multiDate = groups.size > 1;

  const sections: string[] = [];
  const idxToEntry = new Map<number, MealEntry>();
  let seq = 0;
  groups.forEach((list, date) => {
    const blocks = list.map((e) => {
      seq += 1;
      idxToEntry.set(seq, e);
      return `【${seq}】${MEAL_LABEL[e.type] || '餐'}：${e.content}`;
    });
    const dayCtx = ctxMap[date];
    const ctxText = dayCtx ? '\n\n' + buildMealContextText(dayCtx, date) : '';
    // 单日时不必加日期分隔条，保持提示简洁
    const head = multiDate ? `—— ${dateHeading(date)}，共 ${list.length} 餐 ——\n\n` : '';
    sections.push(head + blocks.join('\n\n') + ctxText);
  });

  const intro = multiDate
    ? `以下是 ${groups.size} 个不同日期、共 ${chunk.length} 餐（攒了几天一起补记），请按每餐所属日期分别独立估算：`
    : `这是 ${dateHeading(Array.from(groups.keys())[0])} 的 ${chunk.length} 餐，请分别估算每一餐的营养：`;
  // 关键改动：不再要求「编号 key 对象」，而是「与各餐顺序一一对应的 JSON 数组」——模型最擅长、最稳。
  const outro = `\n\n请返回一个 JSON 数组，数组每个元素按顺序对应上面【1】~【${chunk.length}】的每一餐（第 1 个元素对应【1】，第 2 个对应【2】…），不要额外输出任何文字。`;
  const userContent = intro + '\n\n' + sections.join('\n\n') + outro;

  // 输出预算：按餐数动态给，避免多餐 JSON 被截断，又不超模型上限
  const maxTokens = Math.min(4000, Math.max(1200, chunk.length * 350 + 400));
  const useResponses = cfg.brand === 'doubao' && needSearch;
  const messages = [
    { role: 'system' as const, content: NUTRITION_BATCH_SYSTEM_PROMPT },
    { role: 'user' as const, content: userContent },
  ];

  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const content = useResponses
        ? await postChatResponses(cfg, messages, { temperature: 0.2, maxTokens, forceSearch: true, jsonMode: true, feature: '三餐估算(批量)' })
        : await postChat(cfg, messages, { temperature: 0.2, maxTokens, forceSearch: needSearch, jsonMode: true, feature: '三餐估算(批量)' });
      const raw = parseJsonContent(content);
      const results = extractBatchMeals(raw, chunk, idxToEntry);
      if (results.size === 0) {
        // 诊断日志：帮助定位为什么批量解析全空（token 已消耗但没拿到结果）
        console.error('[Nutrition] 批量解析全部为空。原始返回前 800 字符:', String(content).slice(0, 800));
        console.error('[Nutrition] 解析后的 raw:', JSON.stringify(raw)?.slice(0, 800));
        throw new Error('模型返回里没有可解析的各餐营养结果');
      }
      return { results, status: 'ok' };
    } catch (e: any) {
      const isRate = e?.message && String(e.message).includes('429');
      if (isRate && attempt < MAX_RETRIES) {
        const wait = Math.min(1500 * Math.pow(2, attempt), 6000) + Math.floor(Math.random() * 400);
        await sleep(wait);
        continue;
      }
      return { results: new Map(), status: isRate ? 'rate' : 'error', message: e?.message };
    }
  }
  return { results: new Map(), status: 'error' };
};

export const estimateAllMeals = async (
  entries: MealEntry[],
  ctx?: MealCtxInput,
  cfgOverride?: ModelConfig,
  onBatch?: (doneMeals: number, totalMeals: number) => void,
): Promise<{ results: Map<string, MealNutrition>; status: 'ok' | 'nokey' | 'error' | 'rate'; message?: string }> => {
  const cfg = cfgOverride || (await getActiveConfig(false));
  if (!cfg) return { results: new Map(), status: 'nokey' };
  const valid = entries.filter((e) => e.content && e.content.trim());
  if (valid.length === 0) return { results: new Map(), status: 'ok' };

  // 按日期升序排好，让同一天的餐挨在一起（也保证分批时不会把一天切得太碎）
  const sorted = [...valid].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  const dates = Array.from(new Set(sorted.map((e) => e.date)));
  const ctxMap = normalizeCtxInput(ctx, dates);

  const results = new Map<string, MealNutrition>();
  let lastStatus: 'ok' | 'error' | 'rate' = 'ok';
  let lastMsg: string | undefined;
  let done = 0;

  // 多批串行发送（并发容易触发免费接口 429）
  for (let i = 0; i < sorted.length; i += BATCH_MEALS) {
    const chunk = sorted.slice(i, i + BATCH_MEALS);
    const r = await requestMealBatch(cfg, chunk, ctxMap);
    r.results.forEach((v, k) => results.set(k, v));
    if (r.status !== 'ok') {
      lastStatus = r.status;
      lastMsg = r.message;
    }
    done += chunk.length;
    onBatch?.(done, sorted.length);
  }

  if (results.size === 0) {
    return { results, status: lastStatus === 'ok' ? 'error' : lastStatus, message: lastMsg };
  }
  return { results, status: 'ok', message: lastMsg };
};

// 统一估算入口：先本地算「全关联」的餐（0 token），其余待估餐按日期批量问 AI，最后合并保存。
// 流程：① 分流（本地 or AI）② 待估餐批量问 AI（含当日运动）③ 解析按数组顺序对应各餐 ④ 合并。
// 不再有「批量失败→逐餐静默回退」——失败就如实报失败，不偷偷多发请求烧 token。
const estimateCore = async (
  entries: MealEntry[],
  onEach?: (done: number, total: number) => void,
  ctx?: MealCtxInput,
  cfgOverride?: ModelConfig,
): Promise<{ entries: MealEntry[]; success: number; total: number; failedMeals: MealEntry[] }> => {
  const cfg = cfgOverride || (await getActiveConfig(false));
  const valid = entries.filter((e) => e.content && e.content.trim());
  const total = valid.length;
  if (total === 0) return { entries, success: 0, total: 0, failedMeals: [] };
  if (onEach) onEach(0, total);
  if (!cfg) return { entries, success: 0, total, failedMeals: valid };

  // ① 分流
  const results = new Map<string, MealNutrition>();
  const needAi: MealEntry[] = [];
  for (const e of valid) {
    const rawKnown = e.knownFoods && e.knownFoods.length ? e.knownFoods : null;
    const known = rawKnown ? rawKnown.map((k) => scaleKnown(k)) : null;
    // 全关联且分量已填 → 本地直接算（不发 AI，最准，0 token）
    if (known && stripKnownText(e.content, rawKnown).length === 0) {
      results.set(e.id, localNutrition(known));
    } else {
      needAi.push(e);
    }
  }

  // ② 待估餐按日期批量问 AI（estimateAllMeals 内部按 10 餐分批、按日期分组，每批 1 次请求）
  if (needAi.length > 0) {
    const batch = await estimateAllMeals(needAi, ctx, cfg, (d) => onEach?.(results.size + d, total));
    if (batch.status === 'nokey') {
      // 没配模型：待估餐全部标失败，已本地算的仍保留
      const list0 = await getMeals();
      const next0 = list0.map((m) => (results.has(m.id) ? { ...m, nutrition: results.get(m.id) } : m));
      await saveMeals(next0);
      return { entries: next0, success: results.size, total, failedMeals: needAi };
    }
    batch.results.forEach((v, k) => results.set(k, v));
  }

  // ④ 合并保存（重新读一次，避免覆盖估算期间用户的新增/修改）
  const list = await getMeals();
  const next = list.map((m) => (results.has(m.id) ? { ...m, nutrition: results.get(m.id) } : m));
  await saveMeals(next);
  const failedMeals = valid.filter((e) => !results.has(e.id));
  return { entries: next, success: results.size, total, failedMeals };
};

// 估算某天全部餐（首页「AI 估算今日营养」按钮）。统一走 estimateCore。
export const estimateDayMeals = (
  entries: MealEntry[],
  onEach?: (done: number, total: number) => void,
  ctx?: MealCtxInput,
  cfg?: ModelConfig,
) => estimateCore(entries, onEach, ctx, cfg);

// 批量估算「缺营养」的餐（统计中心一键补全）。同样走统一入口，返回成功估算的餐数。
export const estimateMissingMeals = async (
  entries: MealEntry[],
  onEach?: (done: number, total: number) => void,
  ctx?: MealCtxInput,
  cfg?: ModelConfig,
): Promise<number> => {
  const missing = entries.filter((m) => m.content && m.content.trim() && !m.nutrition);
  if (missing.length === 0) return 0;
  const r = await estimateCore(missing, onEach, ctx, cfg);
  return r.success;
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
    ? '\n【今日运动情况】基础代谢约' + ctx.bmr + 'kcal、运动消耗约' + ctx.exerciseKcal + 'kcal、今日可摄入总量(TDEE)约' + ctx.tdee + 'kcal。请结合今日运动消耗给出饮食调整建议。'
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
    ], { temperature: 0.6, maxTokens: 400, feature: '饮食建议' });

    return { text: content || '', status: content ? 'ok' : 'error' };
  } catch (e) {
    console.error('[Nutrition] advice call failed', e);
    return { text: '', status: 'error' };
  }
};

// ============ 食物库（用户常用食物，免重复输入配料表） ============
export interface FoodItem {
  id: string;
  name: string; // 含分量，如「米饭 1碗(约150g)」
  protein: number;
  calories: number;
  fat: number;
  carbs: number;
  fiber: number;
  water?: number;
  // 配料表与单位（用户录入时填写，帮助 AI 更准确换算热量）
  ingredientText?: string; // 配料表原文（或拍照识别结果）
  labelBaseUnit?: string;  // 配料表基准单位，如 "100g" / "1份20g"
  inputUnit?: string;      // 用户习惯输入单位，如 "一份" / "10g"
  // 由 labelBaseUnit / 名称自动解析出的「这份食物对应的克数」，用于分量换算
  baseGrams?: number;
}

const FOOD_LIBRARY_KEY = 'food_library';

export const getFoodLibrary = async (): Promise<FoodItem[]> => {
  try {
    const raw = await AsyncStorage.getItem(FOOD_LIBRARY_KEY);
    return raw ? (JSON.parse(raw) as FoodItem[]) : [];
  } catch {
    return [];
  }
};

const saveFoodLibrary = async (list: FoodItem[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(FOOD_LIBRARY_KEY, JSON.stringify(list));
    await autoBackup();
  } catch (e) {
    console.error('[Nutrition] saveFoodLibrary failed', e);
  }
};

export const addFoodItem = async (item: Omit<FoodItem, 'id'>): Promise<FoodItem[]> => {
  const list = await getFoodLibrary();
  const next = [...list, { ...item, id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }];
  await saveFoodLibrary(next);
  return next;
};

export const deleteFoodItem = async (id: string): Promise<FoodItem[]> => {
  const list = await getFoodLibrary();
  const next = list.filter((x) => x.id !== id);
  await saveFoodLibrary(next);
  return next;
};

export const updateFoodItem = async (id: string, patch: Partial<Omit<FoodItem, 'id'>>): Promise<FoodItem[]> => {
  const list = await getFoodLibrary();
  const next = list.map((x) => (x.id === id ? { ...x, ...patch } : x));
  await saveFoodLibrary(next);
  return next;
};
