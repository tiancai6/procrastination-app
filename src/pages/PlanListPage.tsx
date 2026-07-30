import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { Plan, PlanTask } from '../types';
import { savePlan, getPlans, updatePlan, deletePlan, generateId } from '../utils/storage';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

type PlanStackParamList = {
  PlanList: undefined;
  Checkin: undefined;
  PlanStats: undefined;
};

type PlanListScreenNavigationProp = NativeStackNavigationProp<PlanStackParamList, 'PlanList'>;

const PlanListPage: React.FC = () => {
  const navigation = useNavigation<PlanListScreenNavigationProp>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [newPlan, setNewPlan] = useState({
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    rewardName: '',
    rewardType: 'virtual' as 'physical' | 'virtual',
    weeklyDays: 7,
    startTime: '08:00',
    endTime: '22:00',
    tasks: [] as PlanTask[],
  });
  // 日期选择器
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'start' | 'end' | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    const data = await getPlans();
    setPlans(data);
  };

  const handleAddPlan = async () => {
    if (!newPlan.name || !newPlan.rewardName || newPlan.tasks.length === 0) return;
    
    const plan: Plan = {
      id: generateId(),
      ...newPlan,
      rewardImage: null,
      createdAt: Date.now(),
      status: 'active',
    };
    
    await savePlan(plan);
    await loadPlans();
    resetForm();
  };

  const handleEditPlan = async () => {
    if (!editingPlan || !newPlan.name || !newPlan.rewardName || newPlan.tasks.length === 0) return;
    
    const updatedPlan: Plan = {
      ...editingPlan,
      ...newPlan,
    };
    
    await updatePlan(updatedPlan);
    await loadPlans();
    resetForm();
  };

  const resetForm = () => {
    setShowAddModal(false);
    setEditingPlan(null);
    setNewPlan({
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      rewardName: '',
      rewardType: 'virtual',
      weeklyDays: 7,
      startTime: '08:00',
      endTime: '22:00',
      tasks: [],
    });
  };

  const handleDelete = async (id: string) => {
    await deletePlan(id);
    await loadPlans();
  };

  const addTask = () => {
    const taskName = `任务${newPlan.tasks.length + 1}`;
    setNewPlan({
      ...newPlan,
      tasks: [...newPlan.tasks, {
        id: generateId(),
        planId: editingPlan?.id || '',
        name: taskName,
        duration: 30,
        order: newPlan.tasks.length,
      }],
    });
  };

  const updateTask = (index: number, field: 'name' | 'duration', value: string | number) => {
    const updatedTasks = [...newPlan.tasks];
    if (field === 'name') {
      updatedTasks[index] = { ...updatedTasks[index], name: value as string };
    } else {
      updatedTasks[index] = { ...updatedTasks[index], duration: value as number };
    }
    setNewPlan({ ...newPlan, tasks: updatedTasks });
  };

  const removeTask = (index: number) => {
    const updatedTasks = newPlan.tasks.filter((_, i) => i !== index);
    setNewPlan({ ...newPlan, tasks: updatedTasks });
  };

  // 日期选择器
  const openDatePicker = (target: 'start' | 'end') => {
    const currentDateStr = target === 'start' ? newPlan.startDate : newPlan.endDate;
    setTempDate(currentDateStr ? new Date(currentDateStr) : new Date());
    setDatePickerTarget(target);
    setShowDatePicker(true);
  };

  const commitDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    if (datePickerTarget === 'start') {
      setNewPlan(prev => ({ ...prev, startDate: dateStr }));
    } else if (datePickerTarget === 'end') {
      setNewPlan(prev => ({ ...prev, endDate: dateStr }));
    }
  };

  const onDateChange = (event: any, date?: Date) => {
    if (date) setTempDate(date);
    if (Platform.OS === 'android') {
      if (event.type === 'set' && date) {
        commitDate(date);
      }
      setShowDatePicker(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const getStatusText = (status: Plan['status']) => {
    switch (status) {
      case 'active': return '进行中';
      case 'completed': return '已完成';
      case 'expired': return '已过期';
    }
  };

  const getStatusColor = (status: Plan['status']) => {
    switch (status) {
      case 'active': return COLORS.primary;
      case 'completed': return '#22C55E';
      case 'expired': return '#9CA3AF';
    }
  };

  const handleOpenAddModal = () => {
    setEditingPlan(null);
    setShowAddModal(true);
  };

  const handleOpenEditModal = (plan: Plan) => {
    setEditingPlan(plan);
    setNewPlan({
      name: plan.name,
      description: plan.description,
      startDate: plan.startDate,
      endDate: plan.endDate,
      rewardName: plan.rewardName,
      rewardType: plan.rewardType,
      weeklyDays: plan.weeklyDays,
      startTime: plan.startTime,
      endTime: plan.endTime,
      tasks: plan.tasks,
    });
    setShowAddModal(true);
  };

  const activePlans = plans.filter(p => p.status === 'active');
  const completedPlans = plans.filter(p => p.status === 'completed');
  const expiredPlans = plans.filter(p => p.status === 'expired');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>规划奖励</Text>
            <Text style={styles.subtitle}>设定目标，获得奖励</Text>
          </View>
          <TouchableOpacity style={styles.headerAddBtn} onPress={handleOpenAddModal}>
            <Ionicons name="add-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.quickActionCard} onPress={() => navigation.navigate('Checkin')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
            </View>
            <View style={styles.quickActionTexts}>
              <Text style={styles.quickActionTitle}>每日打卡</Text>
              <Text style={styles.quickActionSub}>记录今日完成情况</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textLighter} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickActionCard} onPress={() => navigation.navigate('PlanStats')}>
            <View style={[styles.quickActionIcon, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="bar-chart-outline" size={20} color="#22C55E" />
            </View>
            <View style={styles.quickActionTexts}>
              <Text style={styles.quickActionTitle}>进度统计</Text>
              <Text style={styles.quickActionSub}>查看坚持趋势</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textLighter} />
          </TouchableOpacity>
        </View>

        {activePlans.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>进行中</Text>
            {activePlans.map((item) => (
              <View key={item.id} style={styles.planCard}>
                <View style={styles.planHeader}>
                  <View style={styles.planTitleRow}>
                    <Text style={styles.planName}>{item.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: '#DBEAFE' }]}>
                      <Text style={[styles.statusText, { color: COLORS.primaryDark }]}>进行中</Text>
                    </View>
                  </View>
                  <Text style={styles.planDates}>
                    <Ionicons name="calendar-outline" size={12} color={COLORS.textLight} /> {formatDate(item.startDate)} - {formatDate(item.endDate)}
                  </Text>
                </View>

                <View style={styles.rewardBox}>
                  <Ionicons name="trophy" size={18} color="#F59E0B" />
                  <Text style={styles.rewardText}>{item.rewardName}</Text>
                  <View style={styles.rewardTypeBadge}>
                    <Text style={styles.rewardTypeText}>{item.rewardType === 'physical' ? '实物' : '虚拟'}</Text>
                  </View>
                </View>

                <View style={styles.planMeta}>
                  <View style={styles.metaItem}>
                    <Ionicons name="list-outline" size={13} color={COLORS.textLight} />
                    <Text style={styles.metaText}>{item.tasks.length} 个任务</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="time-outline" size={13} color={COLORS.textLight} />
                    <Text style={styles.metaText}>{item.startTime}-{item.endTime}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="repeat-outline" size={13} color={COLORS.textLight} />
                    <Text style={styles.metaText}>每周 {item.weeklyDays} 天</Text>
                  </View>
                </View>

                <View style={styles.planActions}>
                  <TouchableOpacity style={styles.actionTextBtn} onPress={() => handleOpenEditModal(item)}>
                    <Text style={styles.actionTextPrimary}>编辑</Text>
                  </TouchableOpacity>
                  <View style={styles.actionDivider} />
                  <TouchableOpacity style={styles.actionTextBtn} onPress={() => handleDelete(item.id)}>
                    <Text style={styles.actionTextDanger}>删除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {completedPlans.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>已完成</Text>
            {completedPlans.map((item) => (
              <View key={item.id} style={[styles.planCard, styles.planCardCompleted]}>
                <View style={styles.planTitleRow}>
                  <Text style={[styles.planName, styles.planNameCompleted]}>{item.name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: '#DCFCE7' }]}>
                    <Text style={[styles.statusText, { color: '#15803D' }]}>已完成</Text>
                  </View>
                </View>
                <View style={styles.rewardBox}>
                  <Ionicons name="trophy" size={18} color="#22C55E" />
                  <Text style={[styles.rewardText, { color: '#15803D' }]}>已获得奖励：{item.rewardName}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {expiredPlans.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>已过期</Text>
            {expiredPlans.map((item) => (
              <View key={item.id} style={[styles.planCard, styles.planCardExpired]}>
                <View style={styles.planTitleRow}>
                  <Text style={[styles.planName, styles.planNameExpired]}>{item.name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: '#F3F4F6' }]}>
                    <Text style={[styles.statusText, { color: '#6B7280' }]}>已过期</Text>
                  </View>
                </View>
                <Text style={styles.expiredText}>该规划已过期，可以删除或重新创建</Text>
              </View>
            ))}
          </View>
        )}

        {plans.length === 0 && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="trophy-outline" size={40} color="#3B82F6" />
            </View>
            <Text style={styles.emptyText}>还没有规划</Text>
            <Text style={styles.emptySubtext}>点击下方按钮创建你的第一个规划，设定目标获得奖励</Text>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.fab}
        onPress={handleOpenAddModal}
        activeOpacity={0.85}
      >
        <Ionicons name="add-outline" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent={true}
        onRequestClose={resetForm}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? undefined : 'height'}
        >
          <ScrollView
            style={styles.modalScrollView}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingPlan ? '编辑规划' : '添加新规划'}</Text>
                <TouchableOpacity style={styles.modalCloseButton} onPress={resetForm}>
                  <Ionicons name="close" size={20} color="#64748B" />
                </TouchableOpacity>
              </View>
            
            <TextInput
              style={styles.input}
              placeholder="规划名称"
              placeholderTextColor={COLORS.textLight}
              value={newPlan.name}
              onChangeText={(text) => setNewPlan({ ...newPlan, name: text })}
            />

            <TextInput
              style={styles.input}
              placeholder="规划描述（可选）"
              placeholderTextColor={COLORS.textLight}
              value={newPlan.description}
              onChangeText={(text) => setNewPlan({ ...newPlan, description: text })}
              multiline
            />

            <View style={styles.dateRow}>
              <View style={styles.dateInputContainer}>
                <Text style={styles.label}>开始日期</Text>
                <TouchableOpacity
                  style={[styles.input, styles.dateInput, styles.datePickerBtn]}
                  onPress={() => openDatePicker('start')}
                >
                  <Text style={[styles.datePickerText, !newPlan.startDate && styles.datePickerPlaceholder]}>
                    {newPlan.startDate || '点击选择日期'}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
              <View style={styles.dateInputContainer}>
                <Text style={styles.label}>结束日期</Text>
                <TouchableOpacity
                  style={[styles.input, styles.dateInput, styles.datePickerBtn]}
                  onPress={() => openDatePicker('end')}
                >
                  <Text style={[styles.datePickerText, !newPlan.endDate && styles.datePickerPlaceholder]}>
                    {newPlan.endDate || '点击选择日期'}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.label}>奖励设置</Text>
            <TextInput
              style={styles.input}
              placeholder="奖励名称"
              placeholderTextColor={COLORS.textLight}
              value={newPlan.rewardName}
              onChangeText={(text) => setNewPlan({ ...newPlan, rewardName: text })}
            />
            <View style={styles.tagGrid}>
              <TouchableOpacity
                style={[styles.tag, newPlan.rewardType === 'virtual' && styles.tagSelected]}
                onPress={() => setNewPlan({ ...newPlan, rewardType: 'virtual' })}
              >
                <Text style={[styles.tagText, newPlan.rewardType === 'virtual' && styles.tagTextSelected]}>
                  虚拟奖励
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tag, newPlan.rewardType === 'physical' && styles.tagSelected]}
                onPress={() => setNewPlan({ ...newPlan, rewardType: 'physical' })}
              >
                <Text style={[styles.tagText, newPlan.rewardType === 'physical' && styles.tagTextSelected]}>
                  实物奖励
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>打卡规则</Text>
            <View style={styles.ruleRow}>
              <Text style={styles.ruleLabel}>每周打卡天数</Text>
              <TextInput
                style={[styles.input, styles.ruleInput]}
                keyboardType="numeric"
                placeholderTextColor={COLORS.textLight}
                value={String(newPlan.weeklyDays)}
                onChangeText={(text) => setNewPlan({ ...newPlan, weeklyDays: parseInt(text) || 7 })}
              />
            </View>
            <View style={styles.timeRow}>
              <TextInput
                style={[styles.input, styles.timeInput]}
                placeholder="开始时间"
                placeholderTextColor={COLORS.textLight}
                value={newPlan.startTime}
                onChangeText={(text) => setNewPlan({ ...newPlan, startTime: text })}
              />
              <Text style={styles.timeSeparator}>至</Text>
              <TextInput
                style={[styles.input, styles.timeInput]}
                placeholder="结束时间"
                placeholderTextColor={COLORS.textLight}
                value={newPlan.endTime}
                onChangeText={(text) => setNewPlan({ ...newPlan, endTime: text })}
              />
            </View>

            <Text style={styles.label}>任务列表</Text>
            {newPlan.tasks.length > 0 && (
              <View>
                {newPlan.tasks.map((item, index) => (
                  <View key={item.id} style={styles.taskRow}>
                    <TextInput
                      style={styles.taskNameInput}
                      placeholder={`任务${index + 1}`}
                      placeholderTextColor={COLORS.textLight}
                      value={item.name}
                      onChangeText={(text) => updateTask(index, 'name', text)}
                    />
                    <View style={styles.taskDurationContainer}>
                      <TextInput
                        style={styles.taskDurationInput}
                        keyboardType="numeric"
                        placeholder="30"
                        placeholderTextColor={COLORS.textLight}
                        value={String(item.duration)}
                        onChangeText={(text) => updateTask(index, 'duration', parseInt(text) || 30)}
                      />
                      <Text style={styles.taskDurationLabel}>分钟</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeTaskButton}
                      onPress={() => removeTask(index)}
                    >
                      <Text style={styles.removeTaskText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.addTaskButton}
              onPress={addTask}
            >
              <Ionicons name="add-outline" size={16} color={COLORS.primary} />
              <Text style={styles.addTaskText}>添加任务</Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={resetForm}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, (!newPlan.name || !newPlan.rewardName || newPlan.tasks.length === 0) && styles.confirmButtonDisabled]}
                onPress={editingPlan ? handleEditPlan : handleAddPlan}
                disabled={!newPlan.name || !newPlan.rewardName || newPlan.tasks.length === 0}
              >
                <Text style={styles.confirmButtonText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
        {showDatePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={tempDate}
            mode="date"
            display="default"
            onChange={onDateChange}
            maximumDate={datePickerTarget === 'start' && newPlan.endDate ? new Date(newPlan.endDate) : undefined}
            minimumDate={datePickerTarget === 'end' && newPlan.startDate ? new Date(newPlan.startDate) : undefined}
          />
        )}
        {showDatePicker && Platform.OS === 'ios' && (
          <View style={styles.iosDatePickerOverlay}>
            <View style={styles.iosDatePickerSheet}>
              <View style={styles.iosDatePickerHeader}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles.iosDatePickerCancel}>取消</Text>
                </TouchableOpacity>
                <Text style={styles.iosDatePickerTitle}>
                  {datePickerTarget === 'start' ? '选择开始日期' : '选择结束日期'}
                </Text>
                <TouchableOpacity onPress={() => { commitDate(tempDate); setShowDatePicker(false); }}>
                  <Text style={styles.iosDatePickerConfirm}>确定</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onDateChange}
                maximumDate={datePickerTarget === 'start' && newPlan.endDate ? new Date(newPlan.endDate) : undefined}
                minimumDate={datePickerTarget === 'end' && newPlan.startDate ? new Date(newPlan.startDate) : undefined}
                textColor={COLORS.text}
                style={styles.iosDatePicker}
              />
            </View>
          </View>
        )}
        </KeyboardAvoidingView>
      </Modal>
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
    paddingBottom: 20,
    backgroundColor: COLORS.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  headerAddBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  quickActionCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionTexts: {
    flex: 1,
  },
  quickActionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 2,
  },
  quickActionSub: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  content: {
    flex: 1,
    padding: 16,
    paddingTop: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  planCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  planCardCompleted: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  planCardExpired: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
    opacity: 0.9,
  },
  planHeader: {
    marginBottom: 14,
  },
  planTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    marginRight: 10,
  },
  planNameCompleted: {
    color: '#15803D',
  },
  planNameExpired: {
    color: '#6B7280',
  },
  planDates: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  rewardBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    padding: 12,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  rewardText: {
    flex: 1,
    fontSize: 14,
    color: '#92400E',
    fontWeight: '600',
  },
  rewardTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#FDE68A',
    borderRadius: 6,
  },
  rewardTypeText: {
    fontSize: 11,
    color: '#B45309',
    fontWeight: '600',
  },
  planMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 14,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  planActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionTextBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionTextPrimary: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  actionTextDanger: {
    fontSize: 13,
    color: COLORS.danger,
    fontWeight: '600',
  },
  actionDivider: {
    width: 1,
    height: 14,
    backgroundColor: COLORS.border,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 70,
    paddingBottom: 40,
  },
  emptyIcon: {
    width: 84,
    height: 84,
    backgroundColor: COLORS.secondary,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    maxWidth: 240,
    lineHeight: 20,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalScrollView: {
    maxHeight: '92%',
    width: '100%',
  },
  modalScrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  modalCloseButton: {
    width: 34,
    height: 34,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 50,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    marginBottom: 12,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.primaryDark,
    marginBottom: 8,
    marginTop: 6,
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateInputContainer: {
    flex: 1,
  },
  dateInput: {
    marginBottom: 0,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  tag: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: COLORS.background,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  tagSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tagText: {
    fontSize: 14,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  tagTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  ruleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    padding: 14,
    backgroundColor: COLORS.background,
    borderRadius: 12,
  },
  ruleLabel: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
  },
  ruleInput: {
    width: 70,
    height: 42,
    textAlign: 'center',
    marginBottom: 0,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  timeInput: {
    flex: 1,
    marginBottom: 0,
  },
  timeSeparator: {
    fontSize: 15,
    color: COLORS.textLighter,
    fontWeight: 'bold',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    padding: 10,
    backgroundColor: COLORS.background,
    borderRadius: 12,
  },
  taskNameInput: {
    flex: 1,
    height: 42,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskDurationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskDurationInput: {
    width: 56,
    height: 42,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: 'center',
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskDurationLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  removeTaskButton: {
    width: 34,
    height: 34,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeTaskText: {
    fontSize: 20,
    color: COLORS.danger,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  addTaskButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: COLORS.primaryLight,
    borderStyle: 'dashed',
  },
  addTaskText: {
    fontSize: 14,
    color: COLORS.primaryDark,
    fontWeight: '600',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 15,
    backgroundColor: COLORS.background,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textLight,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 15,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  datePickerBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  datePickerText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '500',
  },
  datePickerPlaceholder: {
    color: COLORS.textLight,
    fontWeight: '400',
  },
  iosDatePickerOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  iosDatePickerSheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  iosDatePicker: {
    backgroundColor: COLORS.card,
  },
  iosDatePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  iosDatePickerCancel: {
    fontSize: 16,
    color: COLORS.textLight,
  },
  iosDatePickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  iosDatePickerConfirm: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '600',
  },
  expiredText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
});

export default PlanListPage;