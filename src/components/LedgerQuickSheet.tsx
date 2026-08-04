import React, { useState, useEffect, useMemo } from 'react';
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
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { LedgerEntry, LedgerType } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../utils/ledger';
import { addLedgerEntry, updateLedgerEntry, deleteLedgerEntry, generateId, getLedgerCategories, setLedgerCategories } from '../utils/storage';
import CalendarPicker, { WEEK_LABELS } from './CalendarPicker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
  defaultType?: LedgerType;
  entry?: LedgerEntry | null; // 传入则为编辑模式
}

const OP_TO_CHAR: Record<string, string> = { '÷': '/', '×': '*', '−': '-' };
const round2 = (n: number) => Math.round(n * 100) / 100;

// 安全的中缀表达式求值（支持 + - * / 和括号），不使用 eval
function evaluateExpr(input: string): number | null {
  if (!input) return null;
  const tokens: string[] = [];
  let num = '';
  for (const ch of input) {
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      num += ch;
    } else if ('+-*/()'.includes(ch)) {
      if (num) {
        tokens.push(num);
        num = '';
      }
      tokens.push(ch);
    } else {
      return null;
    }
  }
  if (num) tokens.push(num);
  if (tokens.length === 0) return null;

  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const isNum = (t: string) => !isNaN(Number(t));
  const output: (number | string)[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if (isNum(t)) {
      output.push(Number(t));
    } else if (t === '(') {
      ops.push(t);
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop()!);
      if (ops[ops.length - 1] === '(') ops.pop();
      else return null;
    } else {
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        precedence[ops[ops.length - 1]] >= precedence[t]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(t);
    }
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o === '(' || o === ')') return null;
    output.push(o);
  }
  const stack: number[] = [];
  for (const t of output) {
    if (typeof t === 'number') {
      stack.push(t);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return null;
      if (t === '+') stack.push(a + b);
      else if (t === '-') stack.push(a - b);
      else if (t === '*') stack.push(a * b);
      else if (t === '/') stack.push(b === 0 ? 0 : a / b);
    }
  }
  return stack.length === 1 ? stack[0] : null;
}

const KEYPAD: { k: string; kind: 'fn' | 'op' | 'num' | 'eq' }[] = [
  { k: 'C', kind: 'fn' },
  { k: '⌫', kind: 'fn' },
  { k: '(', kind: 'op' },
  { k: ')', kind: 'op' },
  { k: '7', kind: 'num' },
  { k: '8', kind: 'num' },
  { k: '9', kind: 'num' },
  { k: '÷', kind: 'op' },
  { k: '4', kind: 'num' },
  { k: '5', kind: 'num' },
  { k: '6', kind: 'num' },
  { k: '×', kind: 'op' },
  { k: '1', kind: 'num' },
  { k: '2', kind: 'num' },
  { k: '3', kind: 'num' },
  { k: '−', kind: 'op' },
  { k: '0', kind: 'num' },
  { k: '.', kind: 'num' },
  { k: '=', kind: 'eq' },
  { k: '+', kind: 'op' },
];

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

const LedgerQuickSheet: React.FC<Props> = ({ visible, onClose, onSaved, defaultType = 'expense', entry }) => {
  const [type, setType] = useState<LedgerType>(defaultType);
  const [expr, setExpr] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [startTs, setStartTs] = useState(Date.now());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // 自定义分类（按支出/收入分别保存）；编辑分类弹窗的状态
  const [cats, setCats] = useState<string[]>(
    defaultType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES,
  );
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [catEditList, setCatEditList] = useState<string[]>([]);
  const [catDraft, setCatDraft] = useState('');

  const isEditing = !!entry;

  // 键盘高度监听：弹窗不再整体被顶飞，而是把弹窗抬到键盘上方并压缩可视高度，
  // 备注框在 ScrollView 内随焦点自动滚入视野，保存按钮始终在键盘之上可见。
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

  // 选中分类若不在当前分类列表里（如旧记录的分类被删过），也临时纳入，保证可选
  const effectiveCats = useMemo(
    () => (category && !cats.includes(category) ? [category, ...cats] : cats),
    [cats, category],
  );

  // 切换收支类型时，载入对应分类并默认选中第一个
  const switchType = async (t: LedgerType) => {
    setType(t);
    const list = await getLedgerCategories(t);
    setCats(list);
    setCategory(list[0] || '');
  };

  const resetState = (t: LedgerType) => {
    setType(t);
    setExpr('');
    setCategory(cats.length ? cats[0] : t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
    setNote('');
    setStartTs(Date.now());
  };

  useEffect(() => {
    if (!visible) return;
    if (entry) {
      setType(entry.type);
      setExpr(String(entry.amount));
      setCategory(entry.category);
      setNote(entry.note || '');
      setStartTs(entry.occurredAt);
    } else {
      resetState(defaultType);
    }
    // 载入当前类型的自定义分类
    (async () => {
      const t = entry ? entry.type : defaultType;
      const list = await getLedgerCategories(t);
      setCats(list);
      if (!entry) {
        // 新建：默认选第一个
        setCategory(list[0] || '');
      } else if (!list.includes(entry.category)) {
        // 编辑：原分类若已被删，临时补回列表顶部以便重新选择
        setCats([entry.category, ...list]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry]);

  if (!visible) return null;

  const pressKey = (item: { k: string; kind: string }) => {
    if (item.kind === 'fn') {
      if (item.k === 'C') setExpr('');
      else if (item.k === '⌫') setExpr((e) => e.slice(0, -1));
      return;
    }
    if (item.kind === 'eq') {
      const r = evaluateExpr(expr);
      if (r !== null && isFinite(r)) setExpr(String(round2(r)));
      return;
    }
    const ch = item.kind === 'op' ? OP_TO_CHAR[item.k] ?? item.k : item.k;
    setExpr((prev) => {
      if (item.kind === 'num') return prev + ch;
      if (prev === '') {
        return ch === '-' || ch === '(' ? ch : prev;
      }
      const last = prev[prev.length - 1];
      if ('+-*/'.includes(last) && ch !== '(') {
        return prev.slice(0, -1) + ch;
      }
      return prev + ch;
    });
  };

  const doSave = async (closeAfter: boolean) => {
    const val = evaluateExpr(expr);
    if (val === null || !isFinite(val) || val <= 0) {
      Alert.alert('请输入有效金额');
      return;
    }
    const amount = round2(val);
    const now = Date.now();
    if (entry) {
      const updated: LedgerEntry = {
        ...entry,
        type,
        amount,
        category,
        note: note.trim() || undefined,
        occurredAt: startTs,
        updatedAt: now,
      };
      await updateLedgerEntry(updated);
      onSaved?.();
      onClose();
    } else {
      const newEntry: LedgerEntry = {
        id: generateId(),
        type,
        amount,
        category,
        note: note.trim() || undefined,
        occurredAt: startTs, // 用户可在弹窗内改日期，默认当前时间
        createdAt: now,
        updatedAt: now,
      };
      await addLedgerEntry(newEntry);
      onSaved?.();
      if (closeAfter) {
        onClose();
      } else {
        setExpr('');
        setNote('');
        setCategory(cats[0] || (type === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]));
      }
    }
  };

  const doDelete = () => {
    Alert.alert('删除记录', '确定删除这条记账吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteLedgerEntry(entry!.id);
          onSaved?.();
          onClose();
        },
      },
    ]);
  };

  // —— 编辑分类（标签按钮）——
  const openCatEditor = () => {
    setCatEditList([...effectiveCats]);
    setCatDraft('');
    setShowCatEditor(true);
  };

  const addCat = () => {
    const v = catDraft.trim();
    if (!v) return;
    if (catEditList.includes(v)) {
      setCatDraft('');
      return;
    }
    setCatEditList([...catEditList, v]);
    setCatDraft('');
  };

  const removeCat = (c: string) => {
    if (catEditList.length <= 1) {
      Alert.alert('至少保留一个分类');
      return;
    }
    setCatEditList(catEditList.filter((x) => x !== c));
  };

  const saveCats = async () => {
    const unique = Array.from(new Set(catEditList.map((s) => s.trim()).filter(Boolean)));
    if (unique.length === 0) {
      Alert.alert('请至少保留一个分类');
      return;
    }
    await setLedgerCategories(type, unique);
    setCats(unique);
    if (!unique.includes(category)) setCategory(unique[0] || '');
    setShowCatEditor(false);
  };

  const displayAmount = expr || '0';

  // 键盘出现时：把弹窗整体抬到键盘上方，并压缩最大高度，确保备注框与保存按钮都在可视区内
  const sheetMaxHeight: DimensionValue =
    keyboardHeight > 0 ? Math.max(220, screenHeight - keyboardHeight - 16) : '92%';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalInner, { paddingBottom: keyboardHeight }]}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{isEditing ? '编辑记账' : '记一笔'}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </View>

          {/* 可滚动区：内容再多也能滑到底，保存按钮固定在下方不会被挤走 */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <View style={styles.seg}>
              <TouchableOpacity
                style={[styles.segBtn, type === 'expense' && styles.segBtnActive]}
                onPress={() => switchType('expense')}
              >
                <Text style={[styles.segText, type === 'expense' && styles.segTextActive]}>支出</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segBtn, type === 'income' && styles.segBtnActive]}
                onPress={() => switchType('income')}
              >
                <Text style={[styles.segText, type === 'income' && styles.segTextActive]}>收入</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.amountRow}>
              <Text style={[styles.amount, type === 'income' && styles.amountIncome]}>
                {displayAmount}
              </Text>
            </View>

            {/* 日期时间：新建与编辑都可改 */}
            <TouchableOpacity style={styles.dateRow} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
              <Text style={styles.dateText}>{fmtDate(startTs)}</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textLighter} style={styles.dateArrow} />
            </TouchableOpacity>

            <View style={styles.catHeaderRow}>
              <Text style={styles.catHeader}>分类</Text>
              <TouchableOpacity style={styles.catEditBtn} onPress={openCatEditor}>
                <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                <Text style={styles.catEditBtnText}>编辑</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.catWrap}>
              {effectiveCats.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.catChip, category === c && styles.catChipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.noteRow}>
              <Ionicons name="create-outline" size={16} color={COLORS.textLight} />
              <TextInput
                style={styles.noteInput}
                placeholder="备注（可选）"
                placeholderTextColor={COLORS.textLighter}
                value={note}
                onChangeText={setNote}
                maxLength={50}
              />
            </View>

            <View style={styles.keypad}>
              {KEYPAD.map((item) => (
                <TouchableOpacity
                  key={item.k}
                  style={[
                    styles.key,
                    item.kind === 'fn' && styles.keyFn,
                    item.kind === 'op' && styles.keyOp,
                    item.kind === 'eq' && styles.keyEq,
                  ]}
                  onPress={() => pressKey(item)}
                >
                  <Text
                    style={[
                      styles.keyText,
                      item.kind === 'fn' && styles.keyFnText,
                      item.kind === 'op' && styles.keyOpText,
                      item.kind === 'eq' && styles.keyEqText,
                    ]}
                  >
                    {item.k}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* 固定操作栏：永远可见可点 */}
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
        title="选择记账时间"
        onConfirm={(d) => setStartTs(d.getTime())}
        onClose={() => setShowDatePicker(false)}
      />

      {/* 编辑分类弹窗 */}
      <Modal visible={showCatEditor} transparent animationType="slide" onRequestClose={() => setShowCatEditor(false)}>
        <View style={styles.catEditorOverlay}>
          <TouchableWithoutFeedback onPress={() => setShowCatEditor(false)}>
            <View style={styles.catEditorBackdrop} />
          </TouchableWithoutFeedback>
          <View style={styles.catEditorSheet}>
            <View style={styles.catEditorHeader}>
              <Text style={styles.catEditorTitle}>编辑分类（{type === 'expense' ? '支出' : '收入'}）</Text>
              <TouchableOpacity onPress={() => setShowCatEditor(false)}>
                <Ionicons name="close" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            <Text style={styles.catEditorHint}>点击 × 删除标签；在下方输入后点「添加」新增标签。至少保留一个。</Text>
            <ScrollView style={styles.catEditorList} contentContainerStyle={styles.catEditorListContent}>
              {catEditList.map((c) => (
                <View key={c} style={styles.catEditChip}>
                  <Text style={styles.catEditChipText}>{c}</Text>
                  <TouchableOpacity style={styles.catEditChipDel} onPress={() => removeCat(c)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close" size={13} color={COLORS.textLight} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <View style={styles.catEditorInputRow}>
              <TextInput
                style={styles.catEditorInput}
                placeholder="输入新分类，如：宠物"
                placeholderTextColor={COLORS.textLighter}
                value={catDraft}
                onChangeText={setCatDraft}
                onSubmitEditing={addCat}
                maxLength={10}
              />
              <TouchableOpacity style={styles.catEditorAdd} onPress={addCat}>
                <Text style={styles.catEditorAddText}>添加</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.catEditorSave} onPress={saveCats}>
              <Text style={styles.catEditorSaveText}>保存分类</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    // 关键：用 flex-end 把 sheet 永远推到最底部，避免在某些页面（如统计中心）里位置偏高
    justifyContent: 'flex-end',
  },
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
  sheetWrap: {
    width: '100%',
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
    maxHeight: '92%',
  },
  scrollArea: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 4,
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
  seg: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
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
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  segTextActive: {
    color: '#fff',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  amount: {
    fontSize: 34,
    fontWeight: 'bold',
    color: COLORS.danger,
    flex: 1,
  },
  amountIncome: {
    color: COLORS.success,
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
  closeBtn: {
    padding: 4,
  },
  catHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 2,
  },
  catHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  catEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.secondary,
    borderWidth: 0.5,
    borderColor: COLORS.primaryLight,
  },
  catEditBtnText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  catWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  catChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
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
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  noteText: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  noteInputWrap: {
    marginTop: 4,
  },
  noteInput: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: COLORS.text,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  key: {
    width: '23%',
    aspectRatio: 1.6,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyFn: {
    backgroundColor: '#F1F5F9',
  },
  keyOp: {
    backgroundColor: COLORS.secondary,
  },
  keyEq: {
    backgroundColor: COLORS.primary,
  },
  keyText: {
    fontSize: 20,
    color: COLORS.text,
    fontWeight: '500',
  },
  keyFnText: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  keyOpText: {
    fontSize: 20,
    color: COLORS.primary,
  },
  keyEqText: {
    fontSize: 20,
    color: '#fff',
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
  // —— 编辑分类弹窗 ——
  catEditorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  catEditorBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  catEditorSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
    maxHeight: '85%',
  },
  catEditorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  catEditorTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  catEditorHint: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 18,
    marginBottom: 10,
  },
  catEditorList: {
    maxHeight: 240,
  },
  catEditorListContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catEditChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  catEditChipText: {
    fontSize: 13,
    color: COLORS.text,
  },
  catEditChipDel: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catEditorInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  catEditorInput: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  catEditorAdd: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    borderWidth: 0.5,
    borderColor: COLORS.primaryLight,
  },
  catEditorAddText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  catEditorSave: {
    marginTop: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  catEditorSaveText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default LedgerQuickSheet;
