import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
})
