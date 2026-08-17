import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { MealEntry, MealType, NutritionResult } from '../types';
import {
  getMeals,
  getAllNutrition,
  estimateMissingMeals,
  requestMealAdjustmentAdvice,
  deleteMealEntry,
  PROTEIN_TARGET,
  CALORIE_TARGET,
  NUTRITION_TARGETS,
  MealContext,
} from '../utils/nutrition';
import { getApiKey, getBodyProfile } from '../utils/storage';
import { calcDayEnergy } from '../utils/activity';
import { getModelConfigs, ModelConfig } from '../utils/modelConfig';
import { onDataReset, emitDataReset } from '../utils/appEvents';
import NutritionDetail from './NutritionDetail';
import SwipeableRow from './SwipeableRow';
import MealEditSheet from './MealEditSheet';

type Range = 'day' | 'week' | 'month';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_LABEL: Record<MealType, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const ADEQUACY_COLOR: Record<string, string> = { 不足: '#F59E0B', 适量: '#22C55E', 过量: '#EF4444' };

// 为「一次性补算好几天」准备每一天的身体/运动上下文（BMR、当天运动消耗、当天 TDEE）。
// 逐天算，避免把某一天的运动情况套到所有日期上，导致 adequacy 判断失真。
const buildMealContextByDates = async (dates: string[]): Promise<Record<string, MealContext> | undefined> => {
  try {
    const p = await getBodyProfile();
    const out: Record<string, MealContext> = {};
    for (const date of dates) {
      const energy = await calcDayEnergy(date);
      out[date] = {
        bmr: energy.bmr,
        weight: p?.weight ?? 0,
        tdee: energy.tdee,
        exerciseKcal: energy.exerciseKcal,
        baseLevel: energy.baseLevel,
      };
    }
    return out;
  } catch {
    return undefined;
  }
};

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const getStartOfWeek = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

// 生成区间内所有日期字符串（含未记录的日子，用于趋势图横轴）
const datesInRange = (range: Range, base: Date): string[] => {
  const out: string[] = [];
  if (range === 'day') {
    out.push(toDateStr(base));
  } else if (range === 'week') {
    const ws = getStartOfWeek(base);
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      out.push(toDateStr(d));
    }
  } else {
    const year = base.getFullYear();
    const month = base.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= days; i++) out.push(`${year}-${pad(month + 1)}-${pad(i)}`);
  }
  return out;
};

// 保留完整 MealEntry（含各餐的 nutrition），明细区才能按「每一餐」展示营养
const buildMealsByDate = (meals: MealEntry[]): { [date: string]: MealEntry[] } => {
  const map: { [date: string]: MealEntry[] } = {};
  meals.forEach((m) => {
    (map[m.date] ||= []).push(m);
  });
  return map;
};

const r = (v?: number) => Math.round(v || 0);

const formatDayLabel = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// ============ 趋势柱状图 ============
interface BarItem {
  label: string;
  value: number;
}
const MiniBarChart: React.FC<{
  data: BarItem[];
  target: number;
  unit: string;
  kind: 'protein' | 'calorie';
}> = ({ data, target, unit, kind }) => {
  const max = Math.max(target, ...data.map((d) => d.value), 1);
  const colorFor = (v: number) =>
    kind === 'calorie' ? (v <= target ? '#22C55E' : '#EF4444') : v >= target ? '#22C55E' : '#F59E0B';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.barRow}>
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * 110, 2);
          return (
            <View key={i} style={styles.barCol}>
              <Text style={styles.barValue}>{Math.round(d.value)}</Text>
              <View style={[styles.bar, { height: h, backgroundColor: colorFor(d.value) }]} />
              <Text style={styles.barLabel}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
};

// ============ 单项指标卡 ============
const MetricRow: React.FC<{
  label: string;
  value: number;
  unit: string;
  target: number;
  ok: boolean;
  kind: 'protein' | 'calorie';
}> = ({ label, value, unit, target, ok, kind }) => {
  const pct = Math.min(value / target, 1) * 100;
  const barColor = kind === 'calorie' ? (ok ? '#22C55E' : '#EF4444') : ok ? '#22C55E' : '#F59E0B';
  const chipBg = ok ? '#DCFCE7' : kind === 'calorie' ? '#FEE2E2' : '#FEF3C7';
  const chipText = ok ? '#15803D' : kind === 'calorie' ? '#DC2626' : '#B45309';
  const verdict = ok ? (kind === 'calorie' ? '正常' : '达标') : kind === 'calorie' ? '超标' : '不足';
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>
          {Math.round(value)}
          <Text style={styles.metricUnit}> {unit}</Text>
        </Text>
      </View>
      <View style={styles.metricBarTrack}>
        <View style={[styles.metricBar, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <View style={styles.metricFoot}>
        <Text style={styles.metricTarget}>
          目标 {target}
          {unit}/天
        </Text>
        <View style={[styles.metricChip, { backgroundColor: chipBg }]}>
          <Text style={[styles.metricChipText, { color: chipText }]}>{verdict}</Text>
        </View>
      </View>
    </View>
  );
};

const MealStatsPanel: React.FC = () => {
  const [range, setRange] = useState<Range>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [cache, setCache] = useState<{ [date: string]: NutritionResult }>({});
  const [allMeals, setAllMeals] = useState<MealEntry[]>([]);
  const [estimating, setEstimating] = useState(false);
  const [estProgress, setEstProgress] = useState('');
  // AI 生成的「今日/区间饮食调整方案」
  const [advice, setAdvice] = useState('');
  const [advising, setAdvising] = useState(false);
  // 明细区里哪些餐展开了「逐样食物」表格
  const [openMeals, setOpenMeals] = useState<Record<string, boolean>>({});

  const toggleMeal = (id: string) => setOpenMeals((s) => ({ ...s, [id]: !s[id] }));

  // 估算可选模型（统计中心一键估算也支持指定模型）
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selModelId, setSelModelId] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const selCfg: ModelConfig | undefined = selModelId ? models.find((m) => m.id === selModelId) || undefined : undefined;

  // 单条餐记录编辑 / 删除（像消费一样可改记录）
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetEntry, setSheetEntry] = useState<MealEntry | null>(null);

  const openEdit = (m: MealEntry) => {
    setSheetEntry(m);
    setSheetVisible(true);
  };
  const openAdd = () => {
    setSheetEntry(null);
    setSheetVisible(true);
  };
  const handleDelete = (m: MealEntry) => {
    Alert.alert('删除记录', '确定删除这条三餐记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteMealEntry(m.id);
          await load();
          emitDataReset();
        },
      },
    ]);
  };

  const load = useCallback(async () => {
    const [m, c, md] = await Promise.all([getMeals(), getAllNutrition(), getModelConfigs()]);
    setAllMeals(m);
    setCache(c);
    setModels(md);
  }, []);

  useEffect(() => {
    load();
    const off = onDataReset(() => load());
    return off;
  }, [load]);

  // 每次进入「统计中心 / 三餐」标签都重新拉取，避免多 Tab 间数据不同步（首页改完看不到）
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onAiAdvice = async () => {
    if (withData.length === 0) return;
    const key = await getApiKey();
    if (!key) {
      Alert.alert('未设置 API Key', '请先到「我的 → AI 智能分析」填写 GLM Key 后再生成');
      return;
    }
    setAdvising(true);
    const mealsSummary = withData
      .map((s) => {
        const ms = (mealsByDate[s.date] || [])
          .map((m) => `${MEAL_LABEL[m.type]}：${m.content}`)
          .join('；');
        return `${s.date}：${ms}（蛋白${Math.round(s.nutrition!.protein)}g / 热量${Math.round(
          s.nutrition!.calories,
        )}kcal）`;
      })
      .join('\n');
    const currentText = `蛋白质日均 ${Math.round(avgProtein)}g / 热量日均 ${Math.round(
      avgCalories,
    )}kcal（目标 ${PROTEIN_TARGET}g / ${CALORIE_TARGET}kcal）`;
    const { text, status } = await requestMealAdjustmentAdvice(mealsSummary, currentText);
    setAdvising(false);
    if (status === 'ok' && text) setAdvice(text);
    else Alert.alert('生成失败', '请检查网络或 API Key 后重试');
  };

  const mealsByDate = useMemo(() => buildMealsByDate(allMeals), [allMeals]);
  const mealDateSet = useMemo(() => new Set(Object.keys(mealsByDate)), [mealsByDate]);

  const series = useMemo(() => {
    const dates = datesInRange(range, currentDate);
    return dates.map((date) => ({
      date,
      nutrition: cache[date] || null,
      hasMeal: mealDateSet.has(date),
    }));
  }, [range, currentDate, cache, mealDateSet]);

  const withData = useMemo(() => series.filter((s) => s.nutrition), [series]);
  const daysEstimated = withData.length;
  const daysWithMeals = series.filter((s) => s.hasMeal).length;

  const avgProtein = daysEstimated > 0 ? withData.reduce((s, x) => s + x.nutrition!.protein, 0) / daysEstimated : 0;
  const avgCalories = daysEstimated > 0 ? withData.reduce((s, x) => s + x.nutrition!.calories, 0) / daysEstimated : 0;
  const avgFat = daysEstimated > 0 ? withData.reduce((s, x) => s + (x.nutrition!.fat || 0), 0) / daysEstimated : 0;
  const avgCarbs = daysEstimated > 0 ? withData.reduce((s, x) => s + (x.nutrition!.carbs || 0), 0) / daysEstimated : 0;
  const avgFiber = daysEstimated > 0 ? withData.reduce((s, x) => s + (x.nutrition!.fiber || 0), 0) / daysEstimated : 0;
  const avgWater = daysEstimated > 0 ? withData.reduce((s, x) => s + (x.nutrition!.water || 0), 0) / daysEstimated : 0;
  const totalProtein = withData.reduce((s, x) => s + x.nutrition!.protein, 0);
  const totalCalories = withData.reduce((s, x) => s + x.nutrition!.calories, 0);

  const proteinOk = avgProtein >= PROTEIN_TARGET;
  const calorieOk = avgCalories <= CALORIE_TARGET;
  const fiberOk = avgFiber >= NUTRITION_TARGETS.fiber;
  const waterOk = avgWater >= NUTRITION_TARGETS.water;
  const fatOk = avgFat <= NUTRITION_TARGETS.fat;

  // 还有哪些餐没估算营养（供一键补全）
  const mealsWithoutNutrition = useMemo(
    () => allMeals.filter((m) => m.content && m.content.trim() && !m.nutrition),
    [allMeals],
  );

  // 规则化「不足/超标」说明与补充方案（无需联网，始终可见）
  const adviceItems = useMemo(() => {
    const tips: { icon: string; title: string; text: string; tone: 'warn' | 'danger' }[] = [];
    if (!proteinOk) {
      const gap = Math.max(0, Math.round(PROTEIN_TARGET - avgProtein));
      tips.push({
        icon: 'flash-outline',
        tone: 'warn',
        title: `蛋白质还差 ${gap}g 才达标`,
        text:
          `当前 ${Math.round(avgProtein)}g / 目标 ${PROTEIN_TARGET}g。补够约 ${gap}g 的搭配（任选其一）：\n` +
          `· 2 个鸡蛋(约12g) + 1 杯牛奶(约8g)\n` +
          `· 50g 鸡胸肉(约15g) + 1 份豆腐(约8g)\n` +
          `· 1 份无糖希腊酸奶(约10g) + 一把毛豆(约13g)\n` +
          `其他高蛋白：瘦牛肉26g/100g、三文鱼20g/100g、虾18g/100g、坚果21g/100g。`,
      });
    }
    if (!calorieOk) {
      if (avgCalories > CALORIE_TARGET) {
        const over = Math.round(avgCalories - CALORIE_TARGET);
        tips.push({
          icon: 'flame-outline',
          tone: 'danger',
          title: `热量超出 ${over}kcal`,
          text:
            `当前 ${Math.round(avgCalories)}kcal / 目标 ${CALORIE_TARGET}kcal。建议：少油炸/甜点/含糖饮料；` +
            `晚餐主食减半(约少150kcal)；用清汤蔬菜替代部分主食。`,
        });
      } else {
        const under = Math.round(CALORIE_TARGET - avgCalories);
        tips.push({
          icon: 'restaurant-outline',
          tone: 'warn',
          title: `热量偏低 ${under}kcal`,
          text:
            `当前 ${Math.round(avgCalories)}kcal / 目标 ${CALORIE_TARGET}kcal。建议加份健康加餐：` +
            `1 根香蕉 + 一小把坚果，或 1 片全麦面包 + 花生酱。`,
        });
      }
    }
    if (!fiberOk) {
      const gap = Math.max(0, Math.round(NUTRITION_TARGETS.fiber - avgFiber));
      tips.push({
        icon: 'leaf-outline',
        tone: 'warn',
        title: `膳食纤维还差 ${gap}g`,
        text:
          `当前 ${Math.round(avgFiber)}g / 目标 ${NUTRITION_TARGETS.fiber}g。蔬菜/水果/粗粮偏少：\n` +
          `· 午餐晚餐各加一份青菜(约补5-8g)\n` + `· 用燕麦/红薯/玉米替代部分白米饭\n` + `· 加餐吃个苹果或一小把坚果。`,
      });
    }
    if (!waterOk) {
      const gap = Math.max(0, Math.round(NUTRITION_TARGETS.water - avgWater));
      tips.push({
        icon: 'water-outline',
        tone: 'warn',
        title: `饮水还差 ${gap}ml`,
        text:
          `当前 ${Math.round(avgWater)}ml / 目标 ${NUTRITION_TARGETS.water}ml。建议少量多次喝水：` +
          `每次 200ml，分多次喝完；运动或天热时再加量。`,
      });
    }
    if (!fatOk) {
      const over = Math.round(avgFat - NUTRITION_TARGETS.fat);
      tips.push({
        icon: 'fast-food-outline',
        tone: 'danger',
        title: `脂肪偏高 ${over}g`,
        text:
          `当前 ${Math.round(avgFat)}g / 目标 ${NUTRITION_TARGETS.fat}g。建议：少油炸/肥肉/黄油；` +
          `烹饪用橄榄油替代动物油；坚果适量(一小把即可)。`,
      });
    }
    return tips;
  }, [proteinOk, avgProtein, calorieOk, avgCalories, fiberOk, avgFiber, waterOk, avgWater, fatOk, avgFat]);

  // 趋势数据（仅含已估算日期）
  const proteinBars: BarItem[] = withData.map((s) => ({ label: formatDayLabel(s.date), value: s.nutrition!.protein }));
  const calorieBars: BarItem[] = withData.map((s) => ({ label: formatDayLabel(s.date), value: s.nutrition!.calories }));

  const rangeLabelMap: { value: Range; label: string }[] = [
    { value: 'day', label: '日' },
    { value: 'week', label: '周' },
    { value: 'month', label: '月' },
  ];

  const periodLabel = (): string => {
    if (range === 'day') {
      const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
      return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_LABELS[d.getDay()]}`;
    }
    if (range === 'week') {
      const ws = getStartOfWeek(currentDate);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      return `${ws.getMonth() + 1}月${ws.getDate()}日 - ${we.getMonth() + 1}月${we.getDate()}日`;
    }
    return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
  };

  const navigatePeriod = (direction: 'prev' | 'next') => {
    const d = new Date(currentDate);
    if (range === 'day') d.setDate(d.getDate() + (direction === 'prev' ? -1 : 1));
    else if (range === 'week') d.setDate(d.getDate() + (direction === 'prev' ? -7 : 7));
    else d.setMonth(d.getMonth() + (direction === 'prev' ? -1 : 1));
    setCurrentDate(d);
  };

  const onEstimateMissing = async () => {
    if (mealsWithoutNutrition.length === 0) return;
    const key = await getApiKey();
    if (!key) {
      Alert.alert('未设置 API Key', '请先到「我的 → AI 智能分析」填写 GLM Key 后再估算');
      return;
    }
    setEstimating(true);
    setEstProgress(`估算中 0/${mealsWithoutNutrition.length}`);
    // 补记往期常常横跨好几天：给每一天各自的运动/TDEE 上下文，
    // 让 AI 按「那一天」的消耗判断这餐是否合适，而不是全部套今天的数据。
    const ctxByDate = await buildMealContextByDates(
      Array.from(new Set(mealsWithoutNutrition.map((m) => m.date))),
    );
    await estimateMissingMeals(
      allMeals,
      (done, total) => setEstProgress(`估算中 ${done}/${total}`),
      ctxByDate,
      selCfg,
    );
    setEstimating(false);
    setEstProgress('');
    await load();
  };

  // 记录明细：区间内「有餐记录」的日子
  const detailDays = useMemo(
    () =>
      series
        .filter((s) => s.hasMeal)
        .map((s) => ({ date: s.date, meals: mealsByDate[s.date], nutrition: s.nutrition }))
        .reverse(),
    [series, mealsByDate],
  );

  const hasData = daysEstimated > 0;

  return (
    <View style={styles.container}>
      <View style={styles.controlBar}>
        <View style={styles.rangeButtons}>
          {rangeLabelMap.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[styles.rangeBtn, range === r.value && styles.rangeBtnActive]}
              onPress={() => setRange(r.value)}
            >
              <Text style={[styles.rangeBtnText, range === r.value && styles.rangeBtnTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.periodNavRow}>
          <TouchableOpacity style={styles.periodNavBtn} onPress={() => navigatePeriod('prev')}>
            <Ionicons name="chevron-back-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.periodNavLabel}>{periodLabel()}</Text>
          <TouchableOpacity style={styles.periodNavBtn} onPress={() => navigatePeriod('next')}>
            <Ionicons name="chevron-forward-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.todayBtn} onPress={() => setCurrentDate(new Date())}>
          <Text style={styles.todayBtnText}>回到今天</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 概览：蛋白质 / 热量 达标与超标 */}
        <View style={styles.overviewCard}>
          {hasData ? (
            <>
              <MetricRow label="蛋白质" value={avgProtein} unit="g" target={PROTEIN_TARGET} ok={proteinOk} kind="protein" />
              <View style={styles.metricDivider} />
              <MetricRow
                label="热量"
                value={avgCalories}
                unit="kcal"
                target={CALORIE_TARGET}
                ok={calorieOk}
                kind="calorie"
              />
            </>
          ) : (
            <View style={styles.overviewEmpty}>
              <Ionicons name="restaurant-outline" size={26} color={COLORS.textLight} />
              <Text style={styles.overviewEmptyText}>
                {daysWithMeals > 0
                  ? '这些天有三餐记录，但还没估算营养，点下方按钮一键估算'
                  : '这个区间还没有三餐记录'}
              </Text>
            </View>
          )}
        </View>

        {/* 结论摘要 */}
        {hasData && (
          <View style={[styles.summaryBox, { backgroundColor: proteinOk && calorieOk ? '#F0FDF4' : '#FEF2F2' }]}>
            <Ionicons
              name={proteinOk && calorieOk ? 'checkmark-circle-outline' : 'information-circle-outline'}
              size={16}
              color={proteinOk && calorieOk ? '#15803D' : '#DC2626'}
            />
            <Text style={styles.summaryText}>
              {range === 'day' ? '今日' : range === 'week' ? `本周已估算 ${daysEstimated} 天，日均` : `本月已估算 ${daysEstimated} 天，日均`}
              ：蛋白质 {Math.round(avgProtein)}g（
              {proteinOk
                ? '已达标'
                : `不足，还差 ${Math.max(0, Math.round(PROTEIN_TARGET - avgProtein))}g`}
              ），热量 {Math.round(avgCalories)}kcal（
              {calorieOk
                ? '正常'
                : avgCalories > CALORIE_TARGET
                ? `超标 ${Math.round(avgCalories - CALORIE_TARGET)}kcal`
                : `偏低 ${Math.round(CALORIE_TARGET - avgCalories)}kcal`}
              ）。
              {range !== 'day' && ` 区间合计 蛋白质 ${Math.round(totalProtein)}g / 热量 ${Math.round(totalCalories)}kcal。`}
            </Text>
          </View>
        )}

        {/* 调整建议：不足/超标的具体说明 + 补充方案 + AI 定制 */}
        {hasData && (
          <View style={styles.adviceCard}>
            <View style={styles.adviceHead}>
              <Ionicons name="bulb-outline" size={16} color="#B45309" />
              <Text style={styles.adviceHeadText}>调整建议</Text>
            </View>
            {adviceItems.length > 0 ? (
              adviceItems.map((tip, i) => (
                <View key={i} style={styles.adviceItem}>
                  <Ionicons
                    name={tip.icon as any}
                    size={16}
                    color={ADEQUACY_COLOR[tip.tone === 'danger' ? '过量' : '不足']}
                  />
                  <View style={styles.adviceItemBody}>
                    <Text style={styles.adviceTitle}>{tip.title}</Text>
                    <Text style={styles.adviceText}>{tip.text}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.adviceOkText}>营养摄入达标，保持当前节奏即可 💪</Text>
            )}

            <TouchableOpacity
              style={[styles.aiAdviceBtn, advising && styles.aiAdviceBtnDisabled]}
              onPress={onAiAdvice}
              disabled={advising}
            >
              {advising ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sparkles-outline" size={15} color="#fff" />
              )}
              <Text style={styles.aiAdviceText}>
                {advising ? '生成中…' : advice ? '重新生成 AI 调整方案' : 'AI 帮我定制今日调整方案'}
              </Text>
            </TouchableOpacity>

            {advice ? (
              <View style={styles.aiAdviceBox}>
                <Text style={styles.aiAdviceBoxText}>{advice}</Text>
              </View>
            ) : null}
          </View>
        )}

        {/* 估算模型选择（统计中心一键估算也支持指定模型） */}
        <View style={styles.modelPickWrap}>
          <TouchableOpacity style={styles.modelPickRow} onPress={() => setShowModelPicker((v) => !v)}>
            <Ionicons name="swap-horizontal-outline" size={14} color={COLORS.primary} />
            <Text style={styles.modelPickText}>
              估算模型：{selCfg ? selCfg.name : '默认（' + (models.find((m) => m.isDefault)?.name || '未配置') + '）'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={COLORS.textLight} />
          </TouchableOpacity>
          {showModelPicker && (
            <View style={styles.modelPickBox}>
              <TouchableOpacity
                style={[styles.modelPickItem, !selModelId && styles.modelPickItemActive]}
                onPress={() => { setSelModelId(''); setShowModelPicker(false); }}
              >
                <Text style={styles.modelPickItemText}>默认（{models.find((m) => m.isDefault)?.name || '未配置'}）</Text>
              </TouchableOpacity>
              {models.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.modelPickItem, selModelId === m.id && styles.modelPickItemActive]}
                  onPress={() => { setSelModelId(m.id); setShowModelPicker(false); }}
                >
                  <Text style={styles.modelPickItemText}>
                    {m.name}{m.isVision ? ' · 视觉' : ''}{m.webSearch ? ' · 搜索' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* 一键补全缺失日期估算 */}
        {mealsWithoutNutrition.length > 0 && (
          <TouchableOpacity
            style={[styles.estimateBtn, estimating && styles.estimateBtnDisabled]}
            onPress={onEstimateMissing}
            disabled={estimating}
          >
            {estimating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="sparkles-outline" size={16} color="#fff" />
            )}
            <Text style={styles.estimateBtnText}>
              {estimating ? estProgress : `AI 估算缺失的 ${mealsWithoutNutrition.length} 餐`}
            </Text>
          </TouchableOpacity>
        )}

        {/* 每日蛋白质趋势 */}
        {hasData && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>每日蛋白质 (g) · 目标 {PROTEIN_TARGET}g/天</Text>
            <View style={styles.chartCard}>
              <MiniBarChart data={proteinBars} target={PROTEIN_TARGET} unit="g" kind="protein" />
            </View>
          </View>
        )}

        {/* 每日热量趋势 */}
        {hasData && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>每日热量 (kcal) · 目标 {CALORIE_TARGET}kcal/天</Text>
            <View style={styles.chartCard}>
              <MiniBarChart data={calorieBars} target={CALORIE_TARGET} unit="kcal" kind="calorie" />
            </View>
          </View>
        )}

        {/* 三餐记录明细 */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>三餐记录明细</Text>
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Ionicons name="add" size={15} color="#22C55E" />
              <Text style={styles.addBtnText}>记一餐</Text>
            </TouchableOpacity>
          </View>
          {detailDays.length > 0 ? (
            detailDays.map((d) => {
              const date = new Date(d.date + 'T00:00:00');
              return (
                <View key={d.date} style={styles.mealDayCard}>
                  <View style={styles.mealDayHead}>
                    <Text style={styles.mealDayDate}>
                      {date.getMonth() + 1}月{date.getDate()}日 周{WEEK_LABELS[date.getDay()]}
                    </Text>
                    {d.nutrition && (
                      <View style={[styles.mealDayChip, { backgroundColor: ADEQUACY_COLOR[d.nutrition.adequacy] || '#22C55E' }]}>
                        <Text style={styles.mealDayChipText}>
                          {Math.round(d.nutrition.protein)}g · {Math.round(d.nutrition.calories)}kcal
                        </Text>
                      </View>
                    )}
                  </View>
                  {MEAL_ORDER.map((tp) => {
                    const ms = d.meals.filter((x) => x.type === tp);
                    if (ms.length === 0) return null;
                    return (
                      <View key={tp}>
                        {ms.map((m) => (
                          <SwipeableRow key={m.id} onDelete={() => handleDelete(m)}>
                            <TouchableOpacity
                              style={styles.mealEntryBlock}
                              onPress={() => openEdit(m)}
                              activeOpacity={0.7}
                            >
                              <View style={styles.mealDayLine}>
                                <Text style={styles.mealDayLineLabel}>{MEAL_LABEL[tp]}：</Text>
                                <Text style={styles.mealDayLineContent}>{m.content}</Text>
                              </View>
                              {m.nutrition ? (
                                <>
                                  <TouchableOpacity
                                    style={styles.mealNutriRow}
                                    onPress={() => toggleMeal(m.id)}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={styles.mealNutriText}>
                                      蛋白 {r(m.nutrition.protein)}g · 热量 {r(m.nutrition.calories)}kcal · 脂肪{' '}
                                      {r(m.nutrition.fat)}g · 碳水 {r(m.nutrition.carbs)}g · 纤维{' '}
                                      {r(m.nutrition.fiber)}g
                                    </Text>
                                    <Ionicons
                                      name={openMeals[m.id] ? 'chevron-up' : 'chevron-down'}
                                      size={14}
                                      color="#8B5CF6"
                                    />
                                  </TouchableOpacity>
                                  {openMeals[m.id] && (
                                    <NutritionDetail nutrition={m.nutrition} showTotal={false} />
                                  )}
                                </>
                              ) : (
                                <Text style={styles.mealNoNutri}>这餐还没估算营养</Text>
                              )}
                            </TouchableOpacity>
                          </SwipeableRow>
                        ))}
                      </View>
                    );
                  })}
                </View>
              );
            })
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="restaurant-outline" size={26} color={COLORS.textLight} />
              <Text style={styles.emptyHint}>这个区间还没有三餐记录</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <MealEditSheet
        visible={sheetVisible}
        entry={sheetEntry}
        onClose={() => setSheetVisible(false)}
        onSaved={() => {
          load();
          emitDataReset();
        }}
      />
    </View>
  );
};

const cardShadow = {
  shadowColor: COLORS.shadow,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  controlBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: COLORS.background,
  },
  rangeButtons: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.card,
    padding: 4,
    borderRadius: 20,
    ...cardShadow,
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    alignItems: 'center',
  },
  rangeBtnActive: {
    backgroundColor: '#22C55E',
  },
  rangeBtnText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  rangeBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  periodNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginTop: 10,
  },
  periodNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodNavLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  todayBtn: {
    alignSelf: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.secondary,
  },
  todayBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  overviewCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    ...cardShadow,
  },
  overviewEmpty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  overviewEmptyText: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
  },
  metric: {},
  metricDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 14,
  },
  metricTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  metricLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  metricUnit: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  metricBarTrack: {
    height: 10,
    backgroundColor: COLORS.background,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 8,
  },
  metricBar: {
    height: '100%',
    borderRadius: 5,
  },
  metricFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  metricTarget: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  metricChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  metricChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  summaryBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  summaryText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 20,
  },
  adviceCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  adviceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  adviceHeadText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B45309',
  },
  adviceItem: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  adviceItemBody: {
    flex: 1,
  },
  adviceTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 3,
  },
  adviceText: {
    fontSize: 12.5,
    color: '#78350F',
    lineHeight: 19,
  },
  adviceOkText: {
    fontSize: 13,
    color: '#15803D',
    fontWeight: '600',
  },
  aiAdviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
  },
  aiAdviceBtnDisabled: {
    opacity: 0.7,
  },
  aiAdviceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  aiAdviceBox: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  aiAdviceBoxText: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 20,
  },
  estimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
  },
  estimateBtnDisabled: {
    opacity: 0.7,
  },
  estimateBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modelPickWrap: {
    marginTop: 12,
    marginHorizontal: 16,
  },
  modelPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
    borderWidth: 0.5,
    borderColor: '#C7D2FE',
  },
  modelPickText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  modelPickBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  modelPickItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: COLORS.card,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  modelPickItemActive: { backgroundColor: '#EDE9FE', borderColor: COLORS.primary },
  modelPickItemText: { fontSize: 13.5, color: COLORS.text },
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#DCFCE7',
    borderWidth: 0.5,
    borderColor: '#86EFAC',
    marginBottom: 12,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#16A34A',
  },
  chartCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    ...cardShadow,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 4,
    minWidth: '100%',
  },
  barCol: {
    alignItems: 'center',
    width: 28,
  },
  barValue: {
    fontSize: 9,
    color: COLORS.textLight,
    marginBottom: 2,
  },
  bar: {
    width: 18,
    borderRadius: 4,
  },
  barLabel: {
    fontSize: 9,
    color: COLORS.textLight,
    marginTop: 2,
  },
  mealDayCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    ...cardShadow,
  },
  mealDayHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  mealDayDate: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  mealDayChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  mealDayChipText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  mealEntryBlock: {
    backgroundColor: COLORS.card,
    marginBottom: 0,
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  mealDayLine: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  mealNutriRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  mealNutriText: {
    flex: 1,
    fontSize: 11.5,
    color: COLORS.textLight,
    lineHeight: 17,
  },
  mealNoNutri: {
    fontSize: 11.5,
    color: COLORS.textLighter,
  },
  mealDayLineLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#15803D',
  },
  mealDayLineContent: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 19,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 30,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    gap: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 20,
  },
});

export default MealStatsPanel;
