import { defineConfig, devices } from '@playwright/test';
import nativeConfig from './playwright.native.config';

export default defineConfig({
  ...nativeConfig,
  testMatch: ['native-season-layout.spec.ts'],
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'phone-fallback', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['iPad Mini'], defaultBrowserType: 'chromium' } },
  ],
});
