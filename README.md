# SyncSpace

**Real-Time Collaborative Workspace** with a modern glassmorphism UI.

Edit documents together, chat, manage tasks, sketch on a whiteboard, and share files — all in one dark, polished web app built with **HTML, CSS, and Vanilla JavaScript**.

![Stack](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)

---

## Features

| Area           | What you get                                                               |
| -------------- | -------------------------------------------------------------------------- |
| **Landing**    | Glass hero, animated stats, features grid, how-it-works                    |
| **Auth**       | User ID + password (SHA-256). If user missing → auto signup form           |
| **Sessions**   | Create / join with 6-char ID + password, 30‑min timer, copy ID             |
| **Editor**     | Rich text toolbar, sections, 800ms debounced auto-save, version history    |
| **Chat**       | Real-time messages, avatars, date separators, unread badge                 |
| **Tasks**      | Add / toggle / delete, progress bar, live stats                            |
| **Whiteboard** | Pen, eraser, color, size, clear, touch + DPR scaling                       |
| **Files**      | Drag & drop, preview, **download**, delete (max 2MB)                       |
| **PWA**        | `manifest.json` + service worker offline cache for static assets           |
| **Demo mode**  | Works **without** Supabase via `localStorage` (single browser / multi-tab) |

---

## Project structure

```
syncspace/
├── index.html          # Landing + Auth + Hub + Dashboard
├── style.css           # Glassmorphism design system
├── app.js              # All application logic
├── manifest.json       # PWA manifest
├── sw.js               # Service worker
├── schema.sql          # Supabase / PostgreSQL schema
├── vercel.json         # Deploy config
├── api/config.js       # Secure env config endpoint
├── README.md
└── file-structure.txt
```

---

## Quick start (Demo mode — no backend)

1. Open the folder in any static server, for example:

```bash
cd syncspace
npx --yes serve .
# or: python -m http.server 3000
```

2. Visit `http://localhost:3000`
3. Click **Get Started** → enter any User ID + password
   - First time: signup form opens automatically
4. **Create Session** or **Join** with the 6-character ID
5. Collaborate (same browser / multi-tab works via `localStorage`)

> Demo mode stores users, sessions, chat, tasks, files, and board data in the browser.

---

## Production setup (Supabase + Vercel)

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the full contents of `schema.sql`
3. Copy **Project URL** and **anon public** key from **Settings → API**
4. Confirm Realtime is enabled for: `sessions`, `sections`, `texts`, `chat_messages`, `todos`, `files`

### 2. Environment variables (Vercel)

| Name                | Value                     |
| ------------------- | ------------------------- |
| `SUPABASE_URL`      | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon key    |

### 3. Deploy

```bash
npm i -g vercel
cd syncspace
vercel
```

Or connect the GitHub repo in the Vercel dashboard and set the env vars.

### 4. Local override (optional)

Before loading `app.js`, you can inject:

```html
<script>
  window.SYNCSPACE_CONFIG = {
    url: "https://YOUR_PROJECT.supabase.co",
    key: "YOUR_ANON_KEY",
  };
</script>
```

---

## Auth model

- **No OAuth / no JWT**
- Login checks `users.user_id`
  - Exists → verify SHA-256 password hash
  - Missing → show signup with prefilled User ID
- Session rooms also use hashed passwords
- App session is stored in `localStorage` (`ss_auth`) for convenience

> For production, replace open RLS policies in `schema.sql` with tighter rules and never store plain passwords (this app already hashes with SHA-256; consider bcrypt/argon2 on a server for stronger threat models).

---

## File download

Each file card has a **Download** button that:

1. Reads base64 `file_data`
2. Converts to a `Blob`
3. Triggers a browser download with the original filename

Supported uploads: JPEG, PNG, GIF, WEBP, PDF, TXT, DOC/DOCX, XLS/XLSX (max **2MB**). Images are lightly compressed in the browser when large.

---

## Design system

- **Glass:** `backdrop-filter: blur(20px)` + translucent surfaces
- **Colors:** purple `#6c5ce7`, cyan `#00cec9`, pink `#fd79a8` on deep dark `#0a0a0f`
- **Font:** Inter
- **Icons:** Font Awesome 6
- **Breakpoints:** desktop / tablet / mobile bottom nav

---

## Scripts & runtime notes

- Realtime target: ~100ms UI updates when Supabase Realtime is connected
- Editor auto-save debounce: **800ms**
- Session timer: **30 minutes** (soft end — you can stay)
- Whiteboard strokes broadcast over Supabase Realtime (demo mode: local only)
- Service worker caches static assets only (not Supabase / API)

---

## Troubleshooting

| Issue                                 | Fix                                                                   |
| ------------------------------------- | --------------------------------------------------------------------- |
| Always in demo mode                   | Set Vercel env vars or `window.SYNCSPACE_CONFIG`                      |
| Realtime not syncing                  | Run `ALTER PUBLICATION ...` from `schema.sql`; check RLS              |
| Files fail to upload                  | Size > 2MB or unsupported MIME                                        |
| Whiteboard blurry                     | DPR resize runs on panel open; resize window once                     |
| Auth “user exists” but wrong password | Password is case-sensitive; reset by clearing user row / localStorage |

**Clear demo data:** DevTools → Application → Local Storage → remove `ss_users`, `ss_sessions`, `ss_auth`.

---

## License

MIT — free to use and modify for personal or commercial projects.

---

Built with glassmorphism, liquid motion, and a focus on shipping a complete collaborative workspace in pure front-end + Supabase.
