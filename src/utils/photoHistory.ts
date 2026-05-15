import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY = '@shuashua_photo_history_v1';

/** 24 小时内已浏览过的照片不再进入队列 */
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type HistoryEntry = {
  uri: string;
  viewedAt: number;
};

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/** 清理超过冷却期的记录，减小存储 */
export function pruneHistory(
  entries: HistoryEntry[],
  now: number = Date.now(),
): HistoryEntry[] {
  return entries.filter(e => now - e.viewedAt < COOLDOWN_MS);
}

export function isUriInCooldown(
  uri: string,
  history: HistoryEntry[],
  now: number = Date.now(),
): boolean {
  const e = history.find(h => h.uri === uri);
  if (!e) {
    return false;
  }
  return now - e.viewedAt < COOLDOWN_MS;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
