import { create } from 'zustand';

const useUIStore = create((set) => ({
  sidebarOpen: true,
  mobileMenuOpen: false,
  currentView: 'today',
  filterText: '',
  isLoading: false,

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),

  setCurrentView: (view) => set({ currentView: view }),

  setFilterText: (text) => set({ filterText: text }),

  setLoading: (isLoading) => set({ isLoading }),
}));

export default useUIStore;
