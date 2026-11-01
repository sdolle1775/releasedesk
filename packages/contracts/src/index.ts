import { z } from 'zod';

export const categorySchema = z.enum(['breaking', 'feature', 'fix', 'internal']);
export type Category = z.infer<typeof categorySchema>;
const text = (max: number) => z.string().trim().min(1).max(max);
export const loginSchema = z.object({ username: text(100), password: z.string().min(1).max(256) }).strict();
export const repositorySchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).refine(v => v !== '.' && v !== '..'),
}).strict();
export const templateSchema = z.object({ checklistTemplate: z.array(text(300)).max(30) }).strict();
export const releaseSchema = z.object({ title: text(150), baseRef: text(250), headRef: text(250) }).strict();
export const renameSchema = z.object({ title: text(150) }).strict();
export const entrySchema = z.object({
  titleOverride: text(500).nullable().optional(),
  categoryOverride: categorySchema.nullable().optional(),
  notes: z.string().max(10000).optional(),
  excluded: z.boolean().optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'Provide at least one change');
export const checklistSchema = z.object({ text: text(300) }).strict();
export const checklistPatchSchema = z.object({ text: text(300).optional(), completed: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0);
export const idSchema = z.uuid();
export const DEFAULT_CHECKLIST = ['Version updated', 'Tests passing', 'Documentation updated', 'Release artifacts verified', 'Announcement prepared'];
export const CATEGORY_LABELS: Record<Category, string> = { breaking: 'Breaking changes', feature: 'Features', fix: 'Fixes', internal: 'Internal' };

export interface Repository {
  id: string; owner: string; name: string; defaultBranch: string; htmlUrl: string;
  checklistTemplate: string[]; source: 'github' | 'sample'; draftCount: number; finalizedCount: number;
}
export interface Entry {
  id: string; commitSha: string; message: string; author: string; committedAt: string; htmlUrl: string;
  suggestedCategory: Category; position: number; missing: boolean; titleOverride: string | null;
  categoryOverride: Category | null; notes: string; excluded: boolean;
}
export interface ChecklistItem { id: string; text: string; completed: boolean; position: number }
export interface SyncRun {
  id: string; status: 'running' | 'succeeded' | 'failed'; startedAt: string; finishedAt: string | null;
  added: number; missing: number; total: number; errorCode: string | null; errorMessage: string | null;
}
export interface Release {
  id: string; repositoryId: string; title: string; status: 'draft' | 'finalized'; baseRef: string; headRef: string;
  baseSha: string | null; headSha: string | null; createdAt: string; finalizedAt: string | null;
  lastSyncedAt: string | null; source: 'github' | 'sample'; entryCount: number; includedCount: number;
}
export interface ReleaseDetail extends Release {
  repository: Repository; entries: Entry[]; checklist: ChecklistItem[]; syncRuns: SyncRun[]; markdown: string;
}
export interface SessionInfo {
  authenticated: boolean; csrfToken: string; username?: string; workspace?: { id: string; kind: 'owner' | 'demo'; expiresAt: string | null };
  demo: { enabled: boolean; username: string; password: string };
}
export interface ApiError { error: { code: string; message: string; retryAt?: string; fields?: Record<string, string[]> } }
