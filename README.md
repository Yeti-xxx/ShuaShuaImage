# 刷刷照片清理

像刷图库一样**左右滑动**分页浏览相册，底部一键删除；随机顺序展示，**24 小时内已看过的照片不会再次出现**（本地记录，不上传）。

**Android 删除说明**：依赖 `@react-native-camera-roll/camera-roll` 7.10+ 后，删除使用系统 `MediaStore` 接口。**Android 11（API 30）及以上**会弹出**系统级**删除确认框（不是 App 内二次确认），需在弹窗里点「允许」才会真正从相册移除；若点「拒绝」则不会删除。

## 环境要求

- Node.js >= 16
- **构建 Android 时请使用 JDK 17**（见下文「JDK / Gradle」）
- Android SDK、已开启 USB 调试的真机或模拟器

## 安装依赖

```bash
npm install
```

## 运行 Android

**请先确认本机已安装 JDK 17**（仅有 JDK 21 不够）。终端执行：

```bash
/usr/libexec/java_home -V
```

列表里必须有 **17**。若没有：

```bash
brew install openjdk@17
```

**推荐用脚本**（自动找 Homebrew 的 17 并校验版本）：

```bash
chmod +x scripts/run-android.sh   # 只需一次
# 终端 1
npm start
# 终端 2
./scripts/run-android.sh
```

或手动指定路径（Apple Silicon 常见）：

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
"$JAVA_HOME/bin/java" -version   # 必须显示 17.x，不要只看 `java -version`（PATH 里可能是 21）
npm run android
```

若 `export JAVA_HOME=$(/usr/libexec/java_home -v 17)` 之后 **`java -version` 仍是 21**，说明 **没装 17** 或 PATH 里仍是别的 `java`；请以 **`$JAVA_HOME/bin/java -version`** 为准，或在 `android/gradle.properties` 里取消注释并填写 `org.gradle.java.home=...`（见文件末尾说明）。

`npm run android` **已默认**通过 `scripts/run-android.sh` 使用 JDK 17（与 `android:jdk17` 相同）。若未安装 openjdk@17，脚本会提示安装命令。

### JDK / Gradle（重要）

React Native **0.72** 固定搭配 **Gradle 8.0.1**。请按下面二选一，否则容易报错：

| 现象 | 原因 | 处理 |
|------|------|------|
| `Unsupported class file major version 65` | 用 **JDK 21** 跑 **Gradle 8.0** | 安装并用 **JDK 17**（见上） |
| `Kotlin ... metadata is 1.9.0, expected 1.7.1` | 把 Gradle 升到 **8.7** 等，与 RN 插件 Kotlin 版本冲突 | **不要**升 Gradle，保持仓库里的 **8.0.1** |

若曾试过 Gradle 8.7，建议清缓存后再编：

```bash
cd android && ./gradlew --stop
rm -rf ~/.gradle/caches/8.7-all ~/.gradle/wrapper/dists/*gradle-8.7*
```

### Gradle 下载超时

已配置 **腾讯云 Gradle 镜像** 与较长 `networkTimeout`（见 `android/gradle/wrapper/gradle-wrapper.properties`）。若仍失败：

1. 多试几次 `npm run android`，或用手机热点。
2. 浏览器下载同版本 zip 后放入 Gradle 缓存目录（与报错中的 `wrapper/dists` 路径一致），再重试构建。
3. 将 `distributionUrl` 改为官方（需能访问外网或代理），例如：  
   `https://services.gradle.org/distributions/gradle-8.0.1-all.zip`

## 热更新（USB）

```bash
adb reverse tcp:8081 tcp:8081
```

应用内 Metro 使用本机 `8081` 端口即可。

## 技术说明

- React Native **0.72.17**（CLI，无 Expo）
- 相册：`@react-native-camera-roll/camera-roll`
- 本地记录：`@react-native-async-storage/async-storage`
- 列表：竖向 `FlatList` + `pagingEnabled`（不依赖 Reanimated）

## 权限（Android）

已在 `android/app/src/main/AndroidManifest.xml` 声明 `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE`（按系统版本）。

## 界面与应用图标

- 主界面使用 **渐变背景、玻璃态统计卡、霓虹风删除按钮** 与顶部 **页码胶囊**，依赖 `react-native-linear-gradient`（**重新编译** Android / iOS 原生工程后生效）。
- **应用图标**由 `scripts/generate-app-icons.mjs` 从矢量风格 SVG 生成（紫粉渐变 + 相框与动感线条）。修改脚本内 SVG 后执行：
  ```bash
  npm run icons
  ```
  会更新各 `mipmap-*` 与 `ios/.../AppIcon.appiconset` 下的 PNG 及 `Contents.json`。

### iOS 额外步骤

安装依赖后请在 `ios` 目录执行一次：

```bash
cd ios && pod install && cd ..
```

若 CocoaPods 报编码错误，可先执行 `export LANG=en_US.UTF-8` 再 `pod install`。

## 生成可分享的 Android 安装包（Release APK）

内置 JS 与 Hermes，**无需 Metro**，可发文件给好友侧载安装。

```bash
npm run android:apk
```

成功后：

- 标准路径：`android/app/build/outputs/apk/release/app-release.apk`
- 便于查找的副本：`dist/ShuaShua-PhotoClean-release.apk`

**说明**：当前 `release` 仍使用项目里的 **debug 签名**（与 RN 模板一致），适合自用与熟人安装；上架应用商店需自行配置正式 `release` 签名。

安装方手机需允许「安装未知来源应用」；部分系统会提示风险，属侧载正常现象。

## 测试

```bash
npm test
```

## 许可

见 [LEGAL.md](LEGAL.md)。
