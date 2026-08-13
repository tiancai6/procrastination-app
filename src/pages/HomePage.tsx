import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, TouchableWithoutFeedback, Keyboard, KeyboardAvoidingView, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import TimerCard from '../components/TimerCard';
import StatCard from '../components/StatCard';
import LedgerQuickSheet from '../components/LedgerQuickSheet';
import MealQuickSheet from '../components/MealQuickSheet';
import { useSessionStore } from '../store/sessionStore';
import { useLedgerStore } from '../store/ledgerStore';
import { onDataReset, emitDataReset } from '../utils/appEvents';
import { getTodayExpense, getTodayIncome, getMonthExpense, formatMoney } from '../utils/ledger';
import { getMealsByDate, getNutritionForDate, estimateDayMeals, NUTRITION_TARGETS } from '../utils/nutrition';
import { pickBodyImage, ocrBodyComposition } from '../utils/bodyOcr';
import {
  getApiKey,
  getBodyProfile,
  setBodyProfile,
  getDailyActivity,
  setDailyActivity,
  generateId,
  ExerciseRecord,
} from '../utils/storage';
import {
  calcDayEnergy,
  BASE_LEVEL_LABEL,
  getExerciseTypes,
  addExerciseType,
  removeExerciseType,
  DEFAULT_EXERCISE_TYPES,
  estimateExerciseKcal,
  saveExerciseRecord,
  DEFAULT_BODY_PROFILE,
  DayEnergy,
  DailyActivity,
  BodyProfile,
} from '../utils/activity';
import TrendPage from './TrendPage';
import ModelConfigPage from './ModelConfigPage';
import { LedgerEntry, MealEntry, MealType, NutritionResult } from '../types';

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_META: Record<MealType, { label: string; icon: string }> = {
  breakfast: { label: '早餐', icon: 'sunny-outline' },
  lunch: { label: '午餐', icon: 'restaurant-outline' },
  dinner: { label: '晚餐', icon: 'moon-outline' },
  snack: { label: '加餐', icon: 'fast-food-outline' },
};
const ADEQUACY_COLOR: Record<string, string> = { 不足: '#F59E0B', 适量: '#22C55E', 过量: '#EF4444' };

const HomePage: React.FC = () => {
  const navigation = useNavigation<any>();
  const { stats, fetchStats, fetchSessions } = useSessionStore();
  const ledgerEntries = useLedgerStore((s) => s.entries);
  const loadLedger = useLedgerStore((s) => s.load);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetEntry, setSheetEntry] = useState<LedgerEntry | null>(null);

  // 三餐记录与营养估算
  const [mealVisible, setMealVisible] = useState(false);
  const [todayMeals, setTodayMeals] = useState<MealEntry[]>([]);
  const [todayNutrition, setTodayNutrition] = useState<NutritionResult | null>(null);
  const [estimating, setEstimating] = useState(false);

  // 今日活动量 & TDEE
  const [dayEnergy, setDayEnergy] = useState<DayEnergy>({ bmr: 0, tdee: 0, baseLevel: 'sedentary', exerciseKcal: 0 });
  const [activity, setActivity] = useState<DailyActivity>({ baseLevel: 'sedentary', exercises: [] });
  const [bodyModal, setBodyModal] = useState(false);
  const [bodyProfile, setBodyProfileLocal] = useState<BodyProfile>(DEFAULT_BODY_PROFILE);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMsg, setOcrMsg] = useState('');
  const [exModal, setExModal] = useState(false);
  const [trendVisible, setTrendVisible] = useState(false);
  const [showModelCfg, setShowModelCfg] = useState(false);
  const [exTypes, setExTypes] = useState<string[]>(DEFAULT_EXERCISE_TYPES);
  const [exType, setExType] = useState('');
  const [exCustom, setExCustom] = useState('');
  const [exTypeManager, setExTypeManager] = useState(false);
  const [newTypeInput, setNewTypeInput] = useState('');
  const [exDuration, setExDuration] = useState('30');
  const [exKcal, setExKcal] = useState('');
  const [estimatingEx, setEstimatingEx] = useState(false);

  const loadMeals = async () => {
    const t = toDateStr(new Date());
    const list = await getMealsByDate(t);
    setTodayMeals(list);
    setTodayNutrition(await getNutritionForDate(t));
  };

  const loadActivity = async () => {
    const t = toDateStr(new Date());
    setDayEnergy(await calcDayEnergy(t));
    setActivity(await getDailyActivity(t));
    const types = await getExerciseTypes();
    setExTypes(types);
    if (!exType || !types.includes(exType)) setExType(types[0]);
  };

  useEffect(() => {
    fetchSessions();
    fetchStats();
    loadLedger();
    loadMeals();
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 清除全部数据 / 导入备份后，重新拉取花销与统计，保证首页同步
  useEffect(() => {
    const off = onDataReset(() => {
      fetchSessions();
      fetchStats();
      loadLedger();
      loadMeals();
      loadActivity();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEstimateMeal = async () => {
    if (todayMeals.length === 0) {
      Alert.alert('还没有记录', '请先点「记录三餐」填写今天吃了什么');
      return;
    }
    const hasKey = await getApiKey();
    if (!hasKey) {
      Alert.alert('未设置 API Key', '请先到「我的」页面填写 GLM Key');
      return;
    }
    setEstimating(true);
    await estimateDayMeals(todayMeals);
    setEstimating(false);
    await loadMeals();
    emitDataReset(); // 通知统计中心等已挂载页面立即刷新三餐数据
  };

  // —— 运动量 / TDEE ——
  const setBaseLevel = async (lv: DailyActivity['baseLevel']) => {
    const t = toDateStr(new Date());
    const next: DailyActivity = { ...activity, baseLevel: lv };
    setActivity(next);
    await setDailyActivity(t, next);
    setDayEnergy(await calcDayEnergy(t));
  };

  const openExModal = () => {
    setExType(exTypes[0] || '其他');
    setExDuration('30');
    setExKcal('');
    setExCustom('');
    setExModal(true);
  };

  const estimateEx = async () => {
    const d = parseInt(exDuration, 10);
    if (!d || d <= 0) {
      Alert.alert('请填写时长');
      return;
    }
    setEstimatingEx(true);
    try {
      const finalType = exType === '其他' ? (exCustom.trim() || '其他') : exType;
      const kcal = await estimateExerciseKcal(`${finalType} ${d}分钟`);
      if (kcal) setExKcal(String(kcal));
      else Alert.alert('估算失败', '请检查网络或手动填写消耗');
    } finally {
      setEstimatingEx(false);
    }
  };

  const confirmEx = async () => {
    const d = parseInt(exDuration, 10);
    if (!d || d <= 0) {
      Alert.alert('请填写时长');
      return;
    }
    const t = toDateStr(new Date());
    const finalType = exType === '其他' ? (exCustom.trim() || '其他') : exType;
    const rec: ExerciseRecord = {
      id: generateId(),
      type: finalType,
      durationMin: d,
      kcal: exKcal ? parseInt(exKcal, 10) : undefined,
    };
    const next = await saveExerciseRecord(t, activity, rec);
    setActivity(next);
    setDayEnergy(await calcDayEnergy(t));
    setExModal(false);
  };

  const openBodyModal = async () => {
    const p = (await getBodyProfile()) || DEFAULT_BODY_PROFILE;
    setBodyProfileLocal(p);
    setBodyModal(true);
  };

  const saveBody = async () => {
    await setBodyProfile(bodyProfile);
    setDayEnergy(await calcDayEnergy(toDateStr(new Date())));
    setBodyModal(false);
  };

  // 体成分报告拍照 / 选图识别（视觉模型 OCR）
  const runOcr = async (useCamera: boolean) => {
    const hasKey = await getApiKey();
    if (!hasKey) { setOcrMsg('未设置 API Key，请先到「我的」页面填模型'); return; }
    setOcrLoading(true);
    setOcrMsg('');
    try {
      const b64 = await pickBodyImage(useCamera);
      if (!b64) { setOcrLoading(false); return; }
      const data = await ocrBodyComposition(b64);
      setBodyProfileLocal((prev) => ({
        ...prev,
        ...(data.bodyFatPct != null ? { bodyFatPct: data.bodyFatPct } : {}),
        ...(data.muscleMass != null ? { muscleMass: data.muscleMass } : {}),
        ...(data.boneMass != null ? { boneMass: data.boneMass } : {}),
        ...(data.waterPct != null ? { waterPct: data.waterPct } : {}),
        ...(data.visceralFat != null ? { visceralFat: data.visceralFat } : {}),
        ...(data.bmr != null ? { bmr: data.bmr } : {}),
        ...(data.bodyAge != null ? { bodyAge: data.bodyAge } : {}),
        ...(data.weight != null ? { weight: data.weight } : {}),
      }));
      setOcrMsg('识别完成，已自动填入，请核对后点保存');
    } catch (e: any) {
      setOcrMsg(e && e.message ? e.message : '识别失败，请检查网络或换张清晰图重试');
    }
    setOcrLoading(false);
  };

  // 体成分可编辑字段（识别后仍可手动修改；decimal-pad + 可清空 + 可退出输入）
  const renderBodyField = (
    label: string,
    value: number | undefined,
    key: keyof BodyProfile,
    unit: string,
  ) => (
    <View>
      <Text style={styles.sheetLabel}>{label}{unit ? ' (' + unit + ')' : ''}</Text>
      <TextInput
        style={styles.inputBox}
        keyboardType="decimal-pad"
        returnKeyType="done"
        blurOnSubmit
        value={value != null ? String(value) : ''}
        onChangeText={(v) => setBodyProfileLocal({ ...bodyProfile, [key]: v === '' ? undefined : parseFloat(v) } as BodyProfile)}
      />
    </View>
  );

  // 今日还缺哪些营养素（规则判定，离线可用）
  const deficitChips = useMemo(() => {
    if (!todayNutrition) return [];
    const t = NUTRITION_TARGETS;
    const list: { label: string; lack: boolean }[] = [
      { label: `蛋白 ${Math.round(todayNutrition.protein)}/${t.protein}g`, lack: todayNutrition.protein < t.protein },
      { label: `热量 ${Math.round(todayNutrition.calories)}/${t.calorie}`, lack: todayNutrition.calories < t.calorie },
      { label: `纤维 ${Math.round(todayNutrition.fiber || 0)}/${t.fiber}g`, lack: (todayNutrition.fiber || 0) < t.fiber },
      { label: `水 ${Math.round(todayNutrition.water || 0)}/${t.water}ml`, lack: (todayNutrition.water || 0) < t.water },
    ];
    return list;
  }, [todayNutrition]);

  const todayExpense = useMemo(() => getTodayExpense(ledgerEntries), [ledgerEntries]);
  const todayIncome = useMemo(() => getTodayIncome(ledgerEntries), [ledgerEntries]);
  const monthExpense = useMemo(() => getMonthExpense(ledgerEntries), [ledgerEntries]);

  // 今日记账明细（按时间倒序）
  const todayEntries = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const next = start.getTime() + 24 * 60 * 60 * 1000;
    return ledgerEntries
      .filter((e) => e.occurredAt >= start.getTime() && e.occurredAt < next)
      .sort((a, b) => b.occurredAt - a.occurredAt);
  }, [ledgerEntries]);

  const openAdd = () => {
    setSheetEntry(null);
    setSheetVisible(true);
  };
  const openEditLedger = (e: LedgerEntry) => {
    setSheetEntry(e);
    setSheetVisible(true);
  };

  const today = new Date();
  const monthDay = `${today.getMonth() + 1}月${today.getDate()}日`;
  const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()];

  return (
    <>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.dateText}>{monthDay} · {weekDay}</Text>
            <Text style={styles.title}>今天，开始专注</Text>
          </View>
          <View style={styles.headerIcon}>
            <Ionicons name="time-outline" size={22} color="#fff" />
          </View>
        </View>
      </View>

      <TimerCard />

      <View style={styles.statsRow}>
        <StatCard
          icon="bar-chart-outline"
          label="本周总计"
          value={stats.weekTotal}
          unit="m"
        />
        <StatCard
          icon="timer-outline"
          label="平均时长"
          value={stats.avgDuration}
          unit="m"
        />
        <StatCard
          icon="document-text-outline"
          label="记录次数"
          value={stats.weekCount}
          unit="次"
        />
      </View>

      <View style={styles.ledgerCard}>
        <View style={styles.ledgerCardHead}>
          <View>
            <Text style={styles.ledgerCardTitle}>今日花销</Text>
            <Text style={styles.ledgerCardAmount}>{formatMoney(todayExpense)}</Text>
          </View>
          <TouchableOpacity style={styles.ledgerAddBtn} onPress={openAdd}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.ledgerAddText}>记一笔</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ledgerCardFoot}>
          <Text style={styles.ledgerFootText}>
            今日收入 <Text style={styles.ledgerFootStrong}>{formatMoney(todayIncome)}</Text>
          </Text>
          <Text style={styles.ledgerFootText}>
            本月支出 <Text style={styles.ledgerFootStrong}>{formatMoney(monthExpense)}</Text>
          </Text>
        </View>

        {/* 今日记账明细 */}
        {todayEntries.length > 0 ? (
          <View style={styles.ledgerDetail}>
            {todayEntries.map((e) => {
              const d = new Date(e.occurredAt);
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              const isExpense = e.type === 'expense';
              return (
                <TouchableOpacity
                  key={e.id}
                  style={styles.ledgerRow}
                  activeOpacity={0.7}
                  onPress={() => openEditLedger(e)}
                >
                  <View style={[styles.ledgerRowIcon, { backgroundColor: isExpense ? '#FEE2E2' : '#DCFCE7' }]}>
                    <Ionicons
                      name={isExpense ? 'arrow-up-outline' : 'arrow-down-outline'}
                      size={15}
                      color={isExpense ? '#EF4444' : '#22C55E'}
                    />
                  </View>
                  <View style={styles.ledgerRowMiddle}>
                    <Text style={styles.ledgerRowCat}>{e.category}</Text>
                    {e.note ? <Text style={styles.ledgerRowNote}>{e.note}</Text> : null}
                  </View>
                  <View style={styles.ledgerRowRight}>
                    <Text style={[styles.ledgerRowAmount, { color: isExpense ? '#EF4444' : '#22C55E' }]}>
                      {isExpense ? '-' : '+'}
                      {formatMoney(e.amount)}
                    </Text>
                    <Text style={styles.ledgerRowTime}>
                      {hh}:{mm}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.ledgerEmptyWrap}>
            <Ionicons name="receipt-outline" size={18} color={COLORS.textLighter} />
            <Text style={styles.ledgerEmpty}>今天还没有记账，点「记一笔」添加</Text>
          </View>
        )}
      </View>

      <LedgerQuickSheet
        visible={sheetVisible}
        entry={sheetEntry}
        onClose={() => {
          setSheetEntry(null);
          setSheetVisible(false);
        }}
        onSaved={() => loadLedger()}
      />

      {/* 每日三餐 + AI 营养估算 */}
      <View style={styles.mealCard}>
        <View style={styles.mealCardHead}>
          <View>
            <Text style={styles.mealCardTitle}>每日三餐</Text>
            <Text style={styles.mealCardSub}>
              {todayMeals.length > 0 ? `今天已记录 ${todayMeals.length} 餐` : '今天还没记录'}
            </Text>
          </View>
          <TouchableOpacity style={styles.mealRecordBtn} onPress={() => setMealVisible(true)}>
            <Text style={styles.mealRecordText}>记录</Text>
            <Ionicons name="chevron-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* 详细三餐内容（含每餐营养组成与依据） */}
        {todayMeals.length > 0 ? (
          <View style={styles.mealDetail}>
            {MEAL_ORDER.map((tp) => {
              const ms = todayMeals.filter((x) => x.type === tp);
              if (ms.length === 0) return null;
              return (
                <View key={tp} style={styles.mealDetailRow}>
                  <View style={styles.mealDetailHead}>
                    <Ionicons name={MEAL_META[tp].icon as any} size={14} color="#15803D" />
                    <Text style={styles.mealDetailLabel}>{MEAL_META[tp].label}</Text>
                    {ms[0].nutrition && (
                      <Text style={styles.mealDetailNut}>
                        蛋白{Math.round(ms[0].nutrition.protein)}g·热量{Math.round(ms[0].nutrition.calories)}kcal
                      </Text>
                    )}
                  </View>
                  {ms.map((m) => (
                    <View key={m.id}>
                      <Text style={styles.mealDetailContent}>{m.content}</Text>
                      {m.nutrition?.items && m.nutrition.items.length > 0 && (
                        <View style={styles.mealItems}>
                          {m.nutrition.items.map((it, i) => (
                            <Text key={i} style={styles.mealItemText}>
                              · {it.name}（蛋白{Math.round(it.protein)}g / 热量{Math.round(it.calories)}kcal）
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.mealEmptyWrap}>
            <Ionicons name="restaurant-outline" size={20} color={COLORS.textLighter} />
            <Text style={styles.mealEmpty}>点「记录」填写今天吃了什么，AI 可估算营养</Text>
          </View>
        )}

        {todayNutrition && (
          <View style={styles.mealStatRow}>
            <View style={styles.mealStat}>
              <Text style={styles.mealStatValue}>{todayNutrition.protein}g</Text>
              <Text style={styles.mealStatLabel}>蛋白质</Text>
            </View>
            <View style={styles.mealStat}>
              <Text style={styles.mealStatValue}>{todayNutrition.calories}</Text>
              <Text style={styles.mealStatLabel}>热量 kcal</Text>
            </View>
            <View style={[styles.mealBadge, { backgroundColor: ADEQUACY_COLOR[todayNutrition.adequacy] || '#22C55E' }]}>
              <Text style={styles.mealBadgeText}>{todayNutrition.adequacy}</Text>
            </View>
          </View>
        )}

        {/* 今日还缺哪些营养素 */}
        {todayNutrition && deficitChips.some((c) => c.lack) && (
          <View style={styles.todayLackWrap}>
            <Text style={styles.todayLackTitle}>今日还缺</Text>
            <View style={styles.todayLackChips}>
              {deficitChips.map((c, i) => (
                <View key={i} style={[styles.todayLackChip, c.lack && styles.todayLackChipBad]}>
                  <Text style={[styles.todayLackChipText, c.lack && styles.todayLackChipTextBad]}>{c.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.mealEstimateBtn, estimating && styles.mealEstimateDisabled]}
          onPress={handleEstimateMeal}
          disabled={estimating}
        >
          {estimating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="sparkles-outline" size={15} color="#fff" />
          )}
          <Text style={styles.mealEstimateText}>AI 估算营养（每餐蛋白/热量/是否过量）</Text>
        </TouchableOpacity>
      </View>

      {/* 今日活动量 & TDEE */}
      <View style={styles.activityCard}>
        <View style={styles.activityHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.activityTitle}>今日活动量</Text>
            <Text style={styles.activitySub}>
              基础代谢 {dayEnergy.bmr} · 运动 {dayEnergy.exerciseKcal} · 总消耗 {dayEnergy.tdee} kcal
            </Text>
          </View>
          <TouchableOpacity onPress={openBodyModal}>
            <Text style={styles.activityLink}>身体信息</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.activityLevels}>
          {(['sedentary', 'light', 'moderate', 'high'] as const).map((lv) => (
            <TouchableOpacity
              key={lv}
              style={[styles.levelChip, activity.baseLevel === lv && styles.levelChipActive]}
              onPress={() => setBaseLevel(lv)}
            >
              <Text style={[styles.levelChipText, activity.baseLevel === lv && styles.levelChipTextActive]}>
                {BASE_LEVEL_LABEL[lv]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activity.exercises.length > 0 && (
          <View style={styles.exList}>
            {activity.exercises.map((e) => (
              <View key={e.id} style={styles.exRow}>
                <Text style={styles.exName}>
                  {e.type} {e.durationMin} 分钟
                </Text>
                <Text style={styles.exKcal}>{e.kcal ? `${e.kcal} kcal` : '未估算'}</Text>
              </View>
            ))}
          </View>
        )}


        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity style={[styles.trendBtn, { flex: 1 }]} onPress={() => setTrendVisible(true)}>
            <Ionicons name="stats-chart-outline" size={15} color={COLORS.primary} />
            <Text style={styles.trendBtnText}>查看健身与身体趋势</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.trendBtn, { flex: 1 }]} onPress={() => navigation.navigate('ExerciseCalendar')}>
            <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
            <Text style={styles.trendBtnText}>运动日历</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.activityBtnRow}>
          <TouchableOpacity style={[styles.exAddBtn, { flex: 1 }]} onPress={openExModal}>
            <Ionicons name="add-circle-outline" size={15} color="#fff" />
            <Text style={styles.exAddText}>加运动记录</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modelBtn, { flex: 1 }]} onPress={() => setShowModelCfg(true)}>
            <Ionicons name="swap-horizontal-outline" size={15} color="#fff" />
            <Text style={styles.modelBtnText}>修改模型</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.activityBtnRow}>
          <TouchableOpacity
            style={[styles.estimateTodayBtn, { flex: 1 }, estimating && styles.mealEstimateDisabled]}
            onPress={handleEstimateMeal}
            disabled={estimating}
          >
            {estimating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="sparkles-outline" size={15} color="#fff" />
            )}
            <Text style={styles.estimateTodayText}>AI 估算今日营养</Text>
          </TouchableOpacity>
        </View>

        {todayNutrition && (
          <View style={styles.tdeeHint}>
            <Text style={styles.tdeeHintText}>
              今天已吃 {Math.round(todayNutrition.calories)} kcal，消耗约 {dayEnergy.tdee} kcal，
              {dayEnergy.tdee - Math.round(todayNutrition.calories) >= 0
                ? `还差 ${dayEnergy.tdee - Math.round(todayNutrition.calories)} kcal`
                : `已超出 ${Math.round(todayNutrition.calories) - dayEnergy.tdee} kcal`}
            </Text>
          </View>
        )}
      </View>

      <MealQuickSheet
        visible={mealVisible}
        date={toDateStr(new Date())}
        onClose={() => setMealVisible(false)}
        onSaved={() => {
          loadMeals();
          emitDataReset(); // 通知统计中心等已挂载页面立即刷新三餐数据
        }}
      />
    </ScrollView>

      <TrendPage visible={trendVisible} onClose={() => setTrendVisible(false)} />

      {/* 模型管理（修改/新增 AI 模型，首页与统计中心共用） */}
      <ModelConfigPage visible={showModelCfg} onClose={() => setShowModelCfg(false)} />

      {/* 身体信息 Modal */}
      <Modal visible={bodyModal} transparent animationType="slide" onRequestClose={() => { Keyboard.dismiss(); setBodyModal(false); }}>
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setBodyModal(false); }}>
          <View style={styles.sheetWrap}>
            <KeyboardAvoidingView behavior="padding" style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetTitle}>身体信息</Text>
                <View style={styles.ocrBar}>
                  <TouchableOpacity style={styles.ocrBtn} onPress={() => runOcr(true)} disabled={ocrLoading}>
                    <Ionicons name="camera-outline" size={15} color="#8B5CF6" />
                    <Text style={styles.ocrBtnText}>拍照识别</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.ocrBtn} onPress={() => runOcr(false)} disabled={ocrLoading}>
                    <Ionicons name="images-outline" size={15} color="#8B5CF6" />
                    <Text style={styles.ocrBtnText}>从相册选择</Text>
                  </TouchableOpacity>
                </View>
                {ocrLoading ? (
                  <View style={styles.ocrLoading}>
                    <ActivityIndicator size="small" color="#8B5CF6" />
                    <Text style={styles.ocrLoadingText}>正在识别体成分报告…</Text>
                  </View>
                ) : null}
                {ocrMsg ? <Text style={styles.ocrMsg}>{ocrMsg}</Text> : null}
                <Text style={styles.sheetLabel}>性别</Text>
                <View style={styles.segGroup}>
                  {(['male', 'female'] as const).map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[styles.segBtn, bodyProfile.gender === g && styles.segBtnActive]}
                      onPress={() => setBodyProfileLocal({ ...bodyProfile, gender: g })}
                    >
                      <Text style={[styles.segText, bodyProfile.gender === g && styles.segTextActive]}>
                        {g === 'male' ? '男' : '女'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.sheetLabel}>年龄</Text>
                <TextInput
                  style={styles.inputBox}
                  keyboardType="numeric"
                  returnKeyType="done"
                  blurOnSubmit
                  value={String(bodyProfile.age)}
                  onChangeText={(v) => setBodyProfileLocal({ ...bodyProfile, age: parseInt(v || '0', 10) })}
                />
                <Text style={styles.sheetLabel}>身高 (cm)</Text>
                <TextInput
                  style={styles.inputBox}
                  keyboardType="numeric"
                  returnKeyType="done"
                  blurOnSubmit
                  value={String(bodyProfile.height)}
                  onChangeText={(v) => setBodyProfileLocal({ ...bodyProfile, height: parseInt(v || '0', 10) })}
                />
                <Text style={styles.sheetLabel}>体重 (kg)</Text>
                <TextInput
                  style={styles.inputBox}
                  keyboardType="numeric"
                  returnKeyType="done"
                  blurOnSubmit
                  value={String(bodyProfile.weight)}
                  onChangeText={(v) => setBodyProfileLocal({ ...bodyProfile, weight: parseInt(v || '0', 10) })}
                />
                {renderBodyField('体脂率', bodyProfile.bodyFatPct, 'bodyFatPct', '%')}
                {renderBodyField('肌肉量', bodyProfile.muscleMass, 'muscleMass', 'kg')}
                {renderBodyField('骨量', bodyProfile.boneMass, 'boneMass', 'kg')}
                {renderBodyField('水分', bodyProfile.waterPct, 'waterPct', '%')}
                {renderBodyField('内脏脂肪等级', bodyProfile.visceralFat, 'visceralFat', '')}
                {renderBodyField('基础代谢', bodyProfile.bmr, 'bmr', 'kcal')}
                {renderBodyField('身体年龄', bodyProfile.bodyAge, 'bodyAge', '岁')}
                <View style={styles.sheetActions}>
                  <TouchableOpacity style={styles.sheetCancel} onPress={() => { Keyboard.dismiss(); setBodyModal(false); }}>
                    <Text style={styles.sheetCancelText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sheetSave} onPress={saveBody}>
                    <Text style={styles.sheetSaveText}>保存</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 20 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* 加运动记录 Modal */}
      <Modal visible={exModal} transparent animationType="slide" onRequestClose={() => { Keyboard.dismiss(); setExModal(false); }}>
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setExModal(false); }}>
          <View style={styles.sheetWrap}>
            <KeyboardAvoidingView behavior="padding" style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetTitle}>加运动记录</Text>
                <Text style={styles.sheetLabel}>类型</Text>
                <View style={styles.exTypeRow}>
                  {exTypes.map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.exTypeChip, exType === t && styles.exTypeChipActive]}
                      onPress={() => setExType(t)}
                    >
                      <Text style={[styles.exTypeChipText, exType === t && styles.exTypeChipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.exManageBtn} onPress={() => setExTypeManager((v) => !v)}>
                  <Ionicons name="options-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.exManageBtnText}>{exTypeManager ? '收起' : '管理运动类型'}</Text>
                </TouchableOpacity>
                {exTypeManager && (
                  <View style={styles.exManagerBox}>
                    {exTypes.map((t) => (
                      <View key={t} style={styles.exTypeManageRow}>
                        <Text style={styles.exTypeManageText}>{t}</Text>
                        <TouchableOpacity
                          onPress={async () => {
                            const next = await removeExerciseType(t);
                            setExTypes(next);
                            if (!next.includes(exType)) setExType(next[0] || '');
                          }}
                        >
                          <Ionicons name="trash-outline" size={16} color={COLORS.danger || '#EF4444'} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <View style={styles.exAddTypeRow}>
                      <TextInput
                        style={styles.inputBox}
                        placeholder="新增类型，如：跳绳"
                        placeholderTextColor="#94A3B8"
                        value={newTypeInput}
                        onChangeText={setNewTypeInput}
                        returnKeyType="done"
                        blurOnSubmit
                      />
                      <TouchableOpacity
                        style={styles.exAddTypeBtn}
                        onPress={async () => {
                          const next = await addExerciseType(newTypeInput);
                          setExTypes(next);
                          setNewTypeInput('');
                          setExTypeManager(false);
                        }}
                      >
                        <Text style={styles.exAddTypeBtnText}>添加</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {exType === '其他' && (
                  <>
                    <Text style={styles.sheetLabel}>自定义运动名称</Text>
                    <TextInput
                      style={styles.inputBox}
                      placeholder="例如：爬楼梯 / 椭圆机"
                      placeholderTextColor="#94A3B8"
                      value={exCustom}
                      onChangeText={setExCustom}
                      returnKeyType="done"
                      blurOnSubmit
                    />
                  </>
                )}
                <Text style={styles.sheetLabel}>时长（分钟）</Text>
                <TextInput style={styles.inputBox} keyboardType="numeric" returnKeyType="done" blurOnSubmit value={exDuration} onChangeText={setExDuration} />
                <TouchableOpacity style={styles.estimateBtn} onPress={estimateEx} disabled={estimatingEx}>
                  {estimatingEx ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.estimateBtnText}>AI 估算消耗</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.sheetLabel}>消耗（kcal，可留空或 AI 填）</Text>
                <TextInput style={styles.inputBox} keyboardType="numeric" returnKeyType="done" blurOnSubmit value={exKcal} onChangeText={setExKcal} />
                <View style={styles.sheetActions}>
                  <TouchableOpacity style={styles.sheetCancel} onPress={() => { Keyboard.dismiss(); setExModal(false); }}>
                    <Text style={styles.sheetCancelText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sheetSave} onPress={confirmEx}>
                    <Text style={styles.sheetSaveText}>保存</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 20 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: TOP_INSET + 16,
    paddingBottom: 16,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 4,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  ledgerCard: {
    marginTop: 4,
    marginHorizontal: 16,
    backgroundColor: '#FFF7F6',
    borderWidth: 1,
    borderColor: '#FBD5D0',
    borderRadius: 14,
    padding: 14,
  },
  ledgerCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ledgerCardTitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  ledgerCardAmount: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  ledgerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  ledgerAddText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  ledgerCardFoot: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  ledgerFootText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  ledgerFootStrong: {
    color: COLORS.text,
    fontWeight: '600',
  },
  ledgerDetail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#FBD5D0',
    gap: 8,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ledgerRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  ledgerRowMiddle: {
    flex: 1,
  },
  ledgerRowCat: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  ledgerRowNote: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 1,
  },
  ledgerRowRight: {
    alignItems: 'flex-end',
  },
  ledgerRowAmount: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  ledgerRowTime: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  ledgerEmptyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#FBD5D0',
  },
  ledgerEmpty: {
    fontSize: 12.5,
    color: COLORS.textLight,
  },
  // 每日三餐卡片
  mealCard: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 14,
    padding: 14,
  },
  mealCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mealCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#15803D',
  },
  mealCardSub: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 3,
  },
  mealRecordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#22C55E',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 2,
  },
  mealRecordText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  mealDetail: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#DCFCE7',
    gap: 10,
  },
  mealDetailRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  mealDetailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  mealDetailLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#15803D',
  },
  mealDetailContent: {
    fontSize: 13.5,
    color: COLORS.text,
    lineHeight: 19,
  },
  mealDetailNut: {
    marginLeft: 'auto',
    fontSize: 11.5,
    color: '#15803D',
    fontWeight: '600',
  },
  mealItems: {
    marginTop: 4,
    paddingLeft: 4,
  },
  mealItemText: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 18,
  },
  todayLackWrap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#DCFCE7',
  },
  todayLackTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 8,
  },
  todayLackChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  todayLackChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  todayLackChipBad: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  todayLackChipText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  todayLackChipTextBad: {
    color: '#B45309',
    fontWeight: '700',
  },
  mealEmptyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#DCFCE7',
  },
  mealEmpty: {
    fontSize: 12.5,
    color: COLORS.textLight,
  },
  mealStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#DCFCE7',
  },
  mealStat: {
    flex: 1,
    alignItems: 'center',
  },
  mealStatValue: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#15803D',
  },
  mealStatLabel: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  mealBadge: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: 12,
  },
  mealBadgeText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '700',
  },
  mealEstimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
  },
  mealEstimateDisabled: {
    opacity: 0.6,
  },
  mealEstimateText: {
    color: '#fff',
    fontSize: 13.5,
    fontWeight: '600',
  },
  // 今日活动量 & TDEE
  activityCard: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 14,
    padding: 14,
  },
  activityHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  activityTitle: { fontSize: 15, fontWeight: '700', color: '#1D4ED8' },
  activitySub: { fontSize: 11.5, color: '#3B82F6', marginTop: 3 },
  activityLink: { fontSize: 12, color: '#1D4ED8', fontWeight: '600', paddingVertical: 2 },
  activityLevels: { flexDirection: 'row', gap: 8, marginTop: 10 },
  levelChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 0.5,
    borderColor: '#BFDBFE',
    alignItems: 'center',
  },
  levelChipActive: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  levelChipText: { fontSize: 12.5, color: '#1E40AF' },
  levelChipTextActive: { color: '#fff', fontWeight: '600' },
  exList: { marginTop: 10, gap: 6 },
  exRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  exName: { fontSize: 13, color: COLORS.text },
  exKcal: { fontSize: 12.5, color: '#1D4ED8', fontWeight: '600' },
  exAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#3B82F6',
  },
  exAddText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  activityBtnRow: { flexDirection: 'row', gap: 8 },
  healthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  healthBtnText: { color: '#1D4ED8', fontSize: 13, fontWeight: '600' },
  trendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  trendBtnText: { color: '#1D4ED8', fontSize: 13, fontWeight: '700' },
  modelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#0EA5E9',
  },
  modelBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  estimateTodayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#8B5CF6',
  },
  estimateTodayText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  healthText: { fontSize: 12.5, color: '#1E40AF', flexShrink: 1 },
  tdeeHint: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#BFDBFE',
  },
  tdeeHintText: { fontSize: 12.5, color: '#1E40AF', fontWeight: '500' },
  // 通用底部弹窗
  sheetWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    paddingBottom: 28,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 12 },
  sheetLabel: { fontSize: 13, color: COLORS.textLight, marginTop: 12, marginBottom: 6 },
  inputBox: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
  },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  sheetCancel: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },
  sheetCancelText: { fontSize: 14, color: COLORS.textLight, fontWeight: '600' },
  sheetSave: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  sheetSaveText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  segGroup: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 10, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.primary },
  segText: { fontSize: 13, color: COLORS.textLight },
  segTextActive: { color: '#fff', fontWeight: '600' },
  exTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  exTypeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  exTypeChipText: { fontSize: 13, color: COLORS.text },
  exTypeChipTextActive: { color: '#fff', fontWeight: '600' },
  exManageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    backgroundColor: '#EEF2FF', borderWidth: 0.5, borderColor: '#C7D2FE',
  },
  exManageBtnText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '600' },
  exManagerBox: {
    marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: COLORS.background,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  exTypeManageRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  exTypeManageText: { fontSize: 14, color: COLORS.text },
  exAddTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  exAddTypeBtn: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.primary,
  },
  exAddTypeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  estimateBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#8B5CF6',
  },
  estimateBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '600' },
  ocrBar: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  ocrBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F5F0FF',
    borderWidth: 0.5,
    borderColor: '#DDD0FB',
  },
  ocrBtnText: {
    color: '#8B5CF6',
    fontSize: 13,
    fontWeight: '600',
  },
  ocrLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  ocrLoadingText: {
    fontSize: 12.5,
    color: COLORS.primary,
  },
  ocrMsg: {
    fontSize: 12.5,
    color: COLORS.textLight,
    marginBottom: 10,
  },
});

export default HomePage;
