export interface ProcrastinationRecord {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  reason: string;
  taskType: 'work' | 'life' | 'entertainment' | 'other';
  note?: string;
  createdAt: number;
}

export interface TimerState {
  isRunning: boolean;
  startTime: number | null;
  currentDuration: number;
  selectedReason: string | null;
  selectedTaskType: 'work' | 'life' | 'entertainment' | 'other' | null;
  selectedNote: string;
}

export interface UserStats {
  todayDuration: number;
  todayLimit: number;
  weekTotal: number;
  weekCount: number;
  avgDuration: number;
  longestDuration: number;
  monthTotal: number;
  monthCount: number;
}

export interface CategoryStats {
  name: string;
  duration: number;
  count: number;
  percentage: number;
}

export interface TimePattern {
  hour: number;
  count: number;
  duration: number;
}

export interface InsightResult {
  mostFrequentTimeRange: string;
  mostCommonReason: string;
  longestDurationReason: string;
  peakHours: number[];
}

export interface TaskPlan {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  reason: string;
  strategy: string;
  reminderEnabled: boolean;
  status: 'pending' | 'in-progress' | 'completed';
  createdAt: number;
}

export interface PlanTask {
  id: string;
  planId: string;
  name: string;
  duration: number;
  order: number;
}

export interface CompletedTask {
  taskId: string;
  completed: boolean;
  actualDuration: number;
}

export interface CheckinRecord {
  id: string;
  planId: string;
  date: string;
  completedTasks: CompletedTask[];
  status: 'completed' | 'uncompleted' | 'makeup';
  totalDuration: number;
  procrastinationTime: number;
  completedAt: number;
}

export interface RewardRecord {
  id: string;
  planId: string;
  planName: string;
  rewardName: string;
  rewardType: 'physical' | 'virtual';
  status: 'unclaimed' | 'claimed';
  earnedAt: number;
  claimedAt: number | null;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  rewardName: string;
  rewardType: 'physical' | 'virtual';
  rewardImage: string | null;
  weeklyDays: number;
  startTime: string;
  endTime: string;
  tasks: PlanTask[];
  createdAt: number;
  status: 'active' | 'completed' | 'expired';
}

export interface HighlightRange {
  start: number;
  end: number;
  color: string;
}

export interface MemoMedia {
  type: 'image' | 'video';
  file: string;
  mime?: string;
}

export interface MemoReminder {
  datetime: string; // ISO
  repeat: 'none' | 'daily' | 'weekly';
  channel: 'banner' | 'sound' | 'silent';
  notificationId?: string;
}

export interface QuickMemo {
  id: string;
  content: string;
  highlightRanges: HighlightRange[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  media: MemoMedia[];
  tags: string[];
  reminder?: MemoReminder;
}

export type LedgerType = 'expense' | 'income';

export interface LedgerEntry {
  id: string;
  type: LedgerType;            // 支出 / 收入
  amount: number;              // 金额（元，2 位小数）
  category: string;            // 分类（餐饮/工资...）
  note?: string;
  occurredAt: number;          // 发生时间
  createdAt: number;
  updatedAt: number;
}
