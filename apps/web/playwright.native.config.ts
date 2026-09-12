import {defineConfig,devices} from '@playwright/test';
import {randomUUID} from 'node:crypto';
process.env.ERUDOZA_E2E_PASSWORD??=`E2e!${randomUUID()}`;
const runId=process.env.ERUDOZA_NATIVE_RUN_ID??=randomUUID();
process.env.ERUDOZA_NATIVE_PID_FILE=`test-results/native-server-${runId}.pid`;
export default defineConfig({
 testDir:'./e2e',testMatch:['practice.spec.ts','native-study.spec.ts','training-progression.spec.ts','built-in-library.spec.ts','chapter-assignments.spec.ts','coach-student-mode.spec.ts'],outputDir:`./test-results/native-browser-${runId}`,
 globalTeardown:'./scripts/e2e-native-teardown.mjs',fullyParallel:false,workers:1,retries:0,
 reporter:[['list'],['json',{outputFile:`./test-results/native-browser-${runId}.json`}]],timeout:60000,
 use:{baseURL:'http://localhost:8789',extraHTTPHeaders:{Origin:'http://localhost:8789'},trace:'retain-on-failure'},
 webServer:{command:'node scripts/e2e-native.mjs',url:'http://127.0.0.1:8790/ready',reuseExistingServer:false,timeout:120000},
 projects:[{name:'native-chromium',use:{...devices['Desktop Chrome']}}],
});
