// 把选中的聊天消息导出为带排版的对话稿：Markdown（带角色/时间）或带时间的纯文本。
// 支持系统分享（存文件/分享）与存进 App 内「已保存对话稿」。

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ChatMessage } from './chat';
import { saveSavedChat, SavedChatFormat } from './savedChat';

const lineBody = (m: ChatMessage): string =>
  m.content || (m.images && m.images.length ? `[图片 ${m.images.length} 张]` : '');

export const buildChatExport = (messages: ChatMessage[], title: string, format: SavedChatFormat): string => {
  const ts = new Date().toLocaleString('zh-CN');
  const exportTime = `导出时间：${ts}`;
  if (format === 'md') {
    const head = `# ${title || '对话记录'}\n> ${exportTime}\n\n`;
    const lines = messages.map((m) => {
      const who = m.role === 'user' ? '**我**' : '**AI**';
      const t = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return `${who}（${t}）：${lineBody(m)}`;
    });
    return head + lines.join('\n\n');
  }
  // txt 带时间
  const head = `${title || '对话记录'}\n${exportTime}\n\n`;
  const lines = messages.map((m) => {
    const who = m.role === 'user' ? '我' : 'AI';
    const t = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return `[${t}] ${who}：${lineBody(m)}`;
  });
  return head + lines.join('\n');
};

export const shareChatFile = async (content: string, title: string, format: SavedChatFormat): Promise<void> => {
  const ext = format === 'md' ? 'md' : 'txt';
  const fileUri = `${FileSystem.cacheDirectory}chat_export_${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: format === 'md' ? 'text/markdown' : 'text/plain',
      dialogTitle: '导出对话',
      UTI: 'public.text',
    });
  } else {
    throw new Error('当前环境不支持系统分享，已改为「存到我的保存」');
  }
};

export const saveChatExport = async (
  content: string,
  title: string,
  format: SavedChatFormat,
  messageCount: number,
): Promise<void> => {
  await saveSavedChat({ title, format, content, messageCount });
};
