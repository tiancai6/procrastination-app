import { create } from 'zustand';
import { ChatMessage, sendChatStream } from '../utils/chat';
import { getChatMessages, saveChatMessages, generateId } from '../utils/storage';
import { ModelConfig } from '../utils/modelConfig';

interface ChatStoreState {
  messages: ChatMessage[];
  streamingText: string; // 正在流式生成的片段（AI 后台跑时持续累积）
  isStreaming: boolean;
  loaded: boolean;
  // 加载已存对话（全局只做一次，App 生命周期内消息不随页面卸载而丢）
  load: () => Promise<void>;
  // 发送一条用户消息并由 AI 在后台流式回复；结果写回 store + storage
  send: (text: string, images: string[], systemContext?: string, search?: boolean, cfgOverride?: ModelConfig) => Promise<void>;
  // 直接替换消息列表（批量删除、压缩等本地操作后同步）
  setMessages: (m: ChatMessage[]) => void;
  saveMessages: (m: ChatMessage[]) => Promise<void>;
  clear: () => Promise<void>;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  streamingText: '',
  isStreaming: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const msgs = await getChatMessages();
    set({ messages: msgs, loaded: true });
  },

  send: async (text, images, systemContext, search, cfgOverride) => {
    // 🔧 调试日志：确认 ChatPage 传下来的 cfgOverride 是否存在
    console.log(`[chatStore.send] cfgOverride=${!!cfgOverride ? cfgOverride.name + '(' + cfgOverride.brand + ')' : 'undefined'}, search=${search}`);
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      ts: Date.now(),
      images: images.length ? [...images] : undefined,
    };
    const next = [...get().messages, userMsg];
    set({ messages: next, isStreaming: true, streamingText: '' });
    await saveChatMessages(next); // 先把用户消息落库，切屏回来也不会丢
    try {
      const full = await sendChatStream(
        next,
        systemContext,
        (delta) => {
          set({ streamingText: get().streamingText + delta });
        },
        undefined,
        search,
        cfgOverride,
      );
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: full,
        ts: Date.now(),
      };
      const withReply = [...next, assistantMsg];
      set({ messages: withReply, isStreaming: false, streamingText: '' });
      await saveChatMessages(withReply);
    } catch (e) {
      // 出错也保留已生成的片段，便于用户看到 partial；清空流式态
      set({ isStreaming: false });
      throw e;
    }
  },

  setMessages: (m) => set({ messages: m }),

  saveMessages: async (m) => {
    await saveChatMessages(m);
  },

  clear: async () => {
    set({ messages: [], streamingText: '', isStreaming: false });
    await saveChatMessages([]);
  },
}));
