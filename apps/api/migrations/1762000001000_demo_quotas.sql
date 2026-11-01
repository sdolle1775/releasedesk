-- Up Migration
-- Short-lived quota evidence deliberately survives sandbox reset and draft deletion.
CREATE TABLE demo_sync_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  ip_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_quota_ip ON demo_sync_events(ip_hash,occurred_at);
CREATE INDEX demo_quota_workspace ON demo_sync_events(workspace_id,occurred_at);

-- Down Migration
DROP TABLE demo_sync_events;
