-- ---
-- 📚 POR QUÉ: Define el esquema de base de datos para la plataforma web SaaS.
--    Row Level Security (RLS) garantiza que cada usuario solo ve sus propias filas —
--    esto es la barrera fundamental de seguridad multi-tenant. Sin RLS, una query
--    SQL inyectada o un bug en el frontend expondría datos de todos los usuarios.
-- 📁 ARCHIVO: web/lib/supabase/schema.sql
-- ---

-- ══════════════════════════════════════════
-- Users (extends Supabase auth.users)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  telegram_chat_id TEXT UNIQUE,  -- NULL until Telegram is linked
  full_name TEXT NOT NULL,
  data_consent BOOLEAN NOT NULL DEFAULT false,
  consent_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own data"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ══════════════════════════════════════════
-- User Settings
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
  alert_threshold TEXT NOT NULL DEFAULT 'HIGH',
  location_lat FLOAT8 NOT NULL DEFAULT 5.0703,
  location_lon FLOAT8 NOT NULL DEFAULT -75.5138,
  location_name TEXT NOT NULL DEFAULT 'Manizales, Colombia',
  voice_enabled BOOLEAN NOT NULL DEFAULT true,
  report_frequency_hours INTEGER NOT NULL DEFAULT 6,
  language TEXT NOT NULL DEFAULT 'es'
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ══════════════════════════════════════════
-- Risk Reports
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.risk_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  alert_level TEXT NOT NULL,
  risk_probability FLOAT8 NOT NULL,
  mean_saturation FLOAT8 NOT NULL,
  precipitation_mm FLOAT8,
  temperature_c FLOAT8,
  humidity_pct FLOAT8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.risk_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reports"
  ON public.risk_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert reports"
  ON public.risk_reports FOR INSERT
  WITH CHECK (true);  -- Bot uses service_role key to insert

-- Index for efficient queries by user
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON public.risk_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.risk_reports(created_at DESC);

-- ══════════════════════════════════════════
-- Physical Site State
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.site_state (
  site_id TEXT PRIMARY KEY,
  S_estimate FLOAT8 NOT NULL CHECK (S_estimate >= 0 AND S_estimate <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read physical site state"
  ON public.site_state FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can insert physical site state"
  ON public.site_state FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update physical site state"
  ON public.site_state FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
