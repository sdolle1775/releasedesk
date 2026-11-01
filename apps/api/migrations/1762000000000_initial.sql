-- Up Migration
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE,
  password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('owner','demo'))
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('owner','demo')), expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), CHECK ((kind='owner' AND expires_at IS NULL) OR (kind='demo' AND expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX owner_workspace_unique ON workspaces(user_id) WHERE kind='owner';
CREATE INDEX workspace_expiry ON workspaces(expires_at) WHERE kind='demo';
CREATE TABLE sessions (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL);
CREATE INDEX session_expire ON sessions(expire);
CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  github_id bigint NOT NULL, owner text NOT NULL, name text NOT NULL, default_branch text NOT NULL,
  html_url text NOT NULL, checklist_template jsonb NOT NULL, source text NOT NULL DEFAULT 'github' CHECK(source IN ('github','sample')),
  UNIQUE(workspace_id, github_id, source)
);
CREATE TABLE releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  title text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized')),
  base_ref text NOT NULL, head_ref text NOT NULL, base_sha text, head_sha text,
  source text NOT NULL DEFAULT 'github' CHECK(source IN ('github','sample')), scenario_step integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz, final_markdown text,
  CHECK ((status='draft' AND finalized_at IS NULL AND final_markdown IS NULL) OR (status='finalized' AND finalized_at IS NOT NULL AND final_markdown IS NOT NULL))
);
CREATE INDEX releases_repository ON releases(repository_id, created_at DESC);
CREATE TABLE changelog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  commit_sha text NOT NULL, message text NOT NULL, author text NOT NULL, committed_at timestamptz NOT NULL,
  html_url text NOT NULL, suggested_category text NOT NULL CHECK(suggested_category IN ('feature','fix','breaking','internal')),
  position integer NOT NULL, missing boolean NOT NULL DEFAULT false,
  title_override text, category_override text CHECK(category_override IN ('feature','fix','breaking','internal')),
  notes text NOT NULL DEFAULT '', excluded boolean NOT NULL DEFAULT false,
  UNIQUE(release_id, commit_sha)
);
CREATE TABLE checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  text text NOT NULL, completed boolean NOT NULL DEFAULT false, position integer NOT NULL
);
CREATE INDEX checklist_release ON checklist_items(release_id, position);
CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  release_id uuid REFERENCES releases(id) ON DELETE CASCADE, status text NOT NULL CHECK(status IN ('running','succeeded','failed')),
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  added integer NOT NULL DEFAULT 0, missing integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0,
  base_sha text, head_sha text, error_code text, error_message text, ip_hash text
);
CREATE UNIQUE INDEX one_running_sync ON sync_runs(release_id) WHERE status='running';
CREATE INDEX sync_repository_time ON sync_runs(repository_id, started_at DESC);
CREATE INDEX sync_ip_time ON sync_runs(ip_hash, started_at DESC);
CREATE TABLE github_cache (
  key text PRIMARY KEY, etag text, body jsonb NOT NULL, link text, cached_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE github_cache, sync_runs, checklist_items, changelog_entries, releases, repositories, sessions, workspaces, users;
