import { readConfig } from '../config.js';
import { createPool } from '../db.js';
import { bootstrapUsers } from '../auth.js';
const config = readConfig();
const pool = createPool(config.DATABASE_URL);
try {
  await bootstrapUsers(pool, config);
  console.log('Login users and owner workspace initialized. Existing passwords were preserved.');
} finally {
  await pool.end();
}
