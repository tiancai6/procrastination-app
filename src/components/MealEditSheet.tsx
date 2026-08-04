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
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { MealEntry, MealType, MealNutrition } from '../types';
import {
  updateMealEntry,
  deleteMealEntry,
  estimateMealNutrition,
} from '../utils/nutrition';
import { generateId, getApiKey } from '../utils/storage';
import CalendarPicker, { WEEK_LABELS } from './CalendarPicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  entry?: MealEntry | null; // 传入则为编辑模式，否则为「记一餐」
}

const MEAL_TYPE_OPTIONS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const fmtDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return `${isToday ? '今天 ' : ''}${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_LABELS[d.getDay()]}`;
};

const r = (v?: number) => Math.round(v || 0);

const MealEditSheet: React.FC<Props> = ({ visible, onClose, onSaved, entry }) => {
  const [type, setType] = useState<MealType>('breakfast');
  const [dateStr, setDateStr] = useState(toDateStr(new Date()));
  const [content, setContent] = useState('');
  const [nutrition, setNutrition] = useState<MealNutrition | null | undefined>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [estimating, setEstimating] = useState(false);

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
      setType(entry.type);
      setDateStr(entry.date);
      setContent(entry.content);
      setNutrition(entry.nutrition ?? null);
    } else {
      setType('breakfast');
      setDateStr(toDateStr(new Date()));
      setContent('');
      setNutrition(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry]);

  if (!visible) return null;

  const doEstimate = async () => {
    const text = content.trim();
    if (!text) {
      Alert.alert('先填内容', '把这一餐吃了什么写一下，才能估算营养');
      return;
    }
    const key = await getApiKey();
    if (!key) {
      Alert.alert('未设置 API Key', '请先到「我的 → AI 智能分析」填写 GLM Key 后再估算');
      return;
    }
    setEstimating(true);
    const tempEntry: MealEntry = {
      id: entry?.id || 'tmp',
      type,
      content: text,
      date: dateStr,
      createdAt: entry?.createdAt || Date.now(),
    };
    const { result, status } = await estimateMealNutrition(tempEntry);
    setEstimating(false);
    if (status === 'ok' && result) {
      setNutrition(result);
      // 编辑模式下立即把估算结果落库，体验更顺畅；新建模式在保存时一并写入
      if (entry) {
        await updateMealEntry({ ...entry, nutrition: result });
        onSaved?.();
      }
    } else if (status === 'nokey') {
      Alert.alert('未设置 API Key', '请先到「我的 → AI 智能分析」填写 GLM Key 后再估算');
    } else if (status === 'rate') {
      Alert.alert('AI 接口限流', '免费接口请求太频繁，请稍等几秒再点估算');
    } else {
      Alert.alert('估算失败', '请检查网络或 API Key 后重试');
    }
  };

  const doSave = async () => {
    const text = content.trim();
    if (!text) {
      Alert.alert('先填内容', '把这一餐吃了什么写一下再保存');
      return;
    }
    const now = Date.now();
    const built: MealEntry = {
      id: entry?.id || generateId(),
      type,
      content: text,
      date: dateStr,
      createdAt: entry?.createdAt || now,
      nutrition: nutrition ?? undefined,
    };
    await updateMealEntry(built);
    onSaved?.();
    onClose();
  };

  const doDelete = () => {
    Alert.alert('删除记录', '确定删除这条三餐记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteMealEntry(entry!.id);
          onSaved?.();
          onClose();
        },
      },
    ]);
  };

  const sheetMaxHeight: DimensionValue =
    keyboardHeight > 0 ? Math.max(220, screenHeight - keyboardHeight - 16) : '92%';

  const nutritionHint = nutrition
    ? `蛋白 ${r(nutrition.protein)}g · 热量 ${r(nutrition.calories)}kcal · 脂肪 ${r(
        nutrition.fat,
      )}g · 碳水 ${r(nutrition.carbs)}g · 纤维 ${r(nutrition.fiber)}g`
    : null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalInner, { paddingBottom: keyboardHeight }]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{isEditing ? '编辑三餐记录' : '记一餐'}</Text>
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
            {/* 餐次 chips */}
            <Text style={styles.fieldLabel}>餐次</Text>
            <View style={styles.catWrap}>
              {MEAL_TYPE_OPTIONS.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.catChip, type === c.value && styles.catChipActive]}
                  onPress={() => setType(c.value)}
                >
                  <Text style={[styles.catChipText, type === c.value && styles.catChipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* 日期 */}
            <Text style={styles.fieldLabel}>日期</Text>
            <TouchableOpacity style={styles.dateRow} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
              <Text style={styles.dateText}>{fmtDate(dateStr)}</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textLighter} style={styles.dateArrow} />
            </TouchableOpacity>

            {/* 内容 */}
            <Text style={styles.fieldLabel}>吃了什么</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="如：鸡蛋 2个、全麦面包 1片、牛奶 1杯"
              placeholderTextColor={COLORS.textLighter}
              value={content}
              onChangeText={setContent}
              maxLength={100}
              multiline
            />

            {/* 营养估算 */}
            <View style={styles.estimateWrap}>
              <TouchableOpacity
                style={[styles.estimateBtn, estimating && styles.estimateBtnDisabled]}
                onPress={doEstimate}
                disabled={estimating}
              >
                {estimating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="sparkles-outline" size={15} color="#fff" />
                )}
                <Text style={styles.estimateBtnText}>{estimating ? '估算中…' : 'AI 重新估算营养'}</Text>
              </TouchableOpacity>
              {nutritionHint && <Text style={styles.nutriHint}>{nutritionHint}</Text>}
            </View>
          </ScrollView>

          {/* 固定操作栏 */}
          {isEditing ? (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={doDelete}>
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                <Text style={styles.actionDeleteText}>删除</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionSave]} onPress={doSave}>
                <Text style={styles.actionSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionSave]} onPress={doSave}>
                <Text style={styles.actionSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      <CalendarPicker
        visible={showDatePicker}
        value={new Date(dateStr + 'T00:00:00')}
        mode="date"
        title="选择日期"
        onConfirm={(d) => setDateStr(toDateStr(d))}
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
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  catChipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  catChipTextActive: {
    color: '#fff',
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
  },
  dateText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  dateArrow: {
    marginLeft: 'auto',
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
    minHeight: 64,
    textAlignVertical: 'top',
  },
  estimateWrap: {
    marginTop: 14,
  },
  estimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
  },
  estimateBtnDisabled: {
    opacity: 0.7,
  },
  estimateBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  nutriHint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
    lineHeight: 18,
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
  actionSave: {
    backgroundColor: '#22C55E',
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

export default MealEditSheet;
