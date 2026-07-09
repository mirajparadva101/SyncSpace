-- ============================================================
-- SyncSpace Database Schema (Supabase / PostgreSQL)
-- Simple auth (User ID + Password), realtime collaboration
-- ============================================================

-- Users (simple auth — no JWT)
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT NOT NULL, -- SHA-256 hashed
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Collaboration sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, -- 6-character unique ID
  name TEXT NOT NULL,
  password TEXT NOT NULL, -- SHA-256 hashed
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document sections within a session
CREATE TABLE IF NOT EXISTS sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Text content per section
CREATE TABLE IF NOT EXISTS texts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Version history for text
CREATE TABLE IF NOT EXISTS text_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  content TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Todos / tasks
CREATE TABLE IF NOT EXISTS todos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared files (base64 stored for simplicity)
CREATE TABLE IF NOT EXISTS files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_data TEXT NOT NULL, -- Base64 data URL
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sections_session ON sections(session_id);
CREATE INDEX IF NOT EXISTS idx_texts_section ON texts(section_id);
CREATE INDEX IF NOT EXISTS idx_texts_session ON texts(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id);
CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id);
CREATE INDEX IF NOT EXISTS idx_versions_section ON text_versions(section_id);

-- Enable Realtime (run in Supabase SQL editor)
-- ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE sections;
ALTER PUBLICATION supabase_realtime ADD TABLE texts;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE todos;
ALTER PUBLICATION supabase_realtime ADD TABLE files;

-- Optional: open RLS policies for anon key demo use
-- For production, tighten these with proper policies.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "sessions_all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "sections_all" ON sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "texts_all" ON texts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "text_versions_all" ON text_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "chat_messages_all" ON chat_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "todos_all" ON todos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "files_all" ON files FOR ALL USING (true) WITH CHECK (true);
