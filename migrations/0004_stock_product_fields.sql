-- Agregar cantidad y categoría en stock_products para gestión directa desde el panel
ALTER TABLE stock_products ADD COLUMN quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_products ADD COLUMN category TEXT NOT NULL DEFAULT 'General';
