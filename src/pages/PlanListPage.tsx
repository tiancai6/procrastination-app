import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { Reminder, Habit, HabitCheckin } from '../types';
import {
  getReminders,
  getHabits,
  getCheckins,
  getHabitStreak,
  toggleHabitCheckin,
  updateReminder,
  toDateStr,
} from '../utils/storage';
import { onDataReset } from '../utils/appEvents';
import { WEEK_LABELS } from '../components/CalendarPicker';
import ReminderSheet from '../components/ReminderSheet';
import HabitSheet from '../components/HabitSheet';
import CalendarView from '../components/CalendarView';

type TabKey = 'todo' | 'habit' | 'calendar';

const PlanListPage: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('todo');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkins, setCheckins] = useState<HabitCheckin[]>([]);
  const [streaks, setStreaks] = useState<Record<string, number>>({});

  const [reminderSheet, setReminderSheet] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [habitSheet, setHabitSheet] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  const todayStr = toDateStr(new Date());

  const reload = useCallback(async () => {
    const [rs, hs, cs] = await Promise.all([getReminders(), getHabits(), getCheckins()]);
    setReminders(rs);
    setHabits(hs);
    setCheckins(cs);
    const st: Record<string, number> = {};
    for (const h of hs) st[h.id] = await getHabitStreak(h.id);
    setStreaks(st);
  }, []);

  useEffect(() => {
    reload();
    const off = onDataReset(() => reload());
    return off;
  }, [reload]);

  // ===== 待办分组 =====
  const todoToday = reminders.filter((r) => r.date === todayStr);
  const todoUpcoming = reminders.filter((r) => r.date > todayStr);
  const todoOverdue = reminders.filter((r) => r.date < todayStr && !r.done);
  const todoDone = reminders.filter((r) => r.done);
  const todayPending = todoToday.filter((r) => !r.done).length;
  const todayDone = todoToday.filter((r) => r.done).length;

  const openReminder = (r?: Reminder) => {
    setEditingReminder(r || null);
    setReminderSheet(true);
  };

  const openHabit = (h?: Habit) => {
    setEditingHabit(h || null);
    setHabitSheet(true);
  };

  const onCheckin = async (h: Habit) => {
    await toggleHabitCheckin(h.id, todayStr);
    reload();
  };

  const isCheckedToday = (habitId: string) => checkins.some((c) => c.habitId === habitId && c.date === todayStr);

  const freqText = (h: Habit) =>
    h.frequency === 'daily' ? '每天' : `每周 ${h.weekDays.map((d) => WEEK_LABELS[d].replace('周', '')).join(' ')}`;

  // ===== 渲染 =====
  const renderTodoSection = (title: string, list: Reminder[], emptyHint?: string) => {
    if (list.length === 0 && emptyHint) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionEmpty}>{emptyHint}</Text>
        </View>
      );
    }
    if (list.length === 0) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}（{list.length}）</Text>
        {list.map((r) => (
          <TouchableOpacity key={r.id} style={styles.todoItem} onPress={() => openReminder(r)}>
            <TouchableOpacity
              style={[styles.check, r.done && styles.checkDone]}
              onPress={() => {
                const upd = { ...r, done: !r.done };
                updateReminder(upd).then(() => reload());
              }}
            >
              {r.done && <Ionicons name="checkmark" size={14} color="#fff" />}
            </TouchableOpacity>
            <View style={styles.todoBody}>
              <Text style={[styles.todoText, r.done && styles.todoTextDone]}>{r.title}</Text>
              <Text style={styles.todoSub}>
                {r.date.slice(5).replace('-', '/')}
                {r.time ? ` ${r.time}` : ' 全天'}
                {r.note ? ` · ${r.note}` : ''}
              </Text>
            </View>
            {r.date < todayStr && !r.done && <Text style={styles.overdueTag}>逾期</Text>}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderHabitItem = ({ item }: { item: Habit }) => {
    const checked = isCheckedToday(item.id);
    const streak = streaks[item.id] || 0;
    return (
      <View style={[styles.habitCard, { borderLeftColor: item.color }]}>
        <TouchableOpacity style={styles.habitMain} onPress={() => openHabit(item)}>
          <View style={styles.habitTop}>
            <Text style={styles.habitName}>{item.name}</Text>
            <Text style={styles.habitFreq}>{freqText(item)}</Text>
          </View>
          {item.note ? <Text style={styles.habitNote}>{item.note}</Text> : null}
          <View style={styles.habitMeta}>
            <View style={styles.streakBox}>
              <Ionicons name="flame" size={14} color={streak > 0 ? '#BA7517' : COLORS.textLighter} />
              <Text style={[styles.streakText, streak > 0 && styles.streakActive]}>连续 {streak} 天</Text>
            </View>
            {item.reminderTime && (
              <View style={styles.remindBox}>
                <Ionicons name="alarm-outline" size={13} color={COLORS.textLight} />
                <Text style={styles.remindText}>{item.reminderTime}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.checkinBtn, checked && styles.checkinBtnDone]}
          onPress={() => onCheckin(item)}
        >
          <Ionicons name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={checked ? '#fff' : item.color} />
          <Text style={[styles.checkinText, checked && styles.checkinTextDone]}>{checked ? '今日已打卡' : '去打卡'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.page}>
      {/* 顶部 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>规划与打卡</Text>
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'todo' && styles.tabActive]} onPress={() => setTab('todo')}>
            <Text style={[styles.tabText, tab === 'todo' && styles.tabTextActive]}>待办</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'habit' && styles.tabActive]} onPress={() => setTab('habit')}>
            <Text style={[styles.tabText, tab === 'habit' && styles.tabTextActive]}>习惯打卡</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'calendar' && styles.tabActive]} onPress={() => setTab('calendar')}>
            <Text style={[styles.tabText, tab === 'calendar' && styles.tabTextActive]}>日历</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 内容 */}
      {tab === 'todo' && (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.summaryBlue]}>
              <Text style={styles.summaryNum}>{todayPending}</Text>
              <Text style={styles.summaryLabel}>今天待完成</Text>
              <Text style={styles.summarySub}>已完成 {todayDone}</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryAmber]}>
              <Text style={styles.summaryNum}>{reminders.length}</Text>
              <Text style={styles.summaryLabel}>全部待办</Text>
            </View>
            <View style={[styles.summaryCard, styles.summaryGreen]}>
              <Text style={styles.summaryNum}>{todoDone.length}</Text>
              <Text style={styles.summaryLabel}>已完成</Text>
            </View>
          </View>
          {renderTodoSection('今天', todoToday)}
          {renderTodoSection('即将到来', todoUpcoming)}
          {renderTodoSection('已逾期', todoOverdue)}
          {renderTodoSection('已完成', todoDone)}
          {reminders.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="checkbox-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>还没有待办，点右下角 + 添加</Text>
            </View>
          )}
        </ScrollView>
      )}

      {tab === 'habit' && (
        <View style={styles.content}>
          {habits.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="repeat-outline" size={48} color={COLORS.border} />
              <Text style={styles.emptyText}>还没有习惯，点右下角 + 添加每日/每周打卡</Text>
            </View>
          ) : (
            <FlatList
              data={habits}
              keyExtractor={(h) => h.id}
              renderItem={renderHabitItem}
              contentContainerStyle={styles.contentPad}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      )}

      {tab === 'calendar' && (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
          <CalendarView
            reminders={reminders}
            habits={habits}
            checkins={checkins}
            onReminderPress={(r) => openReminder(r)}
            onHabitPress={(h) => openHabit(h)}
          />
        </ScrollView>
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => (tab === 'habit' ? openHabit() : openReminder())}
      >
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      <ReminderSheet
        visible={reminderSheet}
        entry={editingReminder}
        onClose={() => setReminderSheet(false)}
        onSaved={reload}
      />
      <HabitSheet
        visible={habitSheet}
        entry={editingHabit}
        onClose={() => setHabitSheet(false)}
        onSaved={reload}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: TOP_INSET + 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 12 },
  tabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: '#fff' },
  tabText: { fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  tabTextActive: { color: COLORS.primary, fontWeight: '600' },
  content: { flex: 1 },
  contentPad: { padding: 16, paddingBottom: 100 },

  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 0.5 },
  summaryBlue: { backgroundColor: '#E6F1FB', borderColor: '#B5D4F4' },
  summaryAmber: { backgroundColor: '#FAEEDA', borderColor: '#FAC775' },
  summaryGreen: { backgroundColor: '#EAF3DE', borderColor: '#C0DD97' },
  summaryNum: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  summaryLabel: { fontSize: 12, color: COLORS.textLight, marginTop: 4 },
  summarySub: { fontSize: 11, color: COLORS.textLighter, marginTop: 2 },

  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  sectionEmpty: { fontSize: 13, color: COLORS.textLighter, paddingVertical: 6 },
  todoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: COLORS.textLighter,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginRight: 10,
  },
  checkDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  todoBody: { flex: 1 },
  todoText: { fontSize: 14, color: COLORS.text },
  todoTextDone: { textDecorationLine: 'line-through', color: COLORS.textLight },
  todoSub: { fontSize: 11, color: COLORS.textLighter, marginTop: 3 },
  overdueTag: { fontSize: 10, color: COLORS.danger, backgroundColor: '#FCEBEB', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 6 },

  habitCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 5,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  habitMain: { flex: 1 },
  habitTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  habitName: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  habitFreq: { fontSize: 12, color: COLORS.textLight },
  habitNote: { fontSize: 12, color: COLORS.textLighter, marginTop: 4 },
  habitMeta: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  streakBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  streakText: { fontSize: 12, color: COLORS.textLighter },
  streakActive: { color: '#BA7517', fontWeight: '500' },
  remindBox: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  remindText: { fontSize: 12, color: COLORS.textLight },
  checkinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  checkinBtnDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  checkinText: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  checkinTextDone: { color: '#fff', fontWeight: '600' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 13, color: COLORS.textLighter, marginTop: 12, textAlign: 'center' },

  fab: {
    position: 'absolute',
    right: 18,
    bottom: 84,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});

export default PlanListPage;
