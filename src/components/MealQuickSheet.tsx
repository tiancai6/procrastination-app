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
import { useNavigation } from '@react-navigation/native';
import { COLORS } from '../constants/reasons';
import { MealType, MealEntry, MealNutritionItem, KnownFood } from '../types';
import {
  getMealsByDate,
  upsertMeal,
  estimateMealNutrition,
  saveMealNutrition,
  estimateDayMeals,
  MealContext,
  calcProteinTarget,
  getFoodLibrary,
  addFoodItem,
  deleteFoodItem,
  FoodItem,
  foodNameCore,
  parseBaseGrams,
} from '../utils/nutrition';
import { getApiKey, getBodyProfile } from '../utils/storage';
import { calcDayEnergy } from '../utils/activity';
import { getModelConfigs, ModelConfig } from '../utils/modelConfig';
import CalendarPicker, { WEEK_LABELS } from './CalendarPicker';
import NutritionDetail from './NutritionDetail';

// 计算当天「身体+运动+TDEE」上下文，传给 AI 估算，让三餐建议带上运动数据
const buildMealContext = async (date: string): Promise<MealContext | undefined> => {
  try {
    const energy = await calcDayEnergy(date);
    const p = await getBodyProfile();
    return {
      bmr: energy.bmr,
      weight: p?.weight ?? 0,
      tdee: energy.tdee,
      exerciseKcal: energy.exerciseKcal,
      baseLevel: energy.baseLevel,
    };
  } catch (e) {
    return undefined;
  }
};

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

// 根据输入框文字，自动匹配食物库里「名字出现在文字中」的食物，返回它们的已知营养（用于估算时直接采用）。
// 核心词太短（如「奶」「果」）易误关联，要求核心词至少 2 字；并带入基准克数/习惯单位克数供分量换算。
const deriveKnownFoods = (text: string, lib: FoodItem[]): KnownFood[] => {
  const t = text || '';
  const out: KnownFood[] = [];
  for (const f of lib) {
    const core = foodNameCore(f.name);
    if (core && core.length >= 2 && t.includes(core)) {
      out.push({
        name: f.name,
        foodId: f.id,
        protein: f.protein || 0,
        calories: f.calories || 0,
        fat: f.fat || 0,
        carbs: f.carbs || 0,
        fiber: f.fiber || 0,
        water: f.water,
        baseGrams: f.baseGrams,
        inputUnitGrams: f.inputUnit ? parseBaseGrams(f.inputUnit) : undefined,
      });
    }
  }
  return out;
};

interface SnackInput {
  id?: string;
  content: string;
  knownFoods?: KnownFood[]; // 该加餐从食物库选入、营养已知的食物
}

const MealQuickSheet: React.FC<Props> = ({ visible, date, onClose, onSaved }) => {
  const navigation = useNavigation<any>();
  const [dateStr, setDateStr] = useState(date);
  const [energySummary, setEnergySummary] = useState('');
  const [contents, setContents] = useState<Record<MealType, string>>({ breakfast: '', lunch: '', dinner: '', snack: '' });
  const [snackList, setSnackList] = useState<SnackInput[]>([]);
  // 从食物库选入、营养已知的早/午/晚食物（与 contents 一一对应），估算时作为 ground truth 注入
  const [knownFoods, setKnownFoods] = useState<Record<MealType, KnownFood[]>>({
    breakfast: [],
    lunch: [],
    dinner: [],
    snack: [],
  });
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [estimatingMealId, setEstimatingMealId] = useState<string | null>(null);
  const [estimatingAll, setEstimatingAll] = useState(false);
  const [estProgress, setEstProgress] = useState('');
  const [estMsg, setEstMsg] = useState('');
  // 今日「已摄入 vs TDEE」进度条
  const [intake, setIntake] = useState<{ calories: number; protein: number }>({ calories: 0, protein: 0 });
  const [tdee, setTdee] = useState(0);
  const [proteinTarget, setProteinTarget] = useState(60);
  // 哪些餐展开了「逐样食物明细」
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [foodLib, setFoodLib] = useState<FoodItem[]>([]);
  const [showFoodPicker, setShowFoodPicker] = useState(false);
  const [foodTarget, setFoodTarget] = useState<{ type: MealType; idx?: number } | null>(null);
  const [newFood, setNewFood] = useState<{ name: string; calories: string; protein: string; fat: string; carbs: string; fiber: string }>({ name: '', calories: '', protein: '', fat: '', carbs: '', fiber: '' });

  const toggleExpand = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  const selCfg: ModelConfig | undefined = selectedModelId ? models.find((m) => m.id === selectedModelId) || undefined : undefined;

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
      buildMealContext(dateStr).then((c) => {
        if (c) {
          setEnergySummary('🔥今日运动消耗约 ' + c.exerciseKcal + ' kcal · 可摄入总量 ' + c.tdee + ' kcal');
          setTdee(c.tdee || 0);
          setProteinTarget(calcProteinTarget(c.weight));
        } else {
          setEnergySummary('');
          setTdee(0);
          setProteinTarget(60);
        }
      });
      const byType = (t: MealType) => list.find((m) => m.type === t)?.content || '';
      setContents({ breakfast: byType('breakfast'), lunch: byType('lunch'), dinner: byType('dinner'), snack: '' });
      setKnownFoods({
        breakfast: list.find((m) => m.type === 'breakfast')?.knownFoods || [],
        lunch: list.find((m) => m.type === 'lunch')?.knownFoods || [],
        dinner: list.find((m) => m.type === 'dinner')?.knownFoods || [],
        snack: [],
      });
      setSnackList(list.filter((m) => m.type === 'snack').map((m) => ({ id: m.id, content: m.content, knownFoods: m.knownFoods || [] })));
      setModels(await getModelConfigs());
      setFoodLib(await getFoodLibrary());
      setEstMsg('');
    })();
  }, [visible, dateStr]);

  // 根据当前各餐的估算营养，实时汇总「今日已摄入」热量/蛋白，驱动进度条
  useEffect(() => {
    const c = entries.reduce((s, m) => s + (m.nutrition?.calories || 0), 0);
    const p = entries.reduce((s, m) => s + (m.nutrition?.protein || 0), 0);
    setIntake({ calories: Math.round(c), protein: Math.round(p) });
  }, [entries]);

  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') resumeEstimation();
    });
    return () => sub.remove();
  }, [visible, entries, dateStr]);

  // 每次打开食物库选择面板时刷新列表（从「管理食物库」返回后能看到最新增删）
  useEffect(() => {
    if (showFoodPicker) getFoodLibrary().then(setFoodLib);
  }, [showFoodPicker]);

  const setContent = (t: MealType, v: string) => {
    setContents((c) => ({ ...c, [t]: v }));
    // 输入即关联：输入框文字里出现食物库里的食物名，自动把其营养表带入估算
    setKnownFoods((s) => ({ ...s, [t]: deriveKnownFoods(v, foodLib) }));
  };

  const appendFood = (f: FoodItem) => {
    const piece = f.name;
    // 把名字填进输入框即可，knownFoods 会在输入变化时自动从文字匹配食物库派生（无需手动维护）
    if (foodTarget?.type === 'snack' && foodTarget.idx != null) {
      const cur = snackList[foodTarget.idx]?.content || '';
      updateSnack(foodTarget.idx, cur ? cur + '\n' + piece : piece);
    } else if (foodTarget?.type) {
      const cur = contents[foodTarget.type];
      setContent(foodTarget.type, cur ? cur + '\n' + piece : piece);
    }
    setShowFoodPicker(false);
  };

  const saveItemsToFood = async (items: MealNutritionItem[], knownToSkip?: KnownFood[]) => {
    // 已知食物（来自食物库）不重复入库，避免库膨胀与重复记录
    const skipCores = new Set((knownToSkip || []).map((k) => foodNameCore(k.name)));
    let saved = 0;
    for (const it of items) {
      if (skipCores.has(foodNameCore(it.name))) continue;
      await addFoodItem({ name: it.name, protein: it.protein || 0, calories: it.calories || 0, fat: it.fat || 0, carbs: it.carbs || 0, fiber: it.fiber || 0 });
      saved += 1;
    }
    setFoodLib(await getFoodLibrary());
    Alert.alert('已存入食物库', saved > 0 ? `已保存 ${saved} 样新食物，下次记录可直接从食物库选择` : '这些食物都已在食物库里了，无需重复保存');
  };

  const doSave = async () => {
    await upsertMeal('breakfast', dateStr, contents.breakfast, undefined, knownFoods.breakfast);
    await upsertMeal('lunch', dateStr, contents.lunch, undefined, knownFoods.lunch);
    await upsertMeal('dinner', dateStr, contents.dinner, undefined, knownFoods.dinner);
    // 处理加餐：删除被移除的旧条目，保存现有条目
    const prevSnackIds = entries.filter((m) => m.type === 'snack').map((m) => m.id);
    const keptIds = new Set(snackList.filter((s) => s.id).map((s) => s.id as string));
    for (const id of prevSnackIds) {
      if (!keptIds.has(id)) await upsertMeal('snack', dateStr, '', id);
    }
    for (const s of snackList) {
      if (s.content.trim()) await upsertMeal('snack', dateStr, s.content, s.id, s.knownFoods);
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
      await upsertMeal('snack', dateStr, entry.content, id, entry.knownFoods);
    } else {
      await upsertMeal(entry.type, dateStr, entry.content, undefined, entry.knownFoods);
      id = `${dateStr}_${entry.type}`;
    }
    setEstimatingMealId(id);
    setEstMsg('');
    const ctx = await buildMealContext(dateStr);
    const { result, status, searched, needSearch, message } = await estimateMealNutrition({ ...entry, id }, ctx, selCfg);
    if (status === 'ok' && result) {
      const next = await saveMealNutrition(id, result);
      setEntries(next.filter((m) => m.date === dateStr));
      // 估算完直接展开明细，让用户马上看到每样食物各自贡献了多少营养
      setExpanded((e) => ({ ...e, [id]: true }));
      // 估算成功即已落库，主动通知首页/统计中心刷新（不依赖用户再点「保存」）
      onSaved?.();
      // 若这顿含陌生食物，但当前模型（如豆包）不支持联网搜索，给出明确提示
      if (needSearch && !searched) {
        setEstMsg('提示：当前模型（' + (selCfg?.name || '默认') + '）不支持联网搜索，陌生食物按模型自身知识估算，可能不够准');
      } else {
        setEstMsg('');
      }
    } else if (status === 'nokey') {
      setEstMsg('未设置 API Key，请先到「我的」页面填写');
    } else if (status === 'rate') {
      setEstMsg('AI 接口限流了，请稍候几秒再点估算');
    } else {
      // 透传具体错误（404=模型标识填错、401=API Key 无效等），不再笼统提示
      setEstMsg('估算失败：' + (message ? String(message).slice(0, 200) : '请检查网络或 API Key 后重试'));
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
    const ctx = await buildMealContext(dateStr);
    const { entries: next, failedMeals } = await estimateDayMeals(entries, (done, total) => setEstProgress(`估算中 ${done}/${total}`), ctx, selCfg);
    const dayList = next.filter((m) => m.date === dateStr);
    setEstMsg(failedMeals.length > 0 ? `有 ${failedMeals.length} 餐没估上（限流/网络），可再点一次重试` : '');
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
      const ctx = await buildMealContext(dateStr);
      const { entries: next, failedMeals } = await estimateDayMeals(pending, (done, total) => setEstProgress(`估算中 ${done}/${total}`), ctx, selCfg);
      setEntries(next.filter((m) => m.date === dateStr));
      if (failedMeals.length > 0) setEstMsg(`有 ${failedMeals.length} 餐没估上（限流/网络），可再点一次重试`);
      onSaved?.();
    } catch (e) {
      console.error('[MealQuickSheet] resume estimation failed', e);
    }
    setEstimatingAll(false);
    setEstProgress('');
    resumingRef.current = false;
  };

  const addSnack = () =>
    setSnackList((s) => [...s, { id: `${dateStr}_snack_${Date.now()}_${s.length}`, content: '', knownFoods: [] }]);
  const updateSnack = (idx: number, v: string) =>
    setSnackList((s) => s.map((x, i) => (i === idx ? { ...x, content: v, knownFoods: deriveKnownFoods(v, foodLib) } : x)));
  const removeSnack = (idx: number) => setSnackList((s) => s.filter((_, i) => i !== idx));

  // 「今日已摄入 vs TDEE」进度条：吃了多少、还能吃多少
  const renderIntakeBar = () => {
    const pct = tdee > 0 ? Math.min(100, Math.round((intake.calories / tdee) * 100)) : 0;
    const over = intake.calories > tdee;
    const remaining = tdee - intake.calories;
    const barColor = over ? '#EF4444' : '#22C55E';
    return (
      <View style={styles.intakeCard}>
        <View style={styles.intakeTopRow}>
          <Text style={styles.intakeTitle}>🍽️ 今日热量</Text>
          <Text style={styles.intakeNum}>{intake.calories} / {tdee} kcal</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: barColor }]} />
        </View>
        <View style={styles.intakeBottomRow}>
          <Text style={[styles.intakeRemain, over && styles.intakeOver]}>
            {over ? '已超出 ' + Math.abs(remaining) + ' kcal' : '还可吃 ' + remaining + ' kcal'}
          </Text>
          <Text style={styles.intakeProtein}>蛋白 {intake.protein}/{proteinTarget}g</Text>
        </View>
      </View>
    );
  };

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
          <TouchableOpacity style={styles.mealFoodBtn} onPress={() => { setFoodTarget({ type: f.key }); setShowFoodPicker(true); }}>
            <Ionicons name="fast-food-outline" size={14} color="#8B5CF6" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mealEstBtn, estimating && styles.mealEstBtnDisabled]}
            onPress={() => doEstimateMeal({ id: `${dateStr}_${f.key}`, type: f.key, content: contents[f.key], date: dateStr, createdAt: Date.now(), knownFoods: knownFoods[f.key] })}
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
        {knownFoods[f.key].length > 0 && (
          <View style={styles.linkedBox}>
            <Ionicons name="library-outline" size={13} color="#8B5CF6" />
            <Text style={styles.linkedText}>已关联食物库：{knownFoods[f.key].map((k) => k.name).join('、')}</Text>
          </View>
        )}
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
            <TouchableOpacity style={styles.saveFoodBtn} onPress={() => saveItemsToFood(entry.nutrition?.items || [])}>
              <Ionicons name="bookmark-outline" size={13} color="#8B5CF6" />
              <Text style={styles.saveFoodBtnText}>存为食物</Text>
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
              {energySummary ? <Text style={styles.energyHint}>{energySummary}</Text> : null}
              {tdee > 0 ? renderIntakeBar() : null}
              <TouchableOpacity style={styles.modelPickRow} onPress={() => setShowModelPicker((v) => !v)}>
                <Ionicons name="swap-horizontal-outline" size={14} color={COLORS.primary} />
                <Text style={styles.modelPickText}>
                  估算模型：{selCfg ? selCfg.name : '默认（' + (models.find((m) => m.isDefault)?.name || '未配置') + '）'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={COLORS.textLight} />
              </TouchableOpacity>
              {showModelPicker && (
                <View style={styles.modelPickBox}>
                  <TouchableOpacity
                    style={[styles.modelPickItem, !selectedModelId && styles.modelPickItemActive]}
                    onPress={() => { setSelectedModelId(''); setShowModelPicker(false); }}
                  >
                    <Text style={styles.modelPickItemText}>默认（{models.find((m) => m.isDefault)?.name || '未配置'}）</Text>
                  </TouchableOpacity>
                  {models.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.modelPickItem, selectedModelId === m.id && styles.modelPickItemActive]}
                      onPress={() => { setSelectedModelId(m.id); setShowModelPicker(false); }}
                    >
                      <Text style={styles.modelPickItemText}>
                        {m.name}{m.isVision ? ' · 视觉' : ''}{m.webSearch ? ' · 搜索' : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
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
                        <TouchableOpacity style={styles.snackFoodBtn} onPress={() => { setFoodTarget({ type: 'snack', idx }); setShowFoodPicker(true); }}>
                          <Ionicons name="fast-food-outline" size={14} color="#8B5CF6" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.snackEstBtn, estimating && styles.mealEstBtnDisabled]}
                          onPress={() => s.content.trim() && doEstimateMeal({ id: s.id || `${dateStr}_snack_${idx}`, type: 'snack', content: s.content, date: dateStr, createdAt: Date.now(), knownFoods: s.knownFoods })}
                          disabled={estimating || !s.content.trim()}
                        >
                          {estimating ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Ionicons name="sparkles-outline" size={13} color="#8B5CF6" />}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.snackRemove} onPress={() => removeSnack(idx)}>
                          <Ionicons name="trash-outline" size={15} color={COLORS.textLight} />
                        </TouchableOpacity>
                        {s.knownFoods && s.knownFoods.length > 0 && (
                          <View style={[styles.linkedBox, { width: '100%' }]}>
                            <Ionicons name="library-outline" size={13} color="#8B5CF6" />
                            <Text style={styles.linkedText}>已关联食物库：{s.knownFoods.map((k) => k.name).join('、')}</Text>
                          </View>
                        )}
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
                            <TouchableOpacity style={styles.saveFoodBtn} onPress={() => saveItemsToFood(entry.nutrition?.items || [], entry.knownFoods)}>
                              <Ionicons name="bookmark-outline" size={13} color="#8B5CF6" />
                              <Text style={styles.saveFoodBtnText}>存为食物</Text>
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
              {showFoodPicker && (
                <View style={styles.foodBox}>
                  <View style={styles.foodBoxHead}>
                    <Text style={styles.foodBoxTitle}>
                      食物库（点选加入「{foodTarget?.type === 'snack' ? '加餐' : (foodTarget?.type ? MEAL_FIELDS.find((m) => m.key === foodTarget.type)?.label : '')}」）
                    </Text>
                    <View style={styles.foodBoxHeadActions}>
                      <TouchableOpacity
                        style={styles.foodManageBtn}
                        onPress={() => navigation.navigate('FoodLibrary')}
                      >
                        <Ionicons name="settings-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.foodManageText}>管理</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowFoodPicker(false)}>
                        <Ionicons name="close" size={18} color={COLORS.textLight} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {foodLib.length === 0 && <Text style={styles.foodEmpty}>还没有保存的食物，估算后点「存为食物」即可加入</Text>}
                  {foodLib.map((f) => (
                    <View key={f.id} style={styles.foodItem}>
                      <TouchableOpacity style={styles.foodItemMain} onPress={() => appendFood(f)}>
                        <Text style={styles.foodItemName}>{f.name}</Text>
                        <Text style={styles.foodItemNut}>蛋{f.protein}g · 热{f.calories}kcal</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteFoodItem(f.id).then(setFoodLib)}>
                        <Ionicons name="trash-outline" size={15} color={COLORS.textLight} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <View style={styles.foodAddBox}>
                    <Text style={styles.foodAddTitle}>新增食物</Text>
                    <TextInput style={styles.mealInput} placeholder="名称含分量，如：米饭 1碗(约150g)" placeholderTextColor={COLORS.textLighter} value={newFood.name} onChangeText={(v) => setNewFood({ ...newFood, name: v })} />
                    <View style={styles.foodAddGrid}>
                      <TextInput style={styles.foodNum} keyboardType="numeric" placeholder="热量" placeholderTextColor={COLORS.textLighter} value={newFood.calories} onChangeText={(v) => setNewFood({ ...newFood, calories: v })} />
                      <TextInput style={styles.foodNum} keyboardType="numeric" placeholder="蛋白" placeholderTextColor={COLORS.textLighter} value={newFood.protein} onChangeText={(v) => setNewFood({ ...newFood, protein: v })} />
                      <TextInput style={styles.foodNum} keyboardType="numeric" placeholder="脂肪" placeholderTextColor={COLORS.textLighter} value={newFood.fat} onChangeText={(v) => setNewFood({ ...newFood, fat: v })} />
                      <TextInput style={styles.foodNum} keyboardType="numeric" placeholder="碳水" placeholderTextColor={COLORS.textLighter} value={newFood.carbs} onChangeText={(v) => setNewFood({ ...newFood, carbs: v })} />
                      <TextInput style={styles.foodNum} keyboardType="numeric" placeholder="纤维" placeholderTextColor={COLORS.textLighter} value={newFood.fiber} onChangeText={(v) => setNewFood({ ...newFood, fiber: v })} />
                    </View>
                    <TouchableOpacity style={styles.foodAddBtn} onPress={async () => {
                      if (!newFood.name.trim()) return;
                      await addFoodItem({ name: newFood.name.trim(), calories: Number(newFood.calories) || 0, protein: Number(newFood.protein) || 0, fat: Number(newFood.fat) || 0, carbs: Number(newFood.carbs) || 0, fiber: Number(newFood.fiber) || 0 });
                      setFoodLib(await getFoodLibrary());
                      setNewFood({ name: '', calories: '', protein: '', fat: '', carbs: '', fiber: '' });
                    }}>
                      <Text style={styles.foodAddBtnText}>保存到食物库</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
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
  energyHint: {
    fontSize: 12,
    color: COLORS.primary,
    marginBottom: 6,
    paddingHorizontal: 16,
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
  modelPickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#EEF2FF', borderWidth: 0.5, borderColor: '#C7D2FE', marginBottom: 12,
  },
  modelPickText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  modelPickBox: {
    marginBottom: 12, padding: 10, borderRadius: 12, backgroundColor: COLORS.background,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  modelPickItem: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6,
    backgroundColor: COLORS.card, borderWidth: 0.5, borderColor: COLORS.border,
  },
  modelPickItemActive: { backgroundColor: '#EDE9FE', borderColor: COLORS.primary },
  modelPickItemText: { fontSize: 13.5, color: COLORS.text },
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
  mealFoodBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#F5F0FF',
    borderWidth: 0.5, borderColor: '#DDD0FB', alignItems: 'center', justifyContent: 'center',
  },
  linkedBox: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
    backgroundColor: '#F5F0FF', borderWidth: 0.5, borderColor: '#DDD0FB', alignSelf: 'flex-start',
  },
  linkedText: { fontSize: 11.5, color: '#8B5CF6', fontWeight: '600', flexShrink: 1 },
  snackFoodBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#F5F0FF',
    borderWidth: 0.5, borderColor: '#DDD0FB', alignItems: 'center', justifyContent: 'center',
  },
  saveFoodBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    marginTop: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
    backgroundColor: '#F5F0FF', borderWidth: 0.5, borderColor: '#DDD0FB',
  },
  saveFoodBtnText: { color: '#8B5CF6', fontSize: 12, fontWeight: '600' },
  foodBox: {
    marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: COLORS.background,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  foodBoxHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  foodBoxTitle: { fontSize: 13.5, fontWeight: '700', color: COLORS.text },
  foodBoxHeadActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  foodManageBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  foodManageText: { fontSize: 12.5, color: COLORS.primary, fontWeight: '600' },
  foodEmpty: { fontSize: 12.5, color: COLORS.textLight, marginBottom: 8 },
  foodItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: COLORS.border },
  foodItemMain: { flex: 1, marginRight: 10 },
  foodItemName: { fontSize: 13.5, color: COLORS.text },
  foodItemNut: { fontSize: 11.5, color: COLORS.textLight, marginTop: 2 },
  foodAddBox: { marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: COLORS.border },
  foodAddTitle: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  foodAddGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  foodNum: {
    width: '30%', borderWidth: 0.5, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: COLORS.text, backgroundColor: COLORS.card,
  },
  foodAddBtn: { marginTop: 10, paddingVertical: 11, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center' },
  foodAddBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
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
  intakeCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  intakeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  intakeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  intakeNum: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  barTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EAE6F2',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  intakeBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  intakeRemain: {
    fontSize: 12,
    color: '#15803D',
    fontWeight: '600',
  },
  intakeOver: {
    color: '#EF4444',
  },
  intakeProtein: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
  },
});

export default MealQuickSheet;
