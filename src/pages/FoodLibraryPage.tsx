import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { getFoodLibrary, addFoodItem, deleteFoodItem, updateFoodItem, FoodItem, parseBaseGrams } from '../utils/nutrition';
import { getActiveConfig, BRAND_PRESETS } from '../utils/modelConfig';
import { postChat, parseJsonContent } from '../utils/model';

interface FormState {
  name: string;
  calories: string;
  protein: string;
  fat: string;
  carbs: string;
  fiber: string;
  ingredientText: string; // 配料表原文
  labelBaseUnit: string;  // 配料表基准单位
  inputUnit: string;      // 用户习惯输入单位
}
const EMPTY: FormState = { name: '', calories: '', protein: '', fat: '', carbs: '', fiber: '', ingredientText: '', labelBaseUnit: '', inputUnit: '' };

const FoodLibraryPage: React.FC = () => {
  const navigation = useNavigation<any>();
  const [list, setList] = useState<FoodItem[]>([]);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [recognizing, setRecognizing] = useState(false); // 拍照/上传配料表识别中

  const load = async () => setList(await getFoodLibrary());
  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setSheetVisible(true);
  };
  const openEdit = (f: FoodItem) => {
    setEditing(f);
    setForm({
      name: f.name,
      calories: String(f.calories || 0),
      protein: String(f.protein || 0),
      fat: String(f.fat || 0),
      carbs: String(f.carbs || 0),
      fiber: String(f.fiber || 0),
      ingredientText: f.ingredientText || '',
      labelBaseUnit: f.labelBaseUnit || '',
      inputUnit: f.inputUnit || '',
    });
    setSheetVisible(true);
  };

  // 拍照 / 上传配料表 → 调用视觉模型识别 → 自动填充表单（用户可手动修改确认）
  const pickAndRecognize = async (useCamera: boolean) => {
    try {
      const perm = useCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('权限不足', useCamera ? '需要相机权限才能拍照识别配料表' : '需要相册权限才能上传配料表');
        return;
      }
      const res = useCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (res.canceled || !res.assets || !res.assets.length) return;
      const asset = res.assets[0];
      if (!asset.base64) {
        Alert.alert('提示', '无法读取图片数据，请换一张或手动填写');
        return;
      }
      const visCfg = await getActiveConfig(true);
      if (!visCfg) {
        Alert.alert('未配置视觉模型', '请先到「我的 → 管理 AI 模型」添加一个支持图片的模型（勾选「支持图片」），才能识别配料表');
        return;
      }
      // 只有 GLM（glm-4v-*）/ Gemini 真正支持图片识别；豆包/DeepSeek 不支持，提前拦截避免白跑
      if (visCfg.brand !== 'glm' && visCfg.brand !== 'gemini') {
        Alert.alert(
          '当前视觉模型可能不支持看图',
          `识别配料表需要支持图片的模型（GLM 的 glm-4v-* 或 Gemini）。当前模型品牌「${BRAND_PRESETS[visCfg.brand].label}」可能不支持图片识别，请到「管理 AI 模型」改用 GLM/Gemini 的视觉模型。`,
        );
        return;
      }
      setRecognizing(true);
      const dataUri = `data:${asset.type || 'image/jpeg'};base64,${asset.base64}`;
      try {
        const content = await postChat(
          visCfg,
          [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    '你是营养师。请识别这张食品「配料表 / 营养成分表」图片，按图片里标注的基准单位（如每100g、每份）换算成「该份食物」的营养，返回严格 JSON（不要任何额外文字）：\n' +
                    '{"name":"食物名(含分量,如 薯片 1包100g)","calories":数字,"protein":数字,"fat":数字,"carbs":数字,"fiber":数字,"baseUnit":"基准单位文字,如 100g 或 1份20g,按图片营养成分表标注的基准单位填写"}',
                },
                { type: 'image_url', image_url: { url: dataUri } },
              ],
            },
          ],
          { temperature: 0.3, maxTokens: 800 },
        );
        const p: any = parseJsonContent(content);
        setForm((f) => ({
          ...f,
          name: p?.name ? String(p.name) : f.name,
          calories: p?.calories != null ? String(Number(p.calories) || 0) : f.calories,
          protein: p?.protein != null ? String(Number(p.protein) || 0) : f.protein,
          fat: p?.fat != null ? String(Number(p.fat) || 0) : f.fat,
          carbs: p?.carbs != null ? String(Number(p.carbs) || 0) : f.carbs,
          fiber: p?.fiber != null ? String(Number(p.fiber) || 0) : f.fiber,
          // 把识别依据（配料表原文）也记下来，方便日后核对；并回填基准单位（供后续分量换算）
          ingredientText: f.ingredientText || `（来自配料表识别：${p?.name || ''}）`,
          labelBaseUnit: p?.baseUnit ? String(p.baseUnit) : f.labelBaseUnit,
        }));
        Alert.alert('识别完成', '已自动填入营养数据，请核对修改后再保存');
      } catch (e: any) {
        console.error('[FoodLibrary] recognize failed', e);
        Alert.alert('识别失败', e?.message ? String(e.message).slice(0, 200) : '请检查网络或视觉模型后重试，也可手动填写');
      } finally {
        setRecognizing(false);
      }
    } catch (e: any) {
      setRecognizing(false);
      Alert.alert('出错', e?.message ? String(e.message).slice(0, 200) : '无法打开相机/相册');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('提示', '请填写食物名称（含分量，如「米饭 1碗(约150g)」）');
      return;
    }
    const payload = {
      name: form.name.trim(),
      calories: Number(form.calories) || 0,
      protein: Number(form.protein) || 0,
      fat: Number(form.fat) || 0,
      carbs: Number(form.carbs) || 0,
      fiber: Number(form.fiber) || 0,
      ingredientText: form.ingredientText.trim() || undefined,
      labelBaseUnit: form.labelBaseUnit.trim() || undefined,
      inputUnit: form.inputUnit.trim() || undefined,
      // 由基准单位（或名称）解析出的这份克数，供三餐估算时按实际份量换算
      baseGrams: parseBaseGrams(form.labelBaseUnit) || parseBaseGrams(form.name) || undefined,
    };
    if (editing) {
      setList(await updateFoodItem(editing.id, payload));
    } else {
      setList(await addFoodItem(payload));
    }
    setSheetVisible(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const handleDelete = (f: FoodItem) => {
    Alert.alert('删除食物', `确定删除「${f.name}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => setList(await deleteFoodItem(f.id)),
      },
    ]);
  };

  const renderItem = ({ item }: { item: FoodItem }) => (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={styles.cardMacros}>
          蛋白 {Math.round(item.protein)}g · 热量 {Math.round(item.calories)}kcal · 脂肪 {Math.round(item.fat)}g · 碳水{' '}
          {Math.round(item.carbs)}g · 纤维 {Math.round(item.fiber)}g
        </Text>
      </View>
      <TouchableOpacity style={styles.cardAction} onPress={() => openEdit(item)}>
        <Ionicons name="create-outline" size={18} color={COLORS.primary} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.cardAction} onPress={() => handleDelete(item)}>
        <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>食物库</Text>
          <TouchableOpacity style={styles.addBtnTop} onPress={openAdd}>
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.subtitle}>这里保存的是你常吃的、估算后能一键复用的食物</Text>
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="fast-food-outline" size={42} color={COLORS.textLighter} />
          <Text style={styles.emptyText}>还没有保存的食物</Text>
          <Text style={styles.emptySub}>在三餐估算完点「存为食物」，或点右上角「＋」手动添加</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* 新增 / 修改 表单 */}
      <Modal visible={sheetVisible} transparent animationType="slide" onRequestClose={() => setSheetVisible(false)}>
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setSheetVisible(false); }}>
          <View style={styles.sheetWrap}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{editing ? '修改食物' : '新增食物'}</Text>
                <TouchableOpacity onPress={() => { Keyboard.dismiss(); setSheetVisible(false); }}>
                  <Ionicons name="close-circle" size={24} color={COLORS.textLighter} />
                </TouchableOpacity>
              </View>

              <View style={styles.recogRow}>
                <TouchableOpacity style={styles.recogBtn} onPress={() => pickAndRecognize(true)} disabled={recognizing}>
                  {recognizing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera-outline" size={15} color="#fff" />}
                  <Text style={styles.recogBtnText}>拍照配料表</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.recogBtnAlt} onPress={() => pickAndRecognize(false)} disabled={recognizing}>
                  <Ionicons name="image-outline" size={15} color={COLORS.primary} />
                  <Text style={styles.recogBtnAltText}>上传配料表</Text>
                </TouchableOpacity>
              </View>
              {recognizing && <Text style={styles.recogHint}>正在识别配料表，请稍候…</Text>}

              <Text style={styles.label}>名称（含分量）</Text>
              <TextInput
                style={styles.input}
                placeholder="如：米饭 1碗(约150g)"
                placeholderTextColor={COLORS.textLighter}
                value={form.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
                returnKeyType="done"
              />

              <Text style={styles.label}>营养成分（按上面这个分量填写）</Text>
              <View style={styles.grid}>
                <Field label="热量(kcal)" value={form.calories} onChange={(v) => setForm({ ...form, calories: v })} />
                <Field label="蛋白(g)" value={form.protein} onChange={(v) => setForm({ ...form, protein: v })} />
                <Field label="脂肪(g)" value={form.fat} onChange={(v) => setForm({ ...form, fat: v })} />
                <Field label="碳水(g)" value={form.carbs} onChange={(v) => setForm({ ...form, carbs: v })} />
                <Field label="纤维(g)" value={form.fiber} onChange={(v) => setForm({ ...form, fiber: v })} />
              </View>

              <Text style={styles.label}>配料表原文（可粘贴识别结果，便于日后核对换算）</Text>
              <TextInput
                style={[styles.input, { minHeight: 56, textAlignVertical: 'top' }]}
                placeholder="如：每100g 能量512kcal 蛋白质7.2g 脂肪31g 碳水53g 膳食纤维4g"
                placeholderTextColor={COLORS.textLighter}
                value={form.ingredientText}
                onChangeText={(v) => setForm({ ...form, ingredientText: v })}
                multiline
                returnKeyType="done"
              />

              <View style={styles.unitRow}>
                <View style={styles.unitItem}>
                  <Text style={styles.label}>配料表基准单位</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="如 100g / 1份20g"
                    placeholderTextColor={COLORS.textLighter}
                    value={form.labelBaseUnit}
                    onChangeText={(v) => setForm({ ...form, labelBaseUnit: v })}
                    returnKeyType="done"
                  />
                </View>
                <View style={styles.unitItem}>
                  <Text style={styles.label}>我习惯输入单位</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="如 一份 / 10g"
                    placeholderTextColor={COLORS.textLighter}
                    value={form.inputUnit}
                    onChangeText={(v) => setForm({ ...form, inputUnit: v })}
                    returnKeyType="done"
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Ionicons name={editing ? 'checkmark-circle-outline' : 'add-circle-outline'} size={16} color="#fff" />
                <Text style={styles.saveBtnText}>{editing ? '保存修改' : '保存到食物库'}</Text>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={styles.fieldInput}
      keyboardType="numeric"
      placeholder="0"
      placeholderTextColor={COLORS.textLighter}
      value={value}
      onChangeText={onChange}
      returnKeyType="done"
    />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: TOP_INSET + 12,
    paddingBottom: 16,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { padding: 2, width: 32 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  addBtnTop: { padding: 4, width: 32, alignItems: 'flex-end' },
  subtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 8 },

  listContent: { padding: 16, paddingBottom: 32 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyText: { fontSize: 15, color: COLORS.textLight, marginTop: 12 },
  emptySub: { fontSize: 12, color: COLORS.textLighter, marginTop: 6, textAlign: 'center' },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardBody: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  cardMacros: { fontSize: 12, color: COLORS.textLight, marginTop: 4, lineHeight: 17 },
  cardAction: { paddingHorizontal: 6, paddingVertical: 4 },

  // 表单
  sheetWrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  label: { fontSize: 13, color: COLORS.textLight, marginTop: 10, marginBottom: 6 },
  recogRow: { flexDirection: 'row', gap: 10, marginTop: 2, marginBottom: 4 },
  recogBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 12, backgroundColor: COLORS.primary,
  },
  recogBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  recogBtnAlt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: 12, backgroundColor: '#EEF2FF', borderWidth: 0.5, borderColor: '#C7D2FE',
  },
  recogBtnAltText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  recogHint: { fontSize: 12, color: COLORS.primary, marginTop: 6, marginBottom: 2 },
  unitRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  unitItem: { flex: 1 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { width: '30%' },
  fieldLabel: { fontSize: 11.5, color: COLORS.textLight, marginBottom: 4 },
  fieldInput: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});

export default FoodLibraryPage;
