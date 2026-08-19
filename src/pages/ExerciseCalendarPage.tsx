import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Svg, Circle } from 'react-native-svg';
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
  getBodyProfileHistory,
  ExerciseRecord,
  DailyActivity,
  BodyProfileSnapshot,
} from '../utils/storage';
import { Habit, HabitCheckin } from '../types';
import { getExerciseTypes, DEFAULT_EXERCISE_TYPES, estimateExerciseKcal, addExerciseType, removeExerciseType } from '../utils/activity';
import TrendPage from './TrendPage';

// 运动类型调色板（奶茶暖色调，比之前的莫兰迪冷色更鲜艳活泼）
const TYPE_PALETTE = [
  '#E8856A', // 暖珊瑚/陶土色
  '#6BB380', // 清新绿
  '#E8B84A', // 蜂蜜金
  '#D4768E', // 玫瑰粉
  '#5DADE2', // 天空蓝
  '#AF7AC5', // 薰衣草紫
  '#F0B27A', // 焦糖色
  '#58D68D', // 薄荷绿
];

// 训练时段（5 选 1）
const TIME_SLOTS: { key: 'morning' | 'forenoon' | 'afternoon' | 'evening' | 'night'; label: string }[] = [
  { key: 'morning', label: '晨' },
  { key: 'forenoon', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚上' },
  { key: 'night', label: '夜' },
];

// 运动类习惯关键词（用于和习惯打卡联动）
const SPORT_KEYWORDS = ['运动', '健身', '练', '跑', '瑜伽', '力量', '游泳', '骑行', '跳', '球', '徒步', '拉伸'];
const isSportHabit = (name: string): boolean => SPORT_KEYWORDS.some((k) => name.includes(k));

// 本地离线估算运动消耗（kcal），仅用于展示兜底
const estKcalLocal = (type: string, min: number): number => {
  const t = type.toLowerCase();
  let rate = 6;
  if (t.includes('跑') || t.includes('骑') || t.includes('游') || t.includes('跳') || t.includes('球') || t.includes('hiit')) rate = 10;
  else if (t.includes('力量') || t.includes('瑜伽') || t.includes('拉伸') || t.includes('普拉提')) rate = 5;
  else if (t.includes('走') || t.includes('散步')) rate = 4;
  return Math.round(rate * min);
};

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 分钟 -> H:MM 或 N′
const fmtDur = (m: number): string => {
  const min = Math.max(0, Math.round(m));
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}` : `${mm}′`;
};

// 热力图已去除：月历格子统一白底 + 浅灰边框，运动类型用小圆点区分

type Segment = 'day' | 'week' | 'month' | 'year';

// 由 段(日/周/月/年) + 游标 + 选中日 推导统计区间与标题
const rangeOf = (seg: Segment, cursor: Date, sel: string) => {
  const sd = new Date(sel + 'T00:00:00');
  if (seg === 'day') {
    return { start: sel, end: sel, label: `${sd.getMonth() + 1}月${sd.getDate()}日` };
  }
  if (seg === 'week') {
    const dow = (sd.getDay() + 6) % 7; // 周一是 0
    const mon = new Date(sd);
    mon.setDate(sd.getDate() - dow);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 7);
    const end = new Date(sun.getTime() - 86400000);
    return {
      start: toDateStr(mon),
      end: toDateStr(end),
      label: `${mon.getMonth() + 1}月${mon.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`,
    };
  }
  if (seg === 'month') {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    return { start: toDateStr(new Date(y, m, 1)), end: toDateStr(new Date(y, m + 1, 0)), label: `${y}年${m + 1}月` };
  }
  const y = cursor.getFullYear();
  return { start: toDateStr(new Date(y, 0, 1)), end: toDateStr(new Date(y, 11, 31)), label: `${y}年` };
};

// 类别占比环形图（SVG 实现）
const DonutChart: React.FC<{ segments: { label: string; value: number }[]; size?: number; thickness?: number }> = ({
  segments,
  size = 148,
  thickness = 22,
}) => {
  const cx = size / 2;
  const radius = (size - thickness) / 2;
  const circ = 2 * Math.PI * radius;
  const total = segments.reduce((s, d) => s + d.value, 0);
  let acc = 0;
  const colored = segments.filter((s) => s.value > 0);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={cx} cy={cx} r={radius} stroke={COLORS.border} strokeWidth={thickness} fill="none" />
      {total > 0 &&
        colored.map((s, i) => {
          const len = (s.value / total) * circ;
          const el = (
            <Circle
              key={s.label}
              cx={cx}
              cy={cx}
              r={radius}
              stroke={TYPE_PALETTE[i % TYPE_PALETTE.length]}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-acc}
              rotation="-90"
              originX={cx}
              originY={cx}
            />
          );
          acc += len;
          return el;
        })}
    </Svg>
  );
};

const ExerciseCalendarPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const navigation = useNavigation<any>();
  const today = new Date();
  const todayStr = toDateStr(today);

  const [segment, setSegment] = useState<Segment>('month');
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(todayStr);
  const [allActivity, setAllActivity] = useState<Record<string, DailyActivity>>({});
  const [exTypes, setExTypes] = useState<string[]>(DEFAULT_EXERCISE_TYPES);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkins, setCheckins] = useState<HabitCheckin[]>([]);
  const [body, setBody] = useState<BodyProfileSnapshot[]>([]);

  const [editing, setEditing] = useState<ExerciseRecord | null>(null);
  const [exType, setExType] = useState('');
  const [exDuration, setExDuration] = useState('');
  const [exNote, setExNote] = useState('');
  const [exCustom, setExCustom] = useState('');
  const [exPlan, setExPlan] = useState('');
  const [exSlot, setExSlot] = useState<ExerciseRecord['timeOfDay'] | ''>('');
  const [exKcal, setExKcal] = useState('');
  const [estimatingEx, setEstimatingEx] = useState(false);
  const [exTypeManager, setExTypeManager] = useState(false);
  const [newTypeInput, setNewTypeInput] = useState('');

  const [distMode, setDistMode] = useState<'type' | 'slot'>('type');
  const [trendVisible, setTrendVisible] = useState(false);
  const [dayModalVisible, setDayModalVisible] = useState(false);

  const loadAll = async () => {
    const [all, types, hb, ck, b] = await Promise.all([
      getAllDailyActivity(),
      getExerciseTypes(),
      getHabits(),
      getCheckins(),
      getBodyProfileHistory(),
    ]);
    setAllActivity(all);
    setExTypes(types);
    setHabits(hb);
    setCheckins(ck);
    setBody(b);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const range = useMemo(() => rangeOf(segment, cursor, selected), [segment, cursor, selected]);
  const selectedDate = useMemo(() => new Date(selected + 'T00:00:00'), [selected]);

  // —— 区间内聚合 ——
  const entriesInRange = useMemo(
    () =>
      Object.entries(allActivity).filter(
        ([date, act]) => date >= range.start && date <= range.end && act.exercises.length > 0,
      ),
    [allActivity, range],
  );

  const periodStats = useMemo(() => {
    let totalMin = 0;
    let totalCount = 0;
    let days = 0;
    const typeMin: Record<string, number> = {};
    const typeKcal: Record<string, number> = {};
    const perWeekday = new Array(7).fill(0);
    const perTimeOfDay: Record<string, number> = { morning: 0, forenoon: 0, afternoon: 0, evening: 0, night: 0 };
    entriesInRange.forEach(([date, act]) => {
      days += 1;
      act.exercises.forEach((e) => {
        totalMin += e.durationMin || 0;
        totalCount += 1;
        typeMin[e.type] = (typeMin[e.type] || 0) + (e.durationMin || 0);
        typeKcal[e.type] = (typeKcal[e.type] || 0) + (e.kcal && e.kcal > 0 ? e.kcal : estKcalLocal(e.type, e.durationMin || 0));
        perWeekday[new Date(date + 'T00:00:00').getDay()] += e.durationMin || 0;
        if (e.timeOfDay) perTimeOfDay[e.timeOfDay] += e.durationMin || 0;
      });
    });
    const totalKcal = Object.values(typeKcal).reduce((s, v) => s + v, 0);
    const typeRows = Object.entries(typeMin)
      .sort((a, b) => b[1] - a[1])
      .map(([type, min]) => ({ type, min, pct: totalMin ? Math.round((min / totalMin) * 100) : 0 }));
    const typeMax = typeRows.reduce((m, r) => Math.max(m, r.min), 0);
    const maxWeekday = Math.max(...perWeekday, 0);
    const maxSlot = Math.max(...Object.values(perTimeOfDay), 0);
    return { totalMin, totalCount, days, totalKcal, typeRows, typeMax, perWeekday, maxWeekday, perTimeOfDay, maxSlot };
  }, [entriesInRange]);

  // —— 身体趋势（区间内，无则用全部）——
  const bodyInRange = useMemo(() => body.filter((s) => s.date >= range.start && s.date <= range.end), [body, range]);
  const bodySummary = useMemo(() => {
    const arr = bodyInRange.length ? bodyInRange : body;
    if (arr.length === 0) return null;
    const first = arr[0];
    const last = arr[arr.length - 1];
    return {
      count: arr.length,
      startWeight: first.weight,
      lastWeight: last.weight,
      change: Math.round((last.weight - first.weight) * 10) / 10,
      lastBmi: last.bmi,
      hasFat: arr.some((s) => s.bodyFatPct != null),
      startFat: first.bodyFatPct,
      lastFat: last.bodyFatPct,
      hasMuscle: arr.some((s) => s.muscleMass != null),
      startMuscle: first.muscleMass,
      lastMuscle: last.muscleMass,
    };
  }, [bodyInRange, body]);

  // —— 日历视图 ——
  const monthCells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const last = new Date(year, month + 1, 0);
    // 只生成覆盖当月最后一天的那个周六为止的格子，避免强制 6 行造成下方空白
    const end = new Date(year, month + 1, 6 - last.getDay());
    const cells: Date[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      cells.push(new Date(d));
    }
    return cells;
  }, [cursor]);

  const weekDays = useMemo(() => {
    const sd = new Date(selected + 'T00:00:00');
    const dow = (sd.getDay() + 6) % 7;
    const mon = new Date(sd);
    mon.setDate(sd.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  }, [selected]);

  const yearBars = useMemo(() => {
    const y = cursor.getFullYear();
    const arr = [];
    for (let m = 1; m <= 12; m++) {
      let min = 0;
      Object.entries(allActivity).forEach(([date, act]) => {
        if (date.startsWith(`${y}-${String(m).padStart(2, '0')}`) && act.exercises.length) {
          act.exercises.forEach((e) => (min += e.durationMin || 0));
        }
      });
      arr.push({ month: m, min });
    }
    return { arr, max: Math.max(...arr.map((a) => a.min), 0) };
  }, [allActivity, cursor]);

  const dayExercises = allActivity[selected]?.exercises || [];

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

  // —— 区间导航 ——
  const shiftRange = (delta: number) => {
    if (segment === 'day') {
      const d = new Date(selected + 'T00:00:00');
      d.setDate(d.getDate() + delta);
      setSelected(toDateStr(d));
      setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    } else if (segment === 'week') {
      const d = new Date(selected + 'T00:00:00');
      d.setDate(d.getDate() + 7 * delta);
      setSelected(toDateStr(d));
      setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    } else if (segment === 'month') {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
    } else {
      setCursor((c) => new Date(c.getFullYear() + delta, c.getMonth(), 1));
    }
  };

  const goToday = () => {
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(todayStr);
  };

  const resetForm = () => {
    setEditing(null);
    setExType(exTypes[0] || DEFAULT_EXERCISE_TYPES[0]);
    setExDuration('');
    setExNote('');
    setExCustom('');
    setExPlan('');
    setExSlot('');
    setExKcal('');
  };

  const openDay = (s: string) => {
    setSelected(s);
    resetForm();
    setDayModalVisible(true);
  };

  const startEdit = (e: ExerciseRecord) => {
    setEditing(e);
    setExType(e.type);
    setExDuration(String(e.durationMin));
    setExNote(e.note || '');
    setExCustom('');
    setExPlan(e.plan || '');
    setExSlot(e.timeOfDay || '');
    setExKcal(e.kcal ? String(e.kcal) : '');
  };

  const estimateEx = async () => {
    const d = parseInt(exDuration, 10);
    if (!d || d <= 0) {
      Alert.alert('提示', '请先填写有效的时长（分钟）');
      return;
    }
    setEstimatingEx(true);
    try {
      const finalType = exType === '其他' && exCustom.trim() ? exCustom.trim() : exType;
      const kcal = await estimateExerciseKcal(`${finalType} ${d}分钟`);
      if (kcal) setExKcal(String(kcal));
      else Alert.alert('估算失败', '请检查网络或手动填写消耗');
    } finally {
      setEstimatingEx(false);
    }
  };

  const handleSave = async () => {
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
    let typesNow = exTypes;
    if (!typesNow.includes(finalType)) {
      const { addExerciseType } = await import('../utils/activity');
      typesNow = await addExerciseType(finalType);
      setExTypes(typesNow);
    }
    const cur = await getDailyActivity(selected);
    let exercises = cur.exercises.map((e) =>
      editing && e.id === editing.id
        ? {
            ...e,
            type: finalType,
            durationMin: dur,
            kcal: exKcal ? parseInt(exKcal, 10) : undefined,
            note: exNote.trim() || undefined,
            plan: exPlan.trim() || undefined,
            timeOfDay: exSlot ? exSlot : undefined,
          }
        : e,
    );
    if (!editing) {
      exercises = [
        ...exercises,
        {
          id: generateId(),
          type: finalType,
          durationMin: dur,
          kcal: exKcal ? parseInt(exKcal, 10) : undefined,
          note: exNote.trim() || undefined,
          plan: exPlan.trim() || undefined,
          timeOfDay: exSlot ? exSlot : undefined,
        },
      ];
    }
    await setDailyActivity(selected, { ...cur, exercises });
    await loadAll();
    resetForm();
  };

  const handleDelete = async (id: string) => {
    const cur = await getDailyActivity(selected);
    const next: DailyActivity = { ...cur, exercises: cur.exercises.filter((e) => e.id !== id) };
    await setDailyActivity(selected, next);
    if (editing && editing.id === id) resetForm();
    await loadAll();
  };

  const handleCheckin = async (habitId: string) => {
    await toggleHabitCheckin(habitId, selected);
    await loadAll();
  };

  // —— 渲染：月历单元格（热力图）——
  const renderCell = (d: Date) => {
    const s = toDateStr(d);
    const isThisMonth = d.getMonth() === cursor.getMonth();
    const isToday = s === todayStr;
    const isSel = s === selected;
    const exercises = allActivity[s]?.exercises || [];
    const dur = exercises.reduce((sum, e) => sum + (e.durationMin || 0), 0);
    // 按类型聚合时长（同类型多条合并显示）
    const typeMap = new Map<string, number>();
    exercises.forEach((e) => {
      const t = e.type || '其他';
      typeMap.set(t, (typeMap.get(t) || 0) + (e.durationMin || 0));
    });
    const typeEntries = Array.from(typeMap.entries());
    return (
      <TouchableOpacity
        key={s}
        style={[
          styles.cell,
          isToday && styles.cellToday,
          !isThisMonth && styles.cellOtherMonth,
          isSel && styles.cellSelected,
        ]}
        onPress={() => openDay(s)}
      >
        <Text style={[styles.cellNum, !isThisMonth && styles.cellNumDim, isToday && styles.cellNumToday, isSel && styles.cellNumSel]}>
          {d.getDate()}
        </Text>
        {typeEntries.length > 0 && (
          <View style={styles.cellExList}>
            {typeEntries.slice(0, 3).map(([type, min], i) => (
              <View key={type} style={styles.cellExRow}>
                <View style={[styles.cellExDot, { backgroundColor: isSel ? '#fff' : TYPE_PALETTE[i % TYPE_PALETTE.length] }]} />
                <Text
                  style={[
                    styles.cellExItem,
                    isSel && styles.cellExItemSel,
                    { color: isSel ? '#fff' : '#475569' },
                  ]}
                >
                  {type} {fmtDur(min)}
                </Text>
              </View>
            ))}
            {typeEntries.length > 3 && (
              <Text style={[styles.cellExMore, isSel && styles.cellExItemSel]}>
                +{typeEntries.length - 3}
              </Text>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderWeekCell = (d: Date) => {
    const s = toDateStr(d);
    const isToday = s === todayStr;
    const isSel = s === selected;
    const exercises = allActivity[s]?.exercises || [];
    // 按类型聚合，用于展示彩色圆点
    const typeMap = new Map<string, number>();
    exercises.forEach((e) => {
      const t = e.type || '其他';
      typeMap.set(t, (typeMap.get(t) || 0) + (e.durationMin || 0));
    });
    const typeEntries = Array.from(typeMap.entries());
    return (
      <TouchableOpacity
        key={s}
        style={[styles.wkCell, isToday && styles.wkCellToday, isSel && styles.wkCellSelected]}
        onPress={() => openDay(s)}
        activeOpacity={0.75}
      >
        <Text style={[styles.wkNum, isToday && styles.wkNumToday, isSel && styles.wkNumSel]}>{d.getDate()}</Text>
        {typeEntries.length > 0 ? (
          <View style={styles.wkDotList}>
            {typeEntries.slice(0, 4).map(([type], i) => (
              <View key={type} style={[styles.wkDot, { backgroundColor: TYPE_PALETTE[i % TYPE_PALETTE.length] }]} />
            ))}
            {typeEntries.length > 4 && (
              <Text style={[styles.wkDotMore, isSel && styles.wkDotMoreSel]}>+{typeEntries.length - 4}</Text>
            )}
          </View>
        ) : (
          <View style={styles.wkDotList}>
            <View style={[styles.wkDot, { backgroundColor: 'transparent' }]} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const segBtns: { key: Segment; label: string }[] = [
    { key: 'day', label: '日' },
    { key: 'week', label: '周' },
    { key: 'month', label: '月' },
    { key: 'year', label: '年' },
  ];

  return (
    <View style={styles.container}>
      {/* 顶部栏（embedded 时嵌入统计中心，不再有返回、去掉顶部圆角） */}
      <View style={[styles.header, embedded && styles.headerEmbed]}>
        <View style={styles.headerTop}>
          {!embedded ? (
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSide} />
          )}
          <Text style={[styles.title, { flex: 1, textAlign: 'center' }]}>{embedded ? '运动记录' : '运动日历'}</Text>
          <TouchableOpacity style={styles.todayBtn} onPress={goToday}>
            <Text style={styles.todayBtnText}>今天</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.segment}>
          {segBtns.map((b) => (
            <TouchableOpacity
              key={b.key}
              style={[styles.segBtn, segment === b.key && styles.segBtnActive]}
              onPress={() => setSegment(b.key)}
            >
              <Text style={[styles.segText, segment === b.key && styles.segTextActive]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 区间导航 */}
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => shiftRange(-1)}>
            <Ionicons name="chevron-back" size={22} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>{range.label}</Text>
          <TouchableOpacity onPress={() => shiftRange(1)}>
            <Ionicons name="chevron-forward" size={22} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* —— 区间统计（上移：进页面先看到总量） —— */}
        <View style={styles.statBar}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{periodStats.days}</Text>
            <Text style={styles.statLabel}>训练天数</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{fmtDur(periodStats.totalMin)}</Text>
            <Text style={styles.statLabel}>总时长</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{periodStats.totalKcal}</Text>
            <Text style={styles.statLabel}>总消耗(kcal)</Text>
          </View>
        </View>

        {/* 日 视图：聚焦当天，不显示月历 */}
        {segment === 'day' && (
          <Text style={styles.focusHint}>
            已聚焦 {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日，下面直接显示这一天的训练与添加入口
          </Text>
        )}

        {/* 周 / 月 / 年 视图 */}
        {segment === 'year' ? (
          <View style={styles.yearBox}>
            {yearBars.arr.map((bar) => (
              <TouchableOpacity
                key={bar.month}
                style={styles.yearCol}
                onPress={() => {
                  setCursor(new Date(cursor.getFullYear(), bar.month - 1, 1));
                  setSegment('month');
                }}
              >
                <View style={styles.yearBarTrack}>
                  <View
                    style={[
                      styles.yearBar,
                      { height: `${yearBars.max ? Math.max((bar.min / yearBars.max) * 100, 4) : 4}%`, backgroundColor: bar.min > 0 ? COLORS.primary : COLORS.border },
                    ]}
                  />
                </View>
                <Text style={styles.yearMonth}>{bar.month}</Text>
                <Text style={styles.yearMin}>{bar.min > 0 ? fmtDur(bar.min) : '·'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : segment === 'week' ? (
          <View style={styles.weekCard}>
            <View style={styles.weekHeader}>
              {WEEK_LABELS.map((w) => (
                <Text key={w} style={styles.weekHeaderText}>
                  {w.replace('周', '')}
                </Text>
              ))}
            </View>
            <View style={styles.weekStrip}>
              {weekDays.map((d) => renderWeekCell(d))}
            </View>
          </View>
        ) : segment === 'month' ? (
          <>
            <View style={styles.weekHeader}>
              {WEEK_LABELS.map((w) => (
                <Text key={w} style={styles.weekHeaderText}>
                  {w.replace('周', '')}
                </Text>
              ))}
            </View>
            <View style={styles.grid}>{monthCells.map((d) => renderCell(d))}</View>
          </>
        ) : null}

        <Text style={styles.hint}>
          点任意日期查看 / 补记当天运动；每格的小圆点表示当天的运动类型。
        </Text>

        {/* —— 日视图：紧凑摘要行（点击弹出详情 Modal） —— */}
        {segment === 'day' && (
          <TouchableOpacity
            style={styles.dayCompact}
            onPress={() => setDayModalVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.dayCompactHead}>
              <Ionicons name="barbell-outline" size={16} color={COLORS.primary} />
              <Text style={styles.dayCompactTitle}>
                {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {WEEK_LABELS[selectedDate.getDay()]}
                {selected === todayStr ? ' · 今天' : ''}
              </Text>
            </View>
            {dayExercises.length === 0 ? (
              <Text style={styles.dayCompactEmpty}>点击添加运动记录</Text>
            ) : (
              <>
                <Text style={styles.dayCompactSummary}>
                  共 {dayExercises.length} 项 · 总时长 {fmtDur(dayExercises.reduce((s, e) => s + (e.durationMin || 0), 0))}
                </Text>
                <View style={styles.dayCompactRow}>
                  {dayExercises.map((e) => {
                    const slotLabel = e.timeOfDay ? TIME_SLOTS.find((s) => s.key === e.timeOfDay)?.label : '';
                    return (
                      <View key={e.id} style={styles.dayCompactChip}>
                        <Text style={styles.dayCompactChipText} numberOfLines={1}>
                          {e.type} {fmtDur(e.durationMin)}{slotLabel ? ` ${slotLabel}` : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}
            <Ionicons name="chevron-forward" size={16} color={COLORS.textLight} />
          </TouchableOpacity>
        )}

        {/* —— 类别占比 / 具体时段 切换 —— */}
        {periodStats.totalMin > 0 && (
          <View style={styles.card}>
            <View style={styles.distHead}>
              <Text style={styles.cardTitle}>训练分布（{range.label}）</Text>
              <View style={styles.distToggle}>
                <TouchableOpacity style={[styles.distToggleBtn, distMode === 'type' && styles.distToggleActive]} onPress={() => setDistMode('type')}>
                  <Text style={[styles.distToggleText, distMode === 'type' && styles.distToggleTextActive]}>类别</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.distToggleBtn, distMode === 'slot' && styles.distToggleActive]} onPress={() => setDistMode('slot')}>
                  <Text style={[styles.distToggleText, distMode === 'slot' && styles.distToggleTextActive]}>时段</Text>
                </TouchableOpacity>
              </View>
            </View>

            {distMode === 'type' ? (
              <View style={styles.donutWrap}>
                <View style={styles.donutBox}>
                  <DonutChart segments={periodStats.typeRows.map((r) => ({ label: r.type, value: r.min }))} />
                  <View style={styles.donutCenter}>
                    <Text style={styles.donutCenterNum}>{fmtDur(periodStats.totalMin)}</Text>
                    <Text style={styles.donutCenterLabel}>总时长</Text>
                  </View>
                </View>
                <View style={styles.donutLegend}>
                  {periodStats.typeRows.map((r, i) => (
                    <View key={r.type} style={styles.legendRow}>
                      <View style={[styles.legendDot, { backgroundColor: TYPE_PALETTE[i % TYPE_PALETTE.length] }]} />
                      <Text style={styles.legendName}>{r.type}</Text>
                      <Text style={styles.legendTime}>{fmtDur(r.min)}</Text>
                      <Text style={styles.legendPct}>{r.pct}%</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              TIME_SLOTS.map((s) => {
                const min = periodStats.perTimeOfDay[s.key] || 0;
                return (
                  <View key={s.key} style={styles.typeRow}>
                    <Text style={styles.typeName}>{s.label}</Text>
                    <View style={styles.typeBarTrack}>
                      <View style={[styles.typeBar, { width: `${periodStats.maxSlot ? (min / periodStats.maxSlot) * 100 : 0}%`, backgroundColor: COLORS.primaryLight }]} />
                    </View>
                    <Text style={styles.typeMin}>{min > 0 ? fmtDur(min) : '·'}</Text>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* —— 身体趋势小结（区间内） —— */}
        {bodySummary && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>身体趋势小结（{range.label}）</Text>
            <Text style={styles.bodySummaryText}>
              体重 {bodySummary.startWeight} → {bodySummary.lastWeight} kg（{bodySummary.change >= 0 ? '+' : ''}
              {bodySummary.change}） · BMI {bodySummary.lastBmi}
              {bodySummary.hasFat ? ` · 体脂 ${bodySummary.startFat}→${bodySummary.lastFat}%` : ''}
              {bodySummary.hasMuscle ? ` · 肌肉 ${bodySummary.startMuscle}→${bodySummary.lastMuscle}kg` : ''}
            </Text>
          </View>
        )}

        {/* —— 底部：查看健身与身体趋势（进入 TrendPage，AI 分析在其底部） —— */}
        <TouchableOpacity style={styles.bottomBtn} onPress={() => setTrendVisible(true)}>
          <Ionicons name="pulse-outline" size={18} color="#fff" />
          <Text style={styles.bottomBtnText}>查看健身与身体趋势</Text>
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* —— 日期详情 Modal（日/月/周/年 点击日期后弹出） —— */}
      <Modal visible={dayModalVisible} animationType="slide" transparent onRequestClose={() => setDayModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContent}>
            {/* Modal 头部 */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeadRow}>
                <Ionicons name="barbell-outline" size={18} color={COLORS.primary} />
                <Text style={styles.modalTitle}>
                  {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {WEEK_LABELS[selectedDate.getDay()]}
                  {selected === todayStr ? ' · 今天' : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => { setDayModalVisible(false); resetForm(); }} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={22} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 摘要 */}
              {dayExercises.length > 0 && (
                <View style={styles.mDaySummary}>
                  <Text style={styles.mDaySummaryText}>
                    共 {dayExercises.length} 项 · 总时长 {fmtDur(dayExercises.reduce((s, e) => s + (e.durationMin || 0), 0))}
                  </Text>
                </View>
              )}

              {/* 运动列表 */}
              {dayExercises.length === 0 ? (
                <Text style={styles.mEmptyText}>这一天还没有运动记录，在下面添加吧</Text>
              ) : (
                dayExercises.map((e) => {
                  const slotLabel = e.timeOfDay ? TIME_SLOTS.find((s) => s.key === e.timeOfDay)?.label : '';
                  return (
                    <View key={e.id} style={[styles.exItem, editing?.id === e.id && styles.exItemEditing]}>
                      <View style={[styles.exDot, { backgroundColor: TYPE_PALETTE[TYPE_PALETTE.indexOf(TYPE_PALETTE[0])] }]} />
                      <View style={styles.exBody}>
                        <Text style={styles.exItemName}>
                          {e.type}
                          {slotLabel ? <Text style={styles.exItemSlot}> · {slotLabel}</Text> : null}
                        </Text>
                        <Text style={styles.exItemSub}>时长 {fmtDur(e.durationMin)}{e.note ? ` · ${e.note}` : ''}</Text>
                        {e.plan ? <Text style={styles.exItemPlan}>计划：{e.plan}</Text> : null}
                      </View>
                      <TouchableOpacity style={styles.exAction} onPress={() => startEdit(e)}>
                        <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.exAction} onPress={() => handleDelete(e.id)}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  );
                })
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
                      <Text style={[styles.checkinText, { color: h.color || COLORS.primary }]}>补打卡：{h.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* 添加 / 修改运动 */}
              <View style={styles.addBox}>
                <Text style={styles.sheetLabel}>{editing ? `修改「${editing.type}」` : '添加运动（补记任意一天）'}</Text>
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
                        placeholderTextColor={COLORS.textLighter}
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
                    <TextInput style={styles.inputBox} placeholder="例如：爬楼梯 / 椭圆机" placeholderTextColor={COLORS.textLighter} value={exCustom} onChangeText={setExCustom} returnKeyType="done" blurOnSubmit />
                  </>
                )}
                <Text style={styles.sheetLabel}>时长（分钟）</Text>
                <TextInput style={styles.inputBox} keyboardType="numeric" placeholder="如 45" placeholderTextColor={COLORS.textLighter} value={exDuration} onChangeText={setExDuration} returnKeyType="done" blurOnSubmit />
                <TouchableOpacity style={styles.estimateBtn} onPress={estimateEx} disabled={estimatingEx}>
                  {estimatingEx ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.estimateBtnText}>AI 估算消耗</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.sheetLabel}>消耗（kcal，可留空或 AI 填）</Text>
                <TextInput style={styles.inputBox} keyboardType="numeric" placeholder="如 320" placeholderTextColor={COLORS.textLighter} value={exKcal} onChangeText={setExKcal} returnKeyType="done" blurOnSubmit />
                <Text style={styles.sheetLabel}>训练时段（可选）</Text>
                <View style={styles.slotRow}>
                  {TIME_SLOTS.map((s) => (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.slotChip, exSlot === s.key && styles.slotChipActive]}
                      onPress={() => setExSlot(exSlot === s.key ? '' : s.key)}
                    >
                      <Text style={[styles.slotChipText, exSlot === s.key && styles.slotChipTextActive]}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.sheetLabel}>训练计划（具体练了什么，可选）</Text>
                <TextInput style={styles.inputBox} placeholder="如：胸+三头推举 4 组、深蹲 5×5" placeholderTextColor={COLORS.textLighter} value={exPlan} onChangeText={setExPlan} returnKeyType="done" blurOnSubmit />
                <Text style={styles.sheetLabel}>备注（可选）</Text>
                <TextInput style={styles.inputBox} placeholder="如：力量+有氧" placeholderTextColor={COLORS.textLighter} value={exNote} onChangeText={setExNote} returnKeyType="done" blurOnSubmit />
                <TouchableOpacity style={styles.addBtn} onPress={handleSave}>
                  <Ionicons name={editing ? 'checkmark-circle-outline' : 'add-circle-outline'} size={16} color="#fff" />
                  <Text style={styles.addBtnText}>{editing ? '更新这条记录' : '保存到这一天'}</Text>
                </TouchableOpacity>
                {editing && (
                  <TouchableOpacity style={styles.cancelEditBtn} onPress={resetForm}>
                    <Text style={styles.cancelEditText}>取消修改</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* 键盘弹出时底部留足滚动余量，确保最下方的输入框能被滚上来 */}
              <View style={{ height: 140 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <TrendPage visible={trendVisible} onClose={() => setTrendVisible(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: TOP_INSET + 12,
    paddingBottom: 12,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  headerEmbed: { borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingTop: 14 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerSide: { width: 28 },
  backBtn: { padding: 2, width: 28 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF' },
  todayBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  todayBtnText: { fontSize: 13, color: '#fff', fontWeight: '500' },
  segment: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9 },
  segBtnActive: { backgroundColor: '#fff' },
  segText: { fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  segTextActive: { color: COLORS.primary, fontWeight: '700' },

  scroll: { flex: 1, paddingTop: 4 },
  focusHint: { fontSize: 12.5, color: COLORS.textLight, textAlign: 'center', paddingVertical: 8, paddingHorizontal: 24 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 4 },
  navTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, minWidth: 150, textAlign: 'center' },

  weekHeader: { flexDirection: 'row', marginTop: 4, marginBottom: 4, paddingHorizontal: 6 },
  weekHeaderText: { flex: 1, textAlign: 'center', fontSize: 11.5, color: COLORS.textLight },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6 },
  cell: {
    width: '14.28%', aspectRatio: 1.1, minHeight: 58, alignItems: 'center', justifyContent: 'flex-start',
    borderRadius: 7, paddingTop: 4, paddingHorizontal: 2, marginBottom: 2,
    borderWidth: 1, borderColor: '#F1F5F9', backgroundColor: '#FAFBFC',
  },
  cellOtherMonth: { opacity: 0.45 },
  cellToday: { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.secondary },
  cellSelected: { backgroundColor: COLORS.primary, borderWidth: 1.5, borderColor: COLORS.primary },
  cellNum: { fontSize: 11, color: COLORS.text, fontWeight: '600' },
  cellNumDim: { color: COLORS.textLighter },
  cellNumToday: { color: COLORS.primary, fontWeight: '700' },
  cellNumSel: { color: '#fff', fontWeight: '700' },
  cellExList: { alignItems: 'center', marginTop: 1 },
  cellExRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cellExItem: { fontSize: 8, fontWeight: '500', lineHeight: 10, textAlign: 'center' },
  cellExItemSel: { color: '#fff' },
  cellExDot: { width: 3, height: 3, borderRadius: 1.5, flexShrink: 0 },
  cellExMore: { fontSize: 7, color: '#fff', lineHeight: 10 },

  weekCard: {
    backgroundColor: COLORS.card, marginHorizontal: 14, marginTop: 4, borderRadius: 22,
    padding: 14, shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  weekStrip: { flexDirection: 'row', marginTop: 8, justifyContent: 'space-between' },
  wkCell: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 2,
    borderRadius: 16, marginHorizontal: 3, minHeight: 88,
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0',
  },
  wkCellToday: { borderColor: COLORS.primary, backgroundColor: '#EEF2FF' },
  wkCellSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  wkNum: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  wkNumToday: { color: COLORS.primary },
  wkNumSel: { color: '#fff' },
  wkDotList: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 10, flexWrap: 'wrap', minHeight: 10 },
  wkDot: { width: 7, height: 7, borderRadius: 3.5 },
  wkDotMore: { fontSize: 9, color: COLORS.textLight, marginLeft: 2, fontWeight: '600' },
  wkDotMoreSel: { color: 'rgba(255,255,255,0.85)' },

  yearBox: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 4, alignItems: 'flex-end', height: 170 },
  yearCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  yearBarTrack: { width: 16, height: 130, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: COLORS.background, borderRadius: 8 },
  yearBar: { width: '100%', borderRadius: 8, minHeight: 4 },
  yearMonth: { fontSize: 10, color: COLORS.textLight, marginTop: 6 },
  yearMin: { fontSize: 9, color: COLORS.textLighter, marginTop: 2 },

  hint: { fontSize: 11, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 2, paddingHorizontal: 20 },

  detailPanel: {
    backgroundColor: COLORS.card, marginHorizontal: 16, marginTop: 4, borderRadius: 16, padding: 16,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  detailTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  emptyText: { fontSize: 13, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 12 },
  daySummary: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 4,
    borderRadius: 10, backgroundColor: COLORS.secondary, paddingHorizontal: 12,
  },
  daySummaryText: { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  exItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  exItemEditing: { backgroundColor: COLORS.secondary, borderRadius: 10, borderBottomWidth: 0, paddingHorizontal: 8, marginHorizontal: -8 },
  exDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primaryLight },
  exBody: { flex: 1 },
  exItemName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  exItemSlot: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  exItemSub: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  exItemPlan: { fontSize: 12, color: COLORS.primary, marginTop: 2 },
  exAction: { paddingHorizontal: 6, paddingVertical: 4 },

  checkinBox: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: COLORS.secondary },
  checkinTitle: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  checkinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, marginBottom: 8, backgroundColor: '#fff',
  },
  checkinText: { fontSize: 14, fontWeight: '600' },

  addBox: { marginTop: 14, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  sheetLabel: { fontSize: 13, color: COLORS.textLight, marginTop: 10, marginBottom: 6 },
  exTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  exTypeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  exTypeChipActive: { backgroundColor: COLORS.secondary, borderColor: COLORS.primary },
  exTypeChipText: { fontSize: 13, color: COLORS.text },
  exTypeChipTextActive: { color: COLORS.primary, fontWeight: '600' },
  exManageBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  exManageBtnText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '600' },
  exManagerBox: { marginTop: 8, padding: 10, backgroundColor: COLORS.background, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  exTypeManageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  exTypeManageText: { fontSize: 14, color: COLORS.text },
  exAddTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  exAddTypeBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: COLORS.primary },
  exAddTypeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: {
    paddingVertical: 7, paddingHorizontal: 16, borderRadius: 14,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  slotChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  slotChipText: { fontSize: 13, color: COLORS.text },
  slotChipTextActive: { color: '#fff', fontWeight: '600' },
  inputBox: {
    backgroundColor: COLORS.background, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16,
    paddingVertical: 13, borderRadius: 14, backgroundColor: COLORS.primary,
  },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  estimateBtn: {
    marginTop: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 14, backgroundColor: COLORS.primary,
  },
  estimateBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cancelEditBtn: {
    marginTop: 8, alignItems: 'center', paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  cancelEditText: { fontSize: 14, color: COLORS.textLight, fontWeight: '600' },

  statBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, marginHorizontal: 16,
    marginTop: 14, marginBottom: 6, borderRadius: 16, paddingVertical: 12,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: COLORS.border },

  card: {
    backgroundColor: COLORS.card, marginHorizontal: 16, marginTop: 10, borderRadius: 16, padding: 14,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 12 },
  distHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  distToggle: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 10, padding: 3 },
  distToggleBtn: { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 8 },
  distToggleActive: { backgroundColor: COLORS.primary },
  distToggleText: { fontSize: 12.5, color: COLORS.textLight, fontWeight: '600' },
  distToggleTextActive: { color: '#fff', fontWeight: '700' },

  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  donutBox: { position: 'relative', width: 148, height: 148 },
  donutCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  donutCenterNum: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  donutCenterLabel: { fontSize: 11, color: COLORS.textLight, marginTop: 2 },
  donutLegend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendName: { flex: 1, fontSize: 13, color: COLORS.text, fontWeight: '500' },
  legendTime: { fontSize: 13, fontWeight: '600', color: COLORS.primary, marginRight: 6 },
  legendPct: { fontSize: 13, fontWeight: '600', color: COLORS.textLight },

  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  typeName: { width: 56, fontSize: 12.5, color: COLORS.text, fontWeight: '600' },
  typeBarTrack: { flex: 1, height: 14, backgroundColor: COLORS.background, borderRadius: 7, overflow: 'hidden' },
  typeBar: { height: '100%', borderRadius: 7, minWidth: 4 },
  typeMin: { width: 64, textAlign: 'right', fontSize: 12, color: COLORS.textLight },

  bodySummaryText: { fontSize: 13, color: COLORS.text, lineHeight: 20 },

  bottomBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: COLORS.primary,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  bottomBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // —— 日视图紧凑摘要行 ——
  dayCompact: {
    backgroundColor: COLORS.card, marginHorizontal: 16, marginTop: 4, borderRadius: 16, padding: 14,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  dayCompactHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  dayCompactTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  dayCompactEmpty: { fontSize: 13, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 4 },
  dayCompactSummary: { fontSize: 13, fontWeight: '600', color: COLORS.primary, marginBottom: 8 },
  dayCompactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dayCompactChip: {
    backgroundColor: COLORS.secondary, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10,
    borderWidth: 1, borderColor: COLORS.primaryLight,
  },
  dayCompactChipText: { fontSize: 12, fontWeight: '600', color: COLORS.text },

  // —— 日期详情 Modal ——
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '88%', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  modalHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  modalCloseBtn: { padding: 4 },
  modalScroll: { paddingHorizontal: 18 },
  mDaySummary: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, marginTop: 6, marginBottom: 2,
    borderRadius: 10, backgroundColor: COLORS.secondary, paddingHorizontal: 12,
  },
  mDaySummaryText: { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  mEmptyText: { fontSize: 13, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 20 },
});

export default ExerciseCalendarPage;
