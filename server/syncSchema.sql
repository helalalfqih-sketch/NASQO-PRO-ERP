BEGIN;
CREATE TABLE IF NOT EXISTS nasqo_sync_members (
  workspace_id text NOT NULL,
  firebase_uid text NOT NULL,
  can_write boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, firebase_uid)
);
CREATE TABLE IF NOT EXISTS nasqo_sync_heads (
  workspace_id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE IF NOT EXISTS nasqo_sync_operations (
  workspace_id text NOT NULL,
  operation_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  operation_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_uid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, operation_id),
  UNIQUE (workspace_id, revision)
);
-- Revisions must be allocated by locking the workspace head within the
-- same transaction as domain validation and operation insertion.
-- No automatic memberships or production data are seeded.
COMMIT;
