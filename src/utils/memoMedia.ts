import * as FileSystem from 'expo-file-system/legacy';

const BASE = `${FileSystem.documentDirectory}memos/`;

export const getMemoMediaDir = (id: string): string => `${BASE}${id}/`;

export const ensureMemoDir = async (id: string): Promise<string> => {
  const dir = getMemoMediaDir(id);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
};

// 复制用户选择的图片/视频到随手记私有目录，返回相对文件名
export const copyMediaToMemo = async (id: string, uri: string): Promise<string> => {
  const dir = await ensureMemoDir(id);
  const cleanUri = uri.split('?')[0];
  const ext = (cleanUri.split('.').pop() || 'dat').toLowerCase();
  const name = `${Date.now()}.${ext}`;
  await FileSystem.copyAsync({ from: uri, to: `${dir}${name}` });
  return name;
};

export const getMemoMediaUri = (id: string, file: string): string => `${BASE}${id}/${file}`;

export const deleteMemoMediaDir = async (id: string): Promise<void> => {
  const dir = getMemoMediaDir(id);
  const info = await FileSystem.getInfoAsync(dir);
  if (info.exists) {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }
};
