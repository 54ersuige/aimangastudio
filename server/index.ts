/**
 * 服务入口。
 *
 * P0-4 安全加固（此前为严重漏洞链）：
 *   - 旧配置 cors({ origin: true, credentials: true }) 会反射任意 Origin，
 *     且监听 0.0.0.0 —— 用户开着应用浏览任意恶意网页时，该网页可直接
 *     POST http://localhost:3001/api/config 把生图 baseUrl 改成攻击者服务器，
 *     下次生图时 Provider 会带着真实 API Key 请求攻击者地址（Key 即泄露），
 *     同时还能增删改全部系列数据。
 *   - 现在：默认只监听 127.0.0.1；CORS 白名单仅放行本机 vite 开发端口；
 *     如需局域网访问，显式设置 ALLOW_LAN=1。
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import apiRouter from './routes.js';
import seriesRouter from './series-routes.js';
import { IMAGE_DIR } from './image-store.js';
import { verifyAllDna } from './dna/registry.js';
import { getConfig } from './config.js';

// 启动时校验所有 DNA 文件完整性（防"TS 与 .md 漂移"）。
// 不一致仅警告，不阻断——避免半夜叫醒用户。
verifyAllDna();

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS 白名单：仅本机前端开发端口（vite 默认 5173，备用 5174）
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:(5173|5174)$/,
  /^http:\/\/127\.0\.0\.1:(5173|5174)$/,
];
const ALLOW_LAN = process.env.ALLOW_LAN === '1';

app.use(cors({
  origin(origin, callback) {
    // 同源请求（无 Origin 头，如 curl / vite 代理转发）直接放行
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.some(re => re.test(origin))) return callback(null, true);
    if (ALLOW_LAN) return callback(null, true); // 显式开启局域网时放行
    return callback(new Error(`Origin not allowed: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));

// 限流：全局 300/min。任务轮询（2s 一次）+ 自动跑多页也不会触顶，
// 同时仍能挡住异常脚本。生图本身走后台任务，不再占用请求时长。
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// 生成图片的静态目录（series-store 落盘，JSON 只存 /data/images/xxx.png 路径）
app.use('/data/images', express.static(IMAGE_DIR, { maxAge: '30d', immutable: true }));

app.use('/api', apiRouter);
app.use('/api', seriesRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const HOST = ALLOW_LAN ? '0.0.0.0' : '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`AIMangaStudio server listening on http://${HOST}:${PORT}` + (ALLOW_LAN ? '（局域网已开放）' : '（仅本机，需局域网请设 ALLOW_LAN=1）'));
  // 2026-10-20：启动即打印**实际生效**的模型配置。
  // 这套东西有 .env 和 server/runtime-config.json 两套，后者在时整个盖掉前者 ——
  // 只看 .env 会以为在用 agnes，实际可能跑在另一个 provider 上。
  // 启动日志里直接写明，不打印 apiKey。
  try { getConfig(); } catch (e: any) { console.warn('[config] 读取生效配置失败:', e?.message || e); }
});
