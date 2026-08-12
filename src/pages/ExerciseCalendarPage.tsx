import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { WEEK_LABELS } from '../components/CalendarPicker';
import {
  getAllDailyActivity,
  getDailyActivity,
  setDailyActivity,
  getHabits,
  getCheckins,
  toggleHabitCheckin,
  generateId,
  ExerciseRecord,
  DailyActivity,
} from '../utils/storage';
import { Habit, HabitCheckin } from '../types';
import { getExerciseTypes, DEFAULT_EXERCISE_TYPES } from '../utils/activity';

// 运动类型稳定调色板（按类型名哈希取色，保证同一类型始终同色）
const TYPE_PALETTE = [
  '#2563EB', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#EF4444', '#84CC16',
];
const hashType = (t: string): string => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
};

// 运动类习惯关键词（用于和习惯打卡联动）
const SPORT_KEYWORDS = ['运动', '健身', '练', '跑', '瑜伽', '力量', '游泳', '骑行', '跳', '球', '徒步', '拉伸'];
const isSportHabit = (name: string): boolean => SPORT_KEYWORDS.some((k) => name.includes(k));

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 分钟 -> H:MM 或 N′（贴近你截图的时长显示）
const fmtDur = (m: number): string => {
  const min = Math.max(0, Math.round(m));
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}` : `${mm}′`;
};

const ExerciseCalendarPage: React.FC = () => {
  const navigation = useNavigation<any>();
  const today = new Date();
  const todayStr = toDateStr(today);

  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayStr);
  const [allActivity, setAllActivity] = useState<Record<string, DailyActivity>>({});
  const [exTypes, setExTypes] = useState<string[]>(DEFAULT_EXERCISE_TYPES);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkins, setCheckins] = useState<HabitCheckin[]>([]);

  const [sheetVisible, setSheetVisible] = useState(false);
  const [exType, setExType] = useState('');
  const [exDuration, setExDuration] = useState('');
  const [exNote, setExNote] = useState('');
  const [exCustom, setExCustom] = useState('');

  const loadAll = async () => {
    const [all, types, hb, ck] = await Promise.all([
      getAllDailyActivity(),
      getExerciseTypes(),
      getHabits(),
      getCheckins(),
    ]);
    setAllActivity(all);
    setExTypes(types);
    setHabits(hb);
    setCheckins(ck);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const selectedDate = useMemo(() => new Date(selected + 'T00:00:00'), [selected]);

  // 月历 6x7 网格（从周日开始，和规划页日历一致）
  const monthCells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  // 当月统计：训练天数 / 总时长
  const monthStats = useMemo(() => {
    const prefix = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    let days = 0;
    let totalMin = 0;
    Object.entries(allActivity).forEach(([date, act]) => {
      if (date.startsWith(prefix) && act.exercises.length > 0) {
        days += 1;
        totalMin += act.exercises.reduce((s, e) => s + (e.durationMin || 0), 0);
      }
    });
    return { days, totalMin };
  }, [allActivity, cursor]);

  const shiftMonth = (delta: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(todayStr);
  };

  const dayExercises = allActivity[selected]?.exercises || [];

  // 联动：当天生效的运动类习惯且尚未打卡
  const pendingSportHabits = useMemo(() => {
    const dow = selectedDate.getDay();
    const checkedSet = new Set(checkins.filter((c) => c.date === selected).map((c) => c.habitId));
    return habits.filter((h) => {
      if (h.status !== 'active') return false;
      if (!isSportHabit(h.name)) return false;
      const days = h.frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : h.weekDays;
      if (!days.includes(dow)) return false;
      return !checkedSet.has(h.id);
    });
  }, [habits, checkins, selected, selectedDate]);

  const openDay = (s: string) => {
    setSelected(s);
    setExType(exTypes[0] || DEFAULT_EXERCISE_TYPES[0]);
    setExDuration('');
    setExNote('');
    setExCustom('');
    setSheetVisible(true);
  };

  const handleAdd = async () => {
    const dur = parseInt(exDuration, 10);
    if (!dur || dur <= 0) {
      Alert.alert('提示', '请输入有效的时长（分钟）');
      return;
    }
    const finalType = exType === '其他' && exCustom.trim() ? exCustom.trim() : exType;
    if (!finalType) {
      Alert.alert('提示', '请选择运动类型');
      return;
    }
    // 自定义类型若不在列表里，自动追加（复用首页的增删改存储）
    let typesNow = exTypes;
    if (!typesNow.includes(finalType)) {
      const { addExerciseType } = await import('../utils/activity');
      typesNow = await addExerciseType(finalType);
      setExTypes(typesNow);
    }
    const rec: ExerciseRecord = {
      id: generateId(),
      type: finalType,
      durationMin: dur,
      note: exNote.trim() || undefined,
    };
    const cur = await getDailyActivity(selected);
    const next: DailyActivity = { ...cur, exercises: [...cur.exercises, rec] };
    await setDailyActivity(selected, next);
    await loadAll();
    setExDuration('');
    setExNote('');
    setExCustom('');
    setExType(typesNow[0] || '跑步');
  };

  const handleDelete = async (id: string) => {
    const cur = await getDailyActivity(selected);
    const next: DailyActivity = { ...cur, exercises: cur.exercises.filter((e) => e.id !== id) };
    await setDailyActivity(selected, next);
    await loadAll();
  };

  const handleCheckin = async (habitId: string) => {
    await toggleHabitCheckin(habitId, selected);
    await loadAll();
  };

  const renderCell = (d: Date) => {
    const s = toDateStr(d);
    const isThisMonth = d.getMonth() === cursor.getMonth();
    const isToday = s === todayStr;
    const exercises = allActivity[s]?.exercises || [];
    return (
      <TouchableOpacity
        key={s}
        style={[styles.cell, isToday && styles.cellToday, !isThisMonth && styles.cellOtherMonth]}
        onPress={() => openDay(s)}
      >
        <Text style={[styles.cellNum, !isThisMonth && styles.cellNumDim, isToday && styles.cellNumToday]}>
          {d.getDate()}
        </Text>
        {exercises.length > 0 && (
          <View style={styles.cellExWrap}>
            {exercises.slice(0, 3).map((e) => (
              <View key={e.id} style={[styles.cellExBar, { backgroundColor: hashType(e.type) }]}>
                <Text style={styles.cellExText} numberOfLines={1}>
                  {e.type} {fmtDur(e.durationMin)}
                </Text>
              </View>
            ))}
            {exercises.length > 3 && <Text style={styles.cellMore}>+{exercises.length - 3}</Text>}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 顶部栏 */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>运动日历</Text>
          <TouchableOpacity style={styles.todayBtn} onPress={goToday}>
            <Text style={styles.todayBtnText}>今天</Text>
          </TouchableOpacity>
        </View>
        {/* 月导航 */}
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => shiftMonth(-1)}>
            <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>
            {cursor.getFullYear()}年{cursor.getMonth() + 1}月
          </Text>
          <TouchableOpacity onPress={() => shiftMonth(1)}>
            <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 当月统计 */}
      <View style={styles.statBar}>
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{monthStats.days}</Text>
          <Text style={styles.statLabel}>训练天数</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{fmtDur(monthStats.totalMin)}</Text>
          <Text style={styles.statLabel}>本月总时长</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNum}>{exTypes.length}</Text>
          <Text style={styles.statLabel}>运动类型</Text>
        </View>
      </View>

      {/* 星期表头 */}
      <View style={styles.weekHeader}>
        {WEEK_LABELS.map((w) => (
          <Text key={w} style={styles.weekHeaderText}>{w.replace('周', '')}</Text>
        ))}
      </View>

      {/* 网格 */}
      <View style={styles.grid}>
        {monthCells.map((d) => renderCell(d))}
      </View>

      {/* 提示 */}
      <Text style={styles.hint}>点击任意日期可查看 / 补记当天运动；有颜色即当天有训练。</Text>

      {/* 某天详情 Modal */}
      <Modal visible={sheetVisible} transparent animationType="slide" onRequestClose={() => setSheetVisible(false)}>
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setSheetVisible(false); }}>
          <View style={styles.sheetWrap}>
            <KeyboardAvoidingView behavior="padding" style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={styles.sheetHead}>
                  <Text style={styles.sheetTitle}>
                    {selectedDate.getFullYear()}年{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {WEEK_LABELS[selectedDate.getDay()]}
                    {selected === todayStr ? ' · 今天' : ''}
                  </Text>
                  <TouchableOpacity onPress={() => { Keyboard.dismiss(); setSheetVisible(false); }}>
                    <Ionicons name="close-circle" size={24} color={COLORS.textLighter} />
                  </TouchableOpacity>
                </View>

                {/* 当天运动列表 */}
                {dayExercises.length === 0 ? (
                  <Text style={styles.emptyText}>这一天还没有运动记录</Text>
                ) : (
                  dayExercises.map((e) => (
                    <View key={e.id} style={styles.exItem}>
                      <View style={[styles.exDot, { backgroundColor: hashType(e.type) }]} />
                      <View style={styles.exBody}>
                        <Text style={styles.exItemName}>{e.type}</Text>
                        <Text style={styles.exItemSub}>
                          时长 {fmtDur(e.durationMin)}
                          {e.note ? ` · ${e.note}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => handleDelete(e.id)}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))
                )}

                {/* 联动：运动类习惯补打卡 */}
                {pendingSportHabits.length > 0 && (
                  <View style={styles.checkinBox}>
                    <Text style={styles.checkinTitle}>习惯补打卡</Text>
                    {pendingSportHabits.map((h) => (
                      <TouchableOpacity
                        key={h.id}
                        style={[styles.checkinBtn, { borderColor: h.color || COLORS.primary }]}
                        onPress={() => handleCheckin(h.id)}
                      >
                        <Ionicons name="checkmark-circle-outline" size={16} color={h.color || COLORS.primary} />
                        <Text style={[styles.checkinText, { color: h.color || COLORS.primary }]}>
                          补打卡：{h.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* 添加运动（补打卡） */}
                <View style={styles.addBox}>
                  <Text style={styles.sheetLabel}>添加运动（补记任意一天）</Text>
                  <View style={styles.exTypeRow}>
                    {exTypes.map((t) => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.exTypeChip, exType === t && styles.exTypeChipActive]}
                        onPress={() => setExType(t)}
                      >
                        <View style={[styles.exTypeDot, { backgroundColor: hashType(t) }]} />
                        <Text style={[styles.exTypeChipText, exType === t && styles.exTypeChipTextActive]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {exType === '其他' && (
                    <>
                      <Text style={styles.sheetLabel}>自定义运动名称</Text>
                      <TextInput
                        style={styles.inputBox}
                        placeholder="例如：爬楼梯 / 椭圆机"
                        placeholderTextColor={COLORS.textLighter}
                        value={exCustom}
                        onChangeText={setExCustom}
                        returnKeyType="done"
                        blurOnSubmit
                      />
                    </>
                  )}
                  <Text style={styles.sheetLabel}>时长（分钟）</Text>
                  <TextInput
                    style={styles.inputBox}
                    keyboardType="numeric"
                    placeholder="如 45"
                    placeholderTextColor={COLORS.textLighter}
                    value={exDuration}
                    onChangeText={setExDuration}
                    returnKeyType="done"
                    blurOnSubmit
                  />
                  <Text style={styles.sheetLabel}>备注（可选）</Text>
                  <TextInput
                    style={styles.inputBox}
                    placeholder="如：力量+有氧"
                    placeholderTextColor={COLORS.textLighter}
                    value={exNote}
                    onChangeText={setExNote}
                    returnKeyType="done"
                    blurOnSubmit
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                    <Ionicons name="add-circle-outline" size={16} color="#fff" />
                    <Text style={styles.addBtnText}>保存到这一天</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ height: 20 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: TOP_INSET + 12,
    paddingBottom: 14,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  backBtn: { padding: 2 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF' },
  todayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  todayBtnText: { fontSize: 13, color: '#fff', fontWeight: '500' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  navTitle: { fontSize: 16, fontWeight: '600', color: '#fff', minWidth: 120, textAlign: 'center' },

  statBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    marginHorizontal: 16,
    marginTop: -14,
    borderRadius: 16,
    paddingVertical: 14,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: COLORS.border },

  weekHeader: { flexDirection: 'row', marginTop: 16, marginBottom: 4, paddingHorizontal: 8 },
  weekHeaderText: { flex: 1, textAlign: 'center', fontSize: 12, color: COLORS.textLight },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderRadius: 10,
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  cellOtherMonth: { opacity: 0.45 },
  cellToday: { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.secondary },
  cellNum: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  cellNumDim: { color: COLORS.textLighter },
  cellNumToday: { color: COLORS.primary, fontWeight: '700' },
  cellExWrap: {
    width: '100%',
    marginTop: 3,
    gap: 2,
    alignItems: 'center',
  },
  cellExBar: {
    width: '100%',
    borderRadius: 4,
    paddingVertical: 1.5,
    paddingHorizontal: 3,
    alignItems: 'center',
  },
  cellExText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  cellMore: { fontSize: 9, color: COLORS.textLight },

  hint: {
    fontSize: 12,
    color: COLORS.textLighter,
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },

  // Modal
  sheetWrap: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, flex: 1, marginRight: 8 },
  emptyText: {
    fontSize: 13,
    color: COLORS.textLighter,
    textAlign: 'center',
    paddingVertical: 16,
  },
  exItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  exDot: { width: 10, height: 10, borderRadius: 5 },
  exBody: { flex: 1 },
  exItemName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  exItemSub: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },

  checkinBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: COLORS.secondary,
  },
  checkinTitle: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  checkinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  checkinText: { fontSize: 14, fontWeight: '600' },

  addBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  sheetLabel: { fontSize: 13, color: COLORS.textLight, marginTop: 10, marginBottom: 6 },
  exTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  exTypeChipActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.primary },
  exTypeDot: { width: 8, height: 8, borderRadius: 4 },
  exTypeChipText: { fontSize: 13, color: COLORS.text },
  exTypeChipTextActive: { color: COLORS.primary, fontWeight: '600' },
  inputBox: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default ExerciseCalendarPage;
