import { create } from 'zustand';
import { ProcrastinationRecord, UserStats } from '../types';
import { getRecords, getStats, saveRecord, updateStats } from '../utils/storage';

interface RecordsStore {
  records: ProcrastinationRecord[];
  stats: UserStats;
  loading: boolean;
  fetchRecords: () => Promise<void>;
  fetchStats: () => Promise<void>;
  addRecord: (record: ProcrastinationRecord) => Promise<void>;
}

export const useRecordsStore = create<RecordsStore>((set) => ({
  records: [],
  stats: {
    todayDuration: 0,
    todayLimit: 45,
    weekTotal: 0,
    weekCount: 0,
    avgDuration: 0,
    longestDuration: 0,
    monthTotal: 0,
    monthCount: 0,
  },
  loading: false,
  
  fetchRecords: async () => {
    set({ loading: true });
    const records = await getRecords();
    set({ records, loading: false });
  },
  
  fetchStats: async () => {
    set({ loading: true });
    const stats = await getStats();
    set({ stats, loading: false });
  },
  
  addRecord: async (record) => {
    await saveRecord(record);
    const records = await getRecords();
    await updateStats(records);
    const stats = await getStats();
    set({ records, stats });
  },
}));
