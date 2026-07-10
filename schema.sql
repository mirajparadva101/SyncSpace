-- ============================================================
-- SyncSpace ONE-SHOT FIX
-- Run ALL in Supabase → SQL Editor → Run
-- Fixes: grants, RLS, realtime publication, REPLICA IDENTITY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  created_by TEXT,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.texts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS texts_section_unique ON public.texts(section_id);

CREATE TABLE IF NOT EXISTS public.text_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id TEXT,
  user_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.todos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_data TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whiteboards (
  session_id TEXT PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  data TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

DO $$
BEGIN
  BEGIN ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS created_by TEXT; EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ; EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER TABLE public.texts ADD COLUMN IF NOT EXISTS updated_by TEXT; EXCEPTION WHEN others THEN NULL; END;
  BEGIN ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS user_id TEXT; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- Grants (fixes permission denied)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

-- RLS open demo policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.text_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whiteboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_all" ON public.users;
DROP POLICY IF EXISTS "sessions_all" ON public.sessions;
DROP POLICY IF EXISTS "sections_all" ON public.sections;
DROP POLICY IF EXISTS "texts_all" ON public.texts;
DROP POLICY IF EXISTS "text_versions_all" ON public.text_versions;
DROP POLICY IF EXISTS "chat_messages_all" ON public.chat_messages;
DROP POLICY IF EXISTS "todos_all" ON public.todos;
DROP POLICY IF EXISTS "files_all" ON public.files;
DROP POLICY IF EXISTS "whiteboards_all" ON public.whiteboards;

CREATE POLICY "users_all" ON public.users FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sessions_all" ON public.sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sections_all" ON public.sections FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "texts_all" ON public.texts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "text_versions_all" ON public.text_versions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "chat_messages_all" ON public.chat_messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "todos_all" ON public.todos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "files_all" ON public.files FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "whiteboards_all" ON public.whiteboards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Realtime: full row data on UPDATE/DELETE + publication
ALTER TABLE public.sessions REPLICA IDENTITY FULL;
ALTER TABLE public.sections REPLICA IDENTITY FULL;
ALTER TABLE public.texts REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.todos REPLICA IDENTITY FULL;
ALTER TABLE public.files REPLICA IDENTITY FULL;
ALTER TABLE public.whiteboards REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sections; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.texts; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.todos; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.files; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.whiteboards; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

SELECT 'syncspace_fix_ok' AS status, count(*) AS users FROM public.users;
