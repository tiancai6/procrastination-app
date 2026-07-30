import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { emitDataReset } from './appEvents';

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

const MEMO_MEDIA_BASE = `${FileSystem.documentDirectory}memos/`;

const BACKUP_APP_TAG = 'procrastination-app';
const BACKUP_VERSION = 1;

interface BackupFile {
  version: number;
  app: string;
  exportedAt: string;
  data: Record<string, string | null>;
  memoMedia?: Record<string, Record<string, string>>;
  profileImageFile?: { name: string; base64: string };
}

const pad = (n: number): string => String(n).padStart(2, '0');

const countRecords = (raw: string | null | undefined): number => {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
};

// 收集所有随手记媒体文件，base64 内联进备份（与文本一起走现有分享流程）
const collectMemoMedia = async (): Promise<Record<string, Record<string, string>>> => {
  const out: Record<string, Record<string, string>> = {};
  try {
    const baseInfo = await FileSystem.getInfoAsync(MEMO_MEDIA_BASE);
    if (!baseInfo.exists) return out;
    const ids = await FileSystem.readDirectoryAsync(MEMO_MEDIA_BASE);
    for (const id of ids) {
      const dir = `${MEMO_MEDIA_BASE}${id}/`;
      const files = await FileSystem.readDirectoryAsync(dir);
      out[id] = {};
      for (const f of files) {
        const b64 = await FileSystem.readAsStringAsync(`${dir}${f}`, {
          encoding: FileSystem.EncodingType.Base64,
        });
        out[id][f] = b64;
      }
    }
  } catch (e) {
    console.error('collectMemoMedia failed', e);
  }
  return out;
};

const restoreMemoMedia = async (mediaRaw: string): Promise<void> => {
  try {
    const media: Record<string, Record<string, string>> = JSON.parse(mediaRaw);
    for (const id of Object.keys(media)) {
      const dir = `${MEMO_MEDIA_BASE}${id}/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      for (const f of Object.keys(media[id])) {
        await FileSystem.writeAsStringAsync(`${dir}${f}`, media[id][f], {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
    }
  } catch (e) {
    console.error('restoreMemoMedia failed', e);
  }
};

// 收集头像图片文件（base64 内联进备份，重装后仍可恢复）
const collectProfileImageFile = async (uri: string): Promise<{ name: string; base64: string } | null> => {
  try {
    if (!uri || !uri.startsWith('file://')) return null;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const name = uri.split('/').pop() || 'profile.jpg';
    return { name, base64 };
  } catch (e) {
    console.error('collectProfileImageFile failed', e);
    return null;
  }
};

const restoreProfileImageFile = async (file: { name: string; base64: string }): Promise<string | null> => {
  try {
    const destUri = `${FileSystem.documentDirectory}${file.name}`;
    await FileSystem.writeAsStringAsync(destUri, file.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return destUri;
  } catch (e) {
    console.error('restoreProfileImageFile failed', e);
    return null;
  }
};

export const exportBackup = async (): Promise<{ recordCount: number; fileName: string; fileSizeKB: number }> => {
  const entries = await AsyncStorage.multiGet(BACKUP_KEYS);
  const data: Record<string, string | null> = {};
  entries.forEach(([key, value]) => {
    data[key] = value;
  });

  const memoMedia = await collectMemoMedia();
  // 头像图片文件单独收集，确保重装后仍可恢复
  const profileUri = data['procrastination_profile_image'];
  const profileImageFile = profileUri ? (await collectProfileImageFile(profileUri)) ?? undefined : undefined;

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    app: BACKUP_APP_TAG,
    exportedAt: new Date().toISOString(),
    data,
    memoMedia,
    profileImageFile,
  };

  const now = new Date();
  const fileName = `拖延记录备份-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  const jsonStr = JSON.stringify(backup, null, 2);
  await FileSystem.writeAsStringAsync(fileUri, jsonStr, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // 计算文件大小
  const fileSizeKB = Math.round((jsonStr.length * 2) / 1024); // UTF-16 每字符 2 字节

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: '导出数据备份',
      UTI: 'public.json',
    });
  }

  return {
    recordCount: countRecords(data['procrastination_records']),
    fileName,
    fileSizeKB,
  };
};

export const importBackup = async (): Promise<{ recordCount: number; fileSizeKB: number } | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || !result.assets[0]) {
    return null;
  }

  const fileUri = result.assets[0].uri;
  
  // 检查文件大小，防止读取超大文件导致 OOM
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  const fileSizeKB = fileInfo.exists && fileInfo.size ? Math.round(fileInfo.size / 1024) : 0;
  
  if (fileSizeKB > 200 * 1024) {
    throw new Error(`备份文件过大（${(fileSizeKB / 1024).toFixed(1)}MB），请清理部分随手记媒体后重新导出`);
  }

  const content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  let backup: BackupFile;
  try {
    backup = JSON.parse(content);
  } catch {
    throw new Error('文件内容不是有效的 JSON');
  }

  if (
    !backup ||
    backup.app !== BACKUP_APP_TAG ||
    backup.version !== BACKUP_VERSION ||
    typeof backup.data !== 'object' ||
    backup.data === null
  ) {
    throw new Error('这不是本应用导出的备份文件');
  }

  const pairs: [string, string][] = [];
  for (const key of BACKUP_KEYS) {
    const value = backup.data[key];
    if (typeof value === 'string') {
      pairs.push([key, value]);
    }
  }

  if (pairs.length === 0) {
    throw new Error('备份文件中没有可恢复的数据');
  }

  await AsyncStorage.multiSet(pairs);

  if (backup.memoMedia) {
    await restoreMemoMedia(JSON.stringify(backup.memoMedia));
  }

  // 通知所有已挂载页面重新拉取，保证导入后首页/统计等同步显示新数据
  emitDataReset();

  // 恢复头像图片文件，并把新路径写回 AsyncStorage（旧路径在旧 App 沙盒已失效）
  if (backup.profileImageFile) {
    const newUri = await restoreProfileImageFile(backup.profileImageFile);
    if (newUri) {
      await AsyncStorage.setItem('procrastination_profile_image', newUri);
    }
  }

  return {
    recordCount: countRecords(backup.data['procrastination_records']),
    fileSizeKB,
  };
};
