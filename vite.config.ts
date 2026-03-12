import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())

  return {
    appType: 'mpa',
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          all: resolve(__dirname, 'all.html'),
          lab: resolve(__dirname, 'lab.html'),
          chron: resolve(__dirname, 'chron.html'),
        },
      },
    },
    server: {
      proxy: {
        '/chronicle-api': {
          target: 'https://chronicleclassic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/chronicle-api/, '/api'),
          cookieDomainRewrite: 'localhost',
        },
      },
    },
  }
})
