#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGES_DIR = path.resolve(ROOT_DIR, 'test-results', 'images');
const VIDEO_DIR = path.resolve(ROOT_DIR, 'test-results', 'video');

// Ensure destination media directories exist
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

console.log('='.repeat(70));
console.log('🏸 CamArena Playwright Automated Test & Media Capture Runner');
console.log('='.repeat(70));
console.log(`📁 Target Screenshots Directory : ${IMAGES_DIR}`);
console.log(`🎥 Target Videos Directory      : ${VIDEO_DIR}`);
console.log('='.repeat(70));

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

const args = ['playwright', 'test', ...process.argv.slice(2)];

console.log(`🚀 Executing: ${npxCmd} ${args.join(' ')}\n`);

const child = spawn(npxCmd, args, {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  shell: isWindows
});

child.on('close', (code) => {
  console.log('\n' + '='.repeat(70));
  console.log('📊 Media Capture Summary');
  console.log('='.repeat(70));

  // 1. Inspect Screenshots
  const images = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
  if (images.length > 0) {
    console.log(`📸 Screenshots Captured (${images.length}):`);
    images.forEach(img => {
      const p = path.join(IMAGES_DIR, img);
      const stat = fs.statSync(p);
      const sizeKb = (stat.size / 1024).toFixed(1);
      console.log(`   • ${img.padEnd(35)} [${sizeKb} KB] -> ${p}`);
    });
  } else {
    console.log('⚠️  No screenshots found in test/images.');
  }

  // 2. Check for any video files in test-results and copy to test/video if none exists
  const testResultsDir = path.resolve(ROOT_DIR, 'test-results');
  const existingVideos = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm') || f.endsWith('.mp4'));
  if (existingVideos.length === 0 && fs.existsSync(testResultsDir)) {
    const scanDir = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.webm') || entry.name.endsWith('.mp4')) {
          const dest = path.join(VIDEO_DIR, 'camarena-gameplay-tour.webm');
          if (!fs.existsSync(dest)) {
            try {
              fs.copyFileSync(fullPath, dest);
            } catch (e) {
              // ignore
            }
          }
        }
      }
    };
    scanDir(testResultsDir);
  }

  // 3. Inspect Videos
  const videos = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm') || f.endsWith('.mp4'));
  if (videos.length > 0) {
    console.log(`\n🎥 Videos Recorded (${videos.length}):`);
    videos.forEach(vid => {
      const p = path.join(VIDEO_DIR, vid);
      const stat = fs.statSync(p);
      const sizeKb = (stat.size / 1024).toFixed(1);
      console.log(`   • ${vid.padEnd(35)} [${sizeKb} KB] -> ${p}`);
    });
  } else {
    console.log('⚠️  No video files found in test/video.');
  }

  console.log('='.repeat(70));
  if (code === 0) {
    console.log('✅ Playwright test suite completed successfully!');
  } else {
    console.log(`❌ Playwright test suite exited with code ${code}`);
  }
  console.log('='.repeat(70) + '\n');

  process.exit(code ?? 0);
});
