import { create } from 'zustand';
import { TimerState } from '../types';

interface TimerStore extends TimerState {
  startTimer: (reason: string, taskType: 'work' | 'life' | 'entertainment' | 'other', note?: string) => void;
  stopTimer: () => void;
  updateDuration: (duration: number) => void;
  resetTimer: () => void;
}

export const useTimerStore = create<TimerStore>((set) => ({
  isRunning: false,
  startTime: null,
  currentDuration: 0,
  selectedReason: null,
  selectedTaskType: null,
  selectedNote: '',

  startTimer: (reason, taskType, note = '') => set({
    isRunning: true,
    startTime: Date.now(),
    currentDuration: 0,
    selectedReason: reason,
    selectedTaskType: taskType,
    selectedNote: note,
  }),

  stopTimer: () => set({
    isRunning: false,
    startTime: null,
    currentDuration: 0,
    selectedReason: null,
    selectedTaskType: null,
    selectedNote: '',
  }),

  updateDuration: (duration) => set({ currentDuration: duration }),

  resetTimer: () => set({
    isRunning: false,
    startTime: null,
    currentDuration: 0,
    selectedReason: null,
    selectedTaskType: null,
    selectedNote: '',
  }),
}));
