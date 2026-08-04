import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  Keyboard,
  useWindowDimensions,
  DimensionValue,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FOCUS_CATEGORIES } from '../constants/reasons';
import { TimerSession, TimerCategory } from '../types';
import { updateTimerSession, deleteTimerSession, saveTimerSession, generateId } from '../utils/storage';
import CalendarPicker, { WEEK_LABELS } from './CalendarPicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  entry?: TimerSession | null; // 传入则为编辑模式，否则为「补记一次专注」
}

const fmtDate = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const base = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_LABELS[d.getDay()]}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${isToday ? '今天 ' : ''}${base} ${time}`;
};

const DURATION_QUICK: { label: string; delta: number }[] = [
  { label: '−15', delta: -15 },
  { label: '−5', delta: -5 },
  { label: '+5', delta: 5 },
  { label: '+15', delta: 15 },
  { label: '+30', delta: 30 },
];

const SessionEditSheet: React.FC<Props> = ({ visible, onClose, onSaved, entry }) => {
  const [category, setCategory] = useState<TimerCategory>('work');
  const [what, setWhat] = useState('');
  const [startTs, setStartTs] = useState(Date.now());
  const [duration, setDuration] = useState('25');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const isEditing = !!entry;

  // 键盘高度监听：弹窗抬到键盘上方并压缩可视高度，内容框始终可见
  const { height: screenHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const subShow = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const subHide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (entry) {
      setCategory(entry.category);
      setWhat(entry.what || '');
      setStartTs(entry.startTime);
      setDuration(String(Math.max(1, Math.round(entry.duration))));
    } else {
      setCategory('work');
      setWhat('');
      setStartTs(Date.now());
      setDuration('25');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry]);

  if (!visible) return null;

  const parseDuration = (): number => {
    const n = Math.round(Number(duration));
    if (!isFinite(n) || n <= 0) return 1;
    return Math.min(6000, n);
  };

  const adjustDuration = (delta: number) => {
    const next = parseDuration() + delta;
    setDuration(String(Math.max(1, next)));
  };

  const doSave = async (closeAfter: boolean) => {
    const mins = parseDuration();
    const endTime = startTs + mins * 60000;
    const now = Date.now();
    if (entry) {
      const updated: TimerSession = {
        ...entry,
        category,
        what: what.trim(),
        startTime: startTs,
        endTime,
        duration: mins,
      };
      await updateTimerSession(updated);
      onSaved?.();
      onClose();
    } else {
      const newSession: TimerSession = {
        id: generateId(),
        category,
        what: what.trim(),
        startTime: startTs,
        endTime,
        duration: mins,
        createdAt: now,
      };
      // 复用 storage 的 saveTimerSession 落库（通过 onSaved 触发父级刷新）
      await saveTimerSession(newSession);
      onSaved?.();
      if (closeAfter) {
        onClose();
      } else {
        // 保存并继续：重置为新的补记草稿
        setWhat('');
        setStartTs(Date.now());
        setDuration('25');
        setCategory('work');
      }
    }
  };

  const doDelete = () => {
    Alert.alert('删除记录', '确定删除这条专注记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteTimerSession(entry!.id);
          onSaved?.();
          onClose();
        },
      },
    ]);
  };

  const sheetMaxHeight: DimensionValue =
    keyboardHeight > 0 ? Math.max(220, screenHeight - keyboardHeight - 16) : '92%';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalInner, { paddingBottom: keyboardHeight }]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{isEditing ? '编辑专注记录' : '补记一次专注'}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* 开始时间 */}
            <TouchableOpacity style={styles.dateRow} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
              <Text style={styles.dateText}>{fmtDate(startTs)} 开始</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textLighter} style={styles.dateArrow} />
            </TouchableOpacity>

            {/* 分类 chips */}
            <Text style={styles.fieldLabel}>分类</Text>
            <View style={styles.catWrap}>
              {FOCUS_CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.catChip, category === c.value && styles.catChipActive]}
                  onPress={() => setCategory(c.value)}
                >
                  <Text style={[styles.catChipText, category === c.value && styles.catChipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 时长 */}
            <Text style={styles.fieldLabel}>专注时长（分钟）</Text>
            <View style={styles.durationRow}>
              <TextInput
                style={styles.durationInput}
                value={duration}
                onChangeText={setDuration}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={styles.durationUnit}>分钟</Text>
            </View>
            <View style={styles.quickWrap}>
              {DURATION_QUICK.map((q) => (
                <TouchableOpacity key={q.label} style={styles.quickBtn} onPress={() => adjustDuration(q.delta)}>
                  <Text style={styles.quickBtnText}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 内容 */}
            <Text style={styles.fieldLabel}>做了什么（可选）</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="如：写周报、背单词 30 个"
              placeholderTextColor={COLORS.textLighter}
              value={what}
              onChangeText={setWhat}
              maxLength={50}
            />
          </ScrollView>

          {/* 固定操作栏 */}
          {isEditing ? (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={doDelete}>
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                <Text style={styles.actionDeleteText}>删除</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionSave]} onPress={() => doSave(true)}>
                <Text style={styles.actionSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionContinue]} onPress={() => doSave(false)}>
                <Text style={styles.actionContinueText}>保存并继续</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionSave]} onPress={() => doSave(true)}>
                <Text style={styles.actionSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      <CalendarPicker
        visible={showDatePicker}
        value={new Date(startTs)}
        mode="datetime"
        title="选择开始时间"
        onConfirm={(d) => setStartTs(d.getTime())}
        onClose={() => setShowDatePicker(false)}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalInner: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 1,
  },
  sheet: {
    position: 'relative',
    zIndex: 2,
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
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
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  closeBtn: {
    padding: 4,
  },
  scrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 4,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: COLORS.background,
    marginBottom: 10,
  },
  dateText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  dateArrow: {
    marginLeft: 'auto',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 14,
    marginBottom: 8,
  },
  catWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  catChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  catChipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  catChipTextActive: {
    color: '#fff',
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
  },
  durationInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  durationUnit: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  quickWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  quickBtn: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: COLORS.secondary,
    borderWidth: 0.5,
    borderColor: COLORS.primaryLight,
  },
  quickBtnText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  noteInput: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
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
  actionContinue: {
    backgroundColor: COLORS.secondary,
  },
  actionContinueText: {
    color: COLORS.primary,
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
  actionDelete: {
    backgroundColor: '#FEE2E2',
    flex: 0.6,
  },
  actionDeleteText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default SessionEditSheet;
