/**
 * 从内联 SVG 生成 Android mipmap 与 iOS AppIcon PNG（需 devDependency: sharp）
 * 运行: node scripts/generate-app-icons.mjs
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="8%" y1="0%" x2="92%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="45%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#db2777"/>
    </linearGradient>
    <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <rect x="96" y="96" width="832" height="832" rx="180" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="4"/>
  <!-- 相框 -->
  <rect x="232" y="208" width="560" height="480" rx="40" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.55)" stroke-width="20"/>
  <circle cx="512" cy="360" r="88" fill="rgba(255,255,255,0.22)"/>
  <path d="M 268 592 L 392 472 L 520 568 L 656 428 L 756 592 L 756 656 L 268 656 Z" fill="rgba(255,255,255,0.18)"/>
  <!-- 「刷刷」动感弧线 + 亮点 -->
  <path d="M 664 736 C 780 680 860 560 848 400" stroke="#22d3ee" stroke-width="28" stroke-linecap="round" fill="none" opacity="0.95"/>
  <path d="M 700 700 L 820 620" stroke="#fbbf24" stroke-width="20" stroke-linecap="round" opacity="0.85"/>
  <circle cx="848" cy="392" r="36" fill="#f0abfc" opacity="0.95"/>
  <ellipse cx="512" cy="120" rx="200" ry="24" fill="url(#shine)" opacity="0.6"/>
</svg>`;

async function toPng(size) {
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}

async function main() {
  const androidMap = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192],
  ];

  for (const [folder, size] of androidMap) {
    const dir = path.join(root, 'android/app/src/main/res', folder);
    const buf = await toPng(size);
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), buf);
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), buf);
    console.log('wrote', folder, size);
  }

  const iosDir = path.join(
    root,
    'ios/ShuaShuaImageClearnInit/Images.xcassets/AppIcon.appiconset',
  );
  const iosSizes = [
    ['Icon-20@2x.png', 40],
    ['Icon-20@3x.png', 60],
    ['Icon-29@2x.png', 58],
    ['Icon-29@3x.png', 87],
    ['Icon-40@2x.png', 80],
    ['Icon-40@3x.png', 120],
    ['Icon-60@2x.png', 120],
    ['Icon-60@3x.png', 180],
    ['Icon-1024.png', 1024],
  ];

  for (const [name, size] of iosSizes) {
    fs.writeFileSync(path.join(iosDir, name), await toPng(size));
    console.log('wrote ios', name);
  }

  const contents = {
    images: [
      {
        filename: 'Icon-20@2x.png',
        idiom: 'iphone',
        scale: '2x',
        size: '20x20',
      },
      {
        filename: 'Icon-20@3x.png',
        idiom: 'iphone',
        scale: '3x',
        size: '20x20',
      },
      {
        filename: 'Icon-29@2x.png',
        idiom: 'iphone',
        scale: '2x',
        size: '29x29',
      },
      {
        filename: 'Icon-29@3x.png',
        idiom: 'iphone',
        scale: '3x',
        size: '29x29',
      },
      {
        filename: 'Icon-40@2x.png',
        idiom: 'iphone',
        scale: '2x',
        size: '40x40',
      },
      {
        filename: 'Icon-40@3x.png',
        idiom: 'iphone',
        scale: '3x',
        size: '40x40',
      },
      {
        filename: 'Icon-60@2x.png',
        idiom: 'iphone',
        scale: '2x',
        size: '60x60',
      },
      {
        filename: 'Icon-60@3x.png',
        idiom: 'iphone',
        scale: '3x',
        size: '60x60',
      },
      {
        filename: 'Icon-1024.png',
        idiom: 'ios-marketing',
        scale: '1x',
        size: '1024x1024',
      },
    ],
    info: {author: 'xcode', version: 1},
  };

  fs.writeFileSync(
    path.join(iosDir, 'Contents.json'),
    JSON.stringify(contents, null, 2) + '\n',
  );
  console.log('updated Contents.json');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
