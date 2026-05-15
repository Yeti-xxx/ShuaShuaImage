import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Video from 'react-native-video';

const {width: SCREEN_W, height: SCREEN_H} = Dimensions.get('window');

type VideoPlayerProps = {
  uri: string;
  isVisible: boolean;
  duration: number;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({
  uri,
  isVisible,
  duration: durationProp,
}: VideoPlayerProps): JSX.Element {
  const videoRef = useRef<any>(null);
  const [paused, setPaused] = useState(!isVisible);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [duration, setDuration] = useState(durationProp);
  const seeking = useRef(false);
  const trackWidth = useRef(0);

  useEffect(() => {
    setPaused(!isVisible);
    if (isVisible) {
      setProgress(0);
    }
  }, [isVisible]);

  const handleProgress = (e: {currentTime: number}) => {
    if (!seeking.current) {
      setProgress(e.currentTime);
    }
  };

  const handleEnd = () => {
    videoRef.current?.seek(0);
    setProgress(0);
  };

  const handleLoad = (e: {duration: number}) => {
    setLoaded(true);
    if (e.duration > 0 && duration <= 0) {
      setDuration(e.duration);
    }
  };

  const handleError = () => {
    setError(true);
  };

  const seekToX = (x: number) => {
    if (duration <= 0 || trackWidth.current <= 0) {
      return;
    }
    const fraction = Math.max(0, Math.min(1, x / trackWidth.current));
    const targetTime = fraction * duration;
    videoRef.current?.seek(targetTime);
    setProgress(targetTime);
  };

  const videoW = SCREEN_W - 32;
  const videoH = SCREEN_H * 0.62;

  if (error) {
    return (
      <View style={[styles.container, {width: videoW, height: videoH}]}>
        <Text style={styles.errorText}>视频无法播放</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, {width: videoW, height: videoH}]}>
      <Video
        ref={videoRef}
        source={{uri}}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        paused={paused}
        muted={muted}
        repeat
        onProgress={handleProgress}
        onEnd={handleEnd}
        onLoad={handleLoad}
        onError={handleError}
      />

      {!loaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#22d3ee" />
        </View>
      )}

      {/* 静音切换 */}
      <Pressable
        style={styles.muteBtn}
        onPress={() => setMuted(v => !v)}>
        <Text style={styles.muteIcon}>{muted ? '🔇' : '🔊'}</Text>
      </Pressable>

      {/* 底部进度条 + 时间 */}
      {loaded && duration > 0 && (
        <View
          style={styles.bottomBar}
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}>
          <Text style={styles.timeText}>{formatTime(progress)}</Text>
          <View
            style={styles.seekTrack}
            onLayout={e => {
              trackWidth.current = e.nativeEvent.layout.width;
            }}
            onTouchStart={e => {
              seeking.current = true;
              seekToX(e.nativeEvent.locationX);
            }}
            onTouchMove={e => {
              seekToX(e.nativeEvent.locationX);
            }}
            onTouchEnd={() => {
              seeking.current = false;
            }}>
            <View
              style={[
                styles.seekFill,
                {width: `${Math.min(100, (progress / duration) * 100)}%`},
              ]}
            />
          </View>
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    overflow: 'hidden',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  errorText: {
    color: '#94a3b8',
    fontSize: 16,
    textAlign: 'center',
  },
  muteBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  muteIcon: {
    fontSize: 16,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  timeText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    width: 38,
  },
  seekTrack: {
    flex: 1,
    height: 20,
    justifyContent: 'center',
    marginHorizontal: 6,
  },
  seekFill: {
    height: 3,
    backgroundColor: '#22d3ee',
    borderRadius: 2,
  },
});
