import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ActivityIndicator,
  AppState,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { MealType, MealEntry } from '../types';
import {
  getMealsByDate,
  upsertMeal,
  estimateMealNutrition,
  saveMealNutrition,
  estimateDayMeals,
} from '../utils/nutrition';
import { getApiKey } from '../utils/storage';
import CalendarPicker, { WEEK_LABELS } from './CalendarPicker';
import NutritionDetail from './NutritionDetail';

interface Props {
  visible: boolean;
  date: string; // YYYY-MM-DD
  onClose: () => void;
  onSaved?: () => void;
}

const toDateStr = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_LABELS[d.getDay()]}`;
};

const MEAL_FIELDS: { key: MealType; label: string; icon: string; placeholder: string }[] = [
  { key: 'breakfast', label: '早餐', icon: 'sunny-outline', placeholder: '今天早餐吃了什么？如：两个包子、一杯豆浆' },
  { key: 'lunch', label: '午餐', icon: 'restaurant-outline', placeholder: '今天午餐吃了什么？如：一碗米饭、青椒炒肉、青菜' },
  { key: 'dinner', label: '晚餐', icon: 'moon-outline', placeholder: '今天晚餐吃了什么？如：半碗面、一个苹果' },
];

const adequacyColor: Record<string, string> = {
  不足: '#F59E0B',
  适量: '#22C55E',
  过量: '#EF4444',
};

interface SnackInput {
  id?: string;
  content: string;
}

const MealQuickSheet: React.FC<Props> = ({ visible, date, onClose, onSaved }) => {
  const [dateStr, setDateStr] = useState(date);
  const [contents, setContents] = useState<Record<MealType, string>>({ breakfast: '', lunch: '', dinner: '', snack: '' });
  const [snackList, setSnackList] = useState<SnackInput[]>([]);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [estimatingMealId, setEstimatingMealId] = useState<string | null>(null);
  const [estimatingAll, setEstimatingAll] = useState(false);
  const [estProgress, setEstProgress] = useState('');
  const [estMsg, setEstMsg] = useState('');
  // 哪些餐展开了「逐样食物明细」
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  useEffect(() => {
    if (!visible) return;
    setDateStr(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, date]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const list = await getMealsByDate(dateStr);
      setEntries(list);
      const byType = (t: MealType) => list.find((m) => m.type === t)?.content || '';
      setContents({ breakfast: byType('breakfast'), lunch: byType('lunch'), dinner: byType('dinner'), snack: '' });
      setSnackList(list.filter((m) => m.type === 'snack').map((m) => ({ id: m.id, content: m.content })));
      setEstMsg('');
    })();
  }, [visible, dateStr]);

  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeEstimation();
    });
    return () => sub.remove();
  }, [visible, entries, dateStr]);

  const setContent = (t: MealType, v: string) => setContents((c) => ({ ...c, [t]: v }));

  const doSave = async () => {
    await upsertMeal('breakfast', dateStr, contents.breakfast);
    await upsertMeal('lunch', dateStr, contents.lunch);
    await upsertMeal('dinner', dateStr, contents.dinner);
    // 处理加餐：删除被移除的旧条目，保存现有条目
    const prevSnackIds = entries.filter((m) => m.type === 'snack').map((m) => m.id);
    const keptIds = new Set(snackList.filter((s) => s.id).map((s) => s.id as string));
    for (const id of prevSnackIds) {
      if (!keptIds.has(id)) await upsertMeal('snack', dateStr, '', id);
    }
    for (const s of snackList) {
      if (s.content.trim()) await upsertMeal('snack', dateStr, s.content, s.id);
    }
    onSaved?.();
    onClose();
  };

  const doEstimateMeal = async (entry: MealEntry) => {
    const hasKey = await getApiKey();
    if (!hasKey) {
      setEstMsg('未设置 API Key，请先到「我的」页面填写');
      return;
    }
    // 先确保该餐已落库（这样估算结果能正确挂到条目上，且记录不丢）
    let id = entry.id;
    if (entry.type === 'snack') {
      id = entry.id || `${dateStr}_snack_${Date.now()}`;
      await upsertMeal('snack', dateStr, entry.content, id);
    } else {
      await upsertMeal(entry.type, dateStr, entry.content);
      id = `${dateStr}_${entry.type}`;
    }
    setEstimatingMealId(id);
    setEstMsg('');
    const { result, status } = await estimateMealNutrition({ ...entry, id });
    if (status === 'ok' && result) {
      const next = await saveMealNutrition(id, result);
      setEntries(next.filter((m) => m.date === dateStr));
      // 估算完直接展开明细，让用户马上看到每样食物各自贡献了多少营养
      setExpanded((e) => ({ ...e, [id]: true }));
      // 估算成功即已落库，主动通知首页/统计中心刷新（不依赖用户再点「保存」）
      onSaved?.();
    } else if (status === 'nokey') {
      setEstMsg('未设置 API Key，请先到「我的」页面填写');
    } else if (status === 'rate') {
      setEstMsg('AI 接口限流了，请稍候几秒再点估算');
    } else {
      setEstMsg('估算失败，请检查网络或 API Key 后重试');
    }
    setEstimatingMealId(null);
  };

  const doEstimateAll = async () => {
    const valid = entries.filter((e) => e.content && e.content.trim());
    if (valid.length === 0) {
      setEstMsg('请先填写至少一餐吃了什么，再点估算');
      return;
    }
    const hasKey = await getApiKey();
    if (!hasKey) {
      setEstMsg('未设置 API Key，请先到「我的」页面填写');
      return;
    }
    setEstimatingAll(true);
    setEstMsg('');
    const next = await estimateDayMeals(entries, (done, total) => setEstProgress(`估算中 ${done}/${total}`));
    const dayList = next.filter((m) => m.date === dateStr);
    setEntries(dayList);
    // 全部估算完，把有结果的餐都展开明细
    setExpanded((e) => {
      const merged = { ...e };
      dayList.forEach((m) => {
        if (m.nutrition) merged[m.id] = true;
      });
      return merged;
    });
    // 全部估算完成即已落库，主动通知首页/统计中心刷新
    onSaved?.();
    setEstimatingAll(false);
    setEstProgress('');
  };

  const resumingRef = useRef(false);
  // 回到前台时，把后台被挂起、没算完的餐自动补完（iOS 后台会暂停网络请求）
  const resumeEstimation = async () => {
    if (resumingRef.current) return;
    const hasKey = await getApiKey();
    if (!hasKey) return;
    const pending = entries.filter((e) => e.content && e.content.trim() && !e.nutrition);
    if (pending.length === 0) return;
    resumingRef.current = true;
    setEstimatingAll(true);
    setEstProgress(`估算中 0/${pending.length}`);
    try {
      const next = await estimateDayMeals(pending, (done, total) => setEstProgress(`估算中 ${done}/${total}`));
      setEntries(next.filter((m) => m.date === dateStr));
      onSaved?.();
    } catch (e) {
      console.error('[MealQuickSheet] resume estimation failed', e);
    }
    setEstimatingAll(false);
    setEstProgress('');
    resumingRef.current = false;
  };

  const addSnack = () =>
    setSnackList((s) => [...s, { id: `${dateStr}_snack_${Date.now()}_${s.length}`, content: '' }]);
  const updateSnack = (idx: number, v: string) =>
    setSnackList((s) => s.map((x, i) => (i === idx ? { ...x, content: v } : x)));
  const removeSnack = (idx: number) => setSnackList((s) => s.filter((_, i) => i !== idx));

  const renderMealBlock = (f: { key: MealType; label: string; icon: string; placeholder: string }) => {
    const entry = entries.find((m) => m.type === f.key && m.date === dateStr);
    const estimating = estimatingMealId === entry?.id;
    return (
      <View key={f.key} style={styles.mealBlock}>
        <View style={styles.mealHead}>
          <View style={styles.mealHeadLeft}>
            <Ionicons name={f.icon as any} size={16} color={COLORS.primary} />
            <Text style={styles.mealLabel}>{f.label}</Text>
          </View>
          <TouchableOpacity
            style={[styles.mealEstBtn, estimating && styles.mealEstBtnDisabled]}
            onPress={() => doEstimateMeal({ id: `${dateStr}_${f.key}`, type: f.key, content: contents[f.key], date: dateStr, createdAt: Date.now() })}
            disabled={estimating || !contents[f.key].trim()}
          >
            {estimating ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Ionicons name="sparkles-outline" size={13} color="#8B5CF6" />}
            <Text style={styles.mealEstBtnText}>估算</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.mealInput}
          placeholder={f.placeholder}
          placeholderTextColor={COLORS.textLighter}
          value={contents[f.key]}
          onChangeText={(v) => setContent(f.key, v)}
          multiline
          maxLength={200}
        />
        {entry?.nutrition && (
          <>
            <TouchableOpacity style={styles.mealResultMini} onPress={() => toggleExpand(entry.id)} activeOpacity={0.7}>
              <Text style={styles.mealResultMiniText}>
                蛋白 {Math.round(entry.nutrition.protein)}g · 热量 {Math.round(entry.nutrition.calories)}kcal
              </Text>
              <View style={[styles.miniBadge, { backgroundColor: adequacyColor[entry.nutrition.adequacy] || '#22C55E' }]}>
                <Text style={styles.miniBadgeText}>{entry.nutrition.adequacy}</Text>
              </View>
              <View style={styles.detailToggle}>
                <Text style={styles.detailToggleText}>{expanded[entry.id] ? '收起' : '各食物明细'}</Text>
                <Ionicons name={expanded[entry.id] ? 'chevron-up' : 'chevron-down'} size={12} color="#8B5CF6" />
              </View>
            </TouchableOpacity>
            {expanded[entry.id] && <NutritionDetail nutrition={entry.nutrition} />}
          </>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>每日三餐</Text>
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
              <TouchableOpacity style={styles.dateRow} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
                <Text style={styles.dateText}>{formatDate(dateStr)}</Text>
                <Ionicons name="chevron-forward" size={14} color={COLORS.textLighter} style={styles.dateArrow} />
              </TouchableOpacity>

              {MEAL_FIELDS.map((f) => renderMealBlock(f))}

              {/* 加餐 / 零食（可多条） */}
              <View style={styles.snackSection}>
                <View style={styles.mealHead}>
                  <View style={styles.mealHeadLeft}>
                    <Ionicons name="fast-food-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.mealLabel}>加餐 / 零食</Text>
                  </View>
                  <TouchableOpacity style={styles.addSnackBtn} onPress={addSnack}>
                    <Ionicons name="add" size={14} color="#8B5CF6" />
                    <Text style={styles.addSnackText}>添加</Text>
                  </TouchableOpacity>
                </View>
                {snackList.length === 0 ? (
                  <Text style={styles.snackHint}>还没记录加餐，点「添加」补一条（零食/水果/夜宵都行）</Text>
                ) : (
                  snackList.map((s, idx) => {
                    const entry = entries.find((m) => m.id === s.id);
                    const estimating = estimatingMealId === s.id;
                    return (
                      <View key={idx} style={styles.snackRow}>
                        <TextInput
                          style={[styles.mealInput, { flex: 1 }]}
                          placeholder="如：一根香蕉、一把坚果"
                          placeholderTextColor={COLORS.textLighter}
                          value={s.content}
                          onChangeText={(v) => updateSnack(idx, v)}
                          multiline
                          maxLength={200}
                        />
                        <TouchableOpacity
                          style={[styles.snackEstBtn, estimating && styles.mealEstBtnDisabled]}
                          onPress={() => s.content.trim() && doEstimateMeal({ id: s.id || `${dateStr}_snack_${idx}`, type: 'snack', content: s.content, date: dateStr, createdAt: Date.now() })}
                          disabled={estimating || !s.content.trim()}
                        >
                          {estimating ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Ionicons name="sparkles-outline" size={13} color="#8B5CF6" />}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.snackRemove} onPress={() => removeSnack(idx)}>
                          <Ionicons name="trash-outline" size={15} color={COLORS.textLight} />
                        </TouchableOpacity>
                        {entry?.nutrition && (
                          <View style={styles.snackResultWrap}>
                            <TouchableOpacity
                              style={styles.snackResultRow}
                              onPress={() => toggleExpand(entry.id)}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.snackResultText}>
                                蛋白{Math.round(entry.nutrition.protein)}g·热量
                                {Math.round(entry.nutrition.calories)}kcal
                              </Text>
                              <View style={styles.detailToggle}>
                                <Text style={styles.detailToggleText}>
                                  {expanded[entry.id] ? '收起' : '各食物明细'}
                                </Text>
                                <Ionicons
                                  name={expanded[entry.id] ? 'chevron-up' : 'chevron-down'}
                                  size={12}
                                  color="#8B5CF6"
                                />
                              </View>
                            </TouchableOpacity>
                            {expanded[entry.id] && <NutritionDetail nutrition={entry.nutrition} />}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>

              {estMsg ? <Text style={styles.estMsg}>{estMsg}</Text> : null}
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.estBtn, estimatingAll && styles.estBtnDisabled]}
                onPress={doEstimateAll}
                disabled={estimatingAll}
              >
                {estimatingAll ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="sparkles-outline" size={16} color="#fff" />
                )}
                <Text style={styles.estBtnText}>{estimatingAll ? estProgress || '估算中…' : 'AI 估算全部餐'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionSave]} onPress={doSave}>
                <Text style={styles.actionSaveText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <CalendarPicker
          visible={showDatePicker}
          value={new Date(dateStr + 'T00:00:00')}
          mode="date"
          title="选择日期"
          onConfirm={(d) => {
            setDateStr(toDateStr(d));
            setShowDatePicker(false);
          }}
          onClose={() => setShowDatePicker(false)}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheetWrap: {
    width: '100%',
    maxHeight: '90%',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
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
    maxHeight: 440,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: COLORS.background,
    marginBottom: 14,
  },
  dateText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1,
  },
  dateArrow: {
    marginLeft: 'auto',
  },
  mealBlock: {
    marginBottom: 14,
  },
  mealHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  mealHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mealLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  mealInput: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.background,
    minHeight: 46,
    textAlignVertical: 'top',
  },
  mealEstBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#F5F0FF',
    borderWidth: 0.5,
    borderColor: '#DDD0FB',
  },
  mealEstBtnDisabled: {
    opacity: 0.6,
  },
  mealEstBtnText: {
    color: '#8B5CF6',
    fontSize: 12,
    fontWeight: '600',
  },
  mealResultMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  mealResultMiniText: {
    fontSize: 12,
    color: '#15803D',
    fontWeight: '600',
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  miniBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  snackSection: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    marginBottom: 8,
  },
  addSnackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#F5F0FF',
    borderWidth: 0.5,
    borderColor: '#DDD0FB',
  },
  addSnackText: {
    color: '#8B5CF6',
    fontSize: 12,
    fontWeight: '600',
  },
  snackHint: {
    fontSize: 12.5,
    color: COLORS.textLight,
    marginTop: 6,
  },
  snackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  snackEstBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F5F0FF',
    borderWidth: 0.5,
    borderColor: '#DDD0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  snackRemove: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snackResultWrap: {
    width: '100%',
  },
  snackResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  snackResultText: {
    fontSize: 11.5,
    color: '#15803D',
    fontWeight: '600',
  },
  detailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#F5F0FF',
  },
  detailToggleText: {
    fontSize: 11,
    color: '#8B5CF6',
    fontWeight: '600',
  },
  estMsg: {
    fontSize: 12.5,
    color: COLORS.danger,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  estBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
  },
  estBtnDisabled: {
    opacity: 0.6,
  },
  estBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
  },
  actionSave: {
    backgroundColor: COLORS.primary,
  },
  actionSaveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default MealQuickSheet;
