import { ProcrastinationRecord, CategoryStats, TimePattern, InsightResult } from '../types';

export const calculateCategoryStats = (records: ProcrastinationRecord[]): CategoryStats[] => {
  const categoryMap = new Map<string, { duration: number; count: number }>();
  
  records.forEach(record => {
    const existing = categoryMap.get(record.reason) || { duration: 0, count: 0 };
    categoryMap.set(record.reason, {
      duration: existing.duration + record.duration,
      count: existing.count + 1,
    });
  });
  
  const totalDuration = records.reduce((sum, r) => sum + r.duration, 0);
  
  return Array.from(categoryMap.entries())
    .map(([name, data]) => ({
      name,
      duration: data.duration,
      count: data.count,
      percentage: totalDuration > 0 ? Math.round((data.duration / totalDuration) * 100) : 0,
    }))
    .sort((a, b) => b.duration - a.duration);
};

export const calculateTaskTypeStats = (records: ProcrastinationRecord[]): CategoryStats[] => {
  const typeMap = new Map<string, { duration: number; count: number }>();
  
  records.forEach(record => {
    const existing = typeMap.get(record.taskType) || { duration: 0, count: 0 };
    typeMap.set(record.taskType, {
      duration: existing.duration + record.duration,
      count: existing.count + 1,
    });
  });
  
  const totalDuration = records.reduce((sum, r) => sum + r.duration, 0);
  
  return Array.from(typeMap.entries())
    .map(([name, data]) => ({
      name,
      duration: data.duration,
      count: data.count,
      percentage: totalDuration > 0 ? Math.round((data.duration / totalDuration) * 100) : 0,
    }))
    .sort((a, b) => b.duration - a.duration);
};

export const calculateTimePatterns = (records: ProcrastinationRecord[]): TimePattern[] => {
  const hourMap = new Map<number, { count: number; duration: number }>();
  
  records.forEach(record => {
    const hour = new Date(record.startTime).getHours();
    const existing = hourMap.get(hour) || { count: 0, duration: 0 };
    hourMap.set(hour, {
      count: existing.count + 1,
      duration: existing.duration + record.duration,
    });
  });
  
  return Array.from(hourMap.entries())
    .map(([hour, data]) => ({
      hour,
      count: data.count,
      duration: data.duration,
    }))
    .sort((a, b) => a.hour - b.hour);
};

export const calculateWeeklyTrend = (records: ProcrastinationRecord[]): { day: string; duration: number }[] => {
  const dayMap = new Map<number, number>();
  const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  
  for (let i = 0; i < 7; i++) {
    dayMap.set(i, 0);
  }
  
  records.forEach(record => {
    const day = new Date(record.startTime).getDay();
    const adjustedDay = day === 0 ? 6 : day - 1;
    dayMap.set(adjustedDay, (dayMap.get(adjustedDay) || 0) + record.duration);
  });
  
  return Array.from(dayMap.entries())
    .map(([index, duration]) => ({
      day: weekDays[index],
      duration,
    }))
    .sort((a, b) => weekDays.indexOf(a.day) - weekDays.indexOf(b.day));
};

export const generateInsights = (records: ProcrastinationRecord[]): InsightResult => {
  if (records.length === 0) {
    return {
      mostFrequentTimeRange: '',
      mostCommonReason: '',
      longestDurationReason: '',
      peakHours: [],
    };
  }
  
  const hourMap = new Map<number, number>();
  records.forEach(record => {
    const hour = new Date(record.startTime).getHours();
    hourMap.set(hour, (hourMap.get(hour) || 0) + record.duration);
  });
  
  const sortedHours = Array.from(hourMap.entries()).sort((a, b) => b[1] - a[1]);
  const peakHour = sortedHours[0][0];
  
  let timeRange = '';
  if (peakHour >= 0 && peakHour < 6) timeRange = '凌晨0:00-6:00';
  else if (peakHour >= 6 && peakHour < 9) timeRange = '早上6:00-9:00';
  else if (peakHour >= 9 && peakHour < 12) timeRange = '上午9:00-12:00';
  else if (peakHour >= 12 && peakHour < 14) timeRange = '中午12:00-14:00';
  else if (peakHour >= 14 && peakHour < 17) timeRange = '下午14:00-17:00';
  else if (peakHour >= 17 && peakHour < 20) timeRange = '傍晚17:00-20:00';
  else timeRange = '晚上20:00-24:00';
  
  const reasonMap = new Map<string, { count: number; duration: number }>();
  records.forEach(record => {
    const existing = reasonMap.get(record.reason) || { count: 0, duration: 0 };
    reasonMap.set(record.reason, {
      count: existing.count + 1,
      duration: existing.duration + record.duration,
    });
  });
  
  const sortedByCount = Array.from(reasonMap.entries()).sort((a, b) => b[1].count - a[1].count);
  const sortedByDuration = Array.from(reasonMap.entries()).sort((a, b) => b[1].duration - a[1].duration);
  
  const peakHours = sortedHours.slice(0, 3).map(h => h[0]);
  
  return {
    mostFrequentTimeRange: timeRange,
    mostCommonReason: sortedByCount[0][0],
    longestDurationReason: sortedByDuration[0][0],
    peakHours,
  };
};

export const convertTimeToActivities = (totalMinutes: number) => {
  return {
    movies: Math.floor(totalMinutes / 120),
    books: Math.floor(totalMinutes / 360),
    workouts: Math.floor(totalMinutes / 60),
    travels: Math.floor(totalMinutes / 480),
    courses: Math.floor(totalMinutes / 4800),
    languageStages: Math.floor(totalMinutes / 6000),
    conversations: Math.floor(totalMinutes / 60),
    habits: Math.floor(totalMinutes / 5400),
  };
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

export const formatDurationLong = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
};
