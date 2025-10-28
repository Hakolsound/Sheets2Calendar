import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useConfigStore = create(
  persist(
    (set) => ({
      spreadsheetId: '',
      calendarId: '',
      timezone: 'Asia/Jerusalem',
      processedColumnMarker: '',

      setSpreadsheetId: (id) => set({ spreadsheetId: id }),

      setCalendarId: (id) => set({ calendarId: id }),

      setTimezone: (timezone) => set({ timezone }),

      setProcessedColumnMarker: (marker) => set({ processedColumnMarker: marker }),

      setConfig: (config) => set(config),

      resetConfig: () => set({
        spreadsheetId: '',
        calendarId: '',
        timezone: 'Asia/Jerusalem',
        processedColumnMarker: '',
      }),
    }),
    {
      name: 'config-storage',
    }
  )
);

export default useConfigStore;
