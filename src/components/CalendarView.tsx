import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { Reminder, Habit, HabitCheckin } from '../types';
import { WEEK_LABELS } from './CalendarPicker';

interface Props {
  reminders: Reminder[];
  habits: Habit[];
  checkins: HabitCheckin[];
  onReminderPress?: (r: Reminder) => void;
  onHabitPress?: (h: Habit) => void;
}

interface DayAgg {
  dateStr: string;
  doneTodos: number;
  pendingTodos: number;
  checkins: number;
  missed: number;
}

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const CalendarView: React.FC<Props> = ({ reminders, habits, checkins, onReminderPress, onHabitPress }) => {
  const today = new Date();
  const todayStr = toDateStr(today);
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1)); // 月视图游标
  const [selWeek, setSelWeek] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate())); // 周视图游标（所在周的某天）
  const [selected, setSelected] = useState(todayStr);

  const selectedDate = useMemo(() => new Date(selected + 'T00:00:00'), [selected]);

  // 聚合：每条日期 -> 统计
  const aggMap = useMemo(() => {
    const map = new Map<string, DayAgg>();
    const get = (s: string): DayAgg => {
      if (!map.has(s)) map.set(s, { dateStr: s, doneTodos: 0, pendingTodos: 0, checkins: 0, missed: 0 });
      return map.get(s)!;
    };
    for (const r of reminders) {
      const a = get(r.date);
      if (r.done) a.doneTodos += 1;
      else a.pendingTodos += 1;
    }
    const checkinSet = new Set(checkins.map((c) => `${c.habitId}|${c.date}`));
    for (const c of checkins) {
      get(c.date).checkins += 1;
    }
    // 漏打卡：习惯在该星期几生效、日期 < 今天、且当天无打卡
    for (const h of habits) {
      if (h.status !== 'active') continue;
      const days = h.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : h.weekDays;
      // 从创建日到现在，逐天检查
      const start = new Date(h.createdAt);
      start.setHours(0, 0, 0, 0);
      const end = new Date(today);
      end.setDate(end.getDate() - 1);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (!days.includes(d.getDay())) continue;
        const s = toDateStr(d);
        if (!checkinSet.has(`${h.id}|${s}`)) get(s).missed += 1;
      }
    }
    return map;
  }, [reminders, habits, checkins, today]);

  // 月视图 6x7 网格
  const monthCells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay()); // 从周日开始
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  // 周视图 7 天
  const weekCells = useMemo(() => {
    const base = new Date(selWeek.getFullYear(), selWeek.getMonth(), selWeek.getDate());
    const dow = base.getDay();
    const start = new Date(base);
    start.setDate(base.getDate() - dow);
    const cells: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [selWeek]);

  const shiftMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  };
  const shiftWeek = (delta: number) => {
    setSelWeek((w) => {
      const n = new Date(w);
      n.setDate(n.getDate() + delta * 7);
      return n;
    });
  };

  const renderDots = (s: string) => {
    const a = aggMap.get(s);
    if (!a) return null;
    const dots: React.ReactNode[] = [];
    if (a.doneTodos > 0 || a.pendingTodos > 0) dots.push(<View key="b" style={[styles.dot, { backgroundColor: COLORS.primary }]} />);
    if (a.checkins > 0) dots.push(<View key="g" style={[styles.dot, { backgroundColor: COLORS.success }]} />);
    if (a.missed > 0) dots.push(<View key="r" style={[styles.dot, { backgroundColor: COLORS.danger }]} />);
    if (!dots.length) return null;
    return <View style={styles.dotRow}>{dots}</View>;
  };

  const DayCell = ({ d, selectedCell }: { d: Date; selectedCell: boolean }) => {
    const s = toDateStr(d);
    const isThisMonth = d.getMonth() === (mode === 'month' ? cursor.getMonth() : selWeek.getMonth());
    const isToday = s === todayStr;
    return (
      <TouchableOpacity
        style={[
          styles.cell,
          selectedCell && styles.cellSelected,
          isToday && styles.cellToday,
        ]}
        onPress={() => setSelected(s)}
      >
        <Text style={[styles.cellNum, !isThisMonth && styles.cellNumDim, isToday && styles.cellNumToday]}>
          {d.getDate()}
        </Text>
        {renderDots(s)}
      </TouchableOpacity>
    );
  };

  // 选中当天明细
  const dayReminders = reminders
    .filter((r) => r.date === selected)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dayCheckins = checkins.filter((c) => c.date === selected);
  const dayHabitMap = new Map(habits.map((h) => [h.id, h]));

  return (
    <View style={styles.container}>
      {/* 视图切换 + 标题 */}
      <View style={styles.topBar}>
        <View style={styles.seg}>
          <TouchableOpacity style={[styles.segBtn, mode === 'month' && styles.segBtnActive]} onPress={() => setMode('month')}>
            <Text style={[styles.segText, mode === 'month' && styles.segTextActive]}>月</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segBtn, mode === 'week' && styles.segBtnActive]} onPress={() => setMode('week')}>
            <Text style={[styles.segText, mode === 'week' && styles.segTextActive]}>周</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => (mode === 'month' ? shiftMonth(-1) : shiftWeek(-1))}>
            <Ionicons name="chevron-back" size={22} color={COLORS.textLight} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>
            {mode === 'month'
              ? `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`
              : `${selWeek.getFullYear()}年${selWeek.getMonth() + 1}月`}
          </Text>
          <TouchableOpacity onPress={() => (mode === 'month' ? shiftMonth(1) : shiftWeek(1))}>
            <Ionicons name="chevron-forward" size={22} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.todayBtn}
          onPress={() => {
            const n = new Date();
            setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
            setSelWeek(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
            setSelected(toDateStr(n));
          }}
        >
          <Text style={styles.todayBtnText}>今天</Text>
        </TouchableOpacity>
      </View>

      {/* 星期表头 */}
      <View style={styles.weekHeader}>
        {WEEK_LABELS.map((w) => (
          <Text key={w} style={styles.weekHeaderText}>{w.replace('周', '')}</Text>
        ))}
      </View>

      {/* 网格 */}
      {mode === 'month' ? (
        <View style={styles.grid}>
          {monthCells.map((d, i) => (
            <DayCell key={i} d={d} selectedCell={toDateStr(d) === selected} />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekScroll}>
          <View style={styles.weekRow}>
            {weekCells.map((d, i) => (
              <DayCell key={i} d={d} selectedCell={toDateStr(d) === selected} />
            ))}
          </View>
        </ScrollView>
      )}

      {/* 图例 */}
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: COLORS.primary }]} /><Text style={styles.legendText}>待办</Text></View>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: COLORS.success }]} /><Text style={styles.legendText}>打卡</Text></View>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: COLORS.danger }]} /><Text style={styles.legendText}>漏打卡</Text></View>
      </View>

      {/* 选中当天明细 */}
      <View style={styles.detail}>
        <Text style={styles.detailTitle}>
          {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {WEEK_LABELS[selectedDate.getDay()]}
          {selected === todayStr ? ' · 今天' : ''}
        </Text>
        {dayReminders.length === 0 && dayCheckins.length === 0 && (
          <Text style={styles.emptyText}>这一天还没有记录</Text>
        )}
        {dayReminders.map((r) => (
          <TouchableOpacity
            key={r.id}
            style={[styles.detailItem, r.done && styles.detailItemDone]}
            onPress={() => onReminderPress?.(r)}
          >
            <Ionicons name={r.done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={r.done ? COLORS.success : COLORS.textLight} />
            <View style={styles.detailBody}>
              <Text style={[styles.detailText, r.done && styles.detailTextDone]}>{r.title}</Text>
              {r.time && <Text style={styles.detailSub}>{r.time}</Text>}
            </View>
            <Text style={styles.detailTag}>待办</Text>
          </TouchableOpacity>
        ))}
        {dayCheckins.map((c) => {
          const h = dayHabitMap.get(c.habitId);
          if (!h) return null;
          return (
            <TouchableOpacity
              key={c.id}
              style={styles.detailItem}
              onPress={() => h && onHabitPress?.(h)}
            >
              <Ionicons name="checkmark-circle" size={18} color={h?.color || COLORS.success} />
              <View style={styles.detailBody}>
                <Text style={styles.detailText}>{h?.name}</Text>
              </View>
              <Text style={[styles.detailTag, { color: h?.color }]}>打卡</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingBottom: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  seg: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 10, padding: 2 },
  segBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 8 },
  segBtnActive: { backgroundColor: COLORS.primary },
  segText: { fontSize: 13, color: COLORS.textLight },
  segTextActive: { color: '#fff', fontWeight: '600' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  todayBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: COLORS.background, borderWidth: 0.5, borderColor: COLORS.border },
  todayBtnText: { fontSize: 12, color: COLORS.primary, fontWeight: '500' },
  weekHeader: { flexDirection: 'row', marginBottom: 4 },
  weekHeaderText: { flex: 1, textAlign: 'center', fontSize: 12, color: COLORS.textLight },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 2,
  },
  cellSelected: { backgroundColor: COLORS.secondary },
  cellToday: { borderWidth: 1.5, borderColor: COLORS.primary },
  cellNum: { fontSize: 14, color: COLORS.text },
  cellNumDim: { color: COLORS.textLighter },
  cellNumToday: { color: COLORS.primary, fontWeight: '600' },
  dotRow: { flexDirection: 'row', gap: 3, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  weekScroll: { maxHeight: 72 },
  weekRow: { flexDirection: 'row' },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', paddingVertical: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 12, color: COLORS.textLight },
  detail: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  detailTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 10 },
  emptyText: { fontSize: 13, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 12 },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  detailItemDone: { opacity: 0.6 },
  detailBody: { flex: 1 },
  detailText: { fontSize: 14, color: COLORS.text },
  detailTextDone: { textDecorationLine: 'line-through', color: COLORS.textLight },
  detailSub: { fontSize: 11, color: COLORS.textLighter, marginTop: 2 },
  detailTag: { fontSize: 11, color: COLORS.textLight, backgroundColor: COLORS.background, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
});

export default CalendarView;
