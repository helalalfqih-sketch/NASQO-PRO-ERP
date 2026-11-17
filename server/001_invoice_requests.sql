-- NASQO SmartPro integration: invoice idempotency table.
-- Run only on a private, backed-up MariaDB schema before enabling invoice writes.
-- Does not alter any original SmartPro table or historical record.
CREATE TABLE IF NOT EXISTS nasqo_invoice_requests (
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invoice_id INT(11) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_key),
  KEY idx_invoice_request (invoice_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
