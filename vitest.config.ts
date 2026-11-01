import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include:['apps/api/test/**/*.test.ts'],testTimeout:20000,hookTimeout:30000,fileParallelism:false,globalSetup:['./apps/api/test/global-setup.ts'] } });
