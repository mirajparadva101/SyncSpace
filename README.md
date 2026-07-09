<div align="center">

# ⚡ SyncSpace

### Real-Time Collaborative Workspace

![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Supabase](https://img.shields.io/badge/Supabase-Backend-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployment-black?style=for-the-badge&logo=vercel&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![JWT](https://img.shields.io/badge/JWT-Authentication-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Supported-5A0FC8?style=for-the-badge)

**SyncSpace** is a modern, secure, and real-time collaborative workspace that allows teams to share text notes, files, and chat instantly across multiple devices. It includes simplified user authentication (auto-account creation), real-time synchronization, and secure environment configuration.

</div>

---

## ✨ Key Features

| Category                  | Features                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| **🔐 Authentication**     | Login with User ID & Password, Auto-account creation, JWT Tokens, 24-hour session |
| **👥 Session Management** | Create/Join sessions with password, 6-char unique IDs, 30-min timeout             |
| **📝 Real-time Editor**   | Rich text editing, Auto-save with debouncing, Version history, Typing indicators  |
| **💬 Chat**               | Real-time messaging, Typing indicators, User presence, Message history            |
| **📎 File Sharing**       | Upload images/PDFs/TXT (Max 2MB), Image compression, Preview support              |
| **✅ Task Management**    | Create/complete/delete todos, Real-time sync across devices                       |
| **🎨 Whiteboard**         | Draw with mouse/touch, Real-time collaboration, Pen/Eraser tools                  |
| **📂 Organization**       | Create multiple sections, Drag-drop reordering, Search sections                   |
| **🛡️ Security**           | Zero hardcoded API keys, Vercel Environment Variables, Rate limiting              |
| **🎨 UI/UX**              | Dark/Light theme, Fully responsive, Mobile-friendly, PWA support                  |

---

## 🛠️ Tech Stack

### Frontend

- **HTML5, CSS3** - Semantic markup, custom properties
- **Vanilla JavaScript (ES6+)** - No frameworks needed
- **Service Worker** - Offline support (PWA)
- **Font Awesome 6** - Icons
- **Inter** - Typography

### Backend (Serverless)

- **Vercel** - Serverless functions
- **Supabase** - PostgreSQL database, Realtime WebSockets
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing

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
├── index.html                  # All HTML (Responsive UI)
├── style.css                   # All CSS (Dark/Light theme, Mobile-first)
├── app.js                      # Complete JavaScript (Auth + All Features)
├── manifest.json               # PWA Support
├── sw.js                       # Service Worker (Offline support)
├── schema.sql                  # Supabase Database Schema
├── vercel.json                 # Vercel Deployment Config
├── README.md                   # Project Documentation
└── file-structure.txt          # Plain text project structure
```

---

## 🚀 Getting Started

### Prerequisites

- Supabase account (free tier works)
- Vercel account (free tier works)
- GitHub account

### 1. Supabase Database Setup

1. Create a Supabase project.
2. Run `schema.sql` in SQL Editor.
3. Enable Realtime for these tables:
   - `sections`
   - `texts`
   - `files`
   - `chat_messages`
   - `todos`
4. Get API credentials:
   - Project URL
   - Anon Key

### 2. Deploy to Vercel

1. Push code to your GitHub repository.
2. Import the repository into Vercel.
3. Add these environment variables:

| Name                | Value                              | Where to Get             |
| ------------------- | ---------------------------------- | ------------------------ |
| `SUPABASE_URL`      | `https://your-project.supabase.co` | Supabase Dashboard → API |
| `SUPABASE_ANON_KEY` | `eyJhbGciOi...`                    | Supabase Dashboard → API |
| `JWT_SECRET`        | `your-random-secret-key`           | Generate securely        |

4. Click **Deploy**.

### 3. Run Locally (Development)

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/syncspace.git
cd syncspace

# 2. Install dependencies (if using backend)
npm install

# 3. Start the server
npm start

# 4. Open browser
# http://localhost:3000
```

---

## 🔒 Security Architecture

```text
┌──────────────┐         GET /api/config          ┌──────────────────────┐
│              │ ───────────────────────────────► │                      │
│  Client App  │                                   │  Vercel Serverless   │
│ (index.html) │ ◄─────────────────────────────── │  (API Routes)        │
│              │   { url, key } JSON Response      │                      │
└──────────────┘                                   └──────────┬───────────┘
                                                              │
                                                   Reads from Vercel
                                                   Environment Variables
                                                   (SUPABASE_URL, SUPABASE_ANON_KEY)
```

### Security Features

| Feature                | Implementation                                |
| ---------------------- | --------------------------------------------- |
| **No Hardcoded Keys**  | Supabase credentials in Vercel Dashboard only |
| **Password Hashing**   | bcrypt (10 rounds)                            |
| **JWT Authentication** | 24-hour expiration                            |
| **Rate Limiting**      | 100 requests/15 min                           |
| **Security Headers**   | Helmet.js (HSTS, CSP, XSS protection)         |
| **CORS Protection**    | Restricted to specific origins                |
| **File Validation**    | Type, size, format checking                   |
| **Session Timeout**    | 30 minutes inactivity                         |

---

## 🎯 Features Deep Dive

### Authentication & Security

| Feature              | Description                                 |
| -------------------- | ------------------------------------------- |
| **Login**            | User ID + Password verification             |
| **Auto-Signup**      | If user doesn't exist, auto-create account  |
| **JWT Tokens**       | 24-hour valid tokens stored in localStorage |
| **Session Timeout**  | Auto-logout after 30 minutes of inactivity  |
| **Password Hashing** | bcrypt with 10 rounds                       |

### Real-time Collaboration

| Feature               | Description                             |
| --------------------- | --------------------------------------- |
| **Rich Text Editor**  | ContentEditable with formatting support |
| **Auto-save**         | Debounced save (800ms)                  |
| **Version History**   | Each save creates a version entry       |
| **Typing Indicators** | Shows who is typing in real-time        |

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

## 📱 Responsive Design

| Device      | Breakpoint       | Sidebar               | Bottom Nav |
| ----------- | ---------------- | --------------------- | ---------- |
| **Desktop** | `> 1024px`       | Always visible        | Hidden     |
| **Tablet**  | `768px - 1024px` | Collapsible (overlay) | Hidden     |
| **Mobile**  | `< 768px`        | Collapsible (overlay) | Visible    |

---

## 🤝 Contributing

1. Fork the repository.
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

5. Open a Pull Request.

### Development Guidelines

- Follow existing code style
- Write clear, commented code
- Update documentation as needed
- Test your changes before submitting

---

## 📄 License

This project is distributed under the **MIT License**.

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

**Built with ❤️ by [Your Name]**

- GitHub: [yourusername](https://github.com/yourusername)
- Email: [youremail@example.com](mailto:youremail@example.com)

[⬆ Back to Top](#-syncspace)
