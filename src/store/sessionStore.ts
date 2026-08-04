import { create } from 'zustand';
import { TimerSession, FocusStats } from '../types';
import {
  getTimerSessions,
  getTimerStats,
  saveTimerSession,
  updateTimerSession,
  deleteTimerSession,
} from '../utils/storage';

interface SessionStore {
  sessions: TimerSession[];
  stats: FocusStats;
  loading: boolean;
  fetchSessions: () => Promise<void>;
  fetchStats: () => Promise<void>;
  addSession: (session: TimerSession) => Promise<void>;
  updateSession: (session: TimerSession) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  stats: {
    todayDuration: 0,
    weekTotal: 0,
    weekCount: 0,
    avgDuration: 0,
    longestDuration: 0,
    monthTotal: 0,
    monthCount: 0,
  },
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    const sessions = await getTimerSessions();
    set({ sessions, loading: false });
  },

  fetchStats: async () => {
    const stats = await getTimerStats();
    set({ stats });
  },

  addSession: async (session) => {
    await saveTimerSession(session);
    const sessions = await getTimerSessions();
    const stats = await getTimerStats();
    set({ sessions, stats });
  },

  // 编辑一条专注记录（改分类/内容/开始时间/时长）后重拉会话与统计
  updateSession: async (session) => {
    await updateTimerSession(session);
    const sessions = await getTimerSessions();
    const stats = await getTimerStats();
    set({ sessions, stats });
  },

  // 删除一条专注记录后重拉会话与统计
  deleteSession: async (id) => {
    await deleteTimerSession(id);
    const sessions = await getTimerSessions();
    const stats = await getTimerStats();
    set({ sessions, stats });
  },
}));
