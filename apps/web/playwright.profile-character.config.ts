import {defineConfig} from '@playwright/test';
import nativeConfig from './playwright.native.config';
process.env.ERUDOZA_PROFILE_FIXTURE='1';
export default defineConfig({...nativeConfig,testMatch:['native-profile-character.spec.ts'],timeout:120000});
