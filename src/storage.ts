import type { Menu, Params } from './types';

// 端末内 (localStorage) に保存。サーバー不要で運用費 0。
// 例外（プライベートモード等）でもアプリが落ちないよう try/catch で包む。

const FAV_KEY = 'swimmenu.favorites.v1';
const PARAMS_KEY = 'swimmenu.params.v1';

export interface Favorite {
  id: string;
  name: string;
  savedAt: string; // ISO
  menu: Menu;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadFavorites = (): Favorite[] => read<Favorite[]>(FAV_KEY, []);
export const saveFavorites = (list: Favorite[]) => write(FAV_KEY, list);

export function addFavorite(menu: Menu, name: string): Favorite {
  const fav: Favorite = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    savedAt: new Date().toISOString(),
    menu: structuredClone(menu),
  };
  saveFavorites([fav, ...loadFavorites()]);
  return fav;
}

export function removeFavorite(id: string) {
  saveFavorites(loadFavorites().filter((f) => f.id !== id));
}

export function renameFavorite(id: string, name: string) {
  saveFavorites(loadFavorites().map((f) => (f.id === id ? { ...f, name } : f)));
}

/** 同じシード+パラメータのメニューが保存済みか */
export function findFavorite(menu: Menu): Favorite | undefined {
  const key = JSON.stringify([menu.seed, menu.params]);
  return loadFavorites().find((f) => JSON.stringify([f.menu.seed, f.menu.params]) === key);
}

export function importFavorites(json: string): number {
  const data = JSON.parse(json) as Favorite[];
  if (!Array.isArray(data)) throw new Error('形式が正しくありません');
  const current = loadFavorites();
  const ids = new Set(current.map((f) => f.id));
  const added = data.filter((f) => f && f.id && f.menu && !ids.has(f.id));
  saveFavorites([...added, ...current]);
  return added.length;
}

export const loadParams = (): Partial<Params> => read<Partial<Params>>(PARAMS_KEY, {});
export const saveParams = (p: Params) => write(PARAMS_KEY, p);
