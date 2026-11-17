-- Private, additive SmartPro integration table for deduplicating stock-transfer posts.
-- Must be installed only on the staged/approved MariaDB schema before write enable.
CREATE TABLE IF NOT EXISTS nasqo_transfer_requests (
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transfer_id INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_key),
  KEY idx_transfer_request (transfer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
