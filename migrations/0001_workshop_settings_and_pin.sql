ALTER TABLE workshop_settings ADD COLUMN logo_url TEXT;
ALTER TABLE workshop_login_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN email TEXT DEFAULT '';
ALTER TABLE repair_orders ADD COLUMN public_diagnosis TEXT NOT NULL DEFAULT '';
