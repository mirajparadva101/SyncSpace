# SyncSpace — Real-Time Collaboration Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Supabase](https://img.shields.io/badge/Supabase-Powered-3ECF8E)](https://supabase.com)
[![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952B3)](https://getbootstrap.com)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

**SyncSpace** is a real-time collaborative workspace that allows teams to share text notes and files instantly. Built with Supabase for real-time sync, it's perfect for brainstorming, meeting notes, code snippets, and team collaboration.

![SyncSpace Demo](https://via.placeholder.com/800x400/3ECF8E/FFFFFF?text=SyncSpace+%7C+Real-Time+Collaboration)

## ✨ Features

- 🔐 **Secure Sessions** — Password-protected collaboration spaces with SHA-256 hashing
- 📝 **Real-time Text Editor** — Live updates across all connected devices
- 📎 **File Sharing** — Upload and share files up to 2MB (images, documents, zip files)
- 🔄 **Instant Sync** — Powered by Supabase Realtime subscriptions
- 📱 **Responsive Design** — Works seamlessly on desktop, tablet, and mobile
- 🎨 **Dark Theme** — Eye-friendly dark interface optimized for long sessions
- 📋 **Session Management** — Create, join, and leave sessions easily
- 📂 **Section Organization** — Organize content into named sections
- 📤 **Export Options** — Download text as .txt files
- 🔗 **Share Links** — Generate shareable links with session ID

## 🚀 Quick Start

### Prerequisites

- A [Supabase](https://supabase.com) account (free tier works perfectly)
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Basic understanding of PostgreSQL (optional)

### 1. Supabase Setup

#### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Enter project name and database password
4. Choose region closest to your users
5. Wait for database to initialize (2-3 minutes)

#### Step 2: Run the SQL Setup

1. In your Supabase dashboard, go to **SQL Editor**
2. Copy the entire contents of `table.sql`
3. Paste and click "Run" to execute
4. This creates all required tables and enables RLS & Realtime

#### Step 3: Enable Realtime

1. Go to **Database → Replication** in Supabase
2. Enable Realtime for these tables:
   - `sections`
   - `texts`
   - `files`
3. Click "Save" to apply changes

#### Step 4: Get Your Credentials

1. Go to **Project Settings → API**
2. Copy your **Project URL** (format: `https://xxxxx.supabase.co`)
3. Copy your **anon public key** (starts with `eyJhbGciOiJIUzI1NiIs...`)

### 2. Run SyncSpace

#### Option A: Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/syncspace.git
   cd syncspace
