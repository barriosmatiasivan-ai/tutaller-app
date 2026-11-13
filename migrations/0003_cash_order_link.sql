-- Vincular movimientos de caja a órdenes de reparación y registrar lo abonado en cada orden
ALTER TABLE cash_entries ADD COLUMN order_id TEXT DEFAULT NULL;
ALTER TABLE repair_orders ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_cash_entries_order ON cash_entries(workshop_id, order_id);
