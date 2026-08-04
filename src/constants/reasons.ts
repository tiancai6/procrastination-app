import { TimerCategory } from '../types';

export const FOCUS_CATEGORIES: { value: TimerCategory; label: string }[] = [
  { value: 'work', label: '工作' },
  { value: 'study', label: '学习' },
  { value: 'exercise', label: '运动' },
  { value: 'life', label: '生活' },
  { value: 'rest', label: '休息' },
  { value: 'other', label: '其他' },
];

export const COLORS = {
  primary: '#2563EB',
  primaryDark: '#1E40AF',
  primaryLight: '#3B82F6',
  secondary: '#EFF6FF',
  accent: '#F59E0B',
  text: '#1E293B',
  textLight: '#64748B',
  textLighter: '#94A3B8',
  background: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  shadow: '#1E40AF',
};

export const CONFIG = {
  weekDays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  months: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
};
