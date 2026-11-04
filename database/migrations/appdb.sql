CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  prefix VARCHAR(30) NOT NULL DEFAULT '',
  first_name VARCHAR(80) NOT NULL DEFAULT '',
  last_name VARCHAR(80) NOT NULL DEFAULT '',
  full_name VARCHAR(150),
  nickname VARCHAR(60) NOT NULL DEFAULT '',
  age INTEGER,
  phone VARCHAR(20) NOT NULL DEFAULT '',
  role VARCHAR(50) NOT NULL DEFAULT 'waiter',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_mongo_id ON users(mongo_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

CREATE TABLE IF NOT EXISTS membership_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  points_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
  min_points INTEGER NOT NULL DEFAULT 0,
  benefits JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membership_tiers_tier_name ON membership_tiers(tier_name);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  member_id VARCHAR(50) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL UNIQUE,
  prefix VARCHAR(30) NOT NULL DEFAULT '',
  full_name VARCHAR(150) NOT NULL,
  nickname VARCHAR(60) NOT NULL DEFAULT '',
  age INTEGER,
  email VARCHAR(150) NOT NULL DEFAULT '',
  tier_id UUID REFERENCES membership_tiers(id) ON DELETE SET NULL,
  tier_name VARCHAR(50),
  points_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  visit_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  registered_via VARCHAR(30) NOT NULL DEFAULT 'admin',
  created_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_mongo_id ON members(mongo_id);
CREATE INDEX IF NOT EXISTS idx_members_member_id ON members(member_id);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
CREATE INDEX IF NOT EXISTS idx_members_tier_id ON members(tier_id);
CREATE INDEX IF NOT EXISTS idx_members_is_active ON members(is_active);

CREATE TABLE IF NOT EXISTS shop_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  restaurant_name VARCHAR(200),
  welcome_message TEXT NOT NULL DEFAULT '',
  phone VARCHAR(40) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  open_time VARCHAR(10) NOT NULL DEFAULT '10:30',
  close_time VARCHAR(10) NOT NULL DEFAULT '03:00',
  last_queue_time VARCHAR(10) NOT NULL DEFAULT '02:00',
  timezone VARCHAR(60) NOT NULL DEFAULT 'Asia/Bangkok',
  is_test_mode BOOLEAN NOT NULL DEFAULT false,
  dining_duration_minutes INTEGER NOT NULL DEFAULT 90,
  logo_url TEXT NOT NULL DEFAULT '/assets/images/logo.png',
  hero_image_url TEXT NOT NULL DEFAULT '',
  vat_percent NUMERIC(5, 2) NOT NULL DEFAULT 7.00,
  service_charge_percent NUMERIC(5, 2) NOT NULL DEFAULT 10.00,
  vat_mode VARCHAR(20) NOT NULL DEFAULT 'included',
  service_charge_mode VARCHAR(20) NOT NULL DEFAULT 'included',
  buffet_signature_price NUMERIC(10, 2) NOT NULL DEFAULT 499.00,
  buffet_premium_price NUMERIC(10, 2) NOT NULL DEFAULT 599.00,
  buffet_deluxe_price NUMERIC(10, 2) NOT NULL DEFAULT 699.00,
  refill_drink_price NUMERIC(10, 2) NOT NULL DEFAULT 49.00,
  prompt_pay_id VARCHAR(100),
  payment_qr_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_settings_key ON shop_settings(setting_key);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_session_id VARCHAR(100) UNIQUE,
  queue_id VARCHAR(100),
  table_id VARCHAR(100),
  customer_count INTEGER NOT NULL DEFAULT 1,
  dining_style VARCHAR(20) NOT NULL DEFAULT 'alacarte',
  buffet_package_code VARCHAR(100) DEFAULT '',
  buffet_package_name VARCHAR(150) DEFAULT '',
  buffet_price_per_person NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  has_refill_drink BOOLEAN NOT NULL DEFAULT false,
  refill_price_per_person NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ NOT NULL,
  actual_end_time TIMESTAMPTZ,
  checkout_requested_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  service_charge NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  vat NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  member_id VARCHAR(100),
  member_phone VARCHAR(20),
  member_name VARCHAR(150),
  member_tier_name VARCHAR(50),
  benefit_type VARCHAR(20) NOT NULL DEFAULT '',
  applied_promotion_id VARCHAR(100),
  applied_promo_code VARCHAR(50),
  applied_promo_title VARCHAR(150),
  points_to_redeem INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  loyalty_processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_queue_id ON sessions(queue_id);
CREATE INDEX IF NOT EXISTS idx_sessions_table_id ON sessions(table_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_is_paid ON sessions(is_paid);
CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_mongo_session_id ON sessions(mongo_session_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_order_id VARCHAR(100) UNIQUE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  table_id VARCHAR(100) NOT NULL,
  total_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  accepted_at TIMESTAMPTZ,
  cooking_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_id ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_item_id VARCHAR(100) UNIQUE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_id VARCHAR(100),
  name VARCHAR(200) NOT NULL,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  quantity INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  item_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_id ON order_items(menu_id);
CREATE INDEX IF NOT EXISTS idx_order_items_item_status ON order_items(item_status);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_payment_id VARCHAR(100) UNIQUE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  mongo_session_id VARCHAR(100),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  method VARCHAR(20) NOT NULL DEFAULT 'cash',
  cash_received NUMERIC(12, 2),
  change_due NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by_ref VARCHAR(100),
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by_ref VARCHAR(100),
  confirmed_at TIMESTAMPTZ,
  note TEXT DEFAULT '',
  slip_image_url TEXT DEFAULT '',
  slip_uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_session_id ON payments(session_id);
CREATE INDEX IF NOT EXISTS idx_payments_mongo_session_id ON payments(mongo_session_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

CREATE TABLE IF NOT EXISTS point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  session_ref VARCHAR(100) DEFAULT '',
  promotion_id VARCHAR(100),
  type VARCHAR(20) NOT NULL,
  points INTEGER NOT NULL,
  points_before INTEGER NOT NULL DEFAULT 0,
  points_after INTEGER NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  bill_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_ref VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_transactions_mongo_id ON point_transactions(mongo_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_member_id ON point_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_session_id ON point_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_session_ref ON point_transactions(session_ref);
CREATE INDEX IF NOT EXISTS idx_point_transactions_type ON point_transactions(type);
CREATE INDEX IF NOT EXISTS idx_point_transactions_created_at ON point_transactions(created_at);

CREATE TABLE IF NOT EXISTS tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  table_number VARCHAR(50) NOT NULL UNIQUE,
  capacity INTEGER NOT NULL DEFAULT 2,
  min_capacity INTEGER NOT NULL DEFAULT 1,
  zone VARCHAR(30) NOT NULL DEFAULT 'small',
  status VARCHAR(30) NOT NULL DEFAULT 'available',
  current_session_id VARCHAR(100),
  reserved_for_queue_id VARCHAR(100),
  last_session_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tables_mongo_id ON tables(mongo_id);
CREATE INDEX IF NOT EXISTS idx_tables_zone_status ON tables(zone, status);

CREATE TABLE IF NOT EXISTS queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  queue_number VARCHAR(30) NOT NULL,
  business_date VARCHAR(20),
  sequence INTEGER,
  customer_count INTEGER NOT NULL DEFAULT 1,
  dining_style VARCHAR(20) NOT NULL DEFAULT 'alacarte',
  buffet_package_code VARCHAR(100) NOT NULL DEFAULT '',
  has_refill_drink BOOLEAN NOT NULL DEFAULT false,
  customer_name VARCHAR(150) DEFAULT '',
  customer_phone VARCHAR(30) DEFAULT '',
  member_id VARCHAR(100),
  access_token_hash VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'waiting',
  preferred_zone VARCHAR(30),
  preferred_table_id VARCHAR(100),
  auto_assign BOOLEAN NOT NULL DEFAULT true,
  assigned_table_id VARCHAR(100),
  assignment_note TEXT NOT NULL DEFAULT '',
  qr_code_data TEXT,
  called_at TIMESTAMPTZ,
  seated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  no_show_at TIMESTAMPTZ,
  table_id VARCHAR(100),
  session_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queues_mongo_id ON queues(mongo_id);
CREATE INDEX IF NOT EXISTS idx_queues_business_date ON queues(business_date, queue_number);
CREATE INDEX IF NOT EXISTS idx_queues_status ON queues(status, created_at);

CREATE TABLE IF NOT EXISTS queue_counters (
  counter_id VARCHAR(150) PRIMARY KEY,
  sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  category VARCHAR(100) NOT NULL DEFAULT '',
  buffet_tier VARCHAR(40) NOT NULL DEFAULT 'auto',
  image_url TEXT NOT NULL DEFAULT '/assets/images/default-food.jpg',
  is_available BOOLEAN NOT NULL DEFAULT true,
  preparation_time INTEGER NOT NULL DEFAULT 10,
  stock_quantity INTEGER,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  max_order_quantity INTEGER NOT NULL DEFAULT 99,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menus_mongo_id ON menus(mongo_id);
CREATE INDEX IF NOT EXISTS idx_menus_category ON menus(category);
CREATE INDEX IF NOT EXISTS idx_menus_is_available ON menus(is_available);

CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  promo_code VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  discount_type VARCHAR(20) NOT NULL DEFAULT 'FIXED',
  discount_value NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  points_cost INTEGER NOT NULL DEFAULT 0,
  min_spend NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  max_discount NUMERIC(10, 2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_mongo_id ON promotions(mongo_id);
CREATE INDEX IF NOT EXISTS idx_promotions_is_active ON promotions(is_active);

CREATE TABLE IF NOT EXISTS feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  mongo_session_id VARCHAR(100),
  table_id VARCHAR(100),
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_mongo_id ON feedbacks(mongo_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_session_id ON feedbacks(session_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mongo_id VARCHAR(100) UNIQUE,
  action VARCHAR(100) NOT NULL,
  actor_id VARCHAR(100),
  actor_username VARCHAR(100) NOT NULL DEFAULT 'anonymous',
  actor_role VARCHAR(40) NOT NULL DEFAULT '',
  ip VARCHAR(100) NOT NULL DEFAULT '',
  target_type VARCHAR(60) NOT NULL DEFAULT '',
  target_id VARCHAR(100) NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_mongo_id ON audit_logs(mongo_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

INSERT INTO shop_settings (
  setting_key, restaurant_name, vat_percent, service_charge_percent, vat_mode, service_charge_mode
) VALUES (
  'shop-settings', 'Smart Queue Restaurant', 7.00, 10.00, 'included', 'included'
) ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_image_url TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_uploaded_at TIMESTAMPTZ;

INSERT INTO membership_tiers (tier_name, display_name, discount_percent, points_multiplier, min_points)
VALUES
  ('MEMBER', 'สมาชิกทั่วไป', 0.00, 1.00, 0),
  ('SILVER', 'Silver', 5.00, 1.20, 50),
  ('GOLD', 'Gold', 10.00, 1.50, 150),
  ('VIP', 'VIP', 15.00, 2.00, 400)
ON CONFLICT (tier_name) DO NOTHING;
