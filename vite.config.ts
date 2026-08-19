import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const serverPort = Number(env.SERVER_PORT || '3001');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.SERVER_URL': JSON.stringify(env.SERVER_URL || ''),
      },
      root: '.',
      publicDir: 'public',
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        }
      },
      server: {
        proxy: {
          '/api': {
            target: `http://localhost:${serverPort}`,
            changeOrigin: true,
            secure: false,
          },
        },
      },
    };
});