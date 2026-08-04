import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { Habit } from '../types';
import { generateId, saveHabit, deleteHabit } from '../utils/storage';
import { WEEK_LABELS } from './CalendarPicker';

interface Props {
  visible: boolean;
  entry?: Habit | null;
  onClose: () => void;
  onSaved?: () => void;
}

const COLOR_PRESETS = ['#378ADD', '#639922', '#BA7517', '#993556', '#534AB7', '#0F6E56', '#D85A30', '#185FA5'];

const HabitSheet: React.FC<Props> = ({ visible, entry, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [weekDays, setWeekDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [remindOn, setRemindOn] = useState(false);
  const [reminderTime, setReminderTime] = useState('09:00');
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [showTime, setShowTime] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (entry) {
      setName(entry.name);
      setNote(entry.note || '');
      setFrequency(entry.frequency);
      setWeekDays(entry.weekDays.length ? entry.weekDays : [0, 1, 2, 3, 4, 5, 6]);
      setRemindOn(!!entry.reminderTime);
      setReminderTime(entry.reminderTime || '09:00');
      setColor(entry.color || COLOR_PRESETS[0]);
    } else {
      setName('');
      setNote('');
      setFrequency('daily');
      setWeekDays([0, 1, 2, 3, 4, 5, 6]);
      setRemindOn(false);
      setReminderTime('09:00');
      setColor(COLOR_PRESETS[0]);
    }
  }, [visible, entry]);

  const toggleDay = (d: number) => {
    setWeekDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  const doSave = async () => {
    const n = name.trim();
    if (!n) {
      Alert.alert('请填写名称', '习惯名称不能为空');
      return;
    }
    if (frequency === 'weekly' && weekDays.length === 0) {
      Alert.alert('请选择星期', '每周打卡至少需要选择一天');
      return;
    }
    const habit: Habit = {
      id: entry?.id || generateId(),
      name: n,
      note: note.trim() || undefined,
      frequency,
      weekDays: frequency === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : weekDays,
      reminderTime: remindOn ? reminderTime : null,
      color,
      createdAt: entry?.createdAt || Date.now(),
      status: 'active',
    };
    await saveHabit(habit);
    onSaved?.();
    onClose();
  };

  const doDelete = () => {
    if (!entry) return;
    Alert.alert('删除习惯', '确定删除这个习惯吗？所有打卡记录也会一并删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteHabit(entry.id);
          onSaved?.();
          onClose();
        },
      },
    ]);
  };

  const onTimeChange = (_e: any, selected?: Date) => {
    setShowTime(false);
    if (selected) {
      setReminderTime(`${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{entry ? '编辑习惯' : '新建习惯'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>习惯名称</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：每日阅读 30 分钟"
              placeholderTextColor={COLORS.textLighter}
              value={name}
              onChangeText={setName}
              maxLength={30}
            />

            <Text style={styles.label}>备注（可不填）</Text>
            <TextInput
              style={[styles.input, styles.noteInput]}
              placeholder="补充说明…"
              placeholderTextColor={COLORS.textLighter}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={200}
            />

            <Text style={styles.label}>重复频率</Text>
            <View style={styles.seg}>
              <TouchableOpacity
                style={[styles.segBtn, frequency === 'daily' && styles.segBtnActive]}
                onPress={() => setFrequency('daily')}
              >
                <Text style={[styles.segText, frequency === 'daily' && styles.segTextActive]}>每日</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segBtn, frequency === 'weekly' && styles.segBtnActive]}
                onPress={() => setFrequency('weekly')}
              >
                <Text style={[styles.segText, frequency === 'weekly' && styles.segTextActive]}>每周</Text>
              </TouchableOpacity>
            </View>

            {frequency === 'weekly' && (
              <View style={styles.weekWrap}>
                {WEEK_LABELS.map((label, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.weekChip, weekDays.includes(idx) && styles.weekChipActive]}
                    onPress={() => toggleDay(idx)}
                  >
                    <Text style={[styles.weekChipText, weekDays.includes(idx) && styles.weekChipTextActive]}>
                      {label.replace('周', '')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.switchRow}>
              <View>
                <Text style={styles.label}>每日提醒</Text>
                <Text style={styles.sub}>到点提醒我去打卡</Text>
              </View>
              <Switch value={remindOn} onValueChange={setRemindOn} thumbColor={remindOn ? COLORS.primary : '#fff'} />
            </View>
            {remindOn && (
              <TouchableOpacity style={styles.timeRow} onPress={() => setShowTime(true)}>
                <Ionicons name="alarm-outline" size={18} color={COLORS.primary} />
                <Text style={styles.timeText}>{reminderTime}</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
              </TouchableOpacity>
            )}

            <Text style={styles.label}>主题色</Text>
            <View style={styles.colorWrap}>
              {COLOR_PRESETS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]}
                  onPress={() => setColor(c)}
                >
                  {color === c && <Ionicons name="checkmark" size={14} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            {entry && (
              <TouchableOpacity style={styles.deleteBtn} onPress={doDelete}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.saveBtn} onPress={doSave}>
              <Text style={styles.saveBtnText}>保存</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showTime && (
          <DateTimePicker
            value={new Date(`2000-01-01T${reminderTime}:00`)}
            mode="time"
            is24Hour
            display="spinner"
            onChange={onTimeChange}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  kav: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '92%',
    paddingBottom: 16,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: COLORS.text },
  scroll: { maxHeight: '68%' },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 12 },
  label: { fontSize: 13, color: COLORS.textLight, marginTop: 14, marginBottom: 6 },
  sub: { fontSize: 11, color: COLORS.textLighter, marginTop: -4 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  noteInput: { minHeight: 64, textAlignVertical: 'top' },
  seg: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 12, padding: 3, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.primary },
  segText: { fontSize: 14, color: COLORS.textLight },
  segTextActive: { color: '#fff', fontWeight: '600' },
  weekWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  weekChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  weekChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  weekChipText: { fontSize: 13, color: COLORS.textLight },
  weekChipTextActive: { color: '#fff', fontWeight: '500' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    gap: 8,
  },
  timeText: { flex: 1, fontSize: 15, color: COLORS.text },
  colorWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotActive: { borderColor: COLORS.text, transform: [{ scale: 1.05 }] },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
  },
  deleteBtn: {
    width: 50,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default HabitSheet;
