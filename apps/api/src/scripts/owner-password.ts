import argon2 from 'argon2';
import { readConfig } from '../config.js';
import { createPool, transaction } from '../db.js';
import { passwordOptions } from '../auth.js';
import { ensure } from '../errors.js';
const config = readConfig();
ensure(
  config.OWNER_PASSWORD.length >= 12,
  422,
  'PASSWORD_REQUIRED',
  'Set OWNER_PASSWORD to a password of at least 12 characters in the execution environment.',
);
const pool = createPool(config.DATABASE_URL);
try {
  const hash = await argon2.hash(config.OWNER_PASSWORD, passwordOptions);
  await transaction(pool, async (db) => {
    const existing = (
      await db.query('SELECT id,role FROM users WHERE username=$1 FOR UPDATE', [
        config.OWNER_USERNAME,
      ])
    ).rows[0];
    ensure(
      !existing || existing.role === 'owner',
      409,
      'USERNAME_CONFLICT',
      'This username belongs to a demo account. Choose a different owner username.',
    );
    const user = (
      await db.query(
        "INSERT INTO users(username,password_hash,role) VALUES($1,$2,'owner') ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id",
        [config.OWNER_USERNAME, hash],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO workspaces(user_id,kind) VALUES($1,'owner') ON CONFLICT DO NOTHING",
      [user.id],
    );
    await db.query("DELETE FROM sessions WHERE sess->'auth'->>'userId'=$1", [user.id]);
  });
  console.log('Owner password updated. Existing owner sessions were invalidated.');
} finally {
  await pool.end();
}
