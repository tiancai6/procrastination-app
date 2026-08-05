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
  getMealsByDate,
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

  // 当前真正在编辑的那条记录。切换餐次时会跟着换成那一餐的已有记录，
  // 所以不能直接用 props.entry 判断编辑态。
  const [activeEntry, setActiveEntry] = useState<MealEntry | null>(null);
  // 所选日期当天的全部餐记录，用于「点餐次 → 显示那一餐的记录」
  const [dayMeals, setDayMeals] = useState<MealEntry[]>([]);
  // 切换餐次/日期后的一行说明，避免用户不知道内容为什么变了
  const [switchHint, setSwitchHint] = useState('');
  // 内容改过但营养还是旧的 → 提醒重新估算
  const [nutritionStale, setNutritionStale] = useState(false);

  const isEditing = !!activeEntry;

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
      setActiveEntry(entry);
    } else {
      setType('breakfast');
      setDateStr(toDateStr(new Date()));
      setContent('');
      setNutrition(null);
      setActiveEntry(null);
    }
    setSwitchHint('');
    setNutritionStale(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry]);

  // 拉取所选日期当天的全部记录：切餐次时才知道那一餐有没有已存在的记录
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      const list = await getMealsByDate(dateStr);
      if (alive) setDayMeals(list);
    })();
    return () => {
      alive = false;
    };
  }, [visible, dateStr]);

  if (!visible) return null;

  const labelOf = (t: MealType) => MEAL_TYPE_OPTIONS.find((o) => o.value === t)?.label || '';

  // 点餐次：当天该餐次已有记录 → 直接切过去编辑那条；没有 → 视为把当前这条改成该餐次
  const pickType = (t: MealType) => {
    if (t === type) return;
    const found = dayMeals
      .filter((m) => m.type === t && m.id !== activeEntry?.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (found.length > 0) {
      const target = found[0];
      setType(t);
      setActiveEntry(target);
      setContent(target.content);
      setNutrition(target.nutrition ?? null);
      setNutritionStale(false);
      setSwitchHint(
        found.length > 1
          ? `已切到当天的${labelOf(t)}记录（共 ${found.length} 条，正在编辑最早的一条）`
          : `已切到当天的${labelOf(t)}记录`,
      );
    } else {
      setType(t);
      setSwitchHint(
        activeEntry
          ? `这天还没有${labelOf(t)}记录，保存后这条会变成${labelOf(t)}`
          : `这天还没有${labelOf(t)}记录，保存后会新建一条`,
      );
    }
  };

  // 改日期：不打断当前编辑，但若目标日期同餐次已有记录，提前告知保存会覆盖
  const pickDate = (d: Date) => {
    const next = toDateStr(d);
    setDateStr(next);
    if (next !== (activeEntry?.date ?? next)) {
      setSwitchHint(`已改为 ${fmtDate(next)}，保存后这条记录会移到该日期`);
    } else {
      setSwitchHint('');
    }
  };

  const onChangeContent = (v: string) => {
    setContent(v);
    if (nutrition && v.trim() !== (activeEntry?.content ?? '').trim()) setNutritionStale(true);
  };

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
      id: activeEntry?.id || 'tmp',
      type,
      content: text,
      date: dateStr,
      createdAt: activeEntry?.createdAt || Date.now(),
    };
    const { result, status } = await estimateMealNutrition(tempEntry);
    setEstimating(false);
    if (status === 'ok' && result) {
      setNutrition(result);
      setNutritionStale(false);
      // 编辑模式下立即把估算结果落库，体验更顺畅；新建模式在保存时一并写入
      if (activeEntry) {
        await updateMealEntry({ ...activeEntry, type, date: dateStr, content: text, nutrition: result });
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
    // 早/午/晚按「日期+餐次」占唯一槽位，id 固定为 `${date}_${type}`。
    // 改了餐次或日期时要迁移到新 id，并把原来那条删掉，避免 id 与内容对不上。
    const isMain = type !== 'snack';
    const targetId = isMain ? `${dateStr}_${type}` : activeEntry?.id || generateId();
    if (activeEntry && activeEntry.id !== targetId) {
      await deleteMealEntry(activeEntry.id);
    }
    const built: MealEntry = {
      id: targetId,
      type,
      content: text,
      date: dateStr,
      createdAt: activeEntry?.createdAt || now,
      nutrition: nutrition ?? undefined,
    };
    await updateMealEntry(built);
    onSaved?.();
    onClose();
  };

  const doDelete = () => {
    if (!activeEntry) return;
    Alert.alert('删除记录', '确定删除这条三餐记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteMealEntry(activeEntry.id);
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
              {MEAL_TYPE_OPTIONS.map((c) => {
                const has = dayMeals.some((m) => m.type === c.value);
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[styles.catChip, type === c.value && styles.catChipActive]}
                    onPress={() => pickType(c.value)}
                  >
                    <Text style={[styles.catChipText, type === c.value && styles.catChipTextActive]}>
                      {c.label}
                    </Text>
                    {has && <View style={[styles.catDot, type === c.value && styles.catDotActive]} />}
                  </TouchableOpacity>
                );
              })}
            </View>
            {switchHint ? <Text style={styles.switchHint}>{switchHint}</Text> : null}

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
              onChangeText={onChangeContent}
              maxLength={100}
              multiline
            />
            {nutritionStale ? (
              <Text style={styles.staleHint}>内容改过了，下面的营养还是旧的，建议点「AI 重新估算营养」</Text>
            ) : null}

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
        onConfirm={pickDate}
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
  // 餐次 chip 右上角的小圆点：表示该餐次当天已有记录
  catDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  catDotActive: {
    backgroundColor: '#fff',
  },
  // 切换餐次/日期后的一行说明
  switchHint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 8,
    lineHeight: 16,
  },
  // 内容改过但营养还是旧值时的提醒
  staleHint: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 6,
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
