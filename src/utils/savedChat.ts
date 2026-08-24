// 已保存的对话稿（用户从聊天中选择消息后「存到我的保存」）。
// 存 App 内，可在会话列表页回看、再分享、删除。

import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from './storage';

export type SavedChatFormat = 'md' | 'txt';

export interface SavedChat {
  id: string;
  title: string;
  format: SavedChatFormat;
  content: string; // 完整文件内容（含时间/角色排版）
  createdAt: number;
  messageCount: number;
}

const SAVED_CHATS_KEY = 'saved_chats';

export const getSavedChats = async (): Promise<SavedChat[]> => {
  try {
    const data = await AsyncStorage.getItem(SAVED_CHATS_KEY);
    const list: SavedChat[] = data ? JSON.parse(data) : [];
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error('Failed to get saved chats:', error);
    return [];
  }
};

export const saveSavedChat = async (entry: Omit<SavedChat, 'id' | 'createdAt'>): Promise<SavedChat> => {
  const list = await getSavedChats();
  const item: SavedChat = { ...entry, id: generateId(), createdAt: Date.now() };
  list.unshift(item);
  await AsyncStorage.setItem(SAVED_CHATS_KEY, JSON.stringify(list));
  return item;
};

export const deleteSavedChat = async (id: string): Promise<void> => {
  const list = (await getSavedChats()).filter((x) => x.id !== id);
  await AsyncStorage.setItem(SAVED_CHATS_KEY, JSON.stringify(list));
};
