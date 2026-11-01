import { readConfig } from '../config.js';
import { migrate } from '../db.js';
const config = readConfig();
await migrate(config.DATABASE_DIRECT_URL || config.DATABASE_URL);
console.log('Database migrations complete.');
