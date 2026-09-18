// server/scripts/postbuild.mjs
// tsc 后处理（rootDir=.. → 产物在 dist/server/* 与 dist/shared/*）：
//   1. 把产物平铺到 dist/（用户期望 node dist/index.js 直接跑）
//   2. 复制 .env 与 runtime-config.json 到 dist/（仅当 dist 里没有）
//   3. 创建 dist/data/（首次运行）
import { copyFileSync, cpSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');       // server/
const REPO = resolve(ROOT, '..');       // AI_comic/
const DIST = join(ROOT, 'dist');
const SHARED_SRC = join(REPO, 'shared');
const ENV_FILE = join(REPO, '.env');
const RUNTIME_CONFIG = join(ROOT, 'runtime-config.json');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// tsc 产物在 dist/server/ 与 dist/shared/。把它们的内容平铺到 dist/。
const distServer = join(DIST, 'server');
if (existsSync(distServer)) {
  for (const entry of readdirSync(distServer)) {
    const from = join(distServer, entry);
    const to = join(DIST, entry);
    rmSync(to, { recursive: true, force: true });
    if (statSync(from).isDirectory()) {
      cpSync(from, to, { recursive: true });
    } else {
      copyFileSync(from, to);
    }
  }
  // 移除原嵌套目录
  rmSync(distServer, { recursive: true, force: true });
  console.log('[postbuild] flattened dist/server/* → dist/*');
}

// shared/ 同样处理
const distShared = join(DIST, 'shared');
if (existsSync(distShared)) {
  for (const entry of readdirSync(distShared)) {
    copyFileSync(join(distShared, entry), join(DIST, entry));
  }
  rmSync(distShared, { recursive: true, force: true });
  console.log('[postbuild] flattened dist/shared/* → dist/*');
}

// .env 与 runtime-config.json 默认从仓库根 / server 目录拷贝
const distEnv = join(DIST, '.env');
if (!existsSync(distEnv) && existsSync(ENV_FILE)) {
  copyFileSync(ENV_FILE, distEnv);
  console.log(`[postbuild] .env copied to ${distEnv}`);
}
const distRuntime = join(DIST, 'runtime-config.json');
if (!existsSync(distRuntime) && existsSync(RUNTIME_CONFIG)) {
  copyFileSync(RUNTIME_CONFIG, distRuntime);
  console.log(`[postbuild] runtime-config.json copied to ${distRuntime}`);
}

// data/ 目录（图片落盘用）
ensureDir(join(DIST, 'data'));

console.log('[postbuild] done');