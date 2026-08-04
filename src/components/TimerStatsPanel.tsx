import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FOCUS_CATEGORIES } from '../constants/reasons';
import { useSessionStore } from '../store/sessionStore';
import { calculateWeeklyTrend, calculateCategoryStats, formatDuration } from '../utils/analytics';
import SwipeableRow from './SwipeableRow';
import SessionEditSheet from './SessionEditSheet';
import { emitDataReset } from '../utils/appEvents';
import { TimerSession } from '../types';

const TimerStatsPanel: React.FC = () => {
  const { sessions, stats, fetchSessions, fetchStats, updateSession, deleteSession } = useSessionStore();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetEntry, setSheetEntry] = useState<TimerSession | null>(null);

  useEffect(() => {
    fetchSessions();
    fetchStats();
  }, []);

  // 保存/删除后：重拉本面板会话与统计，并广播给其他 Tab（如首页「今日专注」）同步
  const refresh = useCallback(() => {
    fetchSessions();
    fetchStats();
    emitDataReset();
  }, [fetchSessions, fetchStats]);

  const openEdit = (s: TimerSession) => {
    setSheetEntry(s);
    setSheetVisible(true);
  };
  const openAdd = () => {
    setSheetEntry(null);
    setSheetVisible(true);
  };
  const handleDelete = (s: TimerSession) => {
    Alert.alert('删除记录', '确定删除这条专注记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteSession(s.id);
          refresh();
        },
      },
    ]);
  };

  const weekly = calculateWeeklyTrend(sessions);
  const maxWeekly = Math.max(...weekly.map((w) => w.duration), 1);
  const categories = calculateCategoryStats(sessions);
  const recent = [...sessions].sort((a, b) => b.startTime - a.startTime).slice(0, 20);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 今日总计时 */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>今日专注</Text>
        <Text style={styles.heroValue}>{formatDuration(stats.todayDuration)}</Text>
        <View style={styles.heroRow}>
          <Text style={styles.heroSub}>本周 {formatDuration(stats.weekTotal)}</Text>
          <Text style={styles.heroSub}>平均 {formatDuration(stats.avgDuration)}/次</Text>
          <Text style={styles.heroSub}>共 {stats.weekCount} 次</Text>
        </View>
      </View>

      {/* 周趋势 */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>本周趋势</Text>
        <View style={styles.weekBars}>
          {weekly.map((w) => (
            <View key={w.day} style={styles.weekCol}>
              <View style={styles.weekBarTrack}>
                <View
                  style={[styles.weekBarFill, { height: `${Math.max(4, (w.duration / maxWeekly) * 100)}%` }]}
                />
              </View>
              <Text style={styles.weekDay}>{w.day}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 分类占比 */}
      {categories.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>分类占比</Text>
          {categories.map((c) => (
            <View key={c.name} style={styles.catRow}>
              <Text style={styles.catName}>{c.name}</Text>
              <View style={styles.catBarTrack}>
                <View style={[styles.catBarFill, { width: `${c.percentage}%` }]} />
              </View>
              <Text style={styles.catPct}>{c.percentage}%</Text>
            </View>
          ))}
        </View>
      )}

      {/* 记录列表 */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>专注记录</Text>
          <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
            <Ionicons name="add" size={15} color={COLORS.primary} />
            <Text style={styles.addBtnText}>补记一次</Text>
          </TouchableOpacity>
        </View>
        {recent.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="timer-outline" size={20} color={COLORS.textLighter} />
            <Text style={styles.emptyText}>还没有专注记录，去首页点「开始计时」吧</Text>
          </View>
        ) : (
          recent.map((s) => {
            const d = new Date(s.startTime);
            const now = new Date();
            const isToday =
              d.getFullYear() === now.getFullYear() &&
              d.getMonth() === now.getMonth() &&
              d.getDate() === now.getDate();
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const timeLabel = isToday
              ? `今天 ${hh}:${mm}`
              : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
            const label = FOCUS_CATEGORIES.find((c) => c.value === s.category)?.label || s.category;
            return (
              <SwipeableRow key={s.id} onDelete={() => handleDelete(s)}>
                <TouchableOpacity style={styles.sessionRow} onPress={() => openEdit(s)} activeOpacity={0.7}>
                  <View style={styles.sessionIcon}>
                    <Ionicons name="timer-outline" size={16} color={COLORS.primary} />
                  </View>
                  <View style={styles.sessionMiddle}>
                    <Text style={styles.sessionCat}>
                      {label}
                      {s.what ? ` · ${s.what}` : ''}
                    </Text>
                    <Text style={styles.sessionTime}>{timeLabel} 开始</Text>
                  </View>
                  <Text style={styles.sessionDuration}>{formatDuration(s.duration)}</Text>
                </TouchableOpacity>
              </SwipeableRow>
            );
          })
        )}
      </View>

      <SessionEditSheet
        visible={sheetVisible}
        entry={sheetEntry}
        onClose={() => setSheetVisible(false)}
        onSaved={refresh}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  heroCard: {
    margin: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 20,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  heroLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
  },
  heroValue: {
    color: '#fff',
    fontSize: 44,
    fontWeight: 'bold',
    marginVertical: 4,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 12,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
  },
  sectionCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.secondary,
    borderWidth: 0.5,
    borderColor: COLORS.primaryLight,
    marginBottom: 12,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  weekBars: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 110,
  },
  weekCol: {
    alignItems: 'center',
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  weekBarTrack: {
    width: 18,
    height: 80,
    backgroundColor: COLORS.background,
    borderRadius: 9,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  weekBarFill: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 9,
  },
  weekDay: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 6,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  catName: {
    fontSize: 13,
    color: COLORS.text,
    width: 48,
  },
  catBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.background,
    borderRadius: 4,
    overflow: 'hidden',
  },
  catBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  catPct: {
    fontSize: 12,
    color: COLORS.textLight,
    width: 36,
    textAlign: 'right',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: COLORS.card,
  },
  sessionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sessionMiddle: {
    flex: 1,
  },
  sessionCat: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  sessionTime: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  sessionDuration: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  emptyWrap: {
    alignItems: 'center',
    padding: 20,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});

export default TimerStatsPanel;
