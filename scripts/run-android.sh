#!/usr/bin/env bash
# 使用 JDK 17 运行 Android 构建（避免 Gradle 8.0.1 + JDK 21 的 major version 65 错误）
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
  echo "未检测到 JDK 17。请先安装，例如："
  echo "  brew install openjdk@17"
  echo "然后执行（Apple Silicon 常见路径）："
  echo "  export JAVA_HOME=\"/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home\""
  exit 1
}

export JAVA_HOME="$JAVA17_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version

# 必须直接调 CLI，不能 npm run android（否则会递归）
exec npx react-native run-android "$@"
