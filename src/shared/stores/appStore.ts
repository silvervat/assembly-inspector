import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  projectId: string | null;
  language: 'et' | 'en' | 'fi' | 'ru';

  setProject: (id: string | null) => void;
  setLanguage: (lang: AppState['language']) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      projectId: null,
      language: 'et',

      setProject: (id) => set({ projectId: id }),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'assembly-inspector-app' }
  )
);
