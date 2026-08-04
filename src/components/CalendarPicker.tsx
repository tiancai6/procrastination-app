import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';

interface Props {
  visible: boolean;
  value: Date;
  onConfirm: (date: Date) => void;
  onClose: () => void;
  mode?: 'date' | 'datetime';
  title?: string;
  minDate?: Date;
  maxDate?: Date;
}

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];
export const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// 生成当月网格（周一为每周首日），前后补齐上下月日期
const buildGrid = (year: number, month: number): { date: Date; inMonth: boolean }[] => {
  const first = new Date(year, month, 1);
  // getDay: 0=周日 → 转成以周一为 0
  const leading = (first.getDay() + 6) % 7;
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = leading; i > 0; i--) {
    cells.push({ date: new Date(year, month, 1 - i), inMonth: false });
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
  }
  return cells;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const CalendarPicker: React.FC<Props> = ({
  visible,
  value,
  onConfirm,
  onClose,
  mode = 'date',
  title = '选择日期',
  minDate,
  maxDate,
}) => {
  const [cursor, setCursor] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const [selected, setSelected] = useState(value);

  useEffect(() => {
    if (visible) {
      setSelected(value);
      setCursor(new Date(value.getFullYear(), value.getMonth(), 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const grid = useMemo(() => buildGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const today = new Date();

  const disabled = (d: Date) => {
    if (minDate && startOfDay(d) < startOfDay(minDate)) return true;
    if (maxDate && startOfDay(d) > startOfDay(maxDate)) return true;
    return false;
  };

  const pickDay = (d: Date) => {
    if (disabled(d)) return;
    const next = new Date(d);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setSelected(next);
    if (d.getMonth() !== cursor.getMonth()) {
      setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  };

  const setHour = (h: number) => {
    const next = new Date(selected);
    next.setHours(h);
    setSelected(next);
  };

  const setMinute = (m: number) => {
    const next = new Date(selected);
    next.setMinutes(m);
    setSelected(next);
  };

  const shiftMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  };

  const goToday = () => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    const next = new Date(now);
    if (mode === 'date') next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setSelected(next);
  };

  const selectedLabel = `${selected.getFullYear()}年${selected.getMonth() + 1}月${selected.getDate()}日 ${
    WEEK_LABELS[selected.getDay()]
  }${
    mode === 'datetime'
      ? ` ${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`
      : ''
  }`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          {/* 头部 */}
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          {/* 已选提示 */}
          <View style={styles.selectedBar}>
            <Ionicons name="calendar" size={14} color={COLORS.primary} />
            <Text style={styles.selectedText}>{selectedLabel}</Text>
          </View>

          {/* 月份切换 */}
          <View style={styles.monthRow}>
            <TouchableOpacity style={styles.navBtn} onPress={() => shiftMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={goToday}>
              <Text style={styles.monthText}>
                {cursor.getFullYear()}年 {cursor.getMonth() + 1}月
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => shiftMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* 星期表头 */}
          <View style={styles.weekHead}>
            {WEEK_HEAD.map((w, i) => (
              <Text key={w} style={[styles.weekHeadText, i >= 5 && styles.weekHeadWeekend]}>
                {w}
              </Text>
            ))}
          </View>

          {/* 日期网格 */}
          <View style={styles.grid}>
            {grid.map(({ date, inMonth }, idx) => {
              const sel = isSameDay(date, selected);
              const isToday = isSameDay(date, today);
              const dis = disabled(date);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <TouchableOpacity
                  key={idx}
                  style={styles.cell}
                  onPress={() => pickDay(date)}
                  disabled={dis}
                  activeOpacity={0.7}
                >
                  <View style={[styles.cellInner, sel && styles.cellSelected]}>
                    <Text
                      style={[
                        styles.cellText,
                        !inMonth && styles.cellTextOut,
                        weekend && inMonth && !sel && styles.cellTextWeekend,
                        sel && styles.cellTextSelected,
                        dis && styles.cellTextDisabled,
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                  </View>
                  {isToday && !sel && <View style={styles.todayDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 时间选择 */}
          {mode === 'datetime' && (
            <View style={styles.timeSection}>
              <Text style={styles.timeLabel}>时间</Text>
              <View style={styles.timeRow}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.timeScroll}
                  contentContainerStyle={styles.timeScrollContent}
                >
                  {HOURS.map((h) => (
                    <TouchableOpacity
                      key={h}
                      style={[styles.timeChip, selected.getHours() === h && styles.timeChipActive]}
                      onPress={() => setHour(h)}
                    >
                      <Text
                        style={[styles.timeChipText, selected.getHours() === h && styles.timeChipTextActive]}
                      >
                        {String(h).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.timeRow}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.timeScroll}
                  contentContainerStyle={styles.timeScrollContent}
                >
                  {MINUTES.map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.timeChip, selected.getMinutes() === m && styles.timeChipActive]}
                      onPress={() => setMinute(m)}
                    >
                      <Text
                        style={[styles.timeChipText, selected.getMinutes() === m && styles.timeChipTextActive]}
                      >
                        {String(m).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          )}

          {/* 底部按钮 */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.todayBtn} onPress={goToday}>
              <Text style={styles.todayBtnText}>今天</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={() => {
                onConfirm(selected);
                onClose();
              }}
            >
              <Text style={styles.confirmText}>确定</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  selectedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  selectedText: { fontSize: 13.5, color: COLORS.primary, fontWeight: '600' },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthText: { fontSize: 15.5, fontWeight: '700', color: COLORS.text },
  weekHead: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekHeadText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
    paddingVertical: 6,
  },
  weekHeadWeekend: { color: COLORS.danger },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: { backgroundColor: COLORS.primary },
  cellText: { fontSize: 14, color: COLORS.text },
  cellTextOut: { color: COLORS.textLighter, opacity: 0.5 },
  cellTextWeekend: { color: COLORS.danger },
  cellTextSelected: { color: '#fff', fontWeight: '700' },
  cellTextDisabled: { color: COLORS.textLighter, opacity: 0.35 },
  todayDot: {
    position: 'absolute',
    bottom: 4,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  timeSection: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  timeLabel: { fontSize: 12.5, color: COLORS.textLight, marginBottom: 6, fontWeight: '600' },
  timeRow: { marginBottom: 6 },
  timeScroll: { flexGrow: 0 },
  timeScrollContent: { gap: 6, paddingRight: 8 },
  timeChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  timeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  timeChipText: { fontSize: 13, color: COLORS.text },
  timeChipTextActive: { color: '#fff', fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  todayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtnText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  cancelText: { fontSize: 14.5, color: COLORS.textLight, fontWeight: '500' },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  confirmText: { fontSize: 14.5, color: '#fff', fontWeight: '600' },
});

export default CalendarPicker;
