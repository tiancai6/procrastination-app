import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import TimerCard from '../components/TimerCard';
import StatCard from '../components/StatCard';
import RecordList from '../components/RecordList';
import LedgerQuickSheet from '../components/LedgerQuickSheet';
import { useRecordsStore } from '../store/recordsStore';
import { useLedgerStore } from '../store/ledgerStore';
import { onDataReset } from '../utils/appEvents';
import { getTodayExpense, getTodayIncome, getMonthExpense, formatMoney } from '../utils/ledger';

const HomePage: React.FC = () => {
  const { stats, fetchRecords, fetchStats } = useRecordsStore();
  const ledgerEntries = useLedgerStore((s) => s.entries);
  const loadLedger = useLedgerStore((s) => s.load);
  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    fetchRecords();
    fetchStats();
    loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 清除全部数据 / 导入备份后，重新拉取花销与统计，保证首页同步
  useEffect(() => {
    const off = onDataReset(() => {
      fetchRecords();
      fetchStats();
      loadLedger();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayExpense = useMemo(() => getTodayExpense(ledgerEntries), [ledgerEntries]);
  const todayIncome = useMemo(() => getTodayIncome(ledgerEntries), [ledgerEntries]);
  const monthExpense = useMemo(() => getMonthExpense(ledgerEntries), [ledgerEntries]);

  const today = new Date();
  const monthDay = `${today.getMonth() + 1}月${today.getDate()}日`;
  const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.dateText}>{monthDay} · {weekDay}</Text>
            <Text style={styles.title}>今天拖了什么？</Text>
          </View>
          <View style={styles.headerIcon}>
            <Ionicons name="time-outline" size={22} color="#fff" />
          </View>
        </View>
      </View>

      <TimerCard />

      <View style={styles.statsRow}>
        <StatCard
          icon="bar-chart-outline"
          label="本周总计"
          value={stats.weekTotal}
          unit="m"
        />
        <StatCard
          icon="timer-outline"
          label="平均时长"
          value={stats.avgDuration}
          unit="m"
        />
        <StatCard
          icon="document-text-outline"
          label="记录次数"
          value={stats.weekCount}
          unit="次"
        />
      </View>

      <View style={styles.ledgerCard}>
        <View style={styles.ledgerCardHead}>
          <View>
            <Text style={styles.ledgerCardTitle}>今日花销</Text>
            <Text style={styles.ledgerCardAmount}>{formatMoney(todayExpense)}</Text>
          </View>
          <TouchableOpacity style={styles.ledgerAddBtn} onPress={() => setSheetVisible(true)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.ledgerAddText}>记一笔</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.ledgerCardFoot}>
          <Text style={styles.ledgerFootText}>
            今日收入 <Text style={styles.ledgerFootStrong}>{formatMoney(todayIncome)}</Text>
          </Text>
          <Text style={styles.ledgerFootText}>
            本月支出 <Text style={styles.ledgerFootStrong}>{formatMoney(monthExpense)}</Text>
          </Text>
        </View>
      </View>

      <LedgerQuickSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onSaved={() => loadLedger()}
      />

      <RecordList />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: TOP_INSET + 16,
    paddingBottom: 16,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 4,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  ledgerCard: {
    marginTop: 4,
    marginHorizontal: 16,
    backgroundColor: '#FFF7F6',
    borderWidth: 1,
    borderColor: '#FBD5D0',
    borderRadius: 14,
    padding: 14,
  },
  ledgerCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ledgerCardTitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 4,
  },
  ledgerCardAmount: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  ledgerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  ledgerAddText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  ledgerCardFoot: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  ledgerFootText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  ledgerFootStrong: {
    color: COLORS.text,
    fontWeight: '600',
  },
});

export default HomePage;
