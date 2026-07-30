import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, FlatList } from 'react-native';
import { COLORS } from '../constants/reasons';
import { TOP_INSET } from '../constants/safeArea';
import { Plan, CheckinRecord } from '../types';
import { getPlans, getCheckinRecordsByPlan } from '../utils/storage';
import { Ionicons } from '@expo/vector-icons';

type ViewType = 'week' | 'month' | 'quarter' | 'year';
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];

const PlanStatsPage: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkinRecords, setCheckinRecords] = useState<CheckinRecord[]>([]);
  const [viewType, setViewType] = useState<ViewType>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showPlanSelect, setShowPlanSelect] = useState(false);
  const [showDayDetail, setShowDayDetail] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>('');

  useEffect(() => {
    loadPlans();
  }, []);

  useEffect(() => {
    if (selectedPlan) {
      loadCheckinRecords(selectedPlan.id);
    }
  }, [selectedPlan]);

  const loadPlans = async () => {
    const data = await getPlans();
    setPlans(data);
    if (data.length > 0 && !selectedPlan) {
      setSelectedPlan(data[0]);
    }
  };

  const loadCheckinRecords = async (planId: string) => {
    const records = await getCheckinRecordsByPlan(planId);
    setCheckinRecords(records);
  };

  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getStartOfWeek = (date: Date): Date => {
    const day = date.getDay() || 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - day + 1);
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const getMonthDays = (): { date: Date; dateStr: string; isCurrentMonth: boolean }[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    
    const days: { date: Date; dateStr: string; isCurrentMonth: boolean }[] = [];
    
    for (let i = startPadding; i > 0; i--) {
      const date = new Date(year, month, -i + 1);
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

  const getWeekDates = (): string[] => {
    const startOfWeek = getStartOfWeek(currentDate);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      dates.push(formatDate(date));
    }
    return dates;
  };

  const getQuarterMonths = (): { month: number; year: number; name: string }[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const quarter = Math.floor(month / 3);
    const months: { month: number; year: number; name: string }[] = [];
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    
    for (let i = 0; i < 3; i++) {
      const m = quarter * 3 + i;
      const y = m >= 12 ? year + 1 : year;
      const mn = m % 12;
      months.push({ month: mn, year: y, name: monthNames[mn] });
    }
    
    return months;
  };

  const getYearMonths = (): { month: number; name: string }[] => {
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    return monthNames.map((name, i) => ({ month: i, name }));
  };

  const getRecordForDate = (dateStr: string): CheckinRecord | undefined => {
    return checkinRecords.find(r => r.date === dateStr);
  };

  const getCompletedTaskCount = (dateStr: string): number => {
    const record = getRecordForDate(dateStr);
    if (!record) return 0;
    return record.completedTasks.filter(t => t.completed).length;
  };

  const getMonthStats = (year: number, month: number): { completedDays: number; totalDays: number; totalDuration: number; totalProcrastination: number } => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startStr = formatDate(firstDay);
    const endStr = formatDate(lastDay);
    
    const monthRecords = checkinRecords.filter(r => r.date >= startStr && r.date <= endStr);
    const completedDays = monthRecords.filter(r => r.status === 'completed').length;
    const totalDuration = monthRecords.reduce((sum, r) => sum + r.totalDuration, 0);
    const totalProcrastination = monthRecords.reduce((sum, r) => sum + r.procrastinationTime, 0);
    
    return { completedDays, totalDays: lastDay.getDate(), totalDuration, totalProcrastination };
  };

  const getWeekStats = (): { completedTasks: number; totalTasks: number; totalDuration: number; totalProcrastination: number } => {
    const weekDates = getWeekDates();
    const weekRecords = checkinRecords.filter(r => weekDates.includes(r.date));
    
    let completedTasks = 0;
    let totalTasks = 0;
    
    weekRecords.forEach(record => {
      completedTasks += record.completedTasks.filter(t => t.completed).length;
      totalTasks += record.completedTasks.length;
    });
    
    const totalDuration = weekRecords.reduce((sum, r) => sum + r.totalDuration, 0);
    const totalProcrastination = weekRecords.reduce((sum, r) => sum + r.procrastinationTime, 0);
    
    return { completedTasks, totalTasks, totalDuration, totalProcrastination };
  };

  const getYearStats = (): { completedDays: number; totalDays: number; totalDuration: number; totalProcrastination: number } => {
    const year = currentDate.getFullYear();
    const firstDay = new Date(year, 0, 1);
    const lastDay = new Date(year, 11, 31);
    const startStr = formatDate(firstDay);
    const endStr = formatDate(lastDay);
    
    const yearRecords = checkinRecords.filter(r => r.date >= startStr && r.date <= endStr);
    const completedDays = yearRecords.filter(r => r.status === 'completed').length;
    const totalDuration = yearRecords.reduce((sum, r) => sum + r.totalDuration, 0);
    const totalProcrastination = yearRecords.reduce((sum, r) => sum + r.procrastinationTime, 0);
    
    return { completedDays, totalDays: 365, totalDuration, totalProcrastination };
  };

  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    
    switch (viewType) {
      case 'week':
        newDate.setDate(currentDate.getDate() + (direction === 'prev' ? -7 : 7));
        break;
      case 'month':
        newDate.setMonth(currentDate.getMonth() + (direction === 'prev' ? -1 : 1));
        break;
      case 'quarter':
        newDate.setMonth(currentDate.getMonth() + (direction === 'prev' ? -3 : 3));
        break;
      case 'year':
        newDate.setFullYear(currentDate.getFullYear() + (direction === 'prev' ? -1 : 1));
        break;
    }
    
    setCurrentDate(newDate);
  };

  const getViewTitle = (): string => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    
    switch (viewType) {
      case 'week':
        const startOfWeek = getStartOfWeek(currentDate);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        return `${year}年${monthNames[startOfWeek.getMonth()]}${startOfWeek.getDate()}日-${monthNames[endOfWeek.getMonth()]}${endOfWeek.getDate()}日`;
      case 'month':
        return `${year}年${monthNames[month]}`;
      case 'quarter':
        const quarter = Math.floor(month / 3) + 1;
        return `${year}年第${quarter}季度`;
      case 'year':
        return `${year}年`;
    }
  };

  const handleDayPress = (dateStr: string) => {
    setSelectedDate(dateStr);
    setShowDayDetail(true);
  };

  const today = formatDate(new Date());

  const renderMonthView = () => {
    const days = getMonthDays();
    const monthStats = getMonthStats(currentDate.getFullYear(), currentDate.getMonth());
    const totalTasks = selectedPlan?.tasks.length || 0;

    return (
      <ScrollView style={styles.viewContent}>
        <View style={styles.statsCards}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>完成天数</Text>
            <Text style={styles.statValue}>{monthStats.completedDays}</Text>
            <Text style={styles.statTotal}>/{monthStats.totalDays}天</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>完成率</Text>
            <Text style={styles.statValue}>
              {monthStats.totalDays > 0 ? Math.round((monthStats.completedDays / monthStats.totalDays) * 100) : 0}%
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>总用时</Text>
            <Text style={styles.statValue}>{formatDuration(monthStats.totalDuration)}</Text>
          </View>
        </View>

        <View style={styles.calendarContainer}>
          <View style={styles.weekDaysHeader}>
            {WEEK_DAYS.map((day) => (
              <Text key={day} style={styles.weekDayText}>{day}</Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {days.map(({ date, dateStr, isCurrentMonth }) => {
              const completedCount = getCompletedTaskCount(dateStr);
              const isToday = dateStr === today;

              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[
                    styles.calendarDay,
                    !isCurrentMonth && styles.calendarDayOtherMonth,
                    isToday && styles.calendarDayToday,
                  ]}
                  onPress={() => handleDayPress(dateStr)}
                >
                  <Text style={[
                    styles.dayNumber,
                    !isCurrentMonth && styles.dayNumberOtherMonth,
                    isToday && styles.dayNumberToday,
                  ]}>
                    {date.getDate()}
                  </Text>
                  {completedCount > 0 && (
                    <View style={styles.checkinDots}>
                      {Array.from({ length: Math.min(completedCount, 5) }).map((_, i) => (
                        <View key={i} style={styles.dot} />
                      ))}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.dot} />
            <Text style={styles.legendText}>完成{totalTasks > 0 ? `(${totalTasks}个任务)` : ''}</Text>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderWeekView = () => {
    const weekDates = getWeekDates();
    const weekStats = getWeekStats();

    return (
      <ScrollView style={styles.viewContent}>
        <View style={styles.statsCards}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>完成任务</Text>
            <Text style={styles.statValue}>{weekStats.completedTasks}</Text>
            <Text style={styles.statTotal}>/{weekStats.totalTasks}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>总用时</Text>
            <Text style={styles.statValue}>{formatDuration(weekStats.totalDuration)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>拖延时间</Text>
            <Text style={styles.statValue}>{formatDuration(weekStats.totalProcrastination)}</Text>
          </View>
        </View>

        <View style={styles.weekDetailList}>
          {weekDates.map((dateStr, index) => {
            const record = getRecordForDate(dateStr);
            const weekDay = WEEK_DAYS[index];
            const date = new Date(dateStr);
            const isToday = dateStr === today;

            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.dayCard, isToday && styles.dayCardToday]}
                onPress={() => handleDayPress(dateStr)}
              >
                <View style={styles.dayHeader}>
                  <Text style={[styles.dayName, isToday && styles.dayNameToday]}>{weekDay}</Text>
                  <Text style={styles.dayDate}>{date.getMonth() + 1}月{date.getDate()}日</Text>
                </View>

                {record ? (
                  <>
                    <View style={styles.taskList}>
                      {record.completedTasks.map((task, i) => {
                        const planTask = selectedPlan?.tasks.find(t => t.id === task.taskId);
                        return (
                          <View key={i} style={styles.taskItem}>
                            {task.completed ? (
                              <Ionicons name="checkmark-circle-outline" size={16} color="#22C55E" />
                            ) : (
                              <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
                            )}
                            <Text style={[styles.taskName, task.completed && styles.taskNameCompleted]}>
                              {planTask?.name || '未知任务'}
                            </Text>
                            <Text style={styles.taskDuration}>{planTask?.duration || 0}分钟</Text>
                          </View>
                        );
                      })}
                    </View>
                    <View style={styles.dayStats}>
                      <View style={styles.dayStatItem}>
                        <Ionicons name="time-outline" size={12} color={COLORS.textLight} />
                        <Text style={styles.dayStatText}>用时 {formatDuration(record.totalDuration)}</Text>
                      </View>
                      <View style={styles.dayStatItem}>
                        <Ionicons name="trending-up-outline" size={12} color="#F59E0B" />
                        <Text style={styles.dayStatText}>拖延 {formatDuration(record.procrastinationTime)}</Text>
                      </View>
                    </View>
                  </>
                ) : (
                  <Text style={styles.noRecordText}>暂无打卡记录</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderQuarterView = () => {
    const months = getQuarterMonths();
    const totalCompletedDays = months.reduce((sum, m) => {
      const stats = getMonthStats(m.year, m.month);
      return sum + stats.completedDays;
    }, 0);
    const totalDays = months.reduce((sum, m) => {
      const lastDay = new Date(m.year, m.month + 1, 0);
      return sum + lastDay.getDate();
    }, 0);

    return (
      <ScrollView style={styles.viewContent}>
        <View style={styles.statsCards}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>平均完成率</Text>
            <Text style={styles.statValue}>
              {totalDays > 0 ? Math.round((totalCompletedDays / totalDays) * 100) : 0}%
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>总打卡天数</Text>
            <Text style={styles.statValue}>{totalCompletedDays}</Text>
          </View>
        </View>

        <View style={styles.quarterList}>
          {months.map((m) => {
            const stats = getMonthStats(m.year, m.month);
            const percentage = stats.totalDays > 0 ? Math.round((stats.completedDays / stats.totalDays) * 100) : 0;

            return (
              <View key={`${m.year}-${m.month}`} style={styles.monthCard}>
                <View style={styles.monthHeader}>
                  <Text style={styles.monthName}>{m.name}</Text>
                  <Text style={styles.monthPercentage}>{percentage}%</Text>
                </View>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${percentage}%` }]} />
                </View>
                <View style={styles.monthStats}>
                  <Text style={styles.monthStatText}>打卡 {stats.completedDays}/{stats.totalDays}天</Text>
                  <Text style={styles.monthStatText}>{formatDuration(stats.totalDuration)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderYearView = () => {
    const months = getYearMonths();
    const yearStats = getYearStats();

    return (
      <ScrollView style={styles.viewContent}>
        <View style={styles.statsCards}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>平均完成率</Text>
            <Text style={styles.statValue}>
              {yearStats.totalDays > 0 ? Math.round((yearStats.completedDays / yearStats.totalDays) * 100) : 0}%
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>总打卡天数</Text>
            <Text style={styles.statValue}>{yearStats.completedDays}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>总用时</Text>
            <Text style={styles.statValue}>{formatDuration(yearStats.totalDuration)}</Text>
          </View>
        </View>

        <View style={styles.yearGrid}>
          {months.map((m) => {
            const stats = getMonthStats(currentDate.getFullYear(), m.month);
            const percentage = stats.totalDays > 0 ? Math.round((stats.completedDays / stats.totalDays) * 100) : 0;

            return (
              <View key={m.month} style={styles.yearMonthCard}>
                <Text style={styles.yearMonthName}>{m.name}</Text>
                <View style={styles.yearProgressBar}>
                  <View style={[styles.yearProgressFill, { height: `${percentage}%` }]} />
                </View>
                <Text style={styles.yearPercentage}>{percentage}%</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderView = () => {
    switch (viewType) {
      case 'week':
        return renderWeekView();
      case 'month':
        return renderMonthView();
      case 'quarter':
        return renderQuarterView();
      case 'year':
        return renderYearView();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>统计</Text>
        <Text style={styles.subtitle}>查看你的打卡数据</Text>
      </View>

      <View style={styles.content}>
        {!selectedPlan ? (
          <View style={styles.noPlanState}>
            <Ionicons name="calendar-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.noPlanText}>暂无规划</Text>
            <TouchableOpacity style={styles.selectPlanButton} onPress={() => setShowPlanSelect(true)}>
              <Text style={styles.selectPlanText}>选择规划</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity 
              style={styles.planSelector}
              onPress={() => setShowPlanSelect(true)}
            >
              <Text style={styles.planSelectorText}>{selectedPlan.name}</Text>
              <Ionicons name="chevron-forward-outline" size={16} color={COLORS.textLight} />
            </TouchableOpacity>

            <View style={styles.viewTabs}>
              {(['week', 'month', 'quarter', 'year'] as ViewType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.tab, viewType === type && styles.tabActive]}
                  onPress={() => setViewType(type)}
                >
                  <Text style={[styles.tabText, viewType === type && styles.tabTextActive]}>
                    {type === 'week' ? '周' : type === 'month' ? '月' : type === 'quarter' ? '季度' : '年'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.dateNavigation}>
              <TouchableOpacity style={styles.navButton} onPress={() => navigateDate('prev')}>
                <Ionicons name="chevron-back-outline" size={20} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.dateTitle}>{getViewTitle()}</Text>
              <TouchableOpacity style={styles.navButton} onPress={() => navigateDate('next')}>
                <Ionicons name="chevron-forward-outline" size={20} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {renderView()}
          </>
        )}
      </View>

      <Modal
        visible={showPlanSelect}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPlanSelect(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>选择规划</Text>
            {plans.length > 0 ? (
              <FlatList
                data={plans}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.planOption, selectedPlan?.id === item.id && styles.planOptionSelected]}
                    onPress={() => {
                      setSelectedPlan(item);
                      setShowPlanSelect(false);
                    }}
                  >
                    <Text style={styles.planOptionText}>{item.name}</Text>
                    <Text style={styles.planOptionStatus}>
                      {item.status === 'active' ? '进行中' : item.status === 'completed' ? '已完成' : '已过期'}
                    </Text>
                  </TouchableOpacity>
                )}
                keyExtractor={item => item.id}
              />
            ) : (
              <Text style={styles.noPlansText}>暂无规划</Text>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={showDayDetail}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDayDetail(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{selectedDate} 详情</Text>
            {selectedPlan && (() => {
              const record = getRecordForDate(selectedDate);
              if (!record) {
                return <Text style={styles.noRecordText}>暂无打卡记录</Text>;
              }

              return (
                <>
                  <View style={styles.dayDetailList}>
                    {record.completedTasks.map((task, i) => {
                      const planTask = selectedPlan.tasks.find(t => t.id === task.taskId);
                      return (
                        <View key={i} style={[styles.detailTaskItem, task.completed && styles.detailTaskItemCompleted]}>
                          {task.completed ? (
                            <Ionicons name="checkmark-circle-outline" size={20} color="#22C55E" />
                          ) : (
                            <Ionicons name="close-circle-outline" size={20} color="#EF4444" />
                          )}
                          <View style={styles.detailTaskInfo}>
                            <Text style={[styles.detailTaskName, task.completed && styles.detailTaskNameCompleted]}>
                              {planTask?.name || '未知任务'}
                            </Text>
                            <Text style={styles.detailTaskDuration}>预计 {planTask?.duration || 0} 分钟</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.dayDetailStats}>
                    <View style={styles.detailStatItem}>
                      <Ionicons name="time-outline" size={16} color={COLORS.primary} />
                      <Text style={styles.detailStatText}>总用时：{formatDuration(record.totalDuration)}</Text>
                    </View>
                    <View style={styles.detailStatItem}>
                      <Ionicons name="trending-up-outline" size={16} color="#F59E0B" />
                      <Text style={styles.detailStatText}>拖延时间：{formatDuration(record.procrastinationTime)}</Text>
                    </View>
                    <View style={styles.detailStatItem}>
                      <Ionicons name="medal-outline" size={16} color="#22C55E" />
                      <Text style={styles.detailStatText}>
                        状态：{record.status === 'completed' ? '已完成' : record.status === 'makeup' ? '补签' : '未完成'}
                      </Text>
                    </View>
                  </View>
                </>
              );
            })()}
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowDayDetail(false)}
            >
              <Text style={styles.closeButtonText}>关闭</Text>
            </TouchableOpacity>
          </View>
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
    padding: 24,
    paddingTop: TOP_INSET + 16,
    paddingBottom: 28,
    backgroundColor: COLORS.primaryDark,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 6,
  },
  content: {
    flex: 1,
    padding: 16,
    paddingBottom: 24,
    marginTop: 4,
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
  selectPlanButton: {
    paddingHorizontal: 36,
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 24,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  selectPlanText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  planSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  planSelectorText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  viewTabs: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 16,
    backgroundColor: COLORS.secondary,
    padding: 4,
    borderRadius: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textLight,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  dateNavigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navButton: {
    padding: 8,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  dateTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  viewContent: {
    flex: 1,
  },
  statsCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textLight,
    marginBottom: 6,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primaryDark,
  },
  statTotal: {
    fontSize: 13,
    fontWeight: 'normal',
    color: COLORS.textLight,
    marginTop: 2,
  },
  calendarContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  weekDaysHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  weekDayText: {
    fontSize: 12,
    color: COLORS.primaryDark,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDay: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: COLORS.secondary,
  },
  calendarDayOtherMonth: {
    opacity: 0.4,
  },
  calendarDayToday: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: '#FFFFFF',
  },
  dayNumber: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
  },
  dayNumberOtherMonth: {
    color: COLORS.textLighter,
  },
  dayNumberToday: {
    color: COLORS.primaryDark,
    fontWeight: 'bold',
  },
  checkinDots: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.primary,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  weekDetailList: {
    gap: 12,
  },
  dayCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  dayCardToday: {
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dayName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  dayNameToday: {
    color: COLORS.primaryDark,
  },
  dayDate: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  taskList: {
    gap: 8,
    marginBottom: 12,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  taskNameCompleted: {
    textDecorationLine: 'line-through',
    color: COLORS.primary,
  },
  taskDuration: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  dayStats: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  dayStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dayStatText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  noRecordText: {
    fontSize: 14,
    color: COLORS.textLight,
    paddingVertical: 20,
    textAlign: 'center',
  },
  quarterList: {
    gap: 12,
  },
  monthCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 16,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  monthName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  monthPercentage: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  progressBar: {
    height: 10,
    backgroundColor: COLORS.secondary,
    borderRadius: 5,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 5,
  },
  monthStats: {
    flexDirection: 'row',
    gap: 16,
  },
  monthStatText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  yearGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  yearMonthCard: {
    width: '31%',
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 12,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    alignItems: 'center',
  },
  yearMonthName: {
    fontSize: 12,
    color: COLORS.text,
    marginBottom: 8,
    fontWeight: '600',
  },
  yearProgressBar: {
    width: '100%',
    height: 40,
    backgroundColor: COLORS.secondary,
    borderRadius: 6,
    marginBottom: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  yearProgressFill: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
  },
  yearPercentage: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.primaryDark,
  },
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
    maxHeight: '80%',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primaryDark,
    marginBottom: 16,
  },
  planOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
    marginBottom: 8,
  },
  planOptionSelected: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  planOptionText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: '500',
  },
  planOptionStatus: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  noPlansText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    paddingVertical: 20,
  },
  dayDetailList: {
    gap: 8,
    marginBottom: 16,
  },
  detailTaskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
  },
  detailTaskItemCompleted: {
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  detailTaskInfo: {
    flex: 1,
  },
  detailTaskName: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
  },
  detailTaskNameCompleted: {
    textDecorationLine: 'line-through',
    color: COLORS.primary,
  },
  detailTaskDuration: {
    fontSize: 12,
    color: COLORS.textLight,
    marginTop: 2,
  },
  dayDetailStats: {
    gap: 12,
    marginBottom: 20,
    padding: 14,
    backgroundColor: COLORS.secondary,
    borderRadius: 12,
  },
  detailStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailStatText: {
    fontSize: 14,
    color: COLORS.text,
  },
  closeButton: {
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
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default PlanStatsPage;