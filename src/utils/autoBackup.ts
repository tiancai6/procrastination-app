import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { exportBackup } from './backup';

const BACKUP_DIR = `${FileSystem.documentDirectory}backup/`;
const AUTO_BACKUP_FILE = `${BACKUP_DIR}latest.json`;
const LAST_BACKUP_KEY = 'last_auto_backup_at';
const LAST_MANUAL_EXPORT_KEY = 'last_manual_export_at';

const REMIND_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 天

const BACKUP_KEYS = [
  'procrastination_records',
  'procrastination_stats',
  'procrastination_task_plans',
  'procrastination_plans',
  'procrastination_checkin_records',
  'procrastination_reward_records',
  'procrastination_profile_image',
  'quick_memos',
  'ledger_entries',
  'chat_messages',
  'chat_summary',
  'chat_meta',
  'ai_api_key',
  'ai_model',
  'ai_insights_cache',
  'memo_analysis_cache',
];

interface AutoBackupFile {
  savedAt: number;
  data: Record<string, string | null>;
}

const ensureDir = async (): Promise<void> => {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
  }
};

/**
 * 写入自动备份（防崩溃用）
 * 在每次重要数据写入后调用，保证 documentDirectory 有一份完整副本
 */
export const autoBackup = async (): Promise<void> => {
  try {
    await ensureDir();
    const entries = await AsyncStorage.multiGet(BACKUP_KEYS);
    const data: Record<string, string | null> = {};
    entries.forEach(([key, value]) => {
      data[key] = value;
    });
    const payload: AutoBackupFile = {
      savedAt: Date.now(),
      data,
    };
    await FileSystem.writeAsStringAsync(
      AUTO_BACKUP_FILE,
      JSON.stringify(payload),
      { encoding: FileSystem.EncodingType.UTF8 }
    );
    await AsyncStorage.setItem(LAST_BACKUP_KEY, String(payload.savedAt));
  } catch (e) {
    console.error('autoBackup failed', e);
  }
};

/**
 * 启动自愈：检测 AsyncStorage 是否损坏，若损坏则从 latest.json 恢复
 * 返回恢复结果，供 UI 提示
 */
export const trySelfHeal = async (): Promise<{ recovered: boolean; reason?: string }> => {
  try {
    // 1. 校验 AsyncStorage 是否可用
    const recordsRaw = await AsyncStorage.getItem('procrastination_records');
    if (recordsRaw) {
      try {
        const parsed = JSON.parse(recordsRaw);
        if (Array.isArray(parsed)) {
          // 数据正常，无需恢复
          return { recovered: false };
        }
      } catch {
        // JSON 损坏，继续走恢复流程
      }
    }

    // 2. 读取 latest.json
    const info = await FileSystem.getInfoAsync(AUTO_BACKUP_FILE);
    if (!info.exists) {
      return { recovered: false, reason: 'no_backup' };
    }

    const content = await FileSystem.readAsStringAsync(AUTO_BACKUP_FILE, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const backup: AutoBackupFile = JSON.parse(content);

    if (!backup || typeof backup.data !== 'object' || backup.data === null) {
      return { recovered: false, reason: 'backup_invalid' };
    }

    // 3. 恢复到 AsyncStorage
    const pairs: [string, string][] = [];
    for (const key of BACKUP_KEYS) {
      const value = backup.data[key];
      if (typeof value === 'string') {
        pairs.push([key, value]);
      }
    }

    if (pairs.length === 0) {
      return { recovered: false, reason: 'backup_empty' };
    }

    await AsyncStorage.multiSet(pairs);
    return { recovered: true };
  } catch (e) {
    console.error('trySelfHeal failed', e);
    return { recovered: false, reason: 'exception' };
  }
};

/**
 * 记录手动导出时间（导出成功后调用）
 */
export const markManualExport = async (): Promise<void> => {
  await AsyncStorage.setItem(LAST_MANUAL_EXPORT_KEY, String(Date.now()));
};

/**
 * 检查是否需要提醒用户导出备份
 * 返回 shouldRemind=true 时，App 应弹窗提醒
 */
export const checkExportReminder = async (): Promise<{ shouldRemind: boolean; daysSinceLastExport: number }> => {
  const lastStr = await AsyncStorage.getItem(LAST_MANUAL_EXPORT_KEY);
  if (!lastStr) {
    // 从未导出过，立即提醒
    return { shouldRemind: true, daysSinceLastExport: -1 };
  }

  const last = parseInt(lastStr, 10);
  if (isNaN(last)) {
    return { shouldRemind: true, daysSinceLastExport: -1 };
  }

  const diff = Date.now() - last;
  if (diff >= REMIND_INTERVAL_MS) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return { shouldRemind: true, daysSinceLastExport: days };
  }

  return { shouldRemind: false, daysSinceLastExport: Math.floor(diff / (24 * 60 * 60 * 1000)) };
};

/**
 * 触发手动导出（封装 exportBackup，成功后自动更新时间戳）
 */
export const doManualExport = async (): Promise<{ recordCount: number; fileName: string; fileSizeKB: number }> => {
  const result = await exportBackup();
  await markManualExport();
  return result;
};
