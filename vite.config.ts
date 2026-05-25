import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  const isElectron = process.env.ELECTRON_BUILD === 'true';
  return {
    base: isElectron ? './' : '/',
    plugins: [
      react(),
      tailwindcss(),
      ...(!isElectron ? [VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'logo.svg'],
        manifest: {
          name: 'Socrate',
          short_name: 'Socrate',
          description: 'Interface de pensée avec IA',
          theme_color: '#000000',
          background_color: '#FDFCFA',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'logo.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
          runtimeCaching: [{
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          }],
        },
      })] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
