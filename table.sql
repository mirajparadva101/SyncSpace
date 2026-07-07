-- Enable UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sessions table
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sections table
CREATE TABLE sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Texts table (har section ka content)
CREATE TABLE texts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID UNIQUE REFERENCES sections(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Files table (base64 stored)
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_data TEXT NOT NULL,
    file_type TEXT,
    file_size BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table (naya add karo)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS enable karo
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Public access policies (security = session ID + password)
CREATE POLICY "Public sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public sections" ON sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public texts" ON texts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public files" ON files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public users" ON users FOR ALL USING (true) WITH CHECK (true);

-- Realtime enable karo
ALTER PUBLICATION supabase_realtime ADD TABLE sections;
ALTER PUBLICATION supabase_realtime ADD TABLE texts;
ALTER PUBLICATION supabase_realtime ADD TABLE files;
ALTER PUBLICATION supabase_realtime ADD TABLE users;