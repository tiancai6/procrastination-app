// ============ 专注计时（通用计时，健身/工作均可） ============
export type TimerCategory = 'work' | 'study' | 'exercise' | 'life' | 'rest' | 'other';

export interface TimerSession {
  id: string;
  startTime: number;   // 开始时间戳(ms)
  endTime: number;     // 结束时间戳(ms)
  duration: number;    // 时长（分钟）
  category: TimerCategory; // 分类（结束后选择）
  what: string;        // 这段时间做了什么
  createdAt: number;
}

export interface TimerState {
  isRunning: boolean;
  startTime: number | null;
  currentDuration: number; // 当前计时（分钟）
}

export interface FocusStats {
  todayDuration: number;
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

// 专注洞察（AI 可选）
export interface InsightResult {
  mostFrequentTimeRange: string;
  mostCommonCategory: string;
  longestDurationCategory: string;
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
  delayTime: number;
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

// ============ 提醒事项（待办） ============
export interface Reminder {
  id: string;
  title: string;               // 提醒内容
  date: string;                // 日期 YYYY-MM-DD
  time?: string;               // 可选时间 HH:mm
  note?: string;               // 可选备注
  done: boolean;               // 是否已完成
  notificationId?: string | null; // 本地通知 ID，用于取消
  createdAt: number;
}

// ============ 习惯打卡 ============
export interface Habit {
  id: string;
  name: string;                // 习惯名称
  note?: string;               // 备注
  frequency: 'daily' | 'weekly'; // 每日 / 每周选定星期几
  weekDays: number[];          // weekly 时选中的星期几 [0=日,1=一,...,6=六]
  reminderTime?: string | null; // 可选提醒时间 HH:mm
  color: string;               // 卡片主题色（hex）
  createdAt: number;
  status: 'active' | 'paused';
}

export interface HabitCheckin {
  id: string;
  habitId: string;
  date: string;                // YYYY-MM-DD
  checkedAt: number;
}

// ============ 每日三餐 ============
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealEntry {
  id: string;
  type: MealType;              // 早 / 午 / 晚 / 加餐
  content: string;             // 这顿吃了什么（文本描述）
  date: string;                // 日期 YYYY-MM-DD
  createdAt: number;
  nutrition?: MealNutrition;   // 本餐营养估算（含逐项明细）
  // 从「食物库」选入、营养已知的食物（用户已准确记录），估算时作为 ground truth 注入，
  // 保证你记录过的食物热量一定准确，不被 AI 重新瞎猜。
  knownFoods?: KnownFood[];
}

// 从食物库选入时带入的「已知营养」（来源即 FoodItem 的保存值，仅作展示/参考→现改为参与估算）
export interface KnownFood {
  name: string;       // 食物名（含分量），与食物库里一致
  foodId?: string;    // 关联的食物库 id（可选，便于后续同步）
  protein: number;    // 蛋白 g
  calories: number;   // 热量 kcal
  fat: number;        // 脂肪 g
  carbs: number;      // 碳水 g
  fiber: number;      // 膳食纤维 g
  water?: number;     // 饮水 ml（可选）
  // 分量换算用：食物库这一份对应的「克数」（如「米饭 1碗(约150g)」→150）。
  // 用户实际吃的分量与这份不同时，按比例缩放营养，避免「半碗也按一整碗热量记」。
  baseGrams?: number;
  // 用户习惯输入单位每份对应的克数（如 inputUnit「一份(20g)」→20）。用于「N份」换算。
  inputUnitGrams?: number;
}

export type MealAdequacy = '不足' | '适量' | '过量';

// 单餐营养里的「一项食物」，用于「依据」展示
export interface MealNutritionItem {
  name: string;     // 食物名（尽量含大致分量，如「鸡蛋 2个」）
  protein: number;  // 蛋白质 g
  calories: number; // 热量 kcal
  fat?: number;     // 脂肪 g
  carbs?: number;   // 碳水 g
  fiber?: number;   // 膳食纤维 g
}

export interface MealNutrition {
  protein: number;     // 蛋白质 g
  calories: number;    // 热量 kcal
  fat?: number;        // 脂肪 g
  carbs?: number;      // 碳水 g
  fiber?: number;      // 膳食纤维 g
  water?: number;      // 饮水 ml
  items: MealNutritionItem[]; // 逐项明细（依据）
  adequacy: MealAdequacy;     // 相对推荐量：不足 / 适量 / 过量
  comment: string;     // 一句话点评与建议
}

// 兼容旧引用（历史类型名）
export type NutritionResult = MealNutrition;
