import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      loading: true,
      error: null,

      setUser: (user) => set({ user, loading: false, error: null }),

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error, loading: false }),

      logout: () => set({ user: null, error: null }),

      isAuthenticated: () => !!get().user,
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);

export default useAuthStore;
