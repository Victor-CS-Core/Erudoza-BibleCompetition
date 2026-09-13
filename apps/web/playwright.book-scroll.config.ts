import { defineConfig, devices } from '@playwright/test';
import nativeConfig from './playwright.native.config';
export default defineConfig({
  ...nativeConfig,
  testMatch: ['native-book-scroll.spec.ts'],
  projects: [
    { name: 'scroll-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'scroll-phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'scroll-narrow-phone', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 740 } } },
  ],
});
