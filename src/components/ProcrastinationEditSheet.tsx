import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { ProcrastinationRecord } from '../types';
import { updateRecord, deleteRecord } from '../utils/storage';

interface Props {
  visible: boolean;
  entry: ProcrastinationRecord | null;
  onClose: () => void;
  onChanged?: () => void;
}

const TASK_TYPES: { value: ProcrastinationRecord['taskType']; label: string }[] = [
  { value: 'work', label: '工作' },
  { value: 'life', label: '生活' },
  { value: 'entertainment', label: '娱乐' },
  { value: 'other', label: '其他' },
];

const fmtDateTime = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const ProcrastinationEditSheet: React.FC<Props> = ({ visible, entry, onClose, onChanged }) => {
  const [reason, setReason] = useState('');
  const [taskType, setTaskType] = useState<ProcrastinationRecord['taskType']>('other');
  const [duration, setDuration] = useState('');
  const [startTs, setStartTs] = useState(Date.now());
  const [note, setNote] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());

  useEffect(() => {
    if (visible && entry) {
      setReason(entry.reason);
      setTaskType(entry.taskType);
      setDuration(String(entry.duration));
      setStartTs(entry.startTime);
      setNote(entry.note || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry]);

  if (!visible || !entry) return null;

  const adjustDuration = (delta: number) => {
    const cur = parseInt(duration || '0', 10);
    const next = Math.max(1, cur + delta);
    setDuration(String(next));
  };

  const onDateChange = (event: any, date?: Date) => {
    if (date) setTempDate(date);
    if (Platform.OS === 'android') {
      if (event.type === 'set' && date) {
        applyDate(date);
      }
      setShowDatePicker(false);
    }
  };

  const applyDate = (date: Date) => {
    // 保留原发生时间的时分
    const orig = new Date(startTs);
    const merged = new Date(date);
    merged.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    setStartTs(merged.getTime());
  };

  const openDatePicker = () => {
    setTempDate(new Date(startTs));
    setShowDatePicker(true);
  };

  const doSave = async () => {
    const dur = parseInt(duration || '0', 10);
    if (!reason.trim()) {
      Alert.alert('请填写拖延原因');
      return;
    }
    if (!dur || dur <= 0) {
      Alert.alert('请输入有效时长（分钟）');
      return;
    }
    const updated: ProcrastinationRecord = {
      ...entry!,
      reason: reason.trim(),
      taskType,
      duration: dur,
      startTime: startTs,
      endTime: startTs + dur * 60000,
      note: note.trim() || undefined,
    };
    await updateRecord(updated);
    onChanged?.();
    onClose();
  };

  const doDelete = () => {
    Alert.alert('删除记录', '确定删除这条拖延记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteRecord(entry!.id);
          onChanged?.();
          onClose();
        },
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>编辑记录</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.field}>
              <Text style={styles.label}>原因</Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                placeholder="拖延原因"
                placeholderTextColor={COLORS.textLighter}
                maxLength={30}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>类型</Text>
              <View style={styles.seg}>
                {TASK_TYPES.map((t) => (
                  <TouchableOpacity
                    key={t.value}
                    style={[styles.segBtn, taskType === t.value && styles.segBtnActive]}
                    onPress={() => setTaskType(t.value)}
                  >
                    <Text style={[styles.segText, taskType === t.value && styles.segTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>时长（分钟）</Text>
              <View style={styles.durationRow}>
                <TouchableOpacity style={styles.stepper} onPress={() => adjustDuration(-5)}>
                  <Ionicons name="remove" size={18} color={COLORS.text} />
                </TouchableOpacity>
                <TextInput
                  style={styles.durationInput}
                  value={duration}
                  onChangeText={(t) => setDuration(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  textAlign="center"
                />
                <TouchableOpacity style={styles.stepper} onPress={() => adjustDuration(5)}>
                  <Ionicons name="add" size={18} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.durationUnit}>分钟</Text>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>发生时间</Text>
              <TouchableOpacity style={styles.dateRow} onPress={openDatePicker}>
                <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
                <Text style={styles.dateText}>{fmtDateTime(startTs)}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>备注</Text>
              <TextInput
                style={styles.input}
                value={note}
                onChangeText={setNote}
                placeholder="备注（可选）"
                placeholderTextColor={COLORS.textLighter}
                maxLength={50}
              />
            </View>

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={doDelete}>
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                <Text style={styles.actionDeleteText}>删除</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionSave]} onPress={doSave}>
                <Text style={styles.actionSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker value={tempDate} mode="date" display="default" onChange={onDateChange} />
      )}
      <Modal
        visible={showDatePicker && Platform.OS === 'ios'}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <View style={styles.iosOverlay}>
          <View style={styles.iosSheet}>
            <View style={styles.iosHeader}>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={styles.iosCancel}>取消</Text>
              </TouchableOpacity>
              <Text style={styles.iosTitle}>选择日期</Text>
              <TouchableOpacity
                onPress={() => {
                  applyDate(tempDate);
                  setShowDatePicker(false);
                }}
              >
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
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 24,
    maxHeight: '92%',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flexGrow: 0,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 6,
  },
  input: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
  },
  segBtnActive: {
    backgroundColor: COLORS.primary,
  },
  segText: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  segTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepper: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationInput: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  durationUnit: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
  },
  dateText: {
    fontSize: 15,
    color: COLORS.text,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionDelete: {
    backgroundColor: '#FEE2E2',
    flex: 0.6,
  },
  actionDeleteText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
  actionSave: {
    backgroundColor: COLORS.primary,
  },
  actionSaveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
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
});

export default ProcrastinationEditSheet;
