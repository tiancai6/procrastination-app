import { create } from 'zustand';
import { LedgerEntry } from '../types';
import {
  getLedgerEntries,
  addLedgerEntry,
  updateLedgerEntry,
  deleteLedgerEntry,
} from '../utils/storage';

interface LedgerStore {
  entries: LedgerEntry[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (e: LedgerEntry) => Promise<void>;
  update: (e: LedgerEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// 记账的全局共享数据源：首页花销卡与统计中心消费面板共用，
// 任意一处增删改后都会重新拉取，确保两处同步显示。
export const useLedgerStore = create<LedgerStore>((set, get) => ({
  entries: [],
  loaded: false,
  load: async () => {
    const list = await getLedgerEntries();
    set({ entries: list, loaded: true });
  },
  add: async (e) => {
    await addLedgerEntry(e);
    await get().load();
  },
  update: async (e) => {
    await updateLedgerEntry(e);
    await get().load();
  },
  remove: async (id) => {
    await deleteLedgerEntry(id);
    await get().load();
  },
}));
