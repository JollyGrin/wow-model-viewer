import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      args: ['--use-gl=swiftshader'],
    },
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'bun run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
