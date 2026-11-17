-- Private additive linkage between NASQO-created invoices and their returns.
-- Does not mutate any original SmartPro account, stock or invoice table.
-- Return line references are tracked to prevent returning more than was sold/purchased.
CREATE TABLE IF NOT EXISTS nasqo_return_links (
  return_invoice_id INT NOT NULL,
  source_invoice_id INT NOT NULL,
  actor_uid VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (return_invoice_id),
  KEY idx_source_invoice (source_invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nasqo_return_line_links (
  return_line_id INT NOT NULL,
  source_line_id INT NOT NULL,
  returned_quantity DECIMAL(24,4) NOT NULL,
  PRIMARY KEY (return_line_id),
  KEY idx_source_line (source_line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
