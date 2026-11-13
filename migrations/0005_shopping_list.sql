-- Lista de compras / faltantes de repuestos por taller y orden
CREATE TABLE IF NOT EXISTS purchase_needs (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL,
  order_id TEXT DEFAULT NULL,
  product_id TEXT DEFAULT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'normal',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_needs_workshop_status ON purchase_needs(workshop_id, status);
