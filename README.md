<div align="center">

# 🚀 SyncSpace

### Real-Time Collaborative Workspace

![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Supabase-Backend-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployment-black?style=for-the-badge&logo=vercel&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952B3?style=for-the-badge&logo=bootstrap&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

**SyncSpace** is a modern, secure, and real-time collaborative workspace that allows teams to share text notes and files instantly across multiple devices. It includes user authentication, a live analytics dashboard, and secure runtime configuration using environment variables.

[🌍 Live Demo](https://sync-space-ten.vercel.app) • [📄 Documentation](#-getting-started) • [🐛 Report Bug](https://github.com/mirajparadva101/syncspace/issues) • [✨ Request Feature](https://github.com/mirajparadva101/syncspace/issues)

</div>

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [📂 Project Structure](#-project-structure)
- [🚀 Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Supabase Database Setup](#1-supabase-database-setup)
  - [2. Deploy to Vercel (Production)](#2-deploy-to-vercel-production)
  - [3. Run Locally (Development)](#3-run-locally-development)
- [🔒 Security Architecture](#-security-architecture)
- [💡 How It Works](#-how-it-works)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Key Features

| Category | Features |
|---|---|
| **🔐 Authentication** | Secure Sign Up & Sign In, SHA-256 + Salt Password Hashing, Auto-login via LocalStorage |
| **📊 Live Dashboard** | Real-time count of Registered Users & Active Sessions directly from the database |
| **🛡️ Security** | Zero hardcoded API keys, Vercel Environment Variables, Serverless Config API |
| **📝 Collaboration** | Real-time text sync across devices, Debounced saving (600ms), Cursor position preservation |
| **📂 Organization** | Create multiple named sections inside a session, File count badges |
| **📎 File Sharing** | Upload, download, and delete files (Max 2MB), Base64 secure storage, Drag & drop support |
| **🎨 UI/UX** | Professional Dark Theme, Teal accents, Fully responsive design, Animated particles |
| **🔗 Sharing** | Auto-generated 6-char Session ID, Shareable links using `?join=SESSION_ID` |
| **📤 Export** | Copy all text to clipboard, Download sections as `.txt` files |

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), Bootstrap 5.3
- **Icons & Fonts:** Font Awesome 6, Space Grotesk, JetBrains Mono
- **Backend/Database:** Supabase (PostgreSQL, Realtime WebSockets, Row Level Security)
- **Hosting/Serverless:** Vercel (Serverless Functions for secure config delivery)

---

## 📂 Project Structure

```text
syncspace/
├── api/
│   └── config.js        # Vercel Serverless Function
├── index.html           # Complete Frontend Application
├── vercel.json          # Routing configuration for Vercel rewrites
├── README.md            # Project Documentation
└── LICENSE              # MIT License
```

---

## 🚀 Getting Started

### Prerequisites

Before starting, make sure you have:

- A **Supabase account**
- A **Vercel account**
- A **GitHub account**
- A modern browser like Chrome, Firefox, Edge, or Safari

---

### 1. Supabase Database Setup

#### Step 1: Create a Supabase Project

1. Go to [Supabase](https://supabase.com) and log in.
2. Click **New Project**.
3. Enter your project name and database password.
4. Select a region close to your users.
5. Wait until the project finishes initialization.

#### Step 2: Run the Database Schema

1. Open your Supabase dashboard.
2. Go to **SQL Editor**.
3. Click **New Query**.
4. Paste the SQL script below and click **Run**.

```sql
-- ==========================================
-- 1. ENABLE UUID GENERATION
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 2. CREATE TABLES
-- ==========================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE texts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id UUID UNIQUE REFERENCES sections(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- ==========================================
-- 3. ENABLE ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public sections" ON sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public texts" ON texts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public files" ON files FOR ALL USING (true) WITH CHECK (true);

-- ==========================================
-- 4. ENABLE REALTIME
-- ==========================================
ALTER PUBLICATION supabase_realtime ADD TABLE sections;
ALTER PUBLICATION supabase_realtime ADD TABLE texts;
ALTER PUBLICATION supabase_realtime ADD TABLE files;
```

#### Step 3: Verify Realtime Configuration

1. Open **Database → Replication**.
2. Turn ON realtime for:
   - `sections`
   - `texts`
   - `files`
3. Save changes if required.

#### Step 4: Get API Credentials

1. Go to **Project Settings → API**.
2. Copy your **Project URL**.
3. Copy your **anon public key**.

> ⚠️ Never hardcode these credentials inside frontend code or push them directly to GitHub.

---

### 2. Deploy to Vercel (Production)

This app is designed to keep Supabase credentials outside the frontend source code.

1. Push the project to your GitHub repository.
2. Open [Vercel](https://vercel.com) and click **Add New Project**.
3. Import your GitHub repository.
4. Add the following environment variables before deployment:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase Project URL |
| `SUPABASE_ANON_KEY` | Your Supabase Anon Public Key |

5. Click **Deploy**.
6. After deployment, the app will fetch configuration securely from `/api/config`.

---

### 3. Run Locally (Development)

If you open `index.html` directly in the browser, the `/api/config` route will not work because no Vercel server is running locally.

1. Open `index.html` in your browser.
2. The app will show a **Manual Configuration** screen.
3. Enter your Supabase URL and anon key.
4. The values will be stored in browser LocalStorage.

#### Optional: Run with Vercel locally

```bash
npm i -g vercel
vercel env pull .env.local
vercel dev
```

---

## 🔒 Security Architecture

This project uses a secure runtime config flow for Supabase credentials.

```text
┌──────────────┐         GET /api/config          ┌──────────────────────┐
│              │ ───────────────────────────────► │                      │
│  Client App  │                                   │  Vercel Serverless   │
│ (index.html) │ ◄─────────────────────────────── │  (api/config.js)     │
│              │   { url, key } JSON Response      │                      │
└──────────────┘                                   └──────────┬───────────┘
                                                              │
                                                   Reads from Vercel
                                                   Environment Variables
                                                   (SUPABASE_URL, SUPABASE_ANON_KEY)
                                                              │
                                                   ┌──────────▼───────────┐
                                                   │                      │
                                                   │  Secure Env Storage  │
                                                   │  (Not hardcoded)     │
                                                   └──────────────────────┘
```

### Security Flow

1. **Zero Hardcoded Keys** — No Supabase secrets are written directly in `index.html`.
2. **Runtime Fetching** — The frontend requests config from `/api/config`.
3. **Serverless Protection** — The serverless function reads Vercel environment variables.
4. **Graceful Fallback** — For local development, users can manually provide config values.

---

## 💡 How It Works

1. **Authentication**  
   Users can sign up and sign in using Name, User ID, and Password. Passwords are hashed with **SHA-256 + salt** before storage.

2. **Dashboard**  
   The home screen displays live stats such as total users and active sessions.

3. **Session Management**  
   Creating a session generates a unique 6-character uppercase session ID. Session passwords are hashed before being stored.

4. **Real-Time Sync**  
   Text updates are debounced by 600ms, saved to the database, and synced live to all connected users through Supabase Realtime.

5. **File Sharing**  
   Files are converted to Base64 and stored in the `files` table with a maximum size limit of 2MB.

---

## 🤝 Contributing

Contributions are welcome and appreciated.

1. Fork the repository
2. Create your feature branch

```bash
git checkout -b feature/AmazingFeature
```

3. Commit your changes

```bash
git commit -m "Add some AmazingFeature"
```

4. Push to the branch

```bash
git push origin feature/AmazingFeature
```

5. Open a Pull Request

---

## 📄 License

This project is distributed under the **MIT License**. See the `LICENSE` file for more information.

---

<div align="center">

### Built with ❤️ by Miraj Paradva

[GitHub](https://github.com/mirajparadva101/syncspace) • [Email](mailto:mirajstudy101@gmail.com)

</div>
