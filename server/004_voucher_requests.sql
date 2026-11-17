-- Additive, private idempotency tracking for central SmartPro vouchers.
CREATE TABLE IF NOT EXISTS nasqo_voucher_requests (
  request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  voucher_id INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_key),
  KEY idx_voucher_request (voucher_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
