// 运动量 / TDEE 计算。基础代谢用 Mifflin-St Jeor，总消耗 = BMR×活动系数 + 运动消耗。
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getBodyProfile,
  getDailyActivity,
  BodyProfile,
  DailyActivity,
  ExerciseRecord,
} from './storage';
export type { BodyProfile, DailyActivity, ExerciseRecord } from './storage';
import { sendChat } from './chat';
import { getApiKey } from './storage';
import { ChatMessage } from './chat';

export const DEFAULT_BODY_PROFILE: BodyProfile = { gender: 'male', age: 30, height: 175, weight: 70 };

export const ACTIVITY_FACTOR: Record<DailyActivity['baseLevel'], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

export const BASE_LEVEL_LABEL: Record<DailyActivity['baseLevel'], string> = {
  sedentary: '久坐',
  light: '轻度',
  moderate: '中度',
  high: '高强度',
};

export const DEFAULT_EXERCISE_TYPES = ['跑步', '力量', '游泳', '骑行', '瑜伽', '其他'];
// 兼容旧引用：默认初值（首次进入时使用，之后以用户自定义存储为准）
export const EXERCISE_TYPES = DEFAULT_EXERCISE_TYPES;

const EXERCISE_TYPES_KEY = 'exercise_types';

// 运动类型改为用户可增删改：从 AsyncStorage 读取，无则返回默认初值。
export const getExerciseTypes = async (): Promise<string[]> => {
  try {
    const raw = await AsyncStorage.getItem(EXERCISE_TYPES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_EXERCISE_TYPES];
};

export const saveExerciseTypes = async (types: string[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(EXERCISE_TYPES_KEY, JSON.stringify(types));
  } catch (e) {
    console.error('[activity] saveExerciseTypes failed', e);
  }
};

export const addExerciseType = async (t: string): Promise<string[]> => {
  const name = (t || '').trim();
  if (!name) return getExerciseTypes();
  const list = await getExerciseTypes();
  if (list.includes(name)) return list;
  const next = [...list, name];
  await saveExerciseTypes(next);
  return next;
};

export const removeExerciseType = async (t: string): Promise<string[]> => {
  const list = await getExerciseTypes();
  if (list.length <= 1) return list; // 至少保留一个类型
  const next = list.filter((x) => x !== t);
  await saveExerciseTypes(next);
  return next;
};

// Mifflin-St Jeor 基础代谢率（kcal/天）
export const calcBMR = (p: BodyProfile): number => {
  const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
  return Math.round(p.gender === 'male' ? base + 5 : base - 161);
};

export const calcTDEE = (
  bmr: number,
  level: DailyActivity['baseLevel'],
  exerciseKcal: number,
): number => Math.round(bmr * ACTIVITY_FACTOR[level] + exerciseKcal);

export interface DayEnergy {
  bmr: number;
  tdee: number;
  baseLevel: DailyActivity['baseLevel'];
  exerciseKcal: number;
}

export const calcDayEnergy = async (date: string): Promise<DayEnergy> => {
  const p = (await getBodyProfile()) || DEFAULT_BODY_PROFILE;
  const a = await getDailyActivity(date);
  const bmr = calcBMR(p);
  const exerciseKcal = a.exercises.reduce((s, e) => s + (e.kcal || 0), 0);
  const tdee = calcTDEE(bmr, a.baseLevel, exerciseKcal);
  return { bmr, tdee, baseLevel: a.baseLevel, exerciseKcal };
};

// 保守（低侧）MET 值：取各运动代谢当量（MET）的下限，确保消耗估算偏保守、不虚高。
// MET 含义：每千克体重每小时消耗的千卡数。kcal = MET × 体重(kg) × 时长(小时)。
const EXERCISE_MET_LOW: Record<string, number> = {
  跑步: 7,
  力量: 3.5,
  游泳: 5,
  骑行: 4,
  瑜伽: 2.5,
};
const EXERCISE_MET_DEFAULT = 3; // 「其他」/未知类型：按轻度活动保守估算

// 离线保守估算（不依赖 AI / 网络）：任何情况下都能给出偏低的消耗值。
export const estimateExerciseKcalOffline = (
  type: string,
  durationMin: number,
  weightKg: number,
): number => {
  const t = (type || '').trim();
  // 精确匹配优先；否则看描述里是否包含已知类型（如「晨跑」命中「跑步」）
  let met = EXERCISE_MET_LOW[t];
  if (!met) {
    const hit = Object.keys(EXERCISE_MET_LOW).find((k) => t.includes(k));
    met = hit ? EXERCISE_MET_LOW[hit] : EXERCISE_MET_DEFAULT;
  }
  const h = Math.max(0, durationMin) / 60;
  return Math.round(met * h * Math.max(1, weightKg));
};

// 用 AI 估算一段运动描述消耗多少千卡（返回整数 kcal，保守下限）。
// 失败时回退到离线保守值，保证「总能估出来」且偏保守（用户常无法写清全部动作）。
export const estimateExerciseKcal = async (desc: string): Promise<number | null> => {
  const p = (await getBodyProfile()) || DEFAULT_BODY_PROFILE;
  const durMatch = desc.match(/(\d+)\s*分钟/);
  const dur = durMatch ? parseInt(durMatch[1], 10) : 30;
  // 先算一份保守离线值，作为兜底与下限
  const offline = estimateExerciseKcalOffline(desc, dur, p.weight);
  const apiKey = await getApiKey();
  if (!apiKey) return offline; // 无 key 直接给保守离线值
  const prompt = `请保守估计、尽量往低了估以下运动的能量消耗（千卡）。只返回一个整数（千卡），不要任何其它文字：\n${desc}`;
  try {
    const msg: ChatMessage = { id: 'ex', role: 'user', content: prompt, ts: Date.now() };
    const text = await sendChat([msg], undefined, '运动消耗');
    const m = text.match(/\d+/);
    if (m) {
      const ai = parseInt(m[0], 10);
      // 取 AI 与离线保守值的较小值，确保消耗不虚高（描述不全时 AI 易偏高）
      return Math.min(ai, offline > 0 ? offline : ai);
    }
    return offline;
  } catch (e) {
    console.error('[activity] estimateExerciseKcal failed', e);
    return offline;
  }
};

export const saveExerciseRecord = async (
  date: string,
  activity: DailyActivity,
  rec: ExerciseRecord,
): Promise<DailyActivity> => {
  const next: DailyActivity = { ...activity, exercises: [...activity.exercises, rec] };
  const { setDailyActivity } = await import('./storage');
  await setDailyActivity(date, next);
  return next;
};
