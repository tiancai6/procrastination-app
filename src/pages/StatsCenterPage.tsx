import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import TimerStatsPanel from '../components/TimerStatsPanel';
import LedgerStatsPanel from '../components/LedgerStatsPanel';
import MealStatsPanel from '../components/MealStatsPanel';

type Segment = 'focus' | 'ledger' | 'meal';

const StatsCenterPage: React.FC = () => {
  const [segment, setSegment] = useState<Segment>('focus');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>统计中心</Text>
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, segment === 'focus' && styles.segmentBtnActive]}
            onPress={() => setSegment('focus')}
          >
            <Ionicons
              name="time-outline"
              size={15}
              color={segment === 'focus' ? '#fff' : COLORS.textLight}
            />
            <Text style={[styles.segmentText, segment === 'focus' && styles.segmentTextActive]}>
              专注
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, segment === 'ledger' && styles.segmentBtnActive]}
            onPress={() => setSegment('ledger')}
          >
            <Ionicons
              name="wallet-outline"
              size={15}
              color={segment === 'ledger' ? '#fff' : COLORS.textLight}
            />
            <Text style={[styles.segmentText, segment === 'ledger' && styles.segmentTextActive]}>消费</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, segment === 'meal' && styles.segmentBtnActive]}
            onPress={() => setSegment('meal')}
          >
            <Ionicons
              name="restaurant-outline"
              size={15}
              color={segment === 'meal' ? '#fff' : COLORS.textLight}
            />
            <Text style={[styles.segmentText, segment === 'meal' && styles.segmentTextActive]}>三餐</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.body}>
        {segment === 'focus' ? (
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
  segment: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    padding: 4,
    gap: 4,
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
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  segmentTextActive: {
    color: COLORS.primary,
  },
  body: {
    flex: 1,
  },
});

export default StatsCenterPage;
