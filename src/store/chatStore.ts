import { create } from 'zustand';
import { ChatMessage, sendChatStream } from '../utils/chat';
import {
  getChatMessages,
  saveChatMessages,
  generateId,
  getChatSession,
  saveSessionMessages,
  clearSessionMessages,
} from '../utils/storage';
import { ModelConfig } from '../utils/modelConfig';

interface ChatStoreState {
  sessionId: string | null;
  messages: ChatMessage[];
  streamingText: string; // 正在流式生成的片段（AI 后台跑时持续累积）
  isStreaming: boolean;
  loadedSession: string | null;
  // 加载指定会话的消息（每个会话独立；切走再切回不会丢，因为消息已落库）
  loadSession: (id: string) => Promise<void>;
  // 发送一条用户消息并由 AI 在后台流式回复；结果写回 store + storage
  send: (
    sessionId: string,
    text: string,
    images: string[],
    systemContext?: string,
    search?: boolean,
    cfgOverride?: ModelConfig,
  ) => Promise<void>;
  // 直接替换当前会话消息列表（批量删除、压缩等本地操作后同步）
  setMessages: (m: ChatMessage[]) => void;
  saveMessages: (m: ChatMessage[]) => Promise<void>;
  clearSession: (sessionId: string) => Promise<void>;
  // 兼容旧调用：仍保留全局 load（加载默认/最后会话用）
  load: () => Promise<void>;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  sessionId: null,
  messages: [],
  streamingText: '',
  isStreaming: false,
  loadedSession: null,

  loadSession: async (id) => {
    if (get().loadedSession === id && get().sessionId === id) return;
    const session = await getChatSession(id);
    set({
      messages: session?.messages ?? [],
      sessionId: id,
      loadedSession: id,
      streamingText: '',
      isStreaming: false,
    });
  },

  send: async (sessionId, text, images, systemContext, search, cfgOverride) => {
    // 🔧 调试日志：确认 ChatPage 传下来的 cfgOverride 是否存在
    console.log(
      `[chatStore.send] session=${sessionId} cfgOverride=${!!cfgOverride ? cfgOverride.name + '(' + cfgOverride.brand + ')' : 'undefined'}, search=${search}`,
    );
    const base = get().sessionId === sessionId ? get().messages : (await getChatSession(sessionId))?.messages ?? [];
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      ts: Date.now(),
      images: images.length ? [...images] : undefined,
    };
    const next = [...base, userMsg];
    set({ messages: next, sessionId, loadedSession: sessionId, isStreaming: true, streamingText: '' });
    await saveSessionMessages(sessionId, next); // 先把用户消息落库，切屏回来也不会丢
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
      await saveSessionMessages(sessionId, withReply);
    } catch (e) {
      // 出错也保留已生成的片段，便于用户看到 partial；清空流式态
      set({ isStreaming: false });
      throw e;
    }
  },

  setMessages: (m) => set({ messages: m }),

  saveMessages: async (m) => {
    const id = get().sessionId;
    if (id) await saveSessionMessages(id, m);
  },

  clearSession: async (sessionId) => {
    if (get().sessionId === sessionId) {
      set({ messages: [], streamingText: '', isStreaming: false });
    }
    await clearSessionMessages(sessionId);
  },

  // 兼容：旧的单会话全局加载（已迁移的默认会话）
  load: async () => {
    const msgs = await getChatMessages();
    if (get().sessionId === null) set({ messages: msgs });
  },
}));
