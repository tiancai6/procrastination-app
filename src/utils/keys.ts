// 全量数据 key 清单（单一可信来源）
// ⚠️ 本文件**禁止 import 任何模块**（保持零依赖），避免与 storage/backup/autoBackup 形成循环依赖。
// 新增任何持久化数据项时，必须同步加入下面的数组，否则会出现：
//   - 导出备份漏数据
//   - 清除全部数据清不干净
//   - 自动备份/自愈漏数据
// 字符串直写，与 storage.ts 中各命名常量保持一致。

export const ALL_DATA_KEYS = [
  'timer_sessions', // SESSIONS_KEY
  'procrastination_profile_image', // PROFILE_IMAGE_KEY
  'focus_card_image', // FOCUS_BG_KEY
  'procrastination_task_plans', // TASK_PLANS_KEY
  'procrastination_plans', // PLANS_KEY
  'procrastination_checkin_records', // CHECKIN_RECORDS_KEY
  'procrastination_reward_records', // REWARD_RECORDS_KEY
  'ai_insights_cache', // AI_INSIGHTS_CACHE_KEY
  'ai_api_key', // AI_API_KEY
  'ai_model', // AI_MODEL
  'ai_vision_model', // AI_VISION_MODEL
  'quick_memos', // QUICK_MEMOS_KEY
  'memo_analysis_cache', // MEMO_ANALYSIS_CACHE_KEY
  'chat_messages', // CHAT_MESSAGES_KEY
  'chat_summary', // CHAT_SUMMARY_KEY
  'chat_meta', // CHAT_META_KEY
  'reminders', // REMINDERS_KEY
  'habits', // HABITS_KEY
  'habit_checkins', // HABIT_CHECKINS_KEY
  'ledger_entries', // LEDGER_KEY
  'ledger_cats_expense', // LEDGER_CATS_EXPENSE_KEY
  'ledger_cats_income', // LEDGER_CATS_INCOME_KEY
  'meal_entries', // 三餐记录（nutrition.ts）
  'body_profile', // BODY_PROFILE_KEY
  'body_profile_history', // BODY_PROFILE_HISTORY_KEY（身体信息历史快照，趋势折线图用）
  'daily_activity', // DAILY_ACTIVITY_KEY
  'model_configs', // MODEL_CONFIGS_KEY（多模型配置：GLM/豆包/DeepSeek/Gemini）
  'food_library', // FOOD_LIBRARY_KEY（食物库，nutrition.ts）
  'exercise_types', // EXERCISE_TYPES_KEY（自定义运动类型列表，activity.ts）
];
