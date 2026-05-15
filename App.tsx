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
import VideoPlayer from './src/components/VideoPlayer';
import {NativeModules} from 'react-native';

const {height: SCREEN_H, width: SCREEN_W} = Dimensions.get('window');

/** 为底部统计卡 + 分享/删除按钮预留高度，避免与照片相框重叠 */
const BOTTOM_UI_RESERVE =
  Platform.OS === 'ios' ? 154 : 112;

const TOP_UI_RESERVE =
  Platform.OS === 'ios' ? 116 : (StatusBar.currentHeight ?? 24) + 72;

const STATS_KEY = '@shuashua_daily_stats_v1';
const VIEW_STATS_KEY = '@shuashua_daily_view_stats_v1';
const DAILY_SESSION_KEY = '@shuashua_daily_session_v1';
const DAILY_IMAGE_LIMIT = 1000;
const DAILY_VIDEO_LIMIT = 100;

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

type MediaItem = {
  uri: string;
  filepath: string | null;
  width: number;
  height: number;
  type: 'image' | 'video';
  duration: number;
};

type MediaMode = 'image' | 'video';

type DailyViewStats = {
  image: number;
  video: number;
};

type DailySession = {
  date: string;
  imageQueue: MediaItem[];
  videoQueue: MediaItem[];
  imageIndex: number;
  videoIndex: number;
};

async function requestAndroidGallery(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const api = Number(Platform.Version);
  const perms: string[] = [];
  if (api >= 33) {
    perms.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    perms.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
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

async function loadDailyViewed(): Promise<DailyViewStats> {
  try {
    const raw = await AsyncStorage.getItem(VIEW_STATS_KEY);
    if (!raw) {
      return {image: 0, video: 0};
    }
    const {date, image, video} = JSON.parse(raw) as {
      date: string;
      image: number;
      video: number;
    };
    if (date !== new Date().toDateString()) {
      return {image: 0, video: 0};
    }
    return {
      image: typeof image === 'number' ? image : 0,
      video: typeof video === 'number' ? video : 0,
    };
  } catch {
    return {image: 0, video: 0};
  }
}

async function bumpDailyViewed(type: MediaMode): Promise<DailyViewStats> {
  const prev = await loadDailyViewed();
  const next = {...prev, [type]: prev[type] + 1};
  await AsyncStorage.setItem(
    VIEW_STATS_KEY,
    JSON.stringify({date: new Date().toDateString(), ...next}),
  );
  return next;
}

function todayKey(): string {
  return new Date().toDateString();
}

function emptyDailySession(): DailySession {
  return {
    date: todayKey(),
    imageQueue: [],
    videoQueue: [],
    imageIndex: 0,
    videoIndex: 0,
  };
}

async function loadDailySession(): Promise<DailySession | null> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DailySession;
    if (
      parsed.date !== todayKey() ||
      !Array.isArray(parsed.imageQueue) ||
      !Array.isArray(parsed.videoQueue)
    ) {
      return null;
    }
    return {
      ...parsed,
      imageIndex:
        typeof parsed.imageIndex === 'number' ? parsed.imageIndex : 0,
      videoIndex:
        typeof parsed.videoIndex === 'number' ? parsed.videoIndex : 0,
    };
  } catch {
    return null;
  }
}

async function saveDailySession(session: DailySession): Promise<void> {
  await AsyncStorage.setItem(DAILY_SESSION_KEY, JSON.stringify(session));
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
  const [mediaMode, setMediaMode] = useState<MediaMode>('image');
  const [allMedia, setAllMedia] = useState<MediaItem[]>([]);
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewableIndex, setViewableIndex] = useState(0);
  const [deletedToday, setDeletedToday] = useState(0);
  const [viewedToday, setViewedToday] = useState<DailyViewStats>({
    image: 0,
    video: 0,
  });
  const [dailySession, setDailySession] = useState<DailySession | null>(null);

  const listRef = useRef<FlatList<MediaItem>>(null);
  const mediaModeRef = useRef<MediaMode>(mediaMode);
  mediaModeRef.current = mediaMode;

  const updateDailySession = useCallback(
    (updater: (prev: DailySession) => DailySession) => {
      setDailySession(prev => {
        if (!prev) {
          return prev;
        }
        const next = updater(prev);
        queueMicrotask(() => {
          saveDailySession(next).catch(() => {
            /* ignore */
          });
        });
        return next;
      });
    },
    [],
  );

  const refreshPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const existingSession = await loadDailySession();
      if (existingSession) {
        const restoredAll = [
          ...existingSession.imageQueue,
          ...existingSession.videoQueue,
        ];
        const restoredIndex =
          mediaModeRef.current === 'image'
            ? existingSession.imageIndex
            : existingSession.videoIndex;
        const restoredPhotos =
          mediaModeRef.current === 'image'
            ? existingSession.imageQueue
            : existingSession.videoQueue;
        const safeIndex = Math.min(
          Math.max(0, restoredIndex),
          Math.max(0, restoredPhotos.length - 1),
        );
        setDailySession(existingSession);
        setAllMedia(restoredAll);
        setPhotos(restoredPhotos);
        setCurrentIndex(safeIndex);
        setViewableIndex(safeIndex);
        requestAnimationFrame(() => {
          if (restoredPhotos.length > 0) {
            listRef.current?.scrollToIndex({index: safeIndex, animated: false});
          } else {
            listRef.current?.scrollToOffset({offset: 0, animated: false});
          }
        });
        return;
      }

      let hist = await loadHistory();
      hist = pruneHistory(hist);
      await saveHistory(hist);

      const res = await CameraRoll.getPhotos({
        first: DAILY_IMAGE_LIMIT + DAILY_VIDEO_LIMIT + 1000,
        assetType: 'All',
      });

      const all: MediaItem[] = res.edges.map(e => {
        const isVideo = e.node.type.includes('video');
        return {
          uri: e.node.image.uri,
          filepath: e.node.image.filepath,
          width: e.node.image.width,
          height: e.node.image.height,
          type: isVideo ? 'video' : 'image',
          duration: isVideo ? e.node.image.playableDuration : 0,
        };
      });

      const now = Date.now();
      const available = all.filter(p => !isUriInCooldown(p.uri, hist, now));
      const nextSession: DailySession = {
        ...emptyDailySession(),
        imageQueue: shuffle(available.filter(p => p.type === 'image')).slice(
          0,
          DAILY_IMAGE_LIMIT,
        ),
        videoQueue: shuffle(available.filter(p => p.type === 'video')).slice(
          0,
          DAILY_VIDEO_LIMIT,
        ),
      };
      await saveDailySession(nextSession);
      const nextAll = [...nextSession.imageQueue, ...nextSession.videoQueue];
      const nextPhotos =
        mediaModeRef.current === 'image'
          ? nextSession.imageQueue
          : nextSession.videoQueue;
      setDailySession(nextSession);
      setAllMedia(nextAll);
      setPhotos(nextPhotos);
      setCurrentIndex(0);
      setViewableIndex(0);
      listRef.current?.scrollToOffset({offset: 0, animated: false});
    } catch (e) {
      console.warn(e);
      Alert.alert('加载失败', '无法读取相册，请检查权限后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  const switchMediaMode = useCallback(
    (nextMode: MediaMode) => {
      mediaModeRef.current = nextMode;
      setMediaMode(nextMode);
      const nextPhotos =
        nextMode === 'image'
          ? dailySession?.imageQueue ?? []
          : dailySession?.videoQueue ?? [];
      const nextIndex =
        nextMode === 'image'
          ? dailySession?.imageIndex ?? 0
          : dailySession?.videoIndex ?? 0;
      const safeIndex = Math.min(
        Math.max(0, nextIndex),
        Math.max(0, nextPhotos.length - 1),
      );
      setPhotos(nextPhotos);
      setCurrentIndex(safeIndex);
      setViewableIndex(safeIndex);
      requestAnimationFrame(() => {
        if (nextPhotos.length > 0) {
          listRef.current?.scrollToIndex({index: safeIndex, animated: false});
        } else {
          listRef.current?.scrollToOffset({offset: 0, animated: false});
        }
      });
    },
    [dailySession],
  );

  useEffect(() => {
    (async () => {
      const del = await loadDailyDeleted();
      setDeletedToday(del);
      const viewed = await loadDailyViewed();
      setViewedToday(viewed);
      const ok = await requestAndroidGallery();
      setPermissionOk(ok);
      if (ok) {
        await refreshPhotos();
      } else {
        setLoading(false);
      }
    })();
  }, [refreshPhotos]);

  const markViewed = useCallback((item: MediaItem) => {
    queueMicrotask(async () => {
      try {
        let hist: HistoryEntry[] = await loadHistory();
        if (hist.some(h => h.uri === item.uri)) {
          return;
        }
        const filtered = hist.filter(h => h.uri !== item.uri);
        const next = pruneHistory([
          ...filtered,
          {uri: item.uri, viewedAt: Date.now()},
        ]);
        await saveHistory(next);
        const viewed = await bumpDailyViewed(item.type);
        setViewedToday(viewed);
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
        if (first?.index != null) {
          setViewableIndex(first.index);
        }
        const item = first?.item as MediaItem | undefined;
        if (item?.uri) {
          markViewedRef.current(item);
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
      const nextIndex = Math.min(
        currentIndex,
        Math.max(0, nextPhotos.length - 1),
      );
      setAllMedia(prev => prev.filter(x => x.uri !== uri));
      setPhotos(nextPhotos);
      updateDailySession(prev => ({
        ...prev,
        imageQueue:
          p.type === 'image'
            ? prev.imageQueue.filter(x => x.uri !== uri)
            : prev.imageQueue,
        videoQueue:
          p.type === 'video'
            ? prev.videoQueue.filter(x => x.uri !== uri)
            : prev.videoQueue,
        imageIndex: p.type === 'image' ? nextIndex : prev.imageIndex,
        videoIndex: p.type === 'video' ? nextIndex : prev.videoIndex,
      }));
      const c = await bumpDailyDeleted();
      setDeletedToday(c);
      if (currentIndex >= nextPhotos.length) {
        setCurrentIndex(nextIndex);
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

  const shareCurrentMedia = async () => {
    const p = photos[currentIndex];
    if (!p) {
      return;
    }
    try {
      await NativeModules.NativeShare.share(
        p.uri,
        p.type === 'video' ? 'video/mp4' : 'image/jpeg',
      );
    } catch (e: any) {
      Alert.alert('分享失败', String(e?.message || '未知错误'));
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
    await AsyncStorage.removeItem(VIEW_STATS_KEY);
    await AsyncStorage.removeItem(DAILY_SESSION_KEY);
    setViewedToday({image: 0, video: 0});
    setDailySession(null);
    await refreshPhotos();
  };

  const currentLimit =
    mediaMode === 'image' ? DAILY_IMAGE_LIMIT : DAILY_VIDEO_LIMIT;
  const currentViewed = viewedToday[mediaMode];
  const renderModeTabs = () => (
    <View style={styles.modeTabs}>
      <Pressable
        style={[
          styles.modeTab,
          mediaMode === 'image' && styles.modeTabActive,
        ]}
        onPress={() => switchMediaMode('image')}>
        <Text
          style={[
            styles.modeTabText,
            mediaMode === 'image' && styles.modeTabTextActive,
          ]}>
          图片
        </Text>
      </Pressable>
      <Pressable
        style={[
          styles.modeTab,
          mediaMode === 'video' && styles.modeTabActive,
        ]}
        onPress={() => switchMediaMode('video')}>
        <Text
          style={[
            styles.modeTabText,
            mediaMode === 'video' && styles.modeTabTextActive,
          ]}>
          视频
        </Text>
      </Pressable>
    </View>
  );

  if (photos.length === 0 && allMedia.length === 0) {
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

      <View style={styles.topHud} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(2,6,23,0.94)', 'rgba(2,6,23,0.62)']}
          style={styles.topHudGrad}>
          {renderModeTabs()}
        </LinearGradient>
      </View>

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
        ListEmptyComponent={
          <View
            style={[
              styles.page,
              {width: SCREEN_W, height: SCREEN_H - TOP_UI_RESERVE},
            ]}>
            <Text style={styles.title}>
              {mediaMode === 'image' ? '暂无图片' : '暂无视频'}
            </Text>
            <Text style={styles.sub}>可以点击上方切换另一类内容</Text>
          </View>
        }
        getItemLayout={(_, index) => ({
          length: SCREEN_W,
          offset: SCREEN_W * index,
          index,
        })}
        onMomentumScrollEnd={e => {
          const x = e.nativeEvent.contentOffset.x;
          const idx = Math.round(x / SCREEN_W);
          const nextIndex = Math.min(Math.max(0, idx), photos.length - 1);
          setCurrentIndex(nextIndex);
          updateDailySession(prev => ({
            ...prev,
            imageIndex:
              mediaModeRef.current === 'image'
                ? nextIndex
                : prev.imageIndex,
            videoIndex:
              mediaModeRef.current === 'video'
                ? nextIndex
                : prev.videoIndex,
          }));
        }}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
        renderItem={({item, index}) => (
          <View
            style={[
              styles.page,
              {
                width: SCREEN_W,
                height: SCREEN_H - TOP_UI_RESERVE,
                paddingBottom: BOTTOM_UI_RESERVE,
              },
            ]}>
            <View style={styles.imageFrame}>
              <View style={styles.pagePillOverlay} pointerEvents="none">
                <View style={styles.pagePill}>
                  <Text style={styles.pagePillText}>
                    <Text style={styles.pagePillNum}>
                      {photos.length ? currentIndex + 1 : 0}
                    </Text>
                    <Text style={styles.pagePillSlash}> / {photos.length}</Text>
                  </Text>
                </View>
              </View>
              {item.type === 'video' ? (
                <VideoPlayer
                  uri={item.uri}
                  isVisible={index === viewableIndex}
                  duration={item.duration}
                />
              ) : (
                <Image
                  source={{uri: item.uri}}
                  style={styles.image}
                  resizeMode="contain"
                />
              )}
            </View>
          </View>
        )}
      />

      {/* 顶部页码胶囊 */}
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
            <Text style={styles.statNum}>
              {currentViewed}/{currentLimit}
            </Text>
            <Text style={styles.statLabel}>待浏览</Text>
          </LinearGradient>
          <LinearGradient
            colors={['rgba(244, 63, 94, 0.35)', 'rgba(244, 63, 94, 0.08)']}
            style={styles.statCard}>
            <Text style={[styles.statNum, styles.statDel]}>{deletedToday}</Text>
            <Text style={styles.statLabel}>今日已删</Text>
          </LinearGradient>
        </View>

        <View style={styles.actionRow}>
        <Pressable
          style={({pressed}) => [
            styles.shareBtnWrap,
            pressed && styles.shareBtnPressed,
          ]}
          onPress={shareCurrentMedia}>
          <LinearGradient
            colors={['#6366f1', theme.accent]}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 1}}
            style={styles.shareBtnGrad}>
            <Text style={styles.shareBtnText}>📤 分享</Text>
          </LinearGradient>
        </Pressable>

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
              <Text style={styles.delBtnText}>
                ⚡ 删除当前{photos[currentIndex]?.type === 'video' ? '视频' : '照片'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
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
    marginBottom: 18,
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
    position: 'relative',
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
    height: SCREEN_H * 0.6,
  },
  topHud: {
    paddingTop: Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight ?? 24) + 8,
    alignItems: 'center',
  },
  topHudGrad: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 0,
  },
  modeTabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    marginBottom: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  modeTab: {
    minWidth: 104,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.22)',
    borderWidth: 1,
    borderColor: theme.accentSoft,
  },
  modeTabText: {
    color: theme.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  modeTabTextActive: {
    color: '#f8fafc',
  },
  pagePill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  pagePillText: {fontSize: 12},
  pagePillNum: {
    color: theme.accent,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  pagePillSlash: {color: '#94a3b8', fontWeight: '600'},
  pagePillOverlay: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    zIndex: 2,
    alignItems: 'center',
  },
  barFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 178,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 30,
  },
  statCard: {
    flex: 1,
    maxWidth: 160,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.glassBorder,
  },
  statNum: {
    color: '#f8fafc',
    fontSize: 22,
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
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 7,
  },
  shareBtnWrap: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#6366f1',
        shadowOffset: {width: 0, height: 4},
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {elevation: 6},
    }),
  },
  shareBtnPressed: {opacity: 0.92, transform: [{scale: 0.985}]},
  shareBtnGrad: {
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  delBtnWrap: {
    flex: 1.35,
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
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '500',
  },
});
