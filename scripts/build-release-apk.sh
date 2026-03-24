#!/usr/bin/env bash
# 打 Release APK（内置 JS，可离线安装 / 分享），需 JDK 17
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pick_java17() {
  local p
  if command -v brew &>/dev/null; then
    p="$(brew --prefix openjdk@17 2>/dev/null)" || true
    if [[ -n "$p" && -d "$p/libexec/openjdk.jdk/Contents/Home" ]]; then
      echo "$p/libexec/openjdk.jdk/Contents/Home"
      return 0
    fi
  fi
  if [[ -d "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]]; then
    echo "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  elif [[ -d "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]]; then
    echo "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  elif /usr/libexec/java_home -v 17 &>/dev/null; then
    /usr/libexec/java_home -v 17
  else
    return 1
  fi
}

JAVA17_HOME="$(pick_java17)" || {
  echo "未检测到 JDK 17，无法执行 Gradle。请: brew install openjdk@17"
  exit 1
}

export JAVA_HOME="$JAVA17_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
cd android
./gradlew assembleRelease --no-daemon

OUT="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
mkdir -p "$ROOT/dist"
cp -f "$OUT" "$ROOT/dist/ShuaShua-PhotoClean-release.apk"
echo ""
echo "✓ 安装包已生成（并复制到 dist/ 便于分享）："
ls -lh "$OUT"
ls -lh "$ROOT/dist/ShuaShua-PhotoClean-release.apk"
