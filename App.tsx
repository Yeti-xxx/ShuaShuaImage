/**
 * 刷刷照片清理 - 横向分页浏览相册，底部删除
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {CameraRoll} from '@react-native-camera-roll/camera-roll';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COOLDOWN_MS,
  type HistoryEntry,
  isUriInCooldown,
  loadHistory,
  pruneHistory,
  saveHistory,
  shuffle,
  STORAGE_KEY,
} from './src/utils/photoHistory';

const {height: SCREEN_H, width: SCREEN_W} = Dimensions.get('window');

/** 为底部统计卡 + 删除按钮预留高度，避免与照片相框重叠 */
const BOTTOM_UI_RESERVE =
  Platform.OS === 'ios' ? 178 : 118;

const STATS_KEY = '@shuashua_daily_stats_v1';

/** 主题色 */
const theme = {
  bg0: '#020617',
  bg1: '#0f172a',
  bg2: '#1e1b4b',
  accent: '#22d3ee',
  accentSoft: 'rgba(34, 211, 238, 0.35)',
  magenta: '#e879f9',
  glass: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(255, 255, 255, 0.14)',
  dangerA: '#f43f5e',
  dangerB: '#fb923c',
  textMuted: 'rgba(148, 163, 184, 0.95)',
};

type PhotoItem = {uri: string; width: number; height: number};

async function requestAndroidGallery(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const api = Number(Platform.Version);
  const perms: string[] = [];
  if (api >= 33) {
    perms.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
  } else {
    perms.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
  }
  const results = await PermissionsAndroid.requestMultiple(
    perms as (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][],
  );
  return Object.values(results).every(
    r => r === PermissionsAndroid.RESULTS.GRANTED,
  );
}

async function loadDailyDeleted(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) {
      return 0;
    }
    const {date, count} = JSON.parse(raw) as {date: string; count: number};
    const today = new Date().toDateString();
    if (date !== today) {
      return 0;
    }
    return typeof count === 'number' ? count : 0;
  } catch {
    return 0;
  }
}

async function bumpDailyDeleted(): Promise<number> {
  const today = new Date().toDateString();
  const prev = await loadDailyDeleted();
  const next = prev + 1;
  await AsyncStorage.setItem(
    STATS_KEY,
    JSON.stringify({date: today, count: next}),
  );
  return next;
}

function ScreenChrome({children}: {children: React.ReactNode}) {
  return (
    <View style={styles.screenRoot}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />
      <LinearGradient
        colors={[theme.bg0, theme.bg1, theme.bg2]}
        start={{x: 0, y: 0}}
        end={{x: 1, y: 1}}
        style={StyleSheet.absoluteFill}
      />
      {/* 顶部柔光 */}
      <LinearGradient
        colors={['rgba(99, 102, 241, 0.35)', 'transparent']}
        start={{x: 0.5, y: 0}}
        end={{x: 0.5, y: 0.45}}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

export default function App(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [permissionOk, setPermissionOk] = useState(false);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [deletedToday, setDeletedToday] = useState(0);

  const listRef = useRef<FlatList<PhotoItem>>(null);

  const refreshPhotos = useCallback(async () => {
    setLoading(true);
    try {
      let hist = await loadHistory();
      hist = pruneHistory(hist);
      await saveHistory(hist);

      const res = await CameraRoll.getPhotos({
        first: 2000,
        assetType: 'Photos',
      });

      const all: PhotoItem[] = res.edges.map(e => ({
        uri: e.node.image.uri,
        width: e.node.image.width,
        height: e.node.image.height,
      }));

      const now = Date.now();
      const available = all.filter(p => !isUriInCooldown(p.uri, hist, now));
      setPhotos(shuffle(available));
      setCurrentIndex(0);
    } catch (e) {
      console.warn(e);
      Alert.alert('加载失败', '无法读取相册，请检查权限后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const del = await loadDailyDeleted();
      setDeletedToday(del);
      const ok = await requestAndroidGallery();
      setPermissionOk(ok);
      if (ok) {
        await refreshPhotos();
      } else {
        setLoading(false);
      }
    })();
  }, [refreshPhotos]);

  const markViewed = useCallback((uri: string) => {
    queueMicrotask(async () => {
      try {
        let hist: HistoryEntry[] = await loadHistory();
        const filtered = hist.filter(h => h.uri !== uri);
        const next = pruneHistory([
          ...filtered,
          {uri, viewedAt: Date.now()},
        ]);
        await saveHistory(next);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const markViewedRef = useRef(markViewed);
  markViewedRef.current = markViewed;

  const viewabilityConfigCallbackPairs = useRef([
    {
      viewabilityConfig: {itemVisiblePercentThreshold: 70},
      onViewableItemsChanged: ({
        viewableItems,
      }: {
        viewableItems: ViewToken[];
      }) => {
        const first = viewableItems[0];
        const item = first?.item as PhotoItem | undefined;
        if (item?.uri) {
          markViewedRef.current(item.uri);
        }
      },
    },
  ]).current;

  const deleteCurrentPhoto = async () => {
    const p = photos[currentIndex];
    if (!p) {
      return;
    }
    const uri = p.uri;
    try {
      await CameraRoll.deletePhotos([uri]);
      const nextPhotos = photos.filter(x => x.uri !== uri);
      setPhotos(nextPhotos);
      const c = await bumpDailyDeleted();
      setDeletedToday(c);
      if (currentIndex >= nextPhotos.length) {
        setCurrentIndex(Math.max(0, nextPhotos.length - 1));
      }
    } catch (e: unknown) {
      console.warn(e);
      const m =
        e && typeof e === 'object' && 'message' in e
          ? String((e as {message: unknown}).message)
          : String(e);
      const cancelled =
        m.includes('Deletion was not completed') || m.includes('not completed');
      Alert.alert(
        cancelled ? '未删除' : '删除失败',
        cancelled
          ? '请在系统弹出的删除确认里点「允许」；点「拒绝」或关闭则不会删除。'
          : `${m || '请检查相册权限。Android 11+ 删除会走系统确认框。'}`,
      );
    }
  };

  const requestPermissionAgain = async () => {
    const ok = await requestAndroidGallery();
    setPermissionOk(ok);
    if (ok) {
      await refreshPhotos();
    }
  };

  if (!permissionOk && !loading) {
    return (
      <ScreenChrome>
        <View style={styles.center}>
          <LinearGradient
            colors={['rgba(99, 102, 241, 0.45)', 'rgba(219, 39, 119, 0.25)']}
            style={styles.heroRing}>
            <Text style={styles.heroEmoji}>🖼️</Text>
          </LinearGradient>
          <Text style={styles.title}>开启相册权限</Text>
          <Text style={styles.sub}>
            仅在本地浏览与整理照片，不会上传任何内容。
          </Text>
          <Pressable
            style={({pressed}) => [
              styles.primaryBtnWrap,
              pressed && styles.primaryBtnPressed,
            ]}
            onPress={requestPermissionAgain}>
            <LinearGradient
              colors={['#6366f1', '#a855f7', '#ec4899']}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 1}}
              style={styles.primaryBtnGrad}>
              <Text style={styles.primaryBtnText}>授权相册</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScreenChrome>
    );
  }

  if (loading) {
    return (
      <ScreenChrome>
        <View style={styles.center}>
          <View style={styles.loaderRing}>
            <ActivityIndicator size="large" color={theme.accent} />
          </View>
          <Text style={styles.loadingTitle}>正在唤醒相册</Text>
          <Text style={styles.sub}>随机打乱顺序，准备开刷…</Text>
        </View>
      </ScreenChrome>
    );
  }

  const clearHistoryAndRefresh = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await refreshPhotos();
  };

  if (photos.length === 0) {
    return (
      <ScreenChrome>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✨</Text>
          <Text style={styles.title}>队列已空</Text>
          <Text style={styles.sub}>
            可能 {Math.round(COOLDOWN_MS / 3600000)} 小时内都已刷过，或相册里没有更多图。
          </Text>
          <Pressable
            style={({pressed}) => [
              styles.secondaryBtn,
              pressed && {opacity: 0.85},
            ]}
            onPress={refreshPhotos}>
            <Text style={styles.secondaryBtnText}>重新加载</Text>
          </Pressable>
          <Pressable
            style={({pressed}) => [
              styles.ghostBtn,
              pressed && {opacity: 0.85},
            ]}
            onPress={clearHistoryAndRefresh}>
            <Text style={styles.ghostBtnText}>清除浏览记录并重新排队</Text>
          </Pressable>
        </View>
      </ScreenChrome>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />
      <LinearGradient
        colors={[theme.bg0, '#0c1222']}
        style={StyleSheet.absoluteFill}
      />

      <FlatList
        ref={listRef}
        data={photos}
        keyExtractor={item => item.uri}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={SCREEN_W}
        snapToAlignment="start"
        decelerationRate="normal"
        disableIntervalMomentum
        bounces
        overScrollMode="always"
        getItemLayout={(_, index) => ({
          length: SCREEN_W,
          offset: SCREEN_W * index,
          index,
        })}
        onMomentumScrollEnd={e => {
          const x = e.nativeEvent.contentOffset.x;
          const idx = Math.round(x / SCREEN_W);
          setCurrentIndex(Math.min(Math.max(0, idx), photos.length - 1));
        }}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
        renderItem={({item}) => (
          <View
            style={[
              styles.page,
              {width: SCREEN_W, height: SCREEN_H, paddingBottom: BOTTOM_UI_RESERVE},
            ]}>
            <View style={styles.imageFrame}>
              <Image
                source={{uri: item.uri}}
                style={styles.image}
                resizeMode="contain"
              />
            </View>
          </View>
        )}
      />

      {/* 顶部页码胶囊 */}
      <View style={styles.topHud} pointerEvents="none">
        <LinearGradient
          colors={['rgba(2,6,23,0.92)', 'rgba(2,6,23,0.4)', 'transparent']}
          style={styles.topHudGrad}>
          <View style={styles.pagePill}>
            <Text style={styles.pagePillText}>
              <Text style={styles.pagePillNum}>{currentIndex + 1}</Text>
              <Text style={styles.pagePillSlash}> / {photos.length}</Text>
            </Text>
          </View>
        </LinearGradient>
      </View>

      <LinearGradient
        colors={['transparent', 'rgba(2, 6, 23, 0.88)', theme.bg0]}
        locations={[0, 0.35, 1]}
        style={styles.barFade}
        pointerEvents="none"
      />
      <View style={styles.bar}>
        <View style={styles.statsRow}>
          <LinearGradient
            colors={['rgba(99, 102, 241, 0.35)', 'rgba(99, 102, 241, 0.08)']}
            style={styles.statCard}>
            <Text style={styles.statNum}>{photos.length}</Text>
            <Text style={styles.statLabel}>待浏览</Text>
          </LinearGradient>
          <LinearGradient
            colors={['rgba(244, 63, 94, 0.35)', 'rgba(244, 63, 94, 0.08)']}
            style={styles.statCard}>
            <Text style={[styles.statNum, styles.statDel]}>{deletedToday}</Text>
            <Text style={styles.statLabel}>今日已删</Text>
          </LinearGradient>
        </View>

        <Pressable
          style={({pressed}) => [
            styles.delBtnWrap,
            pressed && styles.delBtnPressed,
          ]}
          onPress={deleteCurrentPhoto}>
            <LinearGradient
              colors={[theme.dangerA, theme.dangerB]}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 1}}
              style={styles.delBtnGrad}>
              <Text style={styles.delBtnText}>⚡ 删除当前照片</Text>
            </LinearGradient>
          </Pressable>
        <Text style={styles.hint}>左右滑切换 · 不喜欢的就删掉</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {flex: 1, backgroundColor: theme.bg0},
  root: {flex: 1, backgroundColor: theme.bg0},
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  heroRing: {
    width: 112,
    height: 112,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  heroEmoji: {fontSize: 48},
  loaderRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: theme.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  loadingTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  emptyIcon: {fontSize: 48, marginBottom: 16},
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 12,
    textAlign: 'center',
  },
  sub: {
    color: theme.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 320,
  },
  primaryBtnWrap: {
    marginTop: 32,
    borderRadius: 28,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#a855f7',
        shadowOffset: {width: 0, height: 8},
        shadowOpacity: 0.45,
        shadowRadius: 16,
      },
      android: {elevation: 10},
    }),
  },
  primaryBtnPressed: {opacity: 0.92, transform: [{scale: 0.98}]},
  primaryBtnGrad: {
    paddingHorizontal: 40,
    paddingVertical: 16,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    marginTop: 28,
    backgroundColor: theme.glass,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  secondaryBtnText: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  ghostBtn: {marginTop: 14, paddingVertical: 10, paddingHorizontal: 16},
  ghostBtnText: {color: '#64748b', fontSize: 14},
  page: {
    width: SCREEN_W,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  imageFrame: {
    marginBottom: 12,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.glassBorder,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 12},
        shadowOpacity: 0.45,
        shadowRadius: 24,
      },
      android: {elevation: 6},
    }),
  },
  image: {
    width: SCREEN_W - 32,
    /** 略减高度，配合 paddingBottom 留出与底栏的间隔 */
    height: SCREEN_H * 0.62,
  },
  topHud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8,
    alignItems: 'center',
  },
  topHudGrad: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 24,
  },
  pagePill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  pagePillText: {fontSize: 14},
  pagePillNum: {
    color: theme.accent,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pagePillSlash: {color: '#94a3b8', fontWeight: '600'},
  barFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    maxWidth: 160,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  statNum: {
    color: '#f8fafc',
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statDel: {color: '#fda4af'},
  statLabel: {
    color: theme.textMuted,
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  delBtnWrap: {
    borderRadius: 28,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: theme.dangerA,
        shadowOffset: {width: 0, height: 6},
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: {elevation: 8},
    }),
  },
  delBtnPressed: {opacity: 0.92, transform: [{scale: 0.985}]},
  delBtnGrad: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  delBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
    fontWeight: '500',
  },
});
