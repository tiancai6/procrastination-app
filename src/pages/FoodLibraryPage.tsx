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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { getFoodLibrary, addFoodItem, deleteFoodItem, updateFoodItem, FoodItem } from '../utils/nutrition';

const EMPTY = { name: '', calories: '', protein: '', fat: '', carbs: '', fiber: '' };

const FoodLibraryPage: React.FC = () => {
  const navigation = useNavigation<any>();
  const [list, setList] = useState<FoodItem[]>([]);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [form, setForm] = useState(EMPTY);

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
    });
    setSheetVisible(true);
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
