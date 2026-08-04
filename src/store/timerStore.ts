import { create } from 'zustand';
import { TimerState } from '../types';

interface TimerStore extends TimerState {
  startTimer: () => void;
  stopTimer: () => void;
  updateDuration: (duration: number) => void;
  resetTimer: () => void;
}

export const useTimerStore = create<TimerStore>((set) => ({
  isRunning: false,
  startTime: null,
  currentDuration: 0,

  startTimer: () => set({
    isRunning: true,
    startTime: Date.now(),
    currentDuration: 0,
  }),

  stopTimer: () => set({
    isRunning: false,
    startTime: null,
    currentDuration: 0,
  }),

  updateDuration: (duration) => set({ currentDuration: duration }),

  resetTimer: () => set({
    isRunning: false,
    startTime: null,
    currentDuration: 0,
  }),
}));
