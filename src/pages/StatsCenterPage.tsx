import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import TimerStatsPanel from '../components/TimerStatsPanel';
import LedgerStatsPanel from '../components/LedgerStatsPanel';
import MealStatsPanel from '../components/MealStatsPanel';
import ExerciseCalendarPage from './ExerciseCalendarPage';

// 顺序：运动 → 消费 → 三餐 → 专注（运动放第一格，专注放最后）
type Segment = 'exercise' | 'ledger' | 'meal' | 'focus';

const SEGS: { key: Segment; label: string; icon: string }[] = [
  { key: 'exercise', label: '运动', icon: 'barbell-outline' },
  { key: 'ledger', label: '消费', icon: 'wallet-outline' },
  { key: 'meal', label: '三餐', icon: 'restaurant-outline' },
  { key: 'focus', label: '专注', icon: 'time-outline' },
];

const StatsCenterPage: React.FC = () => {
  const [segment, setSegment] = useState<Segment>('exercise');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>统计中心</Text>
        </View>
        <View style={styles.segment}>
          {SEGS.map((s) => {
            const active = segment === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                onPress={() => setSegment(s.key)}
              >
                <Ionicons name={s.icon as any} size={17} color={active ? COLORS.primary : '#FFFFFF'} />
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{s.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.body}>
        {segment === 'exercise' ? (
          <ExerciseCalendarPage embedded />
        ) : segment === 'focus' ? (
          <TimerStatsPanel />
        ) : segment === 'ledger' ? (
          <LedgerStatsPanel />
        ) : (
          <MealStatsPanel />
        )}
      </View>
    </View>
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
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 14,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 14,
    padding: 4,
    gap: 6,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.95)',
  },
  segmentTextActive: {
    color: COLORS.primary,
  },
  body: {
    flex: 1,
  },
});

export default StatsCenterPage;
