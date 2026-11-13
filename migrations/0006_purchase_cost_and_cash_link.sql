-- Costo estimado y vínculo con movimiento de caja en purchase_needs
ALTER TABLE purchase_needs ADD COLUMN estimated_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_needs ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'efectivo';
ALTER TABLE purchase_needs ADD COLUMN cash_entry_id TEXT DEFAULT NULL;
