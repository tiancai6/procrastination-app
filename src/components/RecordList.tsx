import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ProcrastinationRecord } from '../types';
import { COLORS } from '../constants/reasons';
import { formatDuration } from '../utils/analytics';
import { getTodayRecords, deleteRecord } from '../utils/storage';
import { useRecordsStore } from '../store/recordsStore';
import { onDataReset } from '../utils/appEvents';
import ProcrastinationEditSheet from './ProcrastinationEditSheet';
import SwipeableRow from './SwipeableRow';

const RecordList: React.FC = () => {
  const [records, setRecords] = useState<ProcrastinationRecord[]>([]);
  const [editing, setEditing] = useState<ProcrastinationRecord | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const { records: storeRecords, fetchRecords, fetchStats } = useRecordsStore();

  useEffect(() => {
    loadRecords();
  }, [storeRecords]);

  // 清除全部数据 / 导入备份后，重新加载今日记录与统计
  useEffect(() => {
    const off = onDataReset(onChanged);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecords = async () => {
    const todayRecords = await getTodayRecords();
    setRecords(todayRecords);
  };

  const onChanged = () => {
    loadRecords();
    fetchRecords();
    fetchStats();
  };

  const handleDelete = (item: ProcrastinationRecord) => {
    Alert.alert('删除记录', `确定删除这条「${item.reason}」记录吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteRecord(item.id);
          onChanged(); // 重新加载今日记录 + 刷新统计 store
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Ionicons name="list-outline" size={18} color={COLORS.primaryDark} />
          <Text style={styles.title}>今日记录</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.count}>{records.length}条</Text>
        </View>
      </View>
      {records.length > 0 ? (
        <View style={styles.list}>
          {records.map((item) => (
            <SwipeableRow
              key={item.id}
              onDelete={() => handleDelete(item)}
            >
              <TouchableOpacity
                style={styles.recordItem}
                activeOpacity={0.7}
                onPress={() => {
                  setEditing(item);
                  setEditVisible(true);
                }}
              >
                <View style={styles.reasonRow}>
                  <View style={styles.reasonDot} />
                  <Text style={styles.reason}>{item.reason}</Text>
                  <Ionicons name="create-outline" size={15} color={COLORS.textLighter} style={styles.editIcon} />
                </View>
                <View style={styles.metaRow}>
                  {item.note ? (
                    <Text style={styles.note} numberOfLines={1}>"{item.note}"</Text>
                  ) : (
                    <Text style={styles.notePlaceholder}>无备注</Text>
                  )}
                  <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
                </View>
              </TouchableOpacity>
            </SwipeableRow>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={32} color={COLORS.textLighter} />
          <Text style={styles.emptyText}>今天还没有拖延记录</Text>
          <Text style={styles.emptySubtext}>开始计时即可生成第一条记录</Text>
        </View>
      )}

      <ProcrastinationEditSheet
        visible={editVisible}
        entry={editing}
        onClose={() => setEditVisible(false)}
        onChanged={onChanged}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 16,
    marginTop: 8,
    padding: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primaryDark,
  },
  countBadge: {
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  count: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  list: {
    maxHeight: 240,
  },
  recordItem: {
    padding: 12,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  reasonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  reason: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
    flex: 1,
  },
  editIcon: {
    marginLeft: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 14,
  },
  note: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textLight,
    fontStyle: 'italic',
    marginRight: 8,
  },
  notePlaceholder: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textLighter,
    marginRight: 8,
  },
  duration: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '500',
  },
  emptySubtext: {
    color: COLORS.textLighter,
    fontSize: 12,
  },
});

export default RecordList;
