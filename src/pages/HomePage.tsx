import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { getApiKey } from '../utils/storage';
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

  const loadMeals = async () => {
    const t = toDateStr(new Date());
    const list = await getMealsByDate(t);
    setTodayMeals(list);
    setTodayNutrition(await getNutritionForDate(t));
  };

  useEffect(() => {
    fetchSessions();
    fetchStats();
    loadLedger();
    loadMeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 清除全部数据 / 导入备份后，重新拉取花销与统计，保证首页同步
  useEffect(() => {
    const off = onDataReset(() => {
      fetchSessions();
      fetchStats();
      loadLedger();
      loadMeals();
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
});

export default HomePage;
