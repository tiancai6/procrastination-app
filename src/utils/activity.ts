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

// 用 AI 估算一段运动描述消耗多少千卡（返回整数 kcal 或 null）
export const estimateExerciseKcal = async (desc: string): Promise<number | null> => {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  const prompt = `估算以下运动的大致能量消耗（千卡）。只返回一个整数（千卡），不要任何其它文字：\n${desc}`;
  try {
    const msg: ChatMessage = { id: 'ex', role: 'user', content: prompt, ts: Date.now() };
    const text = await sendChat([msg], undefined);
    const m = text.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  } catch (e) {
    console.error('[activity] estimateExerciseKcal failed', e);
    return null;
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
