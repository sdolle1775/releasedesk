import argon2 from 'argon2';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { transaction } from './db.js';
import { WorkspaceService } from './service.js';

export const passwordOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export async function bootstrapUsers(pool:Pool,config:Config) {
  if(config.OWNER_PASSWORD && config.OWNER_PASSWORD.length<12) throw new Error('OWNER_PASSWORD must have at least 12 characters');
  for(const [username,password,role] of [[config.OWNER_USERNAME,config.OWNER_PASSWORD,'owner'],[config.DEMO_USERNAME,config.DEMO_PASSWORD,'demo']]) {
    if(!password || (role==='demo'&&config.DEMO_ENABLED==='false')) continue;
    const exists=(await pool.query('SELECT id FROM users WHERE username=$1',[username])).rows[0];
    if(!exists) await pool.query('INSERT INTO users(username,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING',[username,await argon2.hash(password,passwordOptions),role]);
  }
  const owner=(await pool.query("SELECT id FROM users WHERE username=$1 AND role='owner'",[config.OWNER_USERNAME])).rows[0];
  if(owner) await pool.query("INSERT INTO workspaces(user_id,kind) VALUES($1,'owner') ON CONFLICT DO NOTHING",[owner.id]);
}
export async function createSandbox(service:WorkspaceService,userId:string,oldWorkspaceId?:string) {
  return transaction(service.pool,async db=>{
    await db.query("DELETE FROM workspaces WHERE kind='demo' AND expires_at<=now()");
    if(oldWorkspaceId) await db.query("DELETE FROM workspaces WHERE id=$1 AND user_id=$2 AND kind='demo'",[oldWorkspaceId,userId]);
    const workspace=(await db.query("INSERT INTO workspaces(user_id,kind,expires_at) VALUES($1,'demo',now()+interval '24 hours') RETURNING id",[userId])).rows[0];
    await service.seedWorkspace(db,workspace.id);
    return workspace.id as string;
  });
}
