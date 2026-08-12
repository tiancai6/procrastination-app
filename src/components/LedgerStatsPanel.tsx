import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../constants/reasons';
import { LedgerEntry } from '../types';
import {
  totalBy,
  getCategoryBreakdown,
  getMonthlySummary,
  formatMoney,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  CategorySlice,
} from '../utils/ledger';
import { useLedgerStore } from '../store/ledgerStore';
import { onDataReset } from '../utils/appEvents';
import { summarizeLedger } from '../utils/ai';
import PieChart from './PieChart';
import LedgerQuickSheet from './LedgerQuickSheet';
import SwipeableRow from './SwipeableRow';
import { WEEK_LABELS } from './CalendarPicker';

const LEDGER_COLORS = [
  '#EF4444',
  '#F97316',
  '#F59E0B',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
];

const colorForCategory = (category: string): string => {
  const idx = EXPENSE_CATEGORIES.indexOf(category);
  if (idx >= 0) return LEDGER_COLORS[idx % LEDGER_COLORS.length];
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return LEDGER_COLORS[h % LEDGER_COLORS.length];
};

const cardShadow = {
  shadowColor: COLORS.shadow,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 8,
  elevation: 2,
};

type TimeRange = 'day' | 'week' | 'month' | 'year';

const getStartOfWeek = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const toDateStrLocal = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const filterLedgerByRange = (all: LedgerEntry[], range: TimeRange, base: Date): LedgerEntry[] => {
  switch (range) {
    case 'day': {
      const s = new Date(base);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setDate(s.getDate() + 1);
      return all.filter((x) => x.occurredAt >= s.getTime() && x.occurredAt < e.getTime());
    }
    case 'week': {
      const ws = getStartOfWeek(base);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 7);
      return all.filter((x) => x.occurredAt >= ws.getTime() && x.occurredAt < we.getTime());
    }
    case 'month': {
      const ms = new Date(base.getFullYear(), base.getMonth(), 1);
      const me = new Date(base.getFullYear(), base.getMonth() + 1, 1);
      return all.filter((x) => x.occurredAt >= ms.getTime() && x.occurredAt < me.getTime());
    }
    case 'year': {
      const ys = new Date(base.getFullYear(), 0, 1);
      const ye = new Date(base.getFullYear() + 1, 0, 1);
      return all.filter((x) => x.occurredAt >= ys.getTime() && x.occurredAt < ye.getTime());
    }
    default:
      return [];
  }
};

const LedgerStatsPanel: React.FC = () => {
  const navigation = useNavigation();
  // 共用 ledgerStore：首页花销卡与消费面板共享同一数据源，增删改自动同步
  const entries = useLedgerStore((s) => s.entries);
  const load = useLedgerStore((s) => s.load);
  const removeEntry = useLedgerStore((s) => s.remove);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'done' | 'error' | 'disabled'>('idle');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetEntry, setSheetEntry] = useState<LedgerEntry | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  // —— 二级筛选：分类 + 自定义日期范围 ——
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState<Date | null>(null);
  const [rangeTo, setRangeTo] = useState<Date | null>(null);
  const [datePickerMode, setDatePickerMode] = useState<'period' | 'rangeFrom' | 'rangeTo' | null>(null);
  // —— 日历补记账：选中某天看明细 ——
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  useEffect(() => {
    load();
    const off = onDataReset(() => load());
    return off;
  }, [load]);

  const scopedEntries = useMemo(
    () => filterLedgerByRange(entries, timeRange, currentDate),
    [entries, timeRange, currentDate],
  );

  const expense = useMemo(() => totalBy(scopedEntries, 'expense'), [scopedEntries]);
  const income = useMemo(() => totalBy(scopedEntries, 'income'), [scopedEntries]);
  const balance = Math.round((income - expense) * 100) / 100;
  const breakdown: CategorySlice[] = useMemo(
    () => getCategoryBreakdown(scopedEntries, 'expense'),
    [scopedEntries],
  );

  const monthly = useMemo(
    () => (timeRange === 'year' ? getMonthlySummary(entries, currentDate.getFullYear()) : []),
    [timeRange, entries, currentDate],
  );
  const maxMonthExpense = monthly.reduce((m, x) => Math.max(m, x.expense), 1);

  const pieData = breakdown.map((s) => ({
    name: s.category,
    percentage: s.percentage,
    color: colorForCategory(s.category),
  }));

  // —— 二级筛选：分类 + 自定义日期范围，作用于记录明细列表 ——
  const filteredList = useMemo(() => {
    let list = scopedEntries;
    if (catFilter) list = list.filter((e) => e.category === catFilter);
    if (rangeFrom || rangeTo) {
      const from = rangeFrom ? new Date(rangeFrom).setHours(0, 0, 0, 0) : -Infinity;
      const to = rangeTo ? new Date(rangeTo).setHours(23, 59, 59, 999) : Infinity;
      list = list.filter((e) => e.occurredAt >= from && e.occurredAt <= to);
    }
    return list;
  }, [scopedEntries, catFilter, rangeFrom, rangeTo]);

  // —— 日历：按自然日聚合收支配额（用全量 entries，与周期无关）——
  const dayTotals = useMemo(() => {
    const map: Record<string, { expense: number; income: number }> = {};
    for (const e of entries) {
      const s = toDateStrLocal(new Date(e.occurredAt));
      if (!map[s]) map[s] = { expense: 0, income: 0 };
      if (e.type === 'expense') map[s].expense = Math.round((map[s].expense + e.amount) * 100) / 100;
      else map[s].income = Math.round((map[s].income + e.amount) * 100) / 100;
    }
    return map;
  }, [entries]);

  const periodLabel = (): string => {
    switch (timeRange) {
      case 'day':
        return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月${currentDate.getDate()}日`;
      case 'week': {
        const ws = getStartOfWeek(currentDate);
        const we = new Date(ws);
        we.setDate(ws.getDate() + 6);
        return `${ws.getMonth() + 1}月${ws.getDate()}日 - ${we.getMonth() + 1}月${we.getDate()}日`;
      }
      case 'month':
        return `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
      case 'year':
        return `${currentDate.getFullYear()}年`;
      default:
        return '';
    }
  };

  const navigatePeriod = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    switch (timeRange) {
      case 'day':
        newDate.setDate(newDate.getDate() + (direction === 'prev' ? -1 : 1));
        break;
      case 'week':
        newDate.setDate(newDate.getDate() + (direction === 'prev' ? -7 : 7));
        break;
      case 'month':
        newDate.setMonth(newDate.getMonth() + (direction === 'prev' ? -1 : 1));
        break;
      case 'year':
        newDate.setFullYear(newDate.getFullYear() + (direction === 'prev' ? -1 : 1));
        break;
    }
    setCurrentDate(newDate);
  };

  const openDatePicker = () => {
    setTempDate(new Date(currentDate));
    setDatePickerMode('period');
  };

  const openRangeFrom = () => {
    setTempDate(rangeFrom ? new Date(rangeFrom) : new Date());
    setDatePickerMode('rangeFrom');
  };

  const openRangeTo = () => {
    setTempDate(rangeTo ? new Date(rangeTo) : new Date());
    setDatePickerMode('rangeTo');
  };

  const confirmDatePick = () => {
    const d = tempDate;
    if (datePickerMode === 'period') setCurrentDate(d);
    else if (datePickerMode === 'rangeFrom') setRangeFrom(d);
    else if (datePickerMode === 'rangeTo') setRangeTo(d);
    setDatePickerMode(null);
  };

  const onDateChange = (event: any, date?: Date) => {
    if (date) setTempDate(date);
    if (Platform.OS === 'android') {
      if (event.type === 'set' && date) confirmDatePick();
      setDatePickerMode(null);
    }
  };

  const clearFilters = () => {
    setCatFilter(null);
    setRangeFrom(null);
    setRangeTo(null);
  };

  const onSummarize = async () => {
    setAiStatus('loading');
    const { result, status } = await summarizeLedger(scopedEntries);
    if (status === 'ok' && result) {
      setAiSummary(result);
      setAiStatus('done');
    } else if (status === 'nokey') {
      setAiStatus('disabled');
    } else {
      setAiStatus('error');
    }
  };

  const openAdd = () => {
    setSheetEntry(null);
    setSheetVisible(true);
  };

  const openEdit = (entry: LedgerEntry) => {
    setSheetEntry(entry);
    setSheetVisible(true);
  };

  const handleDelete = (entry: LedgerEntry) => {
    Alert.alert('删除记录', `确定删除这条「${entry.category} ${entry.type === 'expense' ? '支出' : '收入'}」记录吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await removeEntry(entry.id); // 删除并重新拉取，收支/结余/环形图/月度数据自动重算，首页同步
        },
      },
    ]);
  };

  const recent = filteredList.slice(0, 200);
  const rangeLabelMap: { value: TimeRange; label: string }[] = [
    { value: 'day', label: '日' },
    { value: 'week', label: '周' },
    { value: 'month', label: '月' },
    { value: 'year', label: '年' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.controlBar}>
        <View style={styles.rangeButtons}>
          {rangeLabelMap.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[styles.rangeBtn, timeRange === r.value && styles.rangeBtnActive]}
              onPress={() => setTimeRange(r.value)}
            >
              <Text style={[styles.rangeBtnText, timeRange === r.value && styles.rangeBtnTextActive]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.periodNavRow}>
          <TouchableOpacity style={styles.periodNavBtn} onPress={() => navigatePeriod('prev')}>
            <Ionicons name="chevron-back-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.periodNavLabelBtn} onPress={openDatePicker}>
            <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
            <Text style={styles.periodNavLabel}>{periodLabel()}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.periodNavBtn} onPress={() => navigatePeriod('next')}>
            <Ionicons name="chevron-forward-outline" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 收支概览 */}
        <View style={styles.overviewCard}>
          <View style={styles.overviewRow}>
            <View style={styles.overviewItem}>
              <Ionicons name="arrow-up-circle-outline" size={18} color="#EF4444" />
              <Text style={styles.overviewLabel}>支出</Text>
              <Text style={[styles.overviewValue, { color: '#EF4444' }]}>{formatMoney(expense)}</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Ionicons name="arrow-down-circle-outline" size={18} color="#22C55E" />
              <Text style={styles.overviewLabel}>收入</Text>
              <Text style={[styles.overviewValue, { color: '#22C55E' }]}>{formatMoney(income)}</Text>
            </View>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>结余</Text>
            <Text style={[styles.balanceValue, { color: balance >= 0 ? COLORS.primary : '#EF4444' }]}>
              {balance >= 0 ? '+' : ''}
              {formatMoney(balance)}
            </Text>
          </View>
        </View>

        {/* 月历视图：每天收支配额，点某天看明细（年视图用下方12个月柱图，不显示月历） */}
        {timeRange !== 'year' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>日历</Text>
            <View style={[styles.calCard, { ...cardShadow }]}>
              <View style={styles.weekHeader}>
                {WEEK_LABELS.map((w) => (
                  <Text key={w} style={styles.calWeekText}>{w.replace('周', '')}</Text>
                ))}
              </View>
              <LedgerMonthCalendar
                base={currentDate}
                timeRange={timeRange}
                dayTotals={dayTotals}
                onPick={(s) => setDayDetailDate(s)}
              />
            </View>
          </View>
        )}

        {/* 年视图：每月花销 + 主要分类 */}
        {timeRange === 'year' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>每月花销</Text>
            <View style={[styles.monthCard, { ...cardShadow }]}>
              {monthly.map((m) => {
                const pct = maxMonthExpense > 0 ? (m.expense / maxMonthExpense) * 100 : 0;
                return (
                  <View key={m.month} style={styles.monthRow}>
                    <Text style={styles.monthLabel}>{m.month}月</Text>
                    <View style={styles.monthBarTrack}>
                      <View
                        style={[
                          styles.monthBar,
                          { width: `${Math.max(pct, m.expense > 0 ? 4 : 0)}%` },
                          m.topCategory ? {} : styles.monthBarEmpty,
                        ]}
                      />
                    </View>
                    <View style={styles.monthInfo}>
                      <Text style={styles.monthAmount}>{formatMoney(m.expense)}</Text>
                      {m.topCategory ? (
                        <View style={[styles.monthTopChip, { backgroundColor: colorForCategory(m.topCategory) }]}>
                          <Text style={styles.monthTopText}>{m.topCategory}</Text>
                        </View>
                      ) : (
                        <Text style={styles.monthTopNone}>无支出</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* 分类占比环形图（年视图也展示当年占比） */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{timeRange === 'year' ? '当年支出分类占比' : '支出分类占比'}</Text>
          <View style={styles.categoryChartContainer}>
            <View style={styles.pieChartContainer}>
              {breakdown.length > 0 ? (
                <PieChart data={pieData} size={100} strokeWidth={16} />
              ) : (
                <View style={styles.pieChartEmpty}>
                  <Text style={styles.pieEmptyText}>暂无数据</Text>
                </View>
              )}
              <View style={styles.pieCenter}>
                <Text style={styles.pieCenterValue}>{formatMoney(expense)}</Text>
                <Text style={styles.pieCenterLabel}>支出合计</Text>
              </View>
            </View>
            <View style={styles.categoryList}>
              {breakdown.length > 0 ? (
                breakdown.map((item) => {
                  const active = catFilter === item.category;
                  return (
                    <TouchableOpacity
                      key={item.category}
                      style={[styles.categoryItem, active && styles.categoryItemActive]}
                      onPress={() => setCatFilter(active ? null : item.category)}
                    >
                      <View style={[styles.categoryDot, { backgroundColor: colorForCategory(item.category) }]} />
                      <Text style={[styles.categoryName, active && styles.categoryNameActive]}>{item.category}</Text>
                      <Text style={styles.categoryAmount}>{formatMoney(item.total)}</Text>
                      <Text style={styles.categoryPercentage}>{item.percentage}%</Text>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={styles.emptyHint}>该区间还没有支出记录</Text>
              )}
            </View>
          </View>
        </View>

        {/* AI 消费总结 */}
        <View style={styles.section}>
          <View style={styles.aiHeader}>
            <Ionicons name="sparkles" size={18} color={COLORS.primary} />
            <Text style={styles.aiTitle}>AI 消费总结</Text>
            {aiStatus === 'loading' && <Text style={styles.aiBadge}>分析中…</Text>}
          </View>

          {aiStatus === 'disabled' && (
            <View>
              <Text style={styles.aiHint}>未开启 AI。在「我的 → AI 智能分析」填入 GLM API Key 后即可生成消费总结（仅上传脱敏统计数字）。</Text>
              <TouchableOpacity style={styles.aiStartBtn} onPress={() => (navigation as any).navigate('settings')}>
                <Ionicons name="key-outline" size={16} color="#fff" />
                <Text style={styles.aiStartText}>去设置 API Key</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiStatus === 'error' && (
            <View>
              <Text style={styles.aiHint}>AI 调用失败（网络或 Key 错误），请稍后重试。</Text>
              <TouchableOpacity style={styles.aiRetry} onPress={onSummarize}>
                <Text style={styles.aiRetryText}>重试</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiStatus === 'loading' && (
            <View style={styles.aiLoadingRow}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.aiHint}>正在生成消费总结…</Text>
            </View>
          )}

          {aiStatus === 'idle' && (
            <View>
              <Text style={styles.aiHint}>根据当前区间的脱敏记账数字，生成一份温和的消费总结与建议。</Text>
              <TouchableOpacity style={styles.aiStartBtn} onPress={onSummarize}>
                <Ionicons name="sparkles-outline" size={16} color="#fff" />
                <Text style={styles.aiStartText}>生成消费总结</Text>
              </TouchableOpacity>
            </View>
          )}

          {aiStatus === 'done' && aiSummary && (
            <View>
              <Text style={styles.aiSummaryText}>{aiSummary}</Text>
              <TouchableOpacity style={styles.aiRefresh} onPress={onSummarize}>
                <Ionicons name="refresh-outline" size={14} color={COLORS.primary} />
                <Text style={styles.aiRefreshText}>重新生成</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 记录列表 */}
        <View style={styles.section}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>记录明细</Text>
            <TouchableOpacity style={styles.addMiniBtn} onPress={openAdd}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addMiniText}>记一笔</Text>
            </TouchableOpacity>
          </View>
          {/* 二级筛选：分类 + 自定义日期范围 */}
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, catFilter !== null && styles.filterChipActive]}
              onPress={() => setCatFilter(null)}
            >
              <Text style={[styles.filterChipText, catFilter === null && styles.filterChipTextActive]}>全部分类</Text>
            </TouchableOpacity>
            {EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES).map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.filterChip, catFilter === c && styles.filterChipActive]}
                onPress={() => setCatFilter(catFilter === c ? null : c)}
              >
                <Text style={[styles.filterChipText, catFilter === c && styles.filterChipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.rangeRow}>
            <Text style={styles.rangeLabel}>日期范围：</Text>
            <TouchableOpacity style={styles.rangePickBtn} onPress={openRangeFrom}>
              <Text style={styles.rangePickText}>{rangeFrom ? toDateStrLocal(rangeFrom).slice(5) : '开始'}</Text>
            </TouchableOpacity>
            <Text style={styles.rangeSep}>~</Text>
            <TouchableOpacity style={styles.rangePickBtn} onPress={openRangeTo}>
              <Text style={styles.rangePickText}>{rangeTo ? toDateStrLocal(rangeTo).slice(5) : '结束'}</Text>
            </TouchableOpacity>
            {(catFilter || rangeFrom || rangeTo) && (
              <TouchableOpacity style={styles.clearFilterBtn} onPress={clearFilters}>
                <Ionicons name="close-circle" size={16} color={COLORS.textLight} />
                <Text style={styles.clearFilterText}>清除筛选</Text>
              </TouchableOpacity>
            )}
          </View>
          {recent.length > 0 ? (
            recent.map((e) => {
              const isExpense = e.type === 'expense';
              const d = new Date(e.occurredAt);
              const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
              return (
                <SwipeableRow key={e.id} onDelete={() => handleDelete(e)}>
                  <TouchableOpacity
                    style={styles.recordRow}
                    activeOpacity={0.7}
                    onPress={() => openEdit(e)}
                  >
                    <View style={[styles.recordIcon, { backgroundColor: isExpense ? '#FEE2E2' : '#DCFCE7' }]}>
                      <Ionicons
                        name={isExpense ? 'arrow-up-outline' : 'arrow-down-outline'}
                        size={16}
                        color={isExpense ? '#EF4444' : '#22C55E'}
                      />
                    </View>
                    <View style={styles.recordMiddle}>
                      <Text style={styles.recordCategory}>{e.category}</Text>
                      {e.note ? <Text style={styles.recordNote}>{e.note}</Text> : null}
                    </View>
                    <View style={styles.recordRight}>
                      <Text style={[styles.recordAmount, { color: isExpense ? '#EF4444' : '#22C55E' }]}>
                        {isExpense ? '-' : '+'}
                        {formatMoney(e.amount)}
                      </Text>
                      <Text style={styles.recordDate}>{dateStr}</Text>
                    </View>
                  </TouchableOpacity>
                </SwipeableRow>
              );
            })
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="receipt-outline" size={28} color={COLORS.textLight} />
              <Text style={styles.emptyHint}>该区间还没有记账记录</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <LedgerQuickSheet
        visible={sheetVisible}
        entry={sheetEntry}
        defaultOccurredAt={dayDetailDate ? new Date(dayDetailDate + 'T12:00:00').getTime() : undefined}
        onClose={() => setSheetVisible(false)}
        onSaved={load}
      />

      {/* 选中某天 → 当天消费明细（可编辑/删除/补记账） */}
      <Modal
        visible={dayDetailDate !== null}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setDayDetailDate(null)}
      >
        <View style={styles.iosOverlay}>
          <View style={styles.iosSheet}>
            <View style={styles.iosHeader}>
              <TouchableOpacity onPress={() => setDayDetailDate(null)}>
                <Text style={styles.iosCancel}>关闭</Text>
              </TouchableOpacity>
              <Text style={styles.iosTitle}>
                {dayDetailDate ? `${dayDetailDate.slice(5).replace('-', '月')}日 明细` : '明细'}
              </Text>
              <TouchableOpacity style={styles.dayAddBtn} onPress={openAdd}>
                <Text style={styles.dayAddText}>记一笔</Text>
              </TouchableOpacity>
            </View>
            <DayDetailBody
              dateStr={dayDetailDate}
              entries={entries}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          </View>
        </View>
      </Modal>

      {datePickerMode !== null && Platform.OS === 'android' && (
        <DateTimePicker value={tempDate} mode="date" display="default" onChange={onDateChange} />
      )}
      <Modal
        visible={datePickerMode !== null && Platform.OS === 'ios'}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setDatePickerMode(null)}
      >
        <View style={styles.iosOverlay}>
          <View style={styles.iosSheet}>
            <View style={styles.iosHeader}>
              <TouchableOpacity onPress={() => setDatePickerMode(null)}>
                <Text style={styles.iosCancel}>取消</Text>
              </TouchableOpacity>
              <Text style={styles.iosTitle}>
                {datePickerMode === 'period' ? '选择周期' : datePickerMode === 'rangeFrom' ? '开始日期' : '结束日期'}
              </Text>
              <TouchableOpacity onPress={confirmDatePick}>
                <Text style={styles.iosConfirm}>确定</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={onDateChange}
              textColor={COLORS.text}
              style={styles.iosPicker}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

// —— 月历网格（账单）：每天显示收支配额，点某天看明细 ——
interface CalProps {
  base: Date;
  timeRange: TimeRange;
  dayTotals: Record<string, { expense: number; income: number }>;
  onPick: (dateStr: string) => void;
}
const fmtShort = (n: number): string => {
  const a = Math.round(n);
  if (a >= 10000) return (a / 10000).toFixed(1) + 'w';
  if (a >= 1000) return (a / 1000).toFixed(1) + 'k';
  return String(a);
};
const LedgerMonthCalendar: React.FC<CalProps> = ({ base, timeRange, dayTotals, onPick }) => {
  const today = new Date();
  const todayStr = toDateStrLocal(today);
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  const highlightSet = new Set<string>();
  if (timeRange === 'week') {
    const ws = getStartOfWeek(base);
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      highlightSet.add(toDateStrLocal(d));
    }
  } else {
    highlightSet.add(todayStr);
  }
  return (
    <View style={styles.calGrid}>
      {cells.map((d, i) => {
        const s = toDateStrLocal(d);
        const t = dayTotals[s];
        const isThisMonth = d.getMonth() === month;
        const isToday = s === todayStr;
        const dim = !isThisMonth;
        return (
          <TouchableOpacity
            key={i}
            style={[styles.calCell, highlightSet.has(s) && styles.calCellHi, isToday && styles.calCellToday]}
            onPress={() => onPick(s)}
          >
            <Text style={[styles.calNum, dim && styles.calDim, isToday && styles.calNumToday]}>{d.getDate()}</Text>
            {t && t.expense > 0 && <Text style={[styles.calExp, dim && styles.calDim]}>-{fmtShort(t.expense)}</Text>}
            {t && t.income > 0 && <Text style={[styles.calInc, dim && styles.calDim]}>+{fmtShort(t.income)}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// —— 某天明细弹窗内容 ——
interface DayDetailProps {
  dateStr: string | null;
  entries: LedgerEntry[];
  onEdit: (e: LedgerEntry) => void;
  onDelete: (e: LedgerEntry) => void;
}
const DayDetailBody: React.FC<DayDetailProps> = ({ dateStr, entries, onEdit, onDelete }) => {
  if (!dateStr) return null;
  const dayEntries = entries
    .filter((e) => toDateStrLocal(new Date(e.occurredAt)) === dateStr)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const exp = dayEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const inc = dayEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  return (
    <View style={styles.dayBody}>
      <View style={styles.daySum}>
        <Text style={[styles.daySumVal, { color: '#EF4444' }]}>支出 {formatMoney(Math.round(exp * 100) / 100)}</Text>
        <Text style={[styles.daySumVal, { color: '#22C55E' }]}>收入 {formatMoney(Math.round(inc * 100) / 100)}</Text>
      </View>
      {dayEntries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="receipt-outline" size={28} color={COLORS.textLight} />
          <Text style={styles.emptyHint}>这一天还没有记账，点右上「记一笔」补记</Text>
        </View>
      ) : (
        dayEntries.map((e) => {
          const isExpense = e.type === 'expense';
          return (
            <SwipeableRow key={e.id} onDelete={() => onDelete(e)}>
              <TouchableOpacity style={styles.recordRow} activeOpacity={0.7} onPress={() => onEdit(e)}>
                <View style={[styles.recordIcon, { backgroundColor: isExpense ? '#FEE2E2' : '#DCFCE7' }]}>
                  <Ionicons name={isExpense ? 'arrow-up-outline' : 'arrow-down-outline'} size={16} color={isExpense ? '#EF4444' : '#22C55E'} />
                </View>
                <View style={styles.recordMiddle}>
                  <Text style={styles.recordCategory}>{e.category}</Text>
                  {e.note ? <Text style={styles.recordNote}>{e.note}</Text> : null}
                </View>
                <View style={styles.recordRight}>
                  <Text style={[styles.recordAmount, { color: isExpense ? '#EF4444' : '#22C55E' }]}>
                    {isExpense ? '-' : '+'}
                    {formatMoney(e.amount)}
                  </Text>
                </View>
              </TouchableOpacity>
            </SwipeableRow>
          );
        })
      )}
    </View>
  );
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
    backgroundColor: COLORS.primary,
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
  periodNavLabelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodNavLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
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
  overviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overviewItem: {
    flex: 1,
    alignItems: 'center',
  },
  overviewDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.border,
  },
  overviewLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 4,
    marginBottom: 2,
  },
  overviewValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  balanceLabel: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  addMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  addMiniText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  monthCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  monthLabel: {
    width: 32,
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  monthBarTrack: {
    flex: 1,
    height: 14,
    backgroundColor: COLORS.background,
    borderRadius: 7,
    overflow: 'hidden',
  },
  monthBar: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 7,
    minWidth: 0,
  },
  monthBarEmpty: {
    backgroundColor: COLORS.border,
  },
  monthInfo: {
    width: 110,
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  monthAmount: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  monthTopChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  monthTopText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  monthTopNone: {
    fontSize: 11,
    color: COLORS.textLighter,
  },
  categoryChartContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    gap: 16,
    ...cardShadow,
  },
  pieChartContainer: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pieCenter: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 56,
    height: 56,
    borderRadius: '50%',
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieCenterValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  pieCenterLabel: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  pieChartEmpty: {
    width: 100,
    height: 100,
    borderRadius: '50%',
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieEmptyText: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  categoryList: {
    flex: 1,
    gap: 8,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  categoryName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  categoryNameActive: {
    flex: 1,
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  categoryItemActive: {
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
  },
  categoryAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginRight: 8,
  },
  categoryPercentage: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  emptyHint: {
    fontSize: 13,
    color: COLORS.textLight,
    lineHeight: 20,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  aiTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  aiBadge: {
    fontSize: 12,
    color: COLORS.primary,
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  aiHint: {
    fontSize: 14,
    color: COLORS.textLight,
    lineHeight: 22,
  },
  aiLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiSummaryText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 24,
  },
  aiRefresh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    backgroundColor: COLORS.secondary,
  },
  aiRefreshText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  aiRetry: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    backgroundColor: COLORS.secondary,
  },
  aiRetryText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  aiStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 11,
  },
  aiStartText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    ...cardShadow,
  },
  recordIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  recordMiddle: {
    flex: 1,
  },
  recordCategory: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  recordNote: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  recordRight: {
    alignItems: 'flex-end',
  },
  recordAmount: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  recordDate: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 2,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 30,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    gap: 8,
  },
  iosOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  iosSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  iosHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  iosCancel: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  iosTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  iosConfirm: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  iosPicker: {
    backgroundColor: COLORS.card,
  },
  // —— 月历（账单）——
  calCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 12,
    ...cardShadow,
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calWeekText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: COLORS.textLight,
  },
  calGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 2,
  },
  calCellHi: {
    backgroundColor: COLORS.secondary,
  },
  calCellToday: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  calNum: {
    fontSize: 13,
    color: COLORS.text,
  },
  calNumToday: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  calDim: {
    opacity: 0.4,
  },
  calExp: {
    fontSize: 9,
    color: '#EF4444',
    marginTop: 1,
  },
  calInc: {
    fontSize: 9,
    color: '#22C55E',
  },
  // —— 二级筛选：分类 + 日期范围 ——
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  filterChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  rangeLabel: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  rangePickBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  rangePickText: {
    fontSize: 13,
    color: COLORS.text,
  },
  rangeSep: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  clearFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: COLORS.secondary,
  },
  clearFilterText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '500',
  },
  // —— 某天明细弹窗 ——
  dayAddBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  dayAddText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  dayBody: {
    paddingHorizontal: 16,
    paddingBottom: 30,
    gap: 8,
  },
  daySum: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
  },
  daySumVal: {
    fontSize: 15,
    fontWeight: 'bold',
  },
});

export default LedgerStatsPanel;
