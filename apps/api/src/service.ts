import type { Pool, PoolClient } from 'pg';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CHECKLIST, type Entry, type ReleaseDetail, type Repository, type Release } from '@releasedesk/contracts';
import { transaction } from './db.js';
import { AppError, ensure, notFound } from './errors.js';
import { renderMarkdown, suggestCategory } from './logic.js';
import type { Comparison, GitHubSource } from './github.js';

type DB = Pool | PoolClient;
export interface Actor { userId: string; workspaceId: string; kind: 'owner' | 'demo'; ipHash: string }
export function camel(row: any): any {
  if (row instanceof Date) return row.toISOString();
  if (Array.isArray(row)) return row.map(camel);
  if (row && typeof row === 'object') return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), camel(value)]));
  return row;
}
const repositorySelect = `SELECT p.*, (SELECT count(*)::int FROM releases WHERE repository_id=p.id AND status='draft') AS draft_count,
  (SELECT count(*)::int FROM releases WHERE repository_id=p.id AND status='finalized') AS finalized_count FROM repositories p`;
const releaseSelect = `SELECT r.*, (SELECT count(*)::int FROM changelog_entries WHERE release_id=r.id) AS entry_count,
  (SELECT count(*)::int FROM changelog_entries WHERE release_id=r.id AND NOT excluded AND NOT missing) AS included_count,
  p.owner AS repo_owner,p.name AS repo_name,p.html_url AS repo_html_url FROM releases r JOIN repositories p ON p.id=r.repository_id`;
function publicRepository(row: any): Repository {
  const r = camel(row);
  return { id:r.id, owner:r.owner, name:r.name, defaultBranch:r.defaultBranch, htmlUrl:r.htmlUrl, checklistTemplate:r.checklistTemplate, source:r.source, draftCount:r.draftCount ?? 0, finalizedCount:r.finalizedCount ?? 0 };
}
function publicRelease(row: any): Release {
  const r = camel(row);
  return { id:r.id, repositoryId:r.repositoryId,title:r.title,status:r.status,baseRef:r.baseRef,headRef:r.headRef,baseSha:r.baseSha,headSha:r.headSha,createdAt:r.createdAt,finalizedAt:r.finalizedAt,lastSyncedAt:r.lastSyncedAt,source:r.source,entryCount:r.entryCount ?? 0,includedCount:r.includedCount ?? 0 };
}
export async function recordedRepositories(): Promise<(Comparison & { githubId: number; owner: string; name: string; defaultBranch: string; htmlUrl: string })[]> {
  return JSON.parse(await readFile(new URL('../../../fixtures/public-repositories.json', import.meta.url), 'utf8')).repositories;
}

export class WorkspaceService {
  constructor(public pool: Pool, public github: GitHubSource) {}
  async repositories(actor: Actor) { return (await this.pool.query(`${repositorySelect} WHERE p.workspace_id=$1 ORDER BY lower(p.name)`, [actor.workspaceId])).rows.map(publicRepository); }
  async repository(actor: Actor, id: string, db: DB = this.pool) {
    const row = (await db.query(`${repositorySelect} WHERE p.workspace_id=$1 AND p.id=$2`, [actor.workspaceId,id])).rows[0];
    if (!row) throw notFound();
    return publicRepository(row);
  }
  async addRepository(actor: Actor, owner: string, name: string) {
    const meta = await this.github.repository(owner,name);
    ensure(!meta.private,422,'PRIVATE_REPOSITORY','ReleaseDesk supports public repositories only.');
    return transaction(this.pool,async db => {
      await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[actor.workspaceId]);
      const existing = (await db.query('SELECT id FROM repositories WHERE workspace_id=$1 AND github_id=$2 AND source=$3',[actor.workspaceId,meta.githubId,'github'])).rows[0];
      if (existing) return this.repository(actor,existing.id,db);
      const count = Number((await db.query('SELECT count(*) FROM repositories WHERE workspace_id=$1',[actor.workspaceId])).rows[0].count);
      ensure(actor.kind !== 'demo' || count < 3,422,'DEMO_LIMIT','Demo sandboxes can contain up to three repositories.');
      const row = (await db.query('INSERT INTO repositories(workspace_id,github_id,owner,name,default_branch,html_url,checklist_template) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[actor.workspaceId,meta.githubId,meta.owner,meta.name,meta.defaultBranch,meta.htmlUrl,JSON.stringify(DEFAULT_CHECKLIST)])).rows[0];
      return this.repository(actor,row.id,db);
    });
  }
  async updateTemplate(actor: Actor, id: string, checklistTemplate: string[]) {
    await this.repository(actor,id);
    await this.pool.query('UPDATE repositories SET checklist_template=$1 WHERE id=$2 AND workspace_id=$3',[JSON.stringify(checklistTemplate),id,actor.workspaceId]);
    return this.repository(actor,id);
  }
  async tags(actor: Actor,id: string,page: number) {
    const repo=await this.repository(actor,id);
    if(repo.source==='sample') return {tags:[{name:'sample-base',sha:'a'.repeat(40)}],hasMore:false};
    return this.github.tags(repo.owner,repo.name,page);
  }
  private async releaseRow(actor: Actor,id: string,db: DB=this.pool,lock=false) {
    const row=(await db.query(`${releaseSelect} WHERE r.id=$1 AND p.workspace_id=$2${lock?' FOR UPDATE OF r':''}`,[id,actor.workspaceId])).rows[0];
    if(!row) throw notFound();
    return row;
  }
  private assertDraft(row: any) { ensure(row.status==='draft',409,'FINALIZED','Finalized releases are read-only. Create a new draft for further changes.'); }
  private async noActiveSync(db: DB,id: string) {
    ensure(!(await db.query("SELECT 1 FROM sync_runs WHERE release_id=$1 AND status='running'",[id])).rowCount,409,'SYNC_RUNNING','A sync is already running for this release.');
  }
  async releases(actor: Actor,repositoryId?: string) {
    if(repositoryId) await this.repository(actor,repositoryId);
    return (await this.pool.query(`${releaseSelect} WHERE p.workspace_id=$1${repositoryId?' AND p.id=$2':''} ORDER BY r.created_at DESC`,repositoryId?[actor.workspaceId,repositoryId]:[actor.workspaceId])).rows.map(publicRelease);
  }
  async detail(actor: Actor,id: string): Promise<ReleaseDetail> {
    const row=await this.releaseRow(actor,id);
    const [repository,entries,checklist,syncRuns]=await Promise.all([
      this.repository(actor,row.repository_id),
      this.pool.query('SELECT * FROM changelog_entries WHERE release_id=$1 ORDER BY position,commit_sha',[id]),
      this.pool.query('SELECT id,text,completed,position FROM checklist_items WHERE release_id=$1 ORDER BY position,id',[id]),
      this.pool.query('SELECT id,status,started_at,finished_at,added,missing,total,error_code,error_message FROM sync_runs WHERE release_id=$1 ORDER BY started_at DESC LIMIT 20',[id]),
    ]);
    const facts=camel(entries.rows) as Entry[];
    return {...publicRelease(row),repository,entries:facts,checklist:camel(checklist.rows),syncRuns:camel(syncRuns.rows),markdown:row.final_markdown ?? renderMarkdown(publicRelease(row),repository,facts)};
  }
  async createRelease(actor: Actor,repositoryId: string,input: {title:string;baseRef:string;headRef:string}) {
    const repo=await this.repository(actor,repositoryId);
    const id=await transaction(this.pool,async db=>{
      await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[actor.workspaceId]);
      const count=Number((await db.query('SELECT count(*) FROM releases r JOIN repositories p ON p.id=r.repository_id WHERE p.workspace_id=$1',[actor.workspaceId])).rows[0].count);
      ensure(actor.kind!=='demo'||count<10,422,'DEMO_LIMIT','Demo sandboxes can contain up to ten releases.');
      const row=(await db.query('INSERT INTO releases(repository_id,title,base_ref,head_ref,source) VALUES($1,$2,$3,$4,$5) RETURNING id',[repositoryId,input.title,input.baseRef,input.headRef,repo.source])).rows[0];
      for(const [position,text] of repo.checklistTemplate.entries()) await db.query('INSERT INTO checklist_items(release_id,text,position) VALUES($1,$2,$3)',[row.id,text,position]);
      return row.id as string;
    });
    try { return await this.sync(actor,id); }
    catch(error) {
      // A failed initial import has no usable draft. Keep its audit attempt at repository scope.
      await transaction(this.pool,async db=>{
        await db.query('UPDATE sync_runs SET release_id=NULL WHERE release_id=$1',[id]);
        await db.query('DELETE FROM releases WHERE id=$1',[id]);
      });
      throw error;
    }
  }
  async rename(actor:Actor,id:string,title:string) {
    await transaction(this.pool,async db=>{this.assertDraft(await this.releaseRow(actor,id,db,true));await db.query('UPDATE releases SET title=$1 WHERE id=$2',[title,id]);});
    return this.detail(actor,id);
  }
  async remove(actor:Actor,id:string) {
    await transaction(this.pool,async db=>{this.assertDraft(await this.releaseRow(actor,id,db,true));await this.noActiveSync(db,id);await db.query('DELETE FROM releases WHERE id=$1',[id]);});
  }
  async editEntry(actor:Actor,id:string,entryId:string,input: {titleOverride?:string|null;categoryOverride?:string|null;notes?:string;excluded?:boolean}) {
    await transaction(this.pool,async db=>{
      this.assertDraft(await this.releaseRow(actor,id,db,true));
      const columns:Record<string,string>={titleOverride:'title_override',categoryOverride:'category_override',notes:'notes',excluded:'excluded'};
      const fields=Object.entries(input);
      const query=`UPDATE changelog_entries SET ${fields.map(([key],i)=>`${columns[key]}=$${i+1}`).join(',')} WHERE id=$${fields.length+1} AND release_id=$${fields.length+2}`;
      if(!(await db.query(query,[...fields.map(([,v])=>v),entryId,id])).rowCount) throw notFound();
    });
    return this.detail(actor,id);
  }
  async addChecklist(actor:Actor,id:string,text:string) {
    await transaction(this.pool,async db=>{
      this.assertDraft(await this.releaseRow(actor,id,db,true));
      const {rows}=await db.query('SELECT count(*)::int AS count,coalesce(max(position),-1)+1 AS position FROM checklist_items WHERE release_id=$1',[id]);
      ensure(rows[0].count<30,422,'CHECKLIST_LIMIT','A checklist can have up to 30 items.');
      await db.query('INSERT INTO checklist_items(release_id,text,position) VALUES($1,$2,$3)',[id,text,rows[0].position]);
    });
    return this.detail(actor,id);
  }
  async editChecklist(actor:Actor,id:string,itemId:string,input: {text?:string;completed?:boolean}|null) {
    await transaction(this.pool,async db=>{
      this.assertDraft(await this.releaseRow(actor,id,db,true));
      let result;
      if(input===null) result=await db.query('DELETE FROM checklist_items WHERE id=$1 AND release_id=$2',[itemId,id]);
      else result=await db.query('UPDATE checklist_items SET text=coalesce($1,text),completed=coalesce($2,completed) WHERE id=$3 AND release_id=$4',[input.text??null,input.completed??null,itemId,id]);
      if(!result.rowCount) throw notFound();
    });
    return this.detail(actor,id);
  }
  async finalize(actor:Actor,id:string) {
    await transaction(this.pool,async db=>{
      const row=await this.releaseRow(actor,id,db,true);this.assertDraft(row);await this.noActiveSync(db,id);
      ensure(row.last_synced_at,409,'IMPORT_REQUIRED','Import a complete comparison before finalizing.');
      ensure(!(await db.query('SELECT 1 FROM checklist_items WHERE release_id=$1 AND NOT completed',[id])).rowCount,409,'CHECKLIST_INCOMPLETE','Complete or remove every checklist item before finalizing.');
      const entries=camel((await db.query('SELECT * FROM changelog_entries WHERE release_id=$1',[id])).rows) as Entry[];
      ensure(!entries.some(e=>e.missing&&!e.excluded),409,'MISSING_COMMITS','Review and explicitly exclude missing commits before finalizing.');
      const markdown=renderMarkdown(publicRelease(row),{htmlUrl:row.repo_html_url},entries);
      await db.query("UPDATE releases SET status='finalized',finalized_at=now(),final_markdown=$1 WHERE id=$2",[markdown,id]);
    });
    return this.detail(actor,id);
  }
  private async quota(db: PoolClient,actor:Actor) {
    if(actor.kind!=='demo') return;
    // Serialize workspace and IP quota checks across requests and server processes.
    const keys=[`workspace:${actor.workspaceId}`,`ip:${actor.ipHash}`].sort();
    for(const key of keys) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
    const count=Number((await db.query(`SELECT count(*) FROM sync_runs s JOIN repositories p ON p.id=s.repository_id
      WHERE s.ip_hash IS NOT NULL AND s.started_at>now()-interval '1 hour' AND (p.workspace_id=$1 OR s.ip_hash=$2)`,[actor.workspaceId,actor.ipHash])).rows[0].count);
    if(count>=10) throw new AppError(429,'DEMO_SYNC_LIMIT','Demo imports and syncs are limited to ten per hour.',new Date(Date.now()+3600000).toISOString());
  }
  async sync(actor:Actor,id:string) {
    const claim=await transaction(this.pool,async db=>{
      const row=await this.releaseRow(actor,id,db,true);this.assertDraft(row);
      await db.query("UPDATE sync_runs SET status='failed',finished_at=now(),error_code='SYNC_EXPIRED',error_message='Sync interrupted; retry safely.' WHERE release_id=$1 AND status='running' AND started_at<now()-interval '2 minutes'",[id]);
      await this.noActiveSync(db,id);
      if(row.source==='github') await this.quota(db,actor);
      const run=(await db.query("INSERT INTO sync_runs(repository_id,release_id,status,ip_hash) VALUES($1,$2,'running',$3) RETURNING id",[row.repository_id,id,row.source==='github'?actor.ipHash:null])).rows[0];
      return {row,runId:run.id as string};
    });
    try {
      const {row,runId}=claim;
      let comparison:Comparison;
      if(row.source==='sample') {
        const record=(await recordedRepositories())[0];
        const commits=record.commits.slice(0,row.scenario_step===0?Math.max(1,record.commits.length-2):record.commits.length);
        comparison={baseSha:record.baseSha,headSha:commits.at(-1)?.sha??record.baseSha,commits};
      } else {
        const signal=AbortSignal.timeout(45000);
        const base=row.base_sha??await this.github.resolve(row.repo_owner,row.repo_name,row.base_ref,signal);
        const head=await this.github.resolve(row.repo_owner,row.repo_name,row.head_ref,signal);
        comparison=await this.github.compare(row.repo_owner,row.repo_name,base,head,signal);
      }
      await transaction(this.pool,async db=>{
        this.assertDraft(await this.releaseRow(actor,id,db,true));
        ensure((await db.query("SELECT 1 FROM sync_runs WHERE id=$1 AND status='running'",[runId])).rowCount,409,'SYNC_EXPIRED','This sync has expired. Retry to import a fresh snapshot.');
        const existing=new Set((await db.query('SELECT commit_sha FROM changelog_entries WHERE release_id=$1',[id])).rows.map(r=>r.commit_sha));
        let added=0;
        for(const [position,c] of comparison.commits.entries()) {
          if(!existing.has(c.sha)) added++;
          // Deliberately enumerate facts. Never put editorial columns in this conflict update.
          await db.query(`INSERT INTO changelog_entries(release_id,commit_sha,message,author,committed_at,html_url,suggested_category,position)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(release_id,commit_sha) DO UPDATE SET
            message=EXCLUDED.message,author=EXCLUDED.author,committed_at=EXCLUDED.committed_at,html_url=EXCLUDED.html_url,
            suggested_category=EXCLUDED.suggested_category,position=EXCLUDED.position,missing=false`,[id,c.sha,c.message,c.author,c.date,c.url,suggestCategory(c.message),position]);
        }
        await db.query('UPDATE changelog_entries SET missing=true WHERE release_id=$1 AND NOT(commit_sha=ANY($2::text[]))',[id,comparison.commits.map(c=>c.sha)]);
        const missing=Number((await db.query('SELECT count(*) FROM changelog_entries WHERE release_id=$1 AND missing',[id])).rows[0].count);
        await db.query('UPDATE releases SET base_sha=$1,head_sha=$2,last_synced_at=now(),scenario_step=scenario_step+1 WHERE id=$3',[comparison.baseSha,comparison.headSha,id]);
        await db.query("UPDATE sync_runs SET status='succeeded',finished_at=now(),added=$1,missing=$2,total=$3,base_sha=$4,head_sha=$5 WHERE id=$6",[added,missing,comparison.commits.length,comparison.baseSha,comparison.headSha,runId]);
      });
    } catch(error) {
      const failure=error instanceof AppError?error:new AppError(502,'SYNC_FAILED','The sync failed. Your saved draft is unchanged.');
      await this.pool.query("UPDATE sync_runs SET status='failed',finished_at=now(),error_code=$1,error_message=$2 WHERE id=$3 AND status='running'",[failure.code,failure.message,claim.runId]);
      throw failure;
    }
    return this.detail(actor,id);
  }
  async seedWorkspace(db:PoolClient,workspaceId:string) {
    for(const record of await recordedRepositories()) {
      const repository=(await db.query('INSERT INTO repositories(workspace_id,github_id,owner,name,default_branch,html_url,checklist_template) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[workspaceId,record.githubId,record.owner,record.name,record.defaultBranch,record.htmlUrl,JSON.stringify(DEFAULT_CHECKLIST)])).rows[0];
      const release=(await db.query('INSERT INTO releases(repository_id,title,base_ref,head_ref,base_sha,head_sha,last_synced_at) VALUES($1,$2,$3,$4,$3,$5,now()) RETURNING id',[repository.id,record.name==='marvel-lcg'?'Next release':'Workspace improvements',record.baseSha,record.defaultBranch,record.headSha])).rows[0];
      for(const [position,c] of record.commits.entries()) await db.query('INSERT INTO changelog_entries(release_id,commit_sha,message,author,committed_at,html_url,suggested_category,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[release.id,c.sha,c.message,c.author,c.date,c.url,suggestCategory(c.message),position]);
      for(const [position,text] of DEFAULT_CHECKLIST.entries()) await db.query('INSERT INTO checklist_items(release_id,text,position) VALUES($1,$2,$3)',[release.id,text,position]);
      await db.query("INSERT INTO sync_runs(repository_id,release_id,status,finished_at,total,added,base_sha,head_sha) VALUES($1,$2,'succeeded',now(),$3,$3,$4,$5)",[repository.id,release.id,record.commits.length,record.baseSha,record.headSha]);
    }
  }
  async createScenario(actor:Actor) {
    ensure(actor.kind==='demo',403,'DEMO_ONLY','The sample scenario is available in demo sandboxes.');
    let repo=(await this.repositories(actor)).find(r=>r.source==='sample');
    if(!repo) {
      await transaction(this.pool,async db=>{
        await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[actor.workspaceId]);
        const count=Number((await db.query('SELECT count(*) FROM repositories WHERE workspace_id=$1',[actor.workspaceId])).rows[0].count);
        ensure(count<3,422,'DEMO_LIMIT','Reset your sandbox to make room for the sample repository.');
        await db.query("INSERT INTO repositories(workspace_id,github_id,owner,name,default_branch,html_url,checklist_template,source) VALUES($1,-1,'sample','edit-preserving-sync','sample-head','https://github.com/sdolle1775/marvel-lcg',$2,'sample') ON CONFLICT DO NOTHING",[actor.workspaceId,JSON.stringify(DEFAULT_CHECKLIST)]);
      });
      repo=(await this.repositories(actor)).find(r=>r.source==='sample');
    }
    return this.createRelease(actor,repo!.id,{title:'Sample: an edit that survives sync',baseRef:'sample-base',headRef:'sample-head'});
  }
}
