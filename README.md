🚀 SyncSpace — Real-Time Collaboration Platform
https://img.shields.io/badge/License-MIT-yellow.svg
https://img.shields.io/badge/Supabase-Powered-3ECF8E
https://img.shields.io/badge/Bootstrap-5.3-7952B3
https://img.shields.io/badge/Vercel-Deployed-000000
https://img.shields.io/badge/JavaScript-ES6+-F7DF1E

SyncSpace is a modern, secure, and real-time collaborative workspace that allows teams to share text notes and files instantly. It features a complete User Authentication system (Sign Up/Sign In), live dashboard stats, and secure credential management using Vercel Environment Variables. Built with Supabase for real-time sync, it's perfect for brainstorming, meeting notes, code snippets, and team collaboration.

https://via.placeholder.com/800x400/3ECF8E/FFFFFF?text=SyncSpace+%257C+Real-Time+Collaboration

✨ Features
👤 User Authentication — Secure Sign Up & Sign In with SHA-256 hashed passwords and auto-login via LocalStorage.
📊 Live Dashboard — Displays real-time stats of Total Registered Users and Active Sessions.
🛡️ Secure Architecture — No hardcoded API keys. Credentials are fetched securely via Vercel Serverless Functions.
🔐 Protected Sessions — Password-protected collaboration spaces with SHA-256 hashing.
📝 Real-time Text Editor — Live updates across all connected devices (debounced for performance).
📎 File Sharing — Upload, download, and delete files up to 2MB (images, documents, zip files).
🔄 Instant Sync — Powered by Supabase Realtime subscriptions.
📱 Responsive Dark Theme — Eye-friendly, modern dark UI optimized for long sessions and mobile devices.
📂 Section Organization — Organize session content into multiple named sections.
📤 Export Options — Copy all text or download sections as .txt files.
🔗 Share Links — Generate shareable links with session ID (?join=SESSION_ID).
🚀 Quick Start
Prerequisites
A Supabase account (free tier works perfectly)
A Vercel account (for deployment with env vars)
A GitHub account
Modern web browser (Chrome, Firefox, Safari, Edge)

1. Supabase Setup
   🗄️ Database Schema
   Tables
   Table Purpose Columns
   users User authentication id, user_id, name, password, created_at
   sessions Collaboration spaces id, password, created_at
   sections Content organization id, session_id, name, sort_order, created_at
   texts Real-time text content id, section_id, session_id, content, updated_at
   files File storage (base64) id, section_id, session_id, file_name, file_data, file_type, file_size, created_at

2. Deploy to Vercel (Recommended)
   This application is designed to hide your Supabase credentials from GitHub using Vercel Environment Variables.

Push this project to your GitHub repository.
Go to Vercel and click "Add New Project".
Import your GitHub repository.
Before clicking "Deploy", expand "Environment Variables" and add the following:
Name
Value
SUPABASE_URL Your Supabase Project URL
SUPABASE_ANON_KEY Your Supabase Anon Key

Click Deploy.
Once deployed, your app will securely fetch credentials via the /api/config serverless function! 3. Run Locally (Without Vercel)
If you run the index.html file directly in your browser, the /api/config call will fail. The app handles this gracefully:

Open index.html in your browser.
The app will show a "Manual Configuration" fallback screen.
Enter your Supabase URL and Anon Key there.
The credentials will be saved in your browser's LocalStorage for future visits.
Alternatively, use the Vercel CLI to run the project locally with environment variables:

bash

npm i -g vercel
vercel env pull .env.local
vercel dev
🔒 Security Architecture
No Hardcoded Keys: The index.html file contains zero Supabase credentials.
Serverless Fetching: On page load, the app calls the /api/config endpoint.
Vercel Environment Variables: The api/config.js serverless function securely reads the credentials from Vercel's hidden environment variables and returns them to the app.
Fallback System: If the API call fails, the app displays a manual configuration screen. Credentials are stored only in the user's LocalStorage, never in the code.
📂 Project Structure
text

syncspace/
├── api/
│ └── config.js # Vercel Serverless Function (reads env vars)
├── index.html # Main application (HTML, CSS, JS)
├── vercel.json # Routing configuration for Vercel
└── README.md # Project Documentation
💡 How It Works
Authentication: Users must Sign Up (Name, User ID, Password) or Sign In to create/join sessions. Passwords are hashed with SHA-256 + salt before being stored in the users table. Auto-login is supported via LocalStorage.
Home Dashboard: The home page shows live stats (Total Users, Total Sessions). Without logging in, action cards are locked.
Session Creation/Joining: Generates a 6-character uppercase ID. The session password is also SHA-256 hashed before storage.
Real-time Sync: When a user types, text is debounced (600ms), saved to the texts table, and broadcasted via Supabase Realtime to all other browser tabs/devices in that session.
File Handling: Files are converted to Base64 and stored in the files table (max 2MB per file). Users can download or delete them.
🤝 Contributing
Fork the repository
Create your feature branch (git checkout -b feature/amazing-feature)
Commit your changes (git commit -m 'Add some amazing feature')
Push to the branch (git push origin feature/amazing-feature)
Open a Pull Request
📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

<p align="center">
Built with ❤️ using HTML, JS, Bootstrap, Supabase & Vercel
</p>
```
