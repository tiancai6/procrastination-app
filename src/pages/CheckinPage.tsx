import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, FlatList, TextInput, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { Plan, CheckinRecord, CompletedTask } from '../types';
import { getPlans, saveCheckinRecord, getCheckinRecordsByPlan, generateId } from '../utils/storage';
import { Ionicons } from '@expo/vector-icons';

const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonthDays = (viewDate: Date): { date: Date; dateStr: string; isCurrentMonth: boolean }[] => {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // 周一开头：getDay()=0(周日)→6, 1(周一)→0
  const startPadding = (firstDay.getDay() + 6) % 7;

  const days: { date: Date; dateStr: string; isCurrentMonth: boolean }[] = [];

  for (let i = startPadding; i > 0; i--) {
    const date = new Date(year, month, 1 - i);
    days.push({ date, dateStr: formatDate(date), isCurrentMonth: false });
  }

  for (let i = 1; i <= lastDay.getDate(); i++) {
    const date = new Date(year, month, i);
    days.push({ date, dateStr: formatDate(date), isCurrentMonth: true });
  }

  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    const date = new Date(year, month + 1, i);
    days.push({ date, dateStr: formatDate(date), isCurrentMonth: false });
  }

  return days;
};

const formatTimerDisplay = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

type CheckinMode = 'quick' | 'timer';

const CheckinPage: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkinRecords, setCheckinRecords] = useState<CheckinRecord[]>([]);
  const [currentViewDate, setCurrentViewDate] = useState<Date>(new Date());
  const [showPlanSelect, setShowPlanSelect] = useState(false);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);

  // 打卡模式相关
  const [checkinMode, setCheckinMode] = useState<CheckinMode>('quick');
  const [timerState, setTimerState] = useState<'idle' | 'running' | 'paused'>('idle');
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [quickHours, setQuickHours] = useState('');
  const [quickMinutes, setQuickMinutes] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadPlans();
  }, []);

  useEffect(() => {
    if (selectedPlan) {
      loadCheckinRecords(selectedPlan.id);
    }
  }, [selectedPlan]);

  // 计时器
  useEffect(() => {
    if (timerState === 'running') {
      timerRef.current = setInterval(() => {
        setTimerElapsed(prev => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerState]);

  const loadPlans = async () => {
    const data = await getPlans();
    const activePlans = data.filter(p => p.status === 'active');
    setPlans(activePlans);
    if (activePlans.length > 0 && !selectedPlan) {
      setSelectedPlan(activePlans[0]);
    }
  };

  const loadCheckinRecords = async (planId: string) => {
    const records = await getCheckinRecordsByPlan(planId);
    setCheckinRecords(records);
  };

  const getRecordForDate = (dateStr: string): CheckinRecord | undefined => {
    return checkinRecords.find(r => r.date === dateStr);
  };

  const getCompletedTaskCount = (dateStr: string): number => {
    const record = getRecordForDate(dateStr);
    if (!record) return 0;
    return record.completedTasks.filter(t => t.completed).length;
  };

  const goToPrevMonth = () => {
    const prev = new Date(currentViewDate);
    prev.setMonth(prev.getMonth() - 1);
    setCurrentViewDate(prev);
  };

  const goToNextMonth = () => {
    const next = new Date(currentViewDate);
    next.setMonth(next.getMonth() + 1);
    setCurrentViewDate(next);
  };

  const goToThisMonth = () => {
    setCurrentViewDate(new Date());
  };

  const openCheckinModal = (dateStr: string) => {
    if (!selectedPlan) return;
    setSelectedDate(dateStr);
    const record = getRecordForDate(dateStr);
    if (record) {
      setCompletedTasks(record.completedTasks);
    } else {
      setCompletedTasks(selectedPlan.tasks.map(task => ({
        taskId: task.id,
        completed: false,
        actualDuration: 0,
      })));
    }
    // 重置打卡模式状态
    setCheckinMode('quick');
    setTimerState('idle');
    setTimerElapsed(0);
    setQuickHours('');
    setQuickMinutes('');
    setShowCheckinModal(true);
  };

  const toggleTask = (taskId: string) => {
    setCompletedTasks(completedTasks.map(task =>
      task.taskId === taskId ? { ...task, completed: !task.completed } : task
    ));
  };

  const handleStartTimer = () => {
    setTimerElapsed(0);
    setTimerState('running');
  };

  const handlePauseTimer = () => {
    setTimerState('paused');
  };

  const handleResumeTimer = () => {
    setTimerState('running');
  };

  const handleFinishTimer = () => {
    setTimerState('idle');
  };

  const handleCheckin = async () => {
    if (!selectedPlan || !selectedDate) return;

    const allCompleted = completedTasks.every(t => t.completed);
    const isToday = selectedDate === formatDate(new Date());
    const status = isToday ? 'completed' : 'makeup';

    // 计算时长
    let totalDuration = 0;
    if (checkinMode === 'quick') {
      const h = parseInt(quickHours) || 0;
      const m = parseInt(quickMinutes) || 0;
      totalDuration = h * 60 + m;
    } else {
      // 计时模式：秒转分钟（向上取整）
      totalDuration = Math.ceil(timerElapsed / 60);
    }

    // 给每个完成的任务分配时长（平均分配）
    const completedCount = completedTasks.filter(t => t.completed).length;
    const avgDuration = completedCount > 0 ? Math.round(totalDuration / completedCount) : 0;
    const finalTasks = completedTasks.map(t => ({
      ...t,
      actualDuration: t.completed ? avgDuration : 0,
    }));

    const record: CheckinRecord = {
      id: generateId(),
      planId: selectedPlan.id,
      date: selectedDate,
      completedTasks: finalTasks,
      status: allCompleted ? status : 'uncompleted',
      totalDuration,
      procrastinationTime: 0,
      completedAt: Date.now(),
    };

    await saveCheckinRecord(record);
    await loadCheckinRecords(selectedPlan.id);
    setShowCheckinModal(false);
  };

  const formatDuration = (minutes: number): string => {
    if (minutes <= 0) return '0分钟';
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
  };

  const monthDays = getMonthDays(currentViewDate);
  const today = formatDate(new Date());
  const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const viewTitle = `${currentViewDate.getFullYear()}年 ${monthNames[currentViewDate.getMonth()]}`;

  // 本月统计
  const monthStart = formatDate(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth(), 1));
  const monthEnd = formatDate(new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() + 1, 0));
  const monthRecords = checkinRecords.filter(r => r.date >= monthStart && r.date <= monthEnd);
  const monthTodayDays = monthRecords.filter(r => r.status === 'completed').length;
  const monthMakeupDays = monthRecords.filter(r => r.status === 'makeup').length;
  const monthTotalCompleted = monthTodayDays + monthMakeupDays;
  const todayDate = new Date();
  const currentDay = todayDate.getDate();
  const completionRate = currentDay > 0 ? Math.round((monthTotalCompleted / currentDay) * 100) : 0;
  const monthTotalDuration = monthRecords.reduce((sum, r) => sum + r.totalDuration, 0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>打卡</Text>
        <Text style={styles.subtitle}>完成任务，获得奖励</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {!selectedPlan ? (
          <View style={styles.noPlanState}>
            <Ionicons name="trophy-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.noPlanText}>暂无进行中的规划</Text>
            <TouchableOpacity style={styles.createPlanButton} onPress={() => setShowPlanSelect(true)}>
              <Text style={styles.createPlanText}>选择规划</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.planSelector}
              onPress={() => setShowPlanSelect(true)}
            >
              <View style={styles.planSelectorLeft}>
                <Ionicons name="ribbon-outline" size={20} color={COLORS.primary} />
                <Text style={styles.planSelectorText}>{selectedPlan.name}</Text>
              </View>
              <Ionicons name="chevron-forward-outline" size={16} color={COLORS.textLight} />
            </TouchableOpacity>

            <View style={styles.rewardInfo}>
              <Ionicons name="trophy-outline" size={20} color="#F59E0B" />
              <Text style={styles.rewardText}>完成奖励：{selectedPlan.rewardName}</Text>
            </View>

            {/* 苹果日历风格 */}
            <View style={styles.calendarCard}>
              <View style={styles.calendarHeader}>
                <TouchableOpacity style={styles.calendarNavBtn} onPress={goToPrevMonth}>
                  <Ionicons name="chevron-back-outline" size={20} color={COLORS.text} />
                </TouchableOpacity>
                <TouchableOpacity onPress={goToThisMonth}>
                  <Text style={styles.calendarTitle}>{viewTitle}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.calendarNavBtn} onPress={goToNextMonth}>
                  <Ionicons name="chevron-forward-outline" size={20} color={COLORS.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.weekDaysRow}>
                {WEEK_DAYS.map(day => (
                  <Text key={day} style={styles.weekDayLabel}>{day}</Text>
                ))}
              </View>

              <View style={styles.daysGrid}>
                {monthDays.map((dayInfo) => {
                  const record = getRecordForDate(dayInfo.dateStr);
                  const completedCount = getCompletedTaskCount(dayInfo.dateStr);
                  const isToday = dayInfo.dateStr === today;
                  const isSelected = dayInfo.dateStr === selectedDate;
                  const isPast = dayInfo.dateStr < today;
                  const canCheckin = isPast || isToday;

                  return (
                    <TouchableOpacity
                      key={dayInfo.dateStr}
                      style={[
                        styles.dayCell,
                      ]}
                      onPress={() => canCheckin ? openCheckinModal(dayInfo.dateStr) : null}
                      disabled={!canCheckin}
                    >
                      <View style={[
                        styles.dayNumberWrap,
                        isToday && styles.dayNumberWrapToday,
                        isSelected && !isToday && styles.dayNumberWrapSelected,
                      ]}>
                        <Text style={[
                          styles.dayNumber,
                          !dayInfo.isCurrentMonth && styles.dayNumberOtherMonth,
                          isToday && styles.dayNumberToday,
                          isSelected && !isToday && styles.dayNumberSelected,
                          !canCheckin && dayInfo.isCurrentMonth && styles.dayNumberFuture,
                        ]}>
                          {dayInfo.date.getDate()}
                        </Text>
                      </View>
                      {completedCount > 0 && (
                        <View style={styles.dotsRow}>
                          {Array.from({ length: Math.min(completedCount, 3) }).map((_, i) => (
                            <View
                              key={i}
                              style={[
                                styles.dayDot,
                                record?.status === 'makeup' ? styles.dotMakeup : styles.dotNormal,
                              ]}
                            />
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* 本月统计 */}
            <View style={styles.monthStatsRow}>
              <View style={styles.monthStatCard}>
                <Text style={styles.monthStatLabel}>当天打卡</Text>
                <Text style={styles.monthStatValue}>
                  {monthTodayDays}
                  <Text style={styles.monthStatUnit}>天</Text>
                </Text>
              </View>
              <View style={styles.monthStatCard}>
                <Text style={styles.monthStatLabel}>补卡</Text>
                <Text style={styles.monthStatValue}>
                  {monthMakeupDays}
                  <Text style={styles.monthStatUnit}>天</Text>
                </Text>
              </View>
              <View style={styles.monthStatCard}>
                <Text style={styles.monthStatLabel}>完成率</Text>
                <Text style={styles.monthStatValue}>
                  {completionRate}
                  <Text style={styles.monthStatUnit}>%</Text>
                </Text>
              </View>
              <View style={styles.monthStatCard}>
                <Text style={styles.monthStatLabel}>本月用时</Text>
                <Text style={styles.monthStatValue}>{formatDuration(monthTotalDuration)}</Text>
              </View>
            </View>

            {/* 今日任务 */}
            <View style={styles.taskListSection}>
              <Text style={styles.sectionTitle}>今日任务</Text>
              {selectedPlan.tasks.length > 0 ? (
                selectedPlan.tasks.map((item) => {
                  const todayRecord = getRecordForDate(today);
                  const completedTask = todayRecord?.completedTasks.find(t => t.taskId === item.id);
                  const isCompleted = completedTask?.completed;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.taskCard, isCompleted && styles.taskCardCompleted]}
                      onPress={() => openCheckinModal(today)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.taskCheckbox, isCompleted && styles.taskCheckboxCompleted]}>
                        {isCompleted ? (
                          <Ionicons name="checkmark" size={16} color="#fff" />
                        ) : null}
                      </View>
                      <View style={styles.taskInfo}>
                        <Text style={[styles.taskName, isCompleted && styles.taskNameCompleted]}>
                          {item.name}
                        </Text>
                        <Text style={styles.taskDuration}>预计 {item.duration} 分钟</Text>
                      </View>
                      <Ionicons name="chevron-forward-outline" size={16} color={COLORS.textLighter} />
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>暂无任务</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={showPlanSelect}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPlanSelect(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>选择规划</Text>
              <TouchableOpacity style={styles.closeIconButton} onPress={() => setShowPlanSelect(false)}>
                <Ionicons name="close-outline" size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>
            {plans.length > 0 ? (
              <FlatList
                data={plans}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.planOption, selectedPlan?.id === item.id && styles.planOptionSelected]}
                    onPress={() => {
                      setSelectedPlan(item);
                      setShowPlanSelect(false);
                    }}
                  >
                    <Text style={styles.planOptionText}>{item.name}</Text>
                    {selectedPlan?.id === item.id && (
                      <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                )}
                keyExtractor={item => item.id}
              />
            ) : (
              <Text style={styles.noPlansText}>暂无进行中的规划</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCheckinModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setTimerState('idle');
          setShowCheckinModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.checkinModalContent}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              style={styles.checkinScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
                <Text style={styles.modalTitle}>{selectedDate} 打卡</Text>
              </View>
              <TouchableOpacity
                style={styles.closeIconButton}
                onPress={() => {
                  setTimerState('idle');
                  setShowCheckinModal(false);
                }}
              >
                <Ionicons name="close-outline" size={22} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            {/* 任务列表 */}
            <Text style={styles.modalSubtitle}>勾选完成的任务</Text>
            {selectedPlan && (
              <View style={styles.taskListWrap}>
                {selectedPlan.tasks.map(item => {
                  const completedTask = completedTasks.find(t => t.taskId === item.id);
                  const isCompleted = completedTask?.completed;

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.checkinTaskRow, isCompleted && styles.checkinTaskRowCompleted]}
                      onPress={() => toggleTask(item.id)}
                    >
                      <View style={[styles.checkinCheckbox, isCompleted && styles.checkinCheckboxCompleted]}>
                        {isCompleted && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={[styles.checkinTaskName, isCompleted && styles.checkinTaskNameCompleted]}>
                        {item.name}
                      </Text>
                      <Text style={styles.checkinTaskDuration}>{item.duration}分钟</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* 打卡模式切换 */}
            <View style={styles.modeTabContainer}>
              <TouchableOpacity
                style={[styles.modeTab, checkinMode === 'quick' && styles.modeTabActive]}
                onPress={() => setCheckinMode('quick')}
              >
                <Ionicons name="flash-outline" size={16} color={checkinMode === 'quick' ? '#fff' : COLORS.primary} />
                <Text style={[styles.modeTabText, checkinMode === 'quick' && styles.modeTabTextActive]}>快速打卡</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeTab, checkinMode === 'timer' && styles.modeTabActive]}
                onPress={() => setCheckinMode('timer')}
              >
                <Ionicons name="timer-outline" size={16} color={checkinMode === 'timer' ? '#fff' : COLORS.primary} />
                <Text style={[styles.modeTabText, checkinMode === 'timer' && styles.modeTabTextActive]}>计时打卡</Text>
              </TouchableOpacity>
            </View>

            {/* 快速打卡：时长输入（可选） */}
            {checkinMode === 'quick' ? (
              <View style={styles.modeContent}>
                <View style={styles.modeLabelRow}>
                  <Text style={styles.modeLabel}>实际用时（可选，不填则不计时长）</Text>
                  <TouchableOpacity style={styles.dismissKbdBtn} onPress={() => Keyboard.dismiss()}>
                    <Ionicons name="keypad-outline" size={13} color={COLORS.primary} />
                    <Text style={styles.dismissKbdText}>收起键盘</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.durationInputRow}>
                  <View style={styles.durationInputWrap}>
                    <TextInput
                      style={styles.durationInput}
                      placeholder="0"
                      placeholderTextColor={COLORS.textLighter}
                      keyboardType="numeric"
                      value={quickHours}
                      onChangeText={setQuickHours}
                      maxLength={3}
                    />
                    <Text style={styles.durationUnit}>小时</Text>
                  </View>
                  <View style={styles.durationInputWrap}>
                    <TextInput
                      style={styles.durationInput}
                      placeholder="0"
                      placeholderTextColor={COLORS.textLighter}
                      keyboardType="numeric"
                      value={quickMinutes}
                      onChangeText={setQuickMinutes}
                      maxLength={2}
                    />
                    <Text style={styles.durationUnit}>分钟</Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.modeContent}>
                <View style={styles.timerDisplay}>
                  <Text style={styles.timerText}>{formatTimerDisplay(timerElapsed)}</Text>
                  <Text style={styles.timerHint}>
                    {timerState === 'running'
                      ? '计时中...'
                      : (timerState === 'paused'
                        ? '已暂停'
                        : (timerElapsed > 0 ? '已结束' : '点击下方按钮开始计时'))}
                  </Text>
                </View>
                {timerState === 'idle' ? (
                  <TouchableOpacity
                    style={styles.timerStartBtn}
                    onPress={handleStartTimer}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="play-circle-outline" size={18} color="#fff" />
                    <Text style={styles.timerBtnText}>开始计时</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.timerBtnRow}>
                    {timerState === 'running' ? (
                      <TouchableOpacity
                        style={styles.timerPauseBtn}
                        onPress={handlePauseTimer}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="pause-circle-outline" size={18} color="#fff" />
                        <Text style={styles.timerBtnText}>暂停</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.timerStartBtn}
                        onPress={handleResumeTimer}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="play-circle-outline" size={18} color="#fff" />
                        <Text style={styles.timerBtnText}>继续</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.timerStopBtn}
                      onPress={handleFinishTimer}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="stop-circle-outline" size={18} color="#fff" />
                      <Text style={styles.timerBtnText}>结束计时</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {timerElapsed > 0 && timerState !== 'running' && (
                  <Text style={styles.timerEditHint}>时长将自动记录为 {Math.ceil(timerElapsed / 60)} 分钟</Text>
                )}
              </View>
            )}

            {/* 统计 */}
            <View style={styles.checkinStats}>
              <View style={styles.checkinStatItem}>
                <Text style={styles.checkinStatLabel}>已完成</Text>
                <Text style={styles.checkinStatValue}>
                  {completedTasks.filter(t => t.completed).length}/{completedTasks.length}
                </Text>
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setTimerState('idle');
                  setShowCheckinModal(false);
                }}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmButton, completedTasks.filter(t => t.completed).length === 0 && styles.confirmButtonDisabled]}
                onPress={handleCheckin}
                disabled={completedTasks.filter(t => t.completed).length === 0}
              >
                <Text style={styles.confirmButtonText}>确认打卡</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
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
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
    paddingBottom: 32,
  },
  noPlanState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 16,
  },
  noPlanText: {
    fontSize: 18,
    color: COLORS.text,
    fontWeight: '600',
  },
  createPlanButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
  },
  createPlanText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  planSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  planSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planSelectorText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  rewardInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FEF3C7',
  },
  rewardText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    fontWeight: '500',
  },
  // 苹果日历风格
  calendarCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  calendarNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  weekDaysRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textLight,
    fontWeight: '600',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  dayNumberWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNumberWrapToday: {
    backgroundColor: COLORS.primary,
  },
  dayNumberWrapSelected: {
    backgroundColor: COLORS.secondary,
  },
  dayNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  dayNumberOtherMonth: {
    color: COLORS.textLighter,
  },
  dayNumberToday: {
    color: '#fff',
    fontWeight: 'bold',
  },
  dayNumberSelected: {
    color: COLORS.primaryDark,
    fontWeight: 'bold',
  },
  dayNumberFuture: {
    color: COLORS.textLight,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
  },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dotNormal: {
    backgroundColor: COLORS.success,
  },
  dotMakeup: {
    backgroundColor: COLORS.warning,
  },
  // 本月统计
  monthStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  monthStatCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  monthStatLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 6,
    fontWeight: '500',
  },
  monthStatValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  monthStatUnit: {
    fontSize: 13,
    fontWeight: 'normal',
    color: COLORS.textLight,
    marginLeft: 2,
  },
  // 任务列表
  taskListSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
    marginLeft: 4,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  taskCardCompleted: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  taskCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskCheckboxCompleted: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  taskInfo: {
    flex: 1,
  },
  taskName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 2,
  },
  taskNameCompleted: {
    color: COLORS.textLight,
    textDecorationLine: 'line-through',
  },
  taskDuration: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    padding: 20,
    backgroundColor: COLORS.card,
    borderRadius: 12,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  checkinModalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  checkinScroll: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  closeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 10,
    fontWeight: '500',
  },
  planOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  planOptionSelected: {
    backgroundColor: COLORS.secondary,
  },
  planOptionText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '500',
  },
  noPlansText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    padding: 40,
  },
  // 任务列表（Modal内）
  taskListWrap: {
    marginBottom: 16,
  },
  checkinTaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  checkinTaskRowCompleted: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  checkinCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkinCheckboxCompleted: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  checkinTaskName: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '500',
  },
  checkinTaskNameCompleted: {
    color: COLORS.textLight,
    textDecorationLine: 'line-through',
  },
  checkinTaskDuration: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  // 模式Tab
  modeTabContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modeTabActive: {
    backgroundColor: COLORS.primary,
  },
  modeTabText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  modeTabTextActive: {
    color: '#fff',
  },
  modeContent: {
    marginBottom: 16,
  },
  modeLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 10,
    fontWeight: '500',
  },
  modeLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dismissKbdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
  },
  dismissKbdText: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '600',
  },
  // 快速打卡时长输入
  durationInputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  durationInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 48,
  },
  durationInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '600',
    padding: 0,
  },
  durationUnit: {
    fontSize: 13,
    color: COLORS.textLight,
    fontWeight: '500',
  },
  // 计时器
  timerDisplay: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: COLORS.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  timerText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: COLORS.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  timerHint: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 6,
  },
  timerStartBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  timerBtnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timerPauseBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: '#F59E0B',
    borderRadius: 14,
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  timerStopBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: COLORS.danger,
    borderRadius: 14,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  timerBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  timerEditHint: {
    fontSize: 12,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 10,
    fontStyle: 'italic',
  },
  // 统计
  checkinStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  checkinStatItem: {
    flex: 1,
    backgroundColor: COLORS.secondary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  checkinStatLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 4,
    fontWeight: '500',
  },
  checkinStatValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primaryDark,
  },
  // 底部按钮
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: COLORS.background,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});

export default CheckinPage;
