import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { LedgerEntry, LedgerType } from '../types';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../utils/ledger';
import { addLedgerEntry, updateLedgerEntry, deleteLedgerEntry, generateId } from '../utils/storage';

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
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

const LedgerQuickSheet: React.FC<Props> = ({ visible, onClose, onSaved, defaultType = 'expense', entry }) => {
  const [type, setType] = useState<LedgerType>(defaultType);
  const [expr, setExpr] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [note, setNote] = useState('');
  const [startTs, setStartTs] = useState(Date.now());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());

  const isEditing = !!entry;

  const resetState = (t: LedgerType) => {
    setType(t);
    setExpr('');
    setCategory(t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entry]);

  if (!visible) return null;

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

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

  const onDateChange = (event: any, date?: Date) => {
    if (date) setTempDate(date);
    if (Platform.OS === 'android') {
      if (event.type === 'set' && date) applyDate(date);
      setShowDatePicker(false);
    }
  };

  const applyDate = (date: Date) => {
    const orig = new Date(startTs);
    const merged = new Date(date);
    merged.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    setStartTs(merged.getTime());
  };

  const openDatePicker = () => {
    setTempDate(new Date(startTs));
    setShowDatePicker(true);
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
        occurredAt: now,
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
        setCategory(type === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]);
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

  const displayAmount = expr || '0';

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.headerRow}>
          <Text style={styles.title}>{isEditing ? '编辑记账' : '记一笔'}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>

        <View style={styles.seg}>
          <TouchableOpacity
            style={[styles.segBtn, type === 'expense' && styles.segBtnActive]}
            onPress={() => {
              setType('expense');
              setCategory(EXPENSE_CATEGORIES[0]);
            }}
          >
            <Text style={[styles.segText, type === 'expense' && styles.segTextActive]}>支出</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segBtn, type === 'income' && styles.segBtnActive]}
            onPress={() => {
              setType('income');
              setCategory(INCOME_CATEGORIES[0]);
            }}
          >
            <Text style={[styles.segText, type === 'income' && styles.segTextActive]}>收入</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.amountRow}>
          <Text style={[styles.amount, type === 'income' && styles.amountIncome]}>
            {displayAmount}
          </Text>
        </View>

        {isEditing && (
          <TouchableOpacity style={styles.dateRow} onPress={openDatePicker}>
            <Ionicons name="calendar-outline" size={15} color={COLORS.primary} />
            <Text style={styles.dateText}>{fmtDate(startTs)}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.catWrap}>
          {categories.map((c) => (
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
    </View>
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
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
  },
  closeBtn: {
    padding: 4,
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
});

export default LedgerQuickSheet;
