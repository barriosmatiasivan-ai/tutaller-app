ALTER TABLE repair_orders ADD COLUMN total_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE repair_orders ADD COLUMN quote_detail TEXT NOT NULL DEFAULT '';
ALTER TABLE repair_orders ADD COLUMN quote_eta TEXT NOT NULL DEFAULT '';
ALTER TABLE repair_orders ADD COLUMN quote_warranty TEXT NOT NULL DEFAULT '';
