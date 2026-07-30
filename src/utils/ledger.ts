import { LedgerEntry, LedgerType } from '../types';

export const EXPENSE_CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '学习', '医疗', '人情', '其他'];
export const INCOME_CATEGORIES = ['工资', '兼职', '理财', '红包', '其他'];

export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = {
  expense: '支出',
  income: '收入',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const formatMoney = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return (
    sign +
    '¥' +
    abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1).getTime();
const endOfMonth = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  x.setTime(x.getTime() - 1);
  return x.getTime();
};

export const totalBy = (
  entries: LedgerEntry[],
  type: LedgerType,
  from?: number,
  to?: number,
): number => {
  return round2(
    entries
      .filter(
        (e) =>
          e.type === type &&
          (from === undefined || e.occurredAt >= from) &&
          (to === undefined || e.occurredAt <= to),
      )
      .reduce((s, e) => s + e.amount, 0),
  );
};

export const getTodayExpense = (entries: LedgerEntry[]) =>
  totalBy(entries, 'expense', startOfDay(new Date()));
export const getTodayIncome = (entries: LedgerEntry[]) =>
  totalBy(entries, 'income', startOfDay(new Date()));
export const getMonthExpense = (entries: LedgerEntry[]) =>
  totalBy(entries, 'expense', startOfMonth(new Date()), endOfMonth(new Date()));
export const getMonthIncome = (entries: LedgerEntry[]) =>
  totalBy(entries, 'income', startOfMonth(new Date()), endOfMonth(new Date()));

export interface CategorySlice {
  category: string;
  total: number;
  percentage: number;
}

export const getCategoryBreakdown = (
  entries: LedgerEntry[],
  type: LedgerType,
  from?: number,
  to?: number,
): CategorySlice[] => {
  const filtered = entries.filter(
    (e) =>
      e.type === type &&
      (from === undefined || e.occurredAt >= from) &&
      (to === undefined || e.occurredAt <= to),
  );
  const map = new Map<string, number>();
  for (const e of filtered) map.set(e.category, round2((map.get(e.category) || 0) + e.amount));
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
  return Array.from(map.entries())
    .map(([category, sum]) => ({
      category,
      total: sum,
      percentage: total > 0 ? Math.round((sum / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);
};

export interface MonthlySummary {
  month: number; // 1-12
  expense: number;
  income: number;
  topCategory: string | null; // 当月支出最大分类
  topAmount: number;
}

// 年视图：返回该年 1-12 月每月的支出/收入/最大消费分类
export const getMonthlySummary = (entries: LedgerEntry[], year: number): MonthlySummary[] => {
  const result: MonthlySummary[] = [];
  for (let m = 1; m <= 12; m++) {
    const from = new Date(year, m - 1, 1).getTime();
    const to = new Date(year, m, 1).getTime() - 1;
    const expense = totalBy(entries, 'expense', from, to);
    const income = totalBy(entries, 'income', from, to);
    const breakdown = getCategoryBreakdown(entries, 'expense', from, to);
    const top = breakdown[0];
    result.push({
      month: m,
      expense,
      income,
      topCategory: top ? top.category : null,
      topAmount: top ? top.total : 0,
    });
  }
  return result;
};
