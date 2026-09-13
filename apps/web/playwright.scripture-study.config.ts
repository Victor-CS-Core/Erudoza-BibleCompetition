import { defineConfig } from '@playwright/test';
import nativeConfig from './playwright.native.config';
export default defineConfig({ ...nativeConfig, testMatch: ['native-scripture-study.spec.ts'] });
