import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const serverPort = Number(env.SERVER_PORT || '3001');
    return {
      define: {
        'process.env.SERVER_URL': JSON.stringify(env.SERVER_URL || ''),
      },
      root: '.',
      publicDir: 'public',
      server: {
        proxy: {
          '/api': {
            target: `http://localhost:${serverPort}`,
            changeOrigin: true,
            secure: false,
          },
          // 生成图片的静态目录（后端 series-store 落盘，JSON 只存路径）
          '/data': {
            target: `http://localhost:${serverPort}`,
            changeOrigin: true,
            secure: false,
          },
        },
      },
    };
});