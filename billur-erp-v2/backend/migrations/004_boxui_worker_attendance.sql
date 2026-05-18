-- Migration 004: BoxUI integration, worker portal, attendance, box scan history

-- ── Worker role (isolated portal) ─────────────────────────────────────────
INSERT INTO roles (id, name_uz, is_system) VALUES
  ('worker', 'Ishchi (portal)', true)
ON CONFLICT (id) DO NOTHING;

-- ── New permissions ───────────────────────────────────────────────────────
INSERT INTO permissions (id, resource, action, description) VALUES
  ('workers.view_all',           'workers',    'view_all',    'Barcha ishchilarni ko''rish'),
  ('box.scan',                   'box',        'scan',        'Box barcode scan qilish'),
  ('boxapp.orders.read',         'boxapp',     'orders.read', 'BoxUI uchun zakazlarni o''qish'),
  ('attendance.checkin',         'attendance', 'checkin',     'Kelish/ketish'),
  ('attendance.view_own',        'attendance', 'view_own',    'O''z davomatini ko''rish'),
  ('attendance.view_all',        'attendance', 'view_all',    'Barcha davomat'),
  ('worker.portal',              'worker',     'portal',      'Ishchi portaliga kirish')
ON CONFLICT (id) DO NOTHING;

-- Fix migration 003 permissions that used wrong column names (idempotent)
INSERT INTO permissions (id, resource, action, description)
SELECT v.id, split_part(v.id, '.', 1), split_part(v.id, '.', 2), v.description
FROM (VALUES
  ('production.qr.create',   'production', 'qr.create',   'Production QR code yaratish'),
  ('production.qr.scan',   'production', 'qr.scan',     'Stage scan START/FINISH'),
  ('production.qr.override','production', 'qr.override', 'Admin lock override'),
  ('production.trace.view', 'production', 'trace.view',  'Traceability ko''rish'),
  ('payroll.view_own',      'payroll',    'view_own',    'O''z oyligini ko''rish'),
  ('payroll.view_all',      'payroll',    'view_all',    'Hamma payroll'),
  ('payroll.calculate',     'payroll',    'calculate',   'Payroll hisoblash'),
  ('payroll.approve',       'payroll',     'approve',     'Payroll tasdiqlash'),
  ('piece_rates.read',      'piece_rates','read',        'Piece rates ko''rish'),
  ('piece_rates.update',    'piece_rates','update',      'Piece rates tahrirlash'),
  ('workers.documents.view_own', 'workers', 'documents.view_own', 'O''z hujjatlari'),
  ('workers.documents.view_all', 'workers', 'documents.view_all', 'Hamma hujjatlar'),
  ('workers.documents.upload',   'workers', 'documents.upload',   'Hujjat yuklash'),
  ('boxapp.view',           'boxapp',     'view',        'BoxApp sync ko''rish'),
  ('boxapp.sync',           'boxapp',     'sync',        'BoxApp sync qilish'),
  ('boxapp.retry',          'boxapp',     'retry',       'BoxApp retry')
)  AS v(id, resource, action, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = v.id)
ON CONFLICT (id) DO NOTHING;

-- Owner gets all new perms
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'owner', id FROM permissions
WHERE id IN (
  'workers.view_all','box.scan','boxapp.orders.read',
  'attendance.checkin','attendance.view_own','attendance.view_all','worker.portal',
  'production.qr.create','production.qr.scan','production.qr.override','production.trace.view',
  'payroll.view_own','payroll.view_all','payroll.calculate','payroll.approve',
  'piece_rates.read','piece_rates.update',
  'workers.documents.view_own','workers.documents.view_all','workers.documents.upload',
  'boxapp.view','boxapp.sync','boxapp.retry'
)
ON CONFLICT DO NOTHING;

-- Admin
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'workers.view_all'),
  ('admin', 'box.scan'),
  ('admin', 'boxapp.orders.read'),
  ('admin', 'attendance.view_all'),
  ('admin', 'production.qr.create'),
  ('admin', 'production.qr.scan'),
  ('admin', 'production.qr.override'),
  ('admin', 'production.trace.view'),
  ('admin', 'payroll.view_all'),
  ('admin', 'payroll.calculate'),
  ('admin', 'piece_rates.read'),
  ('admin', 'piece_rates.update'),
  ('admin', 'workers.documents.view_all'),
  ('admin', 'workers.documents.upload'),
  ('admin', 'boxapp.view'),
  ('admin', 'boxapp.sync'),
  ('admin', 'boxapp.retry')
ON CONFLICT DO NOTHING;

-- Boxing operators (BoxUI)
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('boxing', 'box.scan'),
  ('boxing', 'box.create'),
  ('boxing', 'box.read'),
  ('boxing', 'boxapp.orders.read'),
  ('boxing', 'production.qr.scan'),
  ('boxing', 'attendance.checkin'),
  ('boxing', 'attendance.view_own')
ON CONFLICT DO NOTHING;

-- Packing
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('packing', 'production.qr.scan'),
  ('packing', 'attendance.checkin'),
  ('packing', 'attendance.view_own')
ON CONFLICT DO NOTHING;

-- Stage workers — production scan + attendance
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('cutting',  'production.qr.scan'), ('printing', 'production.qr.scan'),
  ('sewing',   'production.qr.scan'), ('quality',  'production.qr.scan'),
  ('ironing',  'production.qr.scan'),
  ('cutting',  'attendance.checkin'), ('printing', 'attendance.checkin'),
  ('sewing',   'attendance.checkin'), ('quality',  'attendance.checkin'),
  ('ironing',  'attendance.checkin'),
  ('cutting',  'attendance.view_own'), ('printing', 'attendance.view_own'),
  ('sewing',   'attendance.view_own'), ('quality',  'attendance.view_own'),
  ('ironing',  'attendance.view_own')
ON CONFLICT DO NOTHING;

-- Dedicated worker portal role
INSERT INTO role_permissions (role_id, permission_id) VALUES
  ('worker', 'worker.portal'),
  ('worker', 'payroll.view_own'),
  ('worker', 'workers.documents.view_own'),
  ('worker', 'attendance.checkin'),
  ('worker', 'attendance.view_own'),
  ('worker', 'production.qr.scan')
ON CONFLICT DO NOTHING;

-- ── Face enrollment on workers ─────────────────────────────────────────────
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS face_descriptor JSONB,
  ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ;

-- ── Attendance records ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id           UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id),
  record_type         TEXT NOT NULL CHECK (record_type IN ('check_in','check_out')),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  distance_meters     DOUBLE PRECISION,
  face_verified       BOOLEAN NOT NULL DEFAULT false,
  face_match_score    DOUBLE PRECISION,
  face_snapshot_path  TEXT,
  device_info         TEXT,
  user_agent          TEXT,
  ip_address          TEXT,
  idempotency_key     TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_worker ON attendance_records(worker_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(recorded_at DESC);

-- ── Box scan history (production packing against ERP orders) ───────────────
CREATE TABLE IF NOT EXISTS box_scan_events (
  id              BIGSERIAL PRIMARY KEY,
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   UUID REFERENCES order_items(id) ON DELETE SET NULL,
  box_uid         TEXT REFERENCES boxes(uid) ON DELETE SET NULL,
  worker_id       UUID REFERENCES workers(id),
  user_id         UUID REFERENCES users(id),
  barcode         TEXT,
  size_code       TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  scan_type       TEXT NOT NULL DEFAULT 'pack'
    CHECK (scan_type IN ('pack','validate','undo')),
  result          TEXT NOT NULL DEFAULT 'ok'
    CHECK (result IN ('ok','duplicate','invalid_size','overproduction','error')),
  message         TEXT,
  device_id       TEXT,
  ip_address      TEXT,
  idempotency_key TEXT UNIQUE,
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_box_scan_order ON box_scan_events(order_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_box_scan_box ON box_scan_events(box_uid) WHERE box_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_box_scan_barcode ON box_scan_events(barcode) WHERE barcode IS NOT NULL;

-- Link boxes to scan events
ALTER TABLE boxes
  ADD COLUMN IF NOT EXISTS scan_session_id UUID;

-- Order production summary cache (optional denorm for BoxUI speed)
CREATE TABLE IF NOT EXISTS order_production_summary (
  order_id          UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  total_ordered     INTEGER NOT NULL DEFAULT 0,
  total_boxed       INTEGER NOT NULL DEFAULT 0,
  total_remaining   INTEGER NOT NULL DEFAULT 0,
  is_complete       BOOLEAN NOT NULL DEFAULT false,
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency for duplicate request prevention
CREATE TABLE IF NOT EXISTS api_idempotency (
  key           TEXT PRIMARY KEY,
  user_id       UUID,
  endpoint      TEXT NOT NULL,
  response_code INTEGER,
  response_body JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON api_idempotency(expires_at);
