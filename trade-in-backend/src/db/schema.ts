export const SCHEMA = `
-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  enabled INTEGER DEFAULT 1
);

-- Device models (catalog)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES categories(id),
  brand_id TEXT REFERENCES brands(id),
  name TEXT NOT NULL,
  storages TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Repairs: the second pipeline. A repair is priced from a part cost, not from
-- what other buyers pay, so it has its own price table and its own bookings,
-- and shares the catalogue, the customers and the org scoping with trade-ins.
CREATE TABLE IF NOT EXISTS repair_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT,
  device_id TEXT NOT NULL,
  problem TEXT NOT NULL,
  part_cost REAL,            -- what the part costs the shop (Mobile Centrics or China)
  override_price REAL,       -- a hand-set customer price that ignores the formula
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, device_id, problem)
);

CREATE TABLE IF NOT EXISTS repairs (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  store_id TEXT,
  customer_id TEXT REFERENCES customers(id),
  device_id TEXT,
  device_name TEXT NOT NULL,
  problem TEXT NOT NULL,
  problem_label TEXT,
  quoted_price REAL,
  price_source TEXT,          -- 'override' | 'formula' | 'quote' (no price on file)
  fulfilment TEXT DEFAULT 'drop-off',
  status TEXT DEFAULT 'booked',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repairs_status ON repairs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repairs_org ON repairs(org_id, created_at DESC);

-- Condition groups
CREATE TABLE IF NOT EXISTS condition_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Conditions within a group
CREATE TABLE IF NOT EXISTS conditions (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES condition_groups(id),
  grade TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Pricing: base prices per device+storage+condition
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  storage TEXT NOT NULL,
  condition_grade TEXT NOT NULL,
  base_price REAL NOT NULL DEFAULT 0,
  source TEXT DEFAULT 'manual',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(device_id, storage, condition_grade)
);

-- Price adjustments (global or per-category/brand/device)
CREATE TABLE IF NOT EXISTS price_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT,
  adjust_percent REAL DEFAULT 0,
  adjust_amount REAL DEFAULT 0,
  condition_grade TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Price sync sources
CREATE TABLE IF NOT EXISTS price_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  url_template TEXT,
  enabled INTEGER DEFAULT 1,
  last_synced_at TEXT,
  sync_interval_hours INTEGER DEFAULT 168
);

-- Normalized competitor scrapes (pricing engine)
CREATE TABLE IF NOT EXISTS scraped_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_name TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  product_id TEXT,
  variant TEXT NOT NULL,
  condition TEXT NOT NULL,
  trade_in_price REAL,
  sell_price REAL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  source_url TEXT,
  raw_json TEXT,
  scraped_at TEXT NOT NULL,
  engine TEXT DEFAULT 'unknown',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scraped_prices_key
  ON scraped_prices(product_id, variant, condition, scraped_at);
CREATE INDEX IF NOT EXISTS idx_scraped_prices_competitor
  ON scraped_prices(competitor_name, scraped_at);

-- Learned price baselines per variant key
CREATE TABLE IF NOT EXISTS price_baselines (
  variant_key TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  condition TEXT NOT NULL,
  baseline_price REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  source_breakdown TEXT,
  model TEXT DEFAULT 'data-driven',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Manual overrides (highest trust)
CREATE TABLE IF NOT EXISTS price_overrides (
  variant_key TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  condition TEXT NOT NULL,
  price REAL NOT NULL,
  note TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT
);

-- Training run metrics
CREATE TABLE IF NOT EXISTS pricing_train_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  baselines_upserted INTEGER DEFAULT 0,
  sample_counts_json TEXT,
  data_sources_used TEXT,
  errors_json TEXT,
  ok INTEGER DEFAULT 1
);

-- Scrape run health / dual-mode diffs
CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  providers_json TEXT,
  rows_persisted INTEGER DEFAULT 0,
  rows_discarded INTEGER DEFAULT 0,
  dual_diff_json TEXT,
  health_json TEXT,
  errors_json TEXT,
  ok INTEGER DEFAULT 1
);

-- Condition multipliers learned from data
CREATE TABLE IF NOT EXISTS condition_multipliers (
  condition TEXT PRIMARY KEY,
  multiplier REAL NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Offers (the core pipeline)
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'active_lead',
  offer_type TEXT DEFAULT 'mail-in',
  total_value REAL DEFAULT 0,
  payout_method TEXT,
  payout_status TEXT DEFAULT 'pending',
  shipping_label_url TEXT,
  tracking_number TEXT,
  courier TEXT,
  notes TEXT,
  promo_code TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Offer items (devices in an offer)
CREATE TABLE IF NOT EXISTS offer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id TEXT REFERENCES offers(id),
  device_id TEXT REFERENCES devices(id),
  device_name TEXT NOT NULL,
  storage TEXT,
  carrier TEXT,
  color TEXT,
  condition_grade TEXT,
  quoted_price REAL NOT NULL DEFAULT 0,
  final_price REAL,
  battery_health INTEGER,
  imei TEXT,
  notes TEXT
);

-- Inventory (devices after offer completion)
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  offer_item_id INTEGER REFERENCES offer_items(id),
  device_name TEXT NOT NULL,
  imei TEXT,
  condition_grade TEXT,
  cost REAL DEFAULT 0,
  sell_price REAL,
  status TEXT DEFAULT 'available',
  source TEXT DEFAULT 'buyback',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow stages
CREATE TABLE IF NOT EXISTS workflow_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  send_email INTEGER DEFAULT 0,
  email_template TEXT
);

-- Promo codes
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  discount_percent REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  active INTEGER DEFAULT 1,
  uses INTEGER DEFAULT 0,
  max_uses INTEGER,
  expires_at TEXT
);

-- Notifications log
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id TEXT REFERENCES offers(id),
  type TEXT NOT NULL,
  channel TEXT DEFAULT 'email',
  recipient TEXT,
  subject TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);

-- Settings (key/value store for widget config, company info, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Admin users (Reusely-style email/password login)
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Admin sessions issued after login
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed default workflow stages
INSERT OR IGNORE INTO workflow_stages (id, name, label, sort_order, send_email) VALUES
  ('active_lead', 'Active Leads', 'Active Leads', 1, 1),
  ('in_transit', 'In-Transit', 'In-Transit', 2, 1),
  ('delivered', 'Delivered', 'Delivered', 3, 1),
  ('being_inspected', 'Being Inspected', 'Being Inspected', 4, 0),
  ('general_hold', 'General Hold', 'General Hold', 5, 0),
  ('payout_processing', 'Payout Processing', 'Payout Processing', 6, 0),
  ('revised_offer', 'Revised Offer', 'Revised Offer', 7, 1),
  ('completed', 'Completed', 'Completed', 8, 1),
  ('returned', 'Returned', 'Returned', 9, 1);

-- Seed default price sources
-- Sources that are actually scraped.
INSERT OR IGNORE INTO price_sources (id, name, label, enabled) VALUES
  ('univercell', 'UniverCell', 'UniverCell Buyback', 1),
  ('bell', 'Bell', 'Bell Trade-In', 1),
  ('telus', 'TELUS', 'TELUS Trade-In', 1),
  ('gorecell', 'GoRecell', 'GoRecell Buyback', 1);

-- Placeholder sources from the original seed. Nothing populates them: the
-- CSS-selector scraper that would have written 'local-market' never matched
-- GoRecell's markup, so all three reported 0 rows on every recorded run.
-- Seeded disabled so they stop showing as configured-but-empty in the scrape
-- report. Re-enable if a real feed is ever wired up.
INSERT OR IGNORE INTO price_sources (id, name, label, enabled) VALUES
  ('tech-genius-local', 'Tech Genius Local', 'Tech Genius Pricing', 0),
  ('local-market', 'Local Market', 'Local Pricing', 0),
  ('international-market', 'International Market', 'International Pricing', 0);

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('company_name', 'Tech Genius Burlington'),
  ('company_phone', '+1 (289) 455-5556'),
  ('company_email', 'info@techgenius.ca'),
  -- Where customers post mail-in trade-ins. Printed on the shipping label, so
  -- it needs the full street and postal code, not just the city.
  ('company_address', 'Tech Genius Burlington
796 Brant Street
Burlington, ON  L7R 2J2
Canada'),
  ('widget_brand_color', '#39b54a'),
  ('widget_cta_color', '#f79347'),
  ('payout_methods', '["etransfer","store-credit","paypal","cash"]'),
  ('offer_types', '["mail-in","drop-off"]'),
  ('frontend_price_source', 'gorecell'),
  ('frontend_price_mode', 'beat'),
  ('frontend_beat_percent', '2');
`;
