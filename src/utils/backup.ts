import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { emitDataReset } from './appEvents';
import { ALL_DATA_KEYS } from './keys';

const MEMO_MEDIA_BASE = `${FileSystem.documentDirectory}memos/`;
// 聊天图片目录（与 chat.ts 中的 CHAT_IMG_DIR 保持一致）
const CHAT_IMG_DIR = `${FileSystem.documentDirectory}chat_images/`;

const BACKUP_APP_TAG = 'dailytrace';
const BACKUP_VERSION = 1;

interface BackupFile {
  version: number;
  app: string;
  exportedAt: string;
  data: Record<string, string | null>;
  memoMedia?: Record<string, Record<string, string>>;
  chatImages?: Record<string, string>;
  profileImageFile?: { name: string; base64: string };
  focusBgFile?: { name: string; base64: string };
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

// 收集首页「今日专注」卡片背景图（base64 内联进备份，重装后仍可恢复）
const collectFocusBgFile = async (uri: string): Promise<{ name: string; base64: string } | null> => {
  try {
    if (!uri || !uri.startsWith('file://')) return null;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const name = uri.split('/').pop() || 'focus_bg.jpg';
    return { name, base64 };
  } catch (e) {
    console.error('collectFocusBgFile failed', e);
    return null;
  }
};

const restoreFocusBgFile = async (file: { name: string; base64: string }): Promise<string | null> => {
  try {
    const destUri = `${FileSystem.documentDirectory}${file.name}`;
    await FileSystem.writeAsStringAsync(destUri, file.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return destUri;
  } catch (e) {
    console.error('restoreFocusBgFile failed', e);
    return null;
  }
};

// 收集聊天图片（chat_images/）为 base64，按文件名内联进备份，重装后仍能显示聊天里的图片
const collectChatImages = async (): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  try {
    const info = await FileSystem.getInfoAsync(CHAT_IMG_DIR);
    if (!info.exists) return out;
    const files = await FileSystem.readDirectoryAsync(CHAT_IMG_DIR);
    for (const f of files) {
      try {
        out[f] = await FileSystem.readAsStringAsync(`${CHAT_IMG_DIR}${f}`, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch (e) {
        console.error('collectChatImages read failed', f, e);
      }
    }
  } catch (e) {
    console.error('collectChatImages failed', e);
  }
  return out;
};

const restoreChatImages = async (images: Record<string, string>): Promise<void> => {
  try {
    const info = await FileSystem.getInfoAsync(CHAT_IMG_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(CHAT_IMG_DIR, { intermediates: true });
    for (const name of Object.keys(images)) {
      await FileSystem.writeAsStringAsync(`${CHAT_IMG_DIR}${name}`, images[name], {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
  } catch (e) {
    console.error('restoreChatImages failed', e);
  }
};

export const exportBackup = async (): Promise<{ recordCount: number; fileName: string; fileSizeKB: number }> => {
  const entries = await AsyncStorage.multiGet(ALL_DATA_KEYS);
  const data: Record<string, string | null> = {};
  entries.forEach(([key, value]) => {
    data[key] = value;
  });

  const memoMedia = await collectMemoMedia();
  const chatImages = await collectChatImages();
  // 头像图片文件单独收集，确保重装后仍可恢复
  const profileUri = data['procrastination_profile_image'];
  const profileImageFile = profileUri ? (await collectProfileImageFile(profileUri)) ?? undefined : undefined;

  // 首页背景图文件单独收集，确保重装后仍可恢复
  const focusBgUri = data['focus_card_image'];
  const focusBgFile = focusBgUri ? (await collectFocusBgFile(focusBgUri)) ?? undefined : undefined;

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    app: BACKUP_APP_TAG,
    exportedAt: new Date().toISOString(),
    data,
    memoMedia,
    chatImages,
    profileImageFile,
    focusBgFile,
  };

  const now = new Date();
  const fileName = `日迹备份-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
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
    recordCount: countRecords(data['timer_sessions']),
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
    (backup.app !== BACKUP_APP_TAG && backup.app !== 'procrastination-app') ||
    backup.version !== BACKUP_VERSION ||
    typeof backup.data !== 'object' ||
    backup.data === null
  ) {
    throw new Error('这不是本应用导出的备份文件');
  }

  const pairs: [string, string][] = [];
  for (const key of ALL_DATA_KEYS) {
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

  if (backup.chatImages) {
    await restoreChatImages(backup.chatImages);
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

  // 恢复首页背景图文件，并把新路径写回 AsyncStorage
  if (backup.focusBgFile) {
    const newUri = await restoreFocusBgFile(backup.focusBgFile);
    if (newUri) {
      await AsyncStorage.setItem('focus_card_image', newUri);
    }
  }

  return {
    recordCount: countRecords(backup.data['timer_sessions']),
    fileSizeKB,
  };
};
