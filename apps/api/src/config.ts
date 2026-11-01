import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: new URL('../../../.env', import.meta.url), quiet: true });
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).optional(),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  DATABASE_DIRECT_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(32),
  GITHUB_TOKEN: z.string().default(''),
  OWNER_USERNAME: z.string().min(1).default('sam'),
  OWNER_PASSWORD: z.string().default(''),
  DEMO_USERNAME: z.string().default('demo'),
  DEMO_PASSWORD: z.string().default('releasedesk'),
  DEMO_ENABLED: z.enum(['true', 'false']).default('true'),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://'))
    throw new Error('APP_ORIGIN must use HTTPS in production');
  if (config.OWNER_USERNAME === config.DEMO_USERNAME)
    throw new Error('Owner and demo usernames must differ');
  return config;
}
