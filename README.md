<div align="center">

# 🚀 SyncSpace

### Real-Time Collaborative Workspace

**SyncSpace** is a modern, secure, and real-time collaborative workspace that allows teams to share text notes, files, and chat instantly across multiple devices. It includes user authentication with 2FA, real-time synchronization, and secure environment configuration.

[🌍 Live Demo](https://your-vercel-app.vercel.app) - [📄 Documentation](#-getting-started) - [🐛 Report Bug](https://github.com/mirajparadva101/syncspace/issues) - [✨ Request Feature](https://github.com/mirajparadva101/syncspace/issues)

</div>

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [📂 Project Structure](#-project-structure)
- [📄 file-structure.txt](#-file-structuretxt)
- [🚀 Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Supabase Database Setup](#1-supabase-database-setup)
  - [2. Deploy to Vercel (Production)](#2-deploy-to-vercel-production)
  - [3. Run Locally (Development)](#3-run-locally-development)
- [🔒 Security Architecture](#-security-architecture)
- [💡 How It Works](#-how-it-works)
- [🎯 Features Deep Dive](#-features-deep-dive)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Key Features

| Category                  | Features                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **🔐 Authentication**     | Secure Sign Up & Sign In, bcrypt Password Hashing, JWT Tokens, 2FA Support, Auto-login |
| **👥 Session Management** | Create/Join sessions with password, 6-char unique IDs, Session timeout (30 min)        |
| **📝 Real-time Editor**   | Rich text editing, Auto-save with debouncing, Version history, Typing indicators       |
| **💬 Chat**               | Real-time messaging, Typing indicators, User presence, Message history                 |
| **📎 File Sharing**       | Upload images/PDFs/TXT (Max 2MB), Image compression, Preview support, Base64 storage   |
| **✅ Task Management**    | Create/complete/delete todos, Real-time sync across devices                            |
| **🎨 Whiteboard**         | Draw with mouse/touch, Real-time collaboration, Crosshair cursor                       |
| **📂 Organization**       | Create multiple sections, Drag-drop reordering, Search sections                        |
| **🛡️ Security**           | Zero hardcoded API keys, Vercel Environment Variables, Rate limiting, Helmet.js        |
| **🎨 UI/UX**              | Dark/Light theme, Fully responsive, Mobile-friendly, PWA support                       |
| **📤 Export**             | Export all data as JSON, Copy to clipboard, Download as TXT                            |

---

## 🛠️ Tech Stack

### Frontend

- **HTML5, CSS3** - Semantic markup, custom properties
- **Vanilla JavaScript (ES6+)** - No frameworks needed
- **Service Worker** - Offline support (PWA)
- **Font Awesome 6** - Icons
- **Space Grotesk** - Typography

### Backend

- **Node.js + Express** - Server runtime
- **Supabase** - PostgreSQL database, Realtime WebSockets
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing
- **speakeasy** - 2FA implementation
- **QRCode** - 2FA QR code generation

### Security & Middleware

- **Helmet.js** - Security headers
- **express-rate-limit** - Rate limiting
- **CORS** - Cross-origin resource sharing

### Hosting

- **Vercel** - Serverless deployment

---

## 📂 Project Structure

```text
syncspace/
├── server.js              # Main Express server (all APIs)
├── package.json           # Dependencies
├── .env.example           # Environment template (NO real keys)
├── vercel.json            # Vercel deployment config
├── .gitignore             # Git ignore file
├── README.md
├── file-structure.txt     # Plain text project structure
├── public/
│   ├── index.html         # Main app HTML
│   ├── app.js             # Complete frontend logic
│   ├── style.css          # All styles (Dark/Light theme)
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service Worker
└── supabase/
    └── schema.sql         # Database schema
```

---

## 📄 file-structure.txt

Create this file in your project root as `file-structure.txt`:

```text
syncspace/
├── server.js              # Main Express server (all APIs)
├── package.json           # Dependencies
├── .env.example           # Environment template (NO real keys)
├── vercel.json            # Vercel deployment config
├── .gitignore             # Git ignore file
├── README.md
├── file-structure.txt     # Plain text project structure
├── public/
│   ├── index.html         # Main app HTML
│   ├── app.js             # Complete frontend logic
│   ├── style.css          # All styles (Dark/Light theme)
│   ├── manifest.json      # PWA manifest
│   └── sw.js              # Service Worker
└── supabase/
    └── schema.sql         # Database schema
```

---

## 🚀 Getting Started

### Prerequisites

Before starting, make sure you have:

- A **Supabase account** (free tier works)
- A **Vercel account** (free tier works)
- A **GitHub account**
- **Node.js** installed (for local development)
- Modern browser (Chrome, Firefox, Edge, Safari)

---

### 1. Supabase Database Setup

#### Step 1: Create a Supabase Project

1. Go to Supabase and log in.
2. Click **New Project**.
3. Enter your project name and database password.
4. Select a region close to your users.
5. Wait until the project finishes initialization (2-3 minutes).

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

-- Users table
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'editor',
  two_factor_secret TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sections table
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Texts table
CREATE TABLE IF NOT EXISTS texts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Text versions (history)
CREATE TABLE IF NOT EXISTS text_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Todos
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Files
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_data TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activity logs
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  user_name TEXT,
  action TEXT,
  details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- 3. INDEXES FOR PERFORMANCE
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_sections_session_id ON sections(session_id);
CREATE INDEX IF NOT EXISTS idx_texts_section_id ON texts(section_id);
CREATE INDEX IF NOT EXISTS idx_text_versions_section_id ON text_versions(section_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_todos_session_id ON todos(session_id);
CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_session_id ON activity_logs(session_id);

-- ==========================================
-- 4. ENABLE REALTIME
-- ==========================================

ALTER PUBLICATION supabase_realtime ADD TABLE sections;
ALTER PUBLICATION supabase_realtime ADD TABLE texts;
ALTER PUBLICATION supabase_realtime ADD TABLE files;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE todos;
```

#### Step 3: Get API Credentials

1. Go to **Project Settings → API**.
2. Copy your **Project URL**.
3. Copy your **anon public key**.

> ⚠️ **IMPORTANT:** Never hardcode these credentials inside frontend code or push them directly to GitHub.

---

### 2. Deploy to Vercel (Production)

#### Step 1: Prepare Your Repository

Create a GitHub repository and push all files:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/syncspace.git
git push -u origin main
```

#### Step 2: Deploy to Vercel

1. Go to Vercel and sign in.
2. Click **Add New → Project**.
3. Import your GitHub repository.
4. **Add Environment Variables:**

| Name                | Value                                     | Where to Get             |
| ------------------- | ----------------------------------------- | ------------------------ |
| `SUPABASE_URL`      | `https://your-project.supabase.co`        | Supabase Dashboard → API |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Supabase Dashboard → API |
| `JWT_SECRET`        | `your-random-secret-key`                  | Generate securely        |

5. Click **Deploy**.

#### Step 3: Verify Deployment

After deployment:

1. Open your Vercel URL
2. You should see the SyncSpace login page
3. Sign up for a new account
4. Create/join a session
5. Test real-time collaboration

---

### 3. Run Locally (Development)

#### Option A: Full Local Setup (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/syncspace.git
cd syncspace

# 2. Install dependencies
npm install

# 3. Create .env file
cp .env.example .env

# 4. Edit .env with your Supabase credentials
nano .env
# Add:
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_ANON_KEY=your-anon-key
# JWT_SECRET=your-secret-key

# 5. Start the server
npm start

# 6. Open browser
# http://localhost:3000
```

#### Option B: Manual Configuration

If you open `index.html` directly in the browser:

1. Open `index.html` in your browser
2. The app will show a **Manual Configuration** screen
3. Enter your Supabase URL and anon key
4. Click **Save & Connect**
5. The values will be stored in browser LocalStorage

> 💡 **Note:** For full features (real-time, 2FA, etc.), use Option A with the server running.

---

## 🔒 Security Architecture

This project uses a secure runtime config flow for Supabase credentials.

```text
┌──────────────┐         GET /api/config          ┌──────────────────────┐
│              │ ───────────────────────────────► │                      │
│  Client App  │                                   │  Vercel Serverless   │
│ (index.html) │ ◄─────────────────────────────── │  (server.js)         │
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

### Security Features

| Feature                | Implementation                                |
| ---------------------- | --------------------------------------------- |
| **No Hardcoded Keys**  | Supabase credentials in Vercel Dashboard only |
| **Password Hashing**   | bcrypt (10 rounds)                            |
| **JWT Authentication** | 24-hour expiration, secure signing            |
| **2FA Support**        | TOTP with speakeasy                           |
| **Rate Limiting**      | 100 requests/15 min (20 for auth)             |
| **Security Headers**   | Helmet.js (HSTS, CSP, XSS protection)         |
| **CORS Protection**    | Restricted to specific origins                |
| **Input Validation**   | All API endpoints validated                   |
| **File Validation**    | Type, size, format checking                   |
| **Session Timeout**    | 30 minutes inactivity                         |
| **SQL Injection**      | Supabase parameterized queries                |

---

## 💡 How It Works

### 1. Authentication Flow

```text
User Sign Up
    ↓
Hash password with bcrypt
    ↓
Store in Supabase users table
    ↓
User Sign In
    ↓
Verify credentials
    ↓
Check 2FA (if enabled)
    ↓
Generate JWT token
    ↓
Store in localStorage
    ↓
Auto-login on subsequent visits
```

### 2. Real-time Collaboration Flow

```text
User types in editor
    ↓
Debounce (600ms)
    ↓
Save to Supabase texts table
    ↓
Supabase Realtime broadcasts change
    ↓
All connected users receive update
    ↓
Editor content updates automatically
```

### 3. Session Management

```text
Create Session
    ↓
Generate 6-char unique ID
    ↓
Hash password with bcrypt
    ↓
Store in Supabase sessions table
    ↓
Share Session ID with team
    ↓
Others join using Session ID + Password
```

### 4. File Sharing Flow

```text
User selects file
    ↓
Check file type & size
    ↓
Compress image (if > 500KB)
    ↓
Convert to Base64
    ↓
Store in Supabase files table
    ↓
All users can view/download
```

---

## 🎯 Features Deep Dive

### Authentication & Security

| Feature              | Description                                  |
| -------------------- | -------------------------------------------- |
| **Sign Up**          | User ID, Full Name, Password (min 6 chars)   |
| **Sign In**          | User ID + Password verification              |
| **2FA**              | Optional two-factor authentication with TOTP |
| **JWT Tokens**       | 24-hour valid tokens stored in localStorage  |
| **Session Timeout**  | Auto-logout after 30 minutes of inactivity   |
| **Password Hashing** | bcrypt with 10 rounds                        |

### Real-time Collaboration

| Feature               | Description                              |
| --------------------- | ---------------------------------------- |
| **Rich Text Editor**  | ContentEditable with formatting support  |
| **Auto-save**         | Debounced save (600ms)                   |
| **Version History**   | Each save creates a version entry        |
| **Typing Indicators** | Shows who is typing in real-time         |
| **Cursor Sync**       | Maintains cursor position across devices |

### Communication

| Feature               | Description                         |
| --------------------- | ----------------------------------- |
| **Chat**              | Real-time messaging with user names |
| **Typing Indicators** | Shows when others are typing        |
| **Message History**   | Last 100 messages stored            |

### File Management

| Feature         | Description                          |
| --------------- | ------------------------------------ |
| **Upload**      | Images, PDFs, TXT files (max 2MB)    |
| **Compression** | Automatic image compression (>500KB) |
| **Preview**     | Click to preview images/PDFs         |
| **Delete**      | Remove files from session            |

### Task Management

| Feature            | Description                  |
| ------------------ | ---------------------------- |
| **Create Tasks**   | Add tasks with text          |
| **Complete Tasks** | Toggle completion status     |
| **Delete Tasks**   | Remove completed tasks       |
| **Real-time Sync** | Updates appear for all users |

### UI/UX Features

| Feature               | Description                      |
| --------------------- | -------------------------------- |
| **Dark/Light Theme**  | Toggle between themes            |
| **Responsive Design** | Works on desktop, tablet, mobile |
| **Mobile Bottom Nav** | Easy access on phones            |
| **Search Sections**   | Filter sections by name          |
| **Drag & Drop**       | Reorder sections by dragging     |

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### 1. Report Bugs

If you find a bug, please create an issue with:

- Description of the bug
- Steps to reproduce
- Expected behavior
- Screenshots (if applicable)

### 2. Suggest Features

Have an idea? Create an issue with:

- Feature description
- Why it would be useful
- How it should work

### 3. Code Contributions

1. Fork the repository
2. Create your feature branch:

```bash
git checkout -b feature/AmazingFeature
```

3. Commit your changes:

```bash
git commit -m "Add some AmazingFeature"
```

4. Push to the branch:

```bash
git push origin feature/AmazingFeature
```

5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Write clear, commented code
- Update documentation as needed
- Test your changes before submitting

---

## 📄 License

This project is distributed under the **MIT License**. See the `LICENSE` file for more information.

```text
MIT License

Copyright (c) 2024 SyncSpace

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🙏 Acknowledgments

- Supabase - Backend & Realtime
- Vercel - Hosting
- Font Awesome - Icons
- Google Fonts - Typography

---

## 📞 Contact

<div align="center">

### Built with ❤️ by Miraj Paradva

**GitHub:** mirajparadva101  
**Email:** mirajstudy101@gmail.com

[⬆ Back to Top](#-syncspace)

</div>
