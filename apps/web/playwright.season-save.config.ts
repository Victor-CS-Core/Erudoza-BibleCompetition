import { defineConfig } from '@playwright/test';
import nativeConfig from './playwright.native.config';
export default defineConfig({ ...nativeConfig, testMatch: ['native-season-save.spec.ts'], timeout: 120_000 });
