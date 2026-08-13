import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
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
  getBodyProfileHistory,
  ExerciseRecord,
  DailyActivity,
  BodyProfileSnapshot,
} from '../utils/storage';
import { Habit, HabitCheckin } from '../types';
import { getExerciseTypes, DEFAULT_EXERCISE_TYPES } from '../utils/activity';
import { getActiveConfig } from '../utils/modelConfig';
import { postChat } from '../utils/model';
import TrendPage from './TrendPage';

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

// 本地离线估算运动消耗（kcal），仅用于展示/AI 摘要兜底
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

type Segment = 'day' | 'week' | 'month' | 'year';

const EXERCISE_AI_PROMPT = `你是专业的健身与身体管理教练。用户给你一份已脱敏的运动与身体数据摘要（仅含数字，无个人身份信息）。
请基于这些数据，用中文输出一份亲切、有数据支撑的分析与可执行建议，结构如下（用换行分段，不要输出 JSON）：
一、整体运动情况（训练频率、总时长、消耗是否达标）
二、训练结构点评（各类别占比是否合理，力量/有氧/柔韧是否均衡）
三、身体趋势点评（体重/体脂/肌肉变化方向与速度，是否正常）
四、下周具体建议（3-5 条，具体到「练什么、练几次、每次多久」）
要求：语气鼓励、不评判；结论必须有数据支撑；不要编造摘要里没有的信息；总长度控制在 400 字以内。`;

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

const ExerciseCalendarPage: React.FC = () => {
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

  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [trendVisible, setTrendVisible] = useState(false);

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
    entriesInRange.forEach(([date, act]) => {
      days += 1;
      act.exercises.forEach((e) => {
        totalMin += e.durationMin || 0;
        totalCount += 1;
        typeMin[e.type] = (typeMin[e.type] || 0) + (e.durationMin || 0);
        typeKcal[e.type] = (typeKcal[e.type] || 0) + (e.kcal && e.kcal > 0 ? e.kcal : estKcalLocal(e.type, e.durationMin || 0));
        perWeekday[new Date(date + 'T00:00:00').getDay()] += e.durationMin || 0;
      });
    });
    const totalKcal = Object.values(typeKcal).reduce((s, v) => s + v, 0);
    const typeRows = Object.entries(typeMin)
      .sort((a, b) => b[1] - a[1])
      .map(([type, min]) => ({ type, min, pct: totalMin ? Math.round((min / totalMin) * 100) : 0 }));
    const typeMax = typeRows.reduce((m, r) => Math.max(m, r.min), 0);
    const maxWeekday = Math.max(...perWeekday, 0);
    return { totalMin, totalCount, days, totalKcal, typeRows, typeMax, perWeekday, maxWeekday };
  }, [entriesInRange]);

  // —— 身体趋势（区间内，无则用全部）——
  const bodyInRange = useMemo(
    () => body.filter((s) => s.date >= range.start && s.date <= range.end),
    [body, range],
  );
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
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
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
  };

  const openDay = (s: string) => {
    setSelected(s);
    resetForm();
  };

  const startEdit = (e: ExerciseRecord) => {
    setEditing(e);
    setExType(e.type);
    setExDuration(String(e.durationMin));
    setExNote(e.note || '');
    setExCustom('');
    setExPlan(e.plan || '');
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
        ? { ...e, type: finalType, durationMin: dur, note: exNote.trim() || undefined, plan: exPlan.trim() || undefined }
        : e,
    );
    if (!editing) {
      exercises = [
        ...exercises,
        { id: generateId(), type: finalType, durationMin: dur, note: exNote.trim() || undefined, plan: exPlan.trim() || undefined },
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

  // —— AI 分析 ——
  const analyze = async () => {
    setAnalyzing(true);
    setAnalysis('');
    const cfg = await getActiveConfig(false);
    if (!cfg) {
      setAnalysis('未配置 AI 模型，请先到「我的 → 管理 AI 模型」添加模型。');
      setAnalyzing(false);
      return;
    }
    const summary: Record<string, unknown> = {
      周期: range.label,
      训练天数: periodStats.days,
      总时长分钟: periodStats.totalMin,
      总次数: periodStats.totalCount,
      总消耗kcal: periodStats.totalKcal,
      日均分钟: periodStats.days ? Math.round(periodStats.totalMin / periodStats.days) : 0,
      类别时长占比: periodStats.typeRows.map((r) => ({ 类型: r.type, 分钟: r.min, 占比: r.pct + '%' })),
      周几分布分钟: ['日', '一', '二', '三', '四', '五', '六'].map((w, i) => ({ 周几: '周' + w, 分钟: periodStats.perWeekday[i] })),
      身体趋势: bodySummary
        ? {
            记录条数: bodySummary.count,
            开始体重: bodySummary.startWeight,
            最新体重: bodySummary.lastWeight,
            体重变化: (bodySummary.change >= 0 ? '+' : '') + bodySummary.change + 'kg',
            最新BMI: bodySummary.lastBmi,
            体脂率: bodySummary.hasFat ? `${bodySummary.startFat}→${bodySummary.lastFat}%` : '无数据',
            肌肉量: bodySummary.hasMuscle ? `${bodySummary.startMuscle}→${bodySummary.lastMuscle}kg` : '无数据',
          }
        : '无身体数据',
    };
    try {
      const content = await postChat(
        cfg,
        [
          { role: 'system', content: EXERCISE_AI_PROMPT },
          { role: 'user', content: `以下是我的运动与身体数据摘要：\n${JSON.stringify(summary, null, 2)}\n请给我一份中文分析与建议。` },
        ],
        { temperature: 0.6, maxTokens: 1200 },
      );
      setAnalysis(content || '（AI 返回为空）');
    } catch (e: any) {
      setAnalysis('分析失败：' + (e?.message || '未知错误'));
    }
    setAnalyzing(false);
  };

  // —— 渲染：日历单元格（月视图）——
  const renderCell = (d: Date) => {
    const s = toDateStr(d);
    const isThisMonth = d.getMonth() === cursor.getMonth();
    const isToday = s === todayStr;
    const isSel = s === selected;
    const exercises = allActivity[s]?.exercises || [];
    const dur = exercises.reduce((sum, e) => sum + (e.durationMin || 0), 0);
    return (
      <TouchableOpacity
        key={s}
        style={[styles.cell, isToday && styles.cellToday, !isThisMonth && styles.cellOtherMonth, isSel && styles.cellSelected]}
        onPress={() => openDay(s)}
      >
        <Text style={[styles.cellNum, !isThisMonth && styles.cellNumDim, isToday && styles.cellNumToday, isSel && styles.cellNumSel]}>
          {d.getDate()}
        </Text>
        {exercises.length > 0 ? (
          <View style={styles.cellExDots}>
            {exercises.slice(0, 3).map((e) => (
              <View key={e.id} style={[styles.cellExDot, { backgroundColor: hashType(e.type) }]} />
            ))}
            <Text style={styles.cellDur}>{fmtDur(dur)}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderWeekCell = (d: Date) => {
    const s = toDateStr(d);
    const isToday = s === todayStr;
    const isSel = s === selected;
    const exercises = allActivity[s]?.exercises || [];
    const dur = exercises.reduce((sum, e) => sum + (e.durationMin || 0), 0);
    return (
      <TouchableOpacity
        key={s}
        style={[styles.wkCell, isToday && styles.cellToday, isSel && styles.cellSelected]}
        onPress={() => openDay(s)}
      >
        <Text style={styles.wkWeekday}>{WEEK_LABELS[d.getDay()].replace('周', '')}</Text>
        <Text style={[styles.wkNum, isToday && styles.cellNumToday, isSel && styles.cellNumSel]}>{d.getDate()}</Text>
        {exercises.length > 0 && (
          <View style={styles.wkFoot}>
            <View style={[styles.wkDot, { backgroundColor: hashType(exercises[0].type) }]} />
            <Text style={styles.wkDur}>{fmtDur(dur)}</Text>
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

  const showGrid = segment !== 'year';

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
        {/* 日/周/月/年 段选择 */}
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

        {/* 日历 / 周条 / 年柱图 */}
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
          <View style={styles.weekStrip}>
            {weekDays.map((d) => renderWeekCell(d))}
          </View>
        ) : (
          <>
            <View style={styles.weekHeader}>
              {WEEK_LABELS.map((w) => (
                <Text key={w} style={styles.weekHeaderText}>{w.replace('周', '')}</Text>
              ))}
            </View>
            <View style={styles.grid}>{monthCells.map((d) => renderCell(d))}</View>
          </>
        )}

        <Text style={styles.hint}>
          点任意日期查看 / 补记当天运动；有颜色圆点即当天有训练，下方显示该天具体事项。
        </Text>

        {/* —— 选中日期详情面板（常驻日历下方，替代旧弹窗） —— */}
        <View style={styles.detailPanel}>
          <View style={styles.detailHead}>
            <Ionicons name="barbell-outline" size={16} color={COLORS.primary} />
            <Text style={styles.detailTitle}>
              {selectedDate.getMonth() + 1}月{selectedDate.getDate()}日 {WEEK_LABELS[selectedDate.getDay()]}
              {selected === todayStr ? ' · 今天' : ''}
            </Text>
          </View>

          {dayExercises.length === 0 ? (
            <Text style={styles.emptyText}>这一天还没有运动记录</Text>
          ) : (
            <>
              <View style={styles.daySummary}>
                <Text style={styles.daySummaryText}>
                  共 {dayExercises.length} 项 · 总时长 {fmtDur(dayExercises.reduce((s, e) => s + (e.durationMin || 0), 0))}
                </Text>
              </View>
              {dayExercises.map((e) => (
                <View key={e.id} style={[styles.exItem, editing?.id === e.id && styles.exItemEditing]}>
                  <View style={[styles.exDot, { backgroundColor: hashType(e.type) }]} />
                  <View style={styles.exBody}>
                    <Text style={styles.exItemName}>{e.type}</Text>
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
              ))}
            </>
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
                  <View style={[styles.exTypeDot, { backgroundColor: hashType(t) }]} />
                  <Text style={[styles.exTypeChipText, exType === t && styles.exTypeChipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {exType === '其他' && (
              <>
                <Text style={styles.sheetLabel}>自定义运动名称</Text>
                <TextInput style={styles.inputBox} placeholder="例如：爬楼梯 / 椭圆机" placeholderTextColor={COLORS.textLighter} value={exCustom} onChangeText={setExCustom} returnKeyType="done" blurOnSubmit />
              </>
            )}
            <Text style={styles.sheetLabel}>时长（分钟）</Text>
            <TextInput style={styles.inputBox} keyboardType="numeric" placeholder="如 45" placeholderTextColor={COLORS.textLighter} value={exDuration} onChangeText={setExDuration} returnKeyType="done" blurOnSubmit />
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
        </View>

        {/* —— 区间统计 —— */}
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

        {/* —— 类别占比 —— */}
        {periodStats.typeRows.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>训练类别占比（{range.label}）</Text>
            {periodStats.typeRows.map((r) => (
              <View key={r.type} style={styles.typeRow}>
                <Text style={styles.typeName}>{r.type}</Text>
                <View style={styles.typeBarTrack}>
                  <View style={[styles.typeBar, { width: `${periodStats.typeMax ? (r.min / periodStats.typeMax) * 100 : 0}%`, backgroundColor: hashType(r.type) }]} />
                </View>
                <Text style={styles.typeMin}>{r.min}′ · {r.pct}%</Text>
              </View>
            ))}
          </View>
        )}

        {/* —— 训练时段分布（按周几） —— */}
        {periodStats.maxWeekday > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>训练时段分布（按周几 · {range.label}）</Text>
            {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
              <View key={w} style={styles.typeRow}>
                <Text style={styles.typeName}>周{w}</Text>
                <View style={styles.typeBarTrack}>
                  <View style={[styles.typeBar, { width: `${periodStats.maxWeekday ? (periodStats.perWeekday[i] / periodStats.maxWeekday) * 100 : 0}%`, backgroundColor: COLORS.accent }]} />
                </View>
                <Text style={styles.typeMin}>{periodStats.perWeekday[i] > 0 ? fmtDur(periodStats.perWeekday[i]) : '·'}</Text>
              </View>
            ))}
          </View>
        )}

        {/* —— AI 分析 —— */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>AI 运动与身体分析（{range.label}）</Text>
          <TouchableOpacity style={styles.aiBtn} onPress={analyze} disabled={analyzing}>
            {analyzing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="sparkles-outline" size={16} color="#fff" />}
            <Text style={styles.aiBtnText}>{analyzing ? '分析中…' : analysis ? '重新分析' : 'AI 分析我的运动与身体趋势'}</Text>
          </TouchableOpacity>
          {analysis ? <Text style={styles.aiText}>{analysis}</Text> : null}
        </View>

        <View style={{ height: 90 }} />
      </ScrollView>

      {/* 底部：查看健身与身体趋势 */}
      <TouchableOpacity style={styles.bottomBtn} onPress={() => setTrendVisible(true)}>
        <Ionicons name="pulse-outline" size={18} color="#fff" />
        <Text style={styles.bottomBtnText}>查看健身与身体趋势</Text>
      </TouchableOpacity>

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
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  backBtn: { padding: 2 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#FFFFFF' },
  todayBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)' },
  todayBtnText: { fontSize: 13, color: '#fff', fontWeight: '500' },
  segment: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9 },
  segBtnActive: { backgroundColor: '#fff' },
  segText: { fontSize: 14, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  segTextActive: { color: COLORS.primary, fontWeight: '700' },

  scroll: { flex: 1, paddingTop: 8 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 10 },
  navTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, minWidth: 150, textAlign: 'center' },

  weekHeader: { flexDirection: 'row', marginTop: 6, marginBottom: 4, paddingHorizontal: 8 },
  weekHeaderText: { flex: 1, textAlign: 'center', fontSize: 12, color: COLORS.textLight },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  cell: {
    width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'flex-start',
    borderRadius: 10, paddingTop: 4, paddingHorizontal: 2, marginBottom: 2,
  },
  cellOtherMonth: { opacity: 0.4 },
  cellToday: { borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.secondary },
  cellSelected: { backgroundColor: COLORS.primary, borderWidth: 1.5, borderColor: COLORS.primary },
  cellNum: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  cellNumDim: { color: COLORS.textLighter },
  cellNumToday: { color: COLORS.primary, fontWeight: '700' },
  cellNumSel: { color: '#fff', fontWeight: '700' },
  cellExDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 3, justifyContent: 'center', alignItems: 'center' },
  cellExDot: { width: 6, height: 6, borderRadius: 3 },
  cellDur: { fontSize: 9, color: COLORS.textLight, fontWeight: '600' },

  weekStrip: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 4 },
  wkCell: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, marginHorizontal: 3,
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border,
  },
  wkWeekday: { fontSize: 11, color: COLORS.textLight },
  wkNum: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginVertical: 2 },
  wkFoot: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  wkDot: { width: 7, height: 7, borderRadius: 3.5 },
  wkDur: { fontSize: 10, color: COLORS.textLight, fontWeight: '600' },

  yearBox: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 6, alignItems: 'flex-end', height: 200 },
  yearCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  yearBarTrack: { width: 16, height: 130, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: COLORS.background, borderRadius: 8 },
  yearBar: { width: '100%', borderRadius: 8, minHeight: 4 },
  yearMonth: { fontSize: 10, color: COLORS.textLight, marginTop: 6 },
  yearMin: { fontSize: 9, color: COLORS.textLighter, marginTop: 2 },

  hint: { fontSize: 12, color: COLORS.textLighter, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 20 },

  // 选中日详情面板
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
  exDot: { width: 10, height: 10, borderRadius: 5 },
  exBody: { flex: 1 },
  exItemName: { fontSize: 14, fontWeight: '600', color: COLORS.text },
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
  exTypeDot: { width: 8, height: 8, borderRadius: 4 },
  exTypeChipText: { fontSize: 13, color: COLORS.text },
  exTypeChipTextActive: { color: COLORS.primary, fontWeight: '600' },
  inputBox: {
    backgroundColor: COLORS.background, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16,
    paddingVertical: 13, borderRadius: 14, backgroundColor: COLORS.primary,
  },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cancelEditBtn: {
    marginTop: 8, alignItems: 'center', paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  cancelEditText: { fontSize: 14, color: COLORS.textLight, fontWeight: '600' },

  statBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, marginHorizontal: 16,
    marginTop: 14, borderRadius: 16, paddingVertical: 14,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  statLabel: { fontSize: 12, color: COLORS.textLight, marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: COLORS.border },

  card: {
    backgroundColor: COLORS.card, marginHorizontal: 16, marginTop: 14, borderRadius: 16, padding: 16,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  cardTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 12 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  typeName: { width: 64, fontSize: 12.5, color: COLORS.text, fontWeight: '600' },
  typeBarTrack: { flex: 1, height: 14, backgroundColor: COLORS.background, borderRadius: 7, overflow: 'hidden' },
  typeBar: { height: '100%', borderRadius: 7, minWidth: 4 },
  typeMin: { width: 64, textAlign: 'right', fontSize: 12, color: COLORS.textLight },

  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 14, backgroundColor: COLORS.primary,
  },
  aiBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  aiText: { fontSize: 13.5, color: COLORS.text, lineHeight: 22, marginTop: 12 },

  bottomBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    margin: 12, paddingVertical: 13, borderRadius: 14, backgroundColor: COLORS.accent,
    shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
  },
  bottomBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default ExerciseCalendarPage;
