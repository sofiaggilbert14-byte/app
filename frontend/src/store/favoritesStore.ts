import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FavoritesStore {
  favorites: Set<string>;
  initialized: boolean;
  addFavorite: (channelId: string) => Promise<void>;
  removeFavorite: (channelId: string) => Promise<void>;
  isFavorite: (channelId: string) => boolean;
  loadFavorites: () => Promise<void>;
  clearFavorites: () => Promise<void>;
}

const STORAGE_KEY = 'channel_favorites_v1';

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  favorites: new Set(),
  initialized: false,

  loadFavorites: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const ids = JSON.parse(saved) as string[];
        set({ favorites: new Set(ids), initialized: true });
      } else {
        set({ initialized: true });
      }
    } catch (err) {
      console.error('Failed to load favorites:', err);
      set({ initialized: true });
    }
  },

  addFavorite: async (channelId: string) => {
    const state = get();
    const newFavorites = new Set(state.favorites);
    newFavorites.add(channelId);
    set({ favorites: newFavorites });
    
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(newFavorites))
      );
    } catch (err) {
      console.error('Failed to save favorite:', err);
    }
  },

  removeFavorite: async (channelId: string) => {
    const state = get();
    const newFavorites = new Set(state.favorites);
    newFavorites.delete(channelId);
    set({ favorites: newFavorites });
    
    try {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(newFavorites))
      );
    } catch (err) {
      console.error('Failed to remove favorite:', err);
    }
  },

  isFavorite: (channelId: string) => {
    return get().favorites.has(channelId);
  },

  clearFavorites: async () => {
    set({ favorites: new Set() });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error('Failed to clear favorites:', err);
    }
  },
}));
