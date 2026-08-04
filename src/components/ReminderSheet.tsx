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
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { Reminder } from '../types';
import { generateId, addReminder, updateReminder } from '../utils/storage';
import { scheduleTodoReminder, cancelTodoReminder } from '../utils/reminder';
import CalendarPicker, { WEEK_LABELS } from './CalendarPicker';

interface Props {
  visible: boolean;
  entry?: Reminder | null;
  onClose: () => void;
  onSaved?: () => void;
}

const fmtDate = (dateStr: string, timeStr?: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_LABELS[d.getDay()]}`;
  return timeStr ? `${base} ${timeStr}` : base;
};

const ReminderSheet: React.FC<Props> = ({ visible, entry, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (entry) {
      setTitle(entry.title);
      setNote(entry.note || '');
      setDateStr(entry.date);
      setTimeStr(entry.time);
      setDone(entry.done);
    } else {
      const t = new Date();
      setTitle('');
      setNote('');
      setDateStr(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
      setTimeStr(undefined);
      setDone(false);
    }
  }, [visible, entry]);

  const doSave = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert('请填写内容', '待办内容不能为空');
      return;
    }
    let notificationId: string | null | undefined = entry?.notificationId ?? null;
    // 编辑时先取消旧通知，避免重复
    if (entry?.notificationId) {
      await cancelTodoReminder(entry.notificationId);
      notificationId = null;
    }
    const reminder: Reminder = {
      id: entry?.id || generateId(),
      title: t,
      date: dateStr,
      time: timeStr,
      note: note.trim() || undefined,
      done,
      notificationId: null,
      createdAt: entry?.createdAt || Date.now(),
    };
    // 若设置了时间且未完成，调度本地通知
    if (timeStr && !done) {
      notificationId = await scheduleTodoReminder(reminder);
    }
    reminder.notificationId = notificationId || null;

    if (entry) await updateReminder(reminder);
    else await addReminder(reminder);
    onSaved?.();
    onClose();
  };

  const doDelete = () => {
    if (!entry) return;
    Alert.alert('删除待办', '确定删除这条待办吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (entry.notificationId) await cancelTodoReminder(entry.notificationId);
          const { deleteReminder } = await import('../utils/storage');
          await deleteReminder(entry.id);
          onSaved?.();
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{entry ? '编辑待办' : '新建待办'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>内容</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：交水电费 / 提交周报"
              placeholderTextColor={COLORS.textLighter}
              value={title}
              onChangeText={setTitle}
              maxLength={50}
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

            <Text style={styles.label}>日期与时间</Text>
            <TouchableOpacity style={styles.dateRow} onPress={() => setShowPicker(true)}>
              <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
              <Text style={styles.dateText}>{fmtDate(dateStr, timeStr)}</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textLight} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.timeClear}
              onPress={() => setTimeStr(undefined)}
              disabled={!timeStr}
            >
              <Text style={[styles.timeClearText, !timeStr && styles.disabledText]}>
                {timeStr ? '清除具体时间（改为全天）' : '未设置具体时间'}
              </Text>
            </TouchableOpacity>

            {entry && (
              <View style={styles.switchRow}>
                <Text style={styles.label}>标记为已完成</Text>
                <Switch value={done} onValueChange={setDone} thumbColor={done ? COLORS.primary : '#fff'} />
              </View>
            )}
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

        <CalendarPicker
          visible={showPicker}
          value={new Date(`${dateStr}T${timeStr || '00:00'}:00`)}
          mode="datetime"
          title="选择日期与时间"
          onConfirm={(d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            setDateStr(`${y}-${m}-${day}`);
            setTimeStr(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
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
  scroll: { maxHeight: '70%' },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 12 },
  label: { fontSize: 13, color: COLORS.textLight, marginTop: 14, marginBottom: 6 },
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
  noteInput: { minHeight: 72, textAlignVertical: 'top' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    gap: 8,
  },
  dateText: { flex: 1, fontSize: 15, color: COLORS.text },
  timeClear: { marginTop: 8, alignSelf: 'flex-start' },
  timeClearText: { fontSize: 12, color: COLORS.primary },
  disabledText: { color: COLORS.textLighter },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
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

export default ReminderSheet;
