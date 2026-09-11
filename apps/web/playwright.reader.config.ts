import { defineConfig } from "@playwright/test";
import nativeConfig from "./playwright.native.config";

// Uses the existing ephemeral Miniflare database and private fixture accounts.
export default defineConfig({ ...nativeConfig, testMatch: ["native-scripture-reader.spec.ts"] });
