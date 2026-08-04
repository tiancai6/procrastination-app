import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/reasons';
import { MealNutrition } from '../types';

const ADEQUACY_COLOR: Record<string, string> = { 不足: '#F59E0B', 适量: '#22C55E', 过量: '#EF4444' };

const n = (v?: number) => Math.round(v || 0);

interface Props {
  nutrition: MealNutrition;
  /** 是否显示顶部「本餐合计」行（统计页里外层已有合计时可关掉） */
  showTotal?: boolean;
}

/**
 * 单餐营养明细：先给本餐合计，再逐样食物列出各自贡献的营养。
 * 让用户清楚「这 30g 蛋白到底是鸡蛋给的还是牛奶给的」。
 */
const NutritionDetail: React.FC<Props> = ({ nutrition, showTotal = true }) => {
  const items = nutrition.items || [];

  return (
    <View style={styles.wrap}>
      {showTotal && (
        <View style={styles.totalBox}>
          <View style={styles.totalHead}>
            <Text style={styles.totalLabel}>本餐合计</Text>
            <View style={[styles.badge, { backgroundColor: ADEQUACY_COLOR[nutrition.adequacy] || '#22C55E' }]}>
              <Text style={styles.badgeText}>{nutrition.adequacy}</Text>
            </View>
          </View>
          <Text style={styles.totalText}>
            蛋白 {n(nutrition.protein)}g · 热量 {n(nutrition.calories)}kcal · 脂肪 {n(nutrition.fat)}g · 碳水{' '}
            {n(nutrition.carbs)}g · 纤维 {n(nutrition.fiber)}g
            {nutrition.water ? ` · 饮水 ${n(nutrition.water)}ml` : ''}
          </Text>
        </View>
      )}

      {items.length > 0 ? (
        <View style={styles.table}>
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.hCell, styles.cName]}>食物</Text>
            <Text style={[styles.hCell, styles.cNum]}>蛋白</Text>
            <Text style={[styles.hCell, styles.cNum]}>热量</Text>
            <Text style={[styles.hCell, styles.cNum]}>脂肪</Text>
            <Text style={[styles.hCell, styles.cNum]}>碳水</Text>
            <Text style={[styles.hCell, styles.cNum]}>纤维</Text>
          </View>
          {items.map((it, i) => (
            <View key={`${it.name}-${i}`} style={[styles.row, i % 2 === 1 && styles.rowAlt]}>
              <Text style={[styles.cell, styles.cName]} numberOfLines={2}>
                {it.name}
              </Text>
              <Text style={[styles.cell, styles.cNum, styles.cProtein]}>{n(it.protein)}</Text>
              <Text style={[styles.cell, styles.cNum]}>{n(it.calories)}</Text>
              <Text style={[styles.cell, styles.cNum]}>{n(it.fat)}</Text>
              <Text style={[styles.cell, styles.cNum]}>{n(it.carbs)}</Text>
              <Text style={[styles.cell, styles.cNum]}>{n(it.fiber)}</Text>
            </View>
          ))}
          <Text style={styles.unitHint}>单位：蛋白 / 脂肪 / 碳水 / 纤维 = g，热量 = kcal</Text>
        </View>
      ) : (
        <Text style={styles.noItems}>这条记录还没有逐项明细，重新估算一次即可生成。</Text>
      )}

      {nutrition.comment ? <Text style={styles.comment}>{nutrition.comment}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
  },
  totalBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  totalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#15803D',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  totalText: {
    fontSize: 12,
    color: '#166534',
    lineHeight: 18,
  },
  table: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  rowAlt: {
    backgroundColor: COLORS.background,
  },
  headRow: {
    backgroundColor: '#EEF2FF',
  },
  hCell: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  cell: {
    fontSize: 11.5,
    color: COLORS.text,
  },
  cName: {
    flex: 1,
    paddingRight: 4,
  },
  cNum: {
    width: 34,
    textAlign: 'right',
  },
  cProtein: {
    fontWeight: '700',
    color: '#15803D',
  },
  unitHint: {
    fontSize: 10,
    color: COLORS.textLighter,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  noItems: {
    fontSize: 11.5,
    color: COLORS.textLight,
    lineHeight: 18,
  },
  comment: {
    fontSize: 11.5,
    color: COLORS.textLight,
    lineHeight: 18,
    marginTop: 6,
  },
});

export default NutritionDetail;
