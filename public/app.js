/* ============================================
   SYNCSPACE — APPLICATION LOGIC
   ============================================ */

// Load Supabase from CDN dynamically
let supabaseClient = null;

// ========== STATE ==========
const state = {
  sb: null,
  user: null,
  sessionId: null,
  currentSection: null,
  theme: localStorage.getItem("ss_theme") || "dark",
  activeTab: "editor",
  cache: new Map(),
  channels: [],
  typingTimeout: null,
  saveTimeout: null,
  searchTimeout: null,
  sidebarOpen: false,
  whiteboardState: {
    drawing: false,
    color: "#6c5ce7",
    size: 3,
    tool: "pen",
    history: [],
  },
};

// ========== UTILITY FUNCTIONS ==========
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const swr = async (key, fetcher, ttl = 5000) => {
  const entry = state.cache.get(key);
  if (entry && Date.now() - entry.time < ttl) return entry.data;
  const data = await fetcher();
  state.cache.set(key, { data, time: Date.now() });
  return data;
};

const cacheInvalidate = (pattern) => {
  for (const key of state.cache.keys()) {
    if (key.includes(pattern)) state.cache.delete(key);
  }
};

const generateId = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
};

const getFileIcon = (type) => {
  if (type?.startsWith("image/")) return "fa-image";
  if (type === "application/pdf") return "fa-file-pdf";
  if (type?.startsWith("text/")) return "fa-file-lines";
  return "fa-file";
};

const getInitials = (name) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

// ========== TOAST SYSTEM ==========
function showToast(message, type = "success", duration = 3000) {
  const container = $("#toast-container");
  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    warning: "fa-triangle-exclamation",
    info: "fa-circle-info",
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type]} toast-icon"></i>
    <span>${message}</span>
    <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("exit");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ========== LOADER ==========
function hideLoader() {
  const loader = $("#loader");
  if (loader) {
    loader.classList.add("hidden");
    setTimeout(() => loader.remove(), 500);
  }
}

// ========== THEME ==========
function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem("ss_theme", state.theme);
  showToast(`Switched to ${state.theme} mode`, "info", 2000);
}

// ========== LOAD SUPABASE ==========
async function loadSupabase() {
  if (window.supabase) {
    return window.supabase;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
    script.onload = () => {
      resolve(window.supabase);
    };
    script.onerror = () => {
      reject(new Error("Failed to load Supabase library"));
    };
    document.head.appendChild(script);
  });
}

// ========== INIT ==========
async function init() {
  document.documentElement.setAttribute("data-theme", state.theme);

  try {
    // Load Supabase library first
    await loadSupabase();
    console.log("Supabase library loaded");

    console.log("Fetching config from /api/config...");
    const response = await fetch("/api/config");

    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status}`);
    }

    const config = await response.json();
    console.log("Config received:", config);

    if (!config?.url || !config?.key) {
      throw new Error("Missing Supabase credentials in config");
    }

    state.sb = window.supabase.createClient(config.url, config.key);
    setupRealtime();

    const params = new URLSearchParams(window.location.search);
    if (params.get("join")) {
      state.sessionId = params.get("join").toUpperCase();
      localStorage.setItem("ss_session", state.sessionId);
    } else if (localStorage.getItem("ss_session")) {
      state.sessionId = localStorage.getItem("ss_session");
    }

    checkAuth();
    setupKeyboardShortcuts();
    setupSessionTimeout();
    registerSW();
    setupGlobalListeners();

    // Hide loader after successful init
    setTimeout(hideLoader, 500);
  } catch (err) {
    console.error("Init error:", err);
    // Show manual config if we can't fetch from server
    showManualConfig();
    // Still hide loader after showing config
    setTimeout(hideLoader, 800);
  }
}

// ========== GLOBAL LISTENERS ==========
function setupGlobalListeners() {
  document.addEventListener("click", (e) => {
    const ctx = $("#context-menu");
    if (ctx && !ctx.contains(e.target)) {
      ctx.classList.remove("visible");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const overlay = $(".overlay.active");
      if (overlay) overlay.classList.remove("active");

      const ctx = $("#context-menu");
      if (ctx) ctx.classList.remove("visible");

      if (state.sidebarOpen) toggleSidebar();
    }
  });
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  const sidebar = $(".sidebar");
  const overlay = $(".sidebar-overlay");

  if (sidebar) sidebar.classList.toggle("open", state.sidebarOpen);
  if (overlay) overlay.classList.toggle("visible", state.sidebarOpen);
}

// ========== AUTH ==========
function checkAuth() {
  const token = localStorage.getItem("ss_token");
  const userData = localStorage.getItem("ss_user");

  if (token && userData) {
    state.user = JSON.parse(userData);
    showDashboard();
  } else {
    showAuth();
  }
}

function showAuth() {
  const app = $("#app");
  app.innerHTML = `
    <div class="overlay active" id="auth-overlay">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-logo">
            <i class="fas fa-bolt"></i>
          </div>
          <h1 class="modal-title">Welcome to SyncSpace</h1>
          <p class="modal-subtitle">Your real-time collaborative workspace</p>
        </div>

        <div class="input-group">
          <div class="input-wrapper">
            <input type="text" id="auth-userid" class="input has-icon" placeholder="User ID" aria-label="User ID" autocomplete="username" value="">
            <i class="fas fa-at input-icon"></i>
          </div>
        </div>

        <div class="input-group">
          <div class="input-wrapper">
            <input type="text" id="auth-name" class="input has-icon" placeholder="Full Name (for signup)" aria-label="Full Name" autocomplete="name" value="">
            <i class="fas fa-user input-icon"></i>
          </div>
        </div>

        <div class="input-group">
          <div class="input-wrapper">
            <input type="password" id="auth-pass" class="input has-icon" placeholder="Password (min 6 chars)" aria-label="Password" autocomplete="current-password" value="">
            <i class="fas fa-lock input-icon"></i>
          </div>
        </div>

        <button class="btn btn-primary btn-full btn-lg" id="auth-login">
          <i class="fas fa-arrow-right-to-bracket"></i>
          Sign In
        </button>

        <div class="modal-divider">or</div>

        <button class="btn btn-secondary btn-full" id="auth-signup">
          <i class="fas fa-user-plus"></i>
          Create Account
        </button>

        <div class="modal-footer">
          <button class="btn btn-ghost btn-full text-sm" id="auth-join-session">
            <i class="fas fa-link"></i>
            Join with Session Code
          </button>
        </div>
      </div>
    </div>`;

  // Get references to buttons
  const loginBtn = document.getElementById("auth-login");
  const signupBtn = document.getElementById("auth-signup");
  const joinBtn = document.getElementById("auth-join-session");

  // Add click handlers
  if (loginBtn) {
    loginBtn.onclick = function (e) {
      e.preventDefault();
      authAction("login");
    };
  }

  if (signupBtn) {
    signupBtn.onclick = function (e) {
      e.preventDefault();
      authAction("signup");
    };
  }

  if (joinBtn) {
    joinBtn.onclick = function (e) {
      e.preventDefault();
      const sid = prompt("Enter Session ID:");
      if (sid) {
        state.sessionId = sid.toUpperCase();
        localStorage.setItem("ss_session", state.sessionId);
        showToast("Session ID set! Please sign in.", "info");
      }
    };
  }

  // Enter key support - use event listeners
  const userIdInput = document.getElementById("auth-userid");
  const nameInput = document.getElementById("auth-name");
  const passInput = document.getElementById("auth-pass");

  if (userIdInput) {
    userIdInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        // If on signup, move to name field, else move to password
        if (document.activeElement === userIdInput) {
          if (passInput) passInput.focus();
        }
      }
    });
  }

  if (nameInput) {
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (passInput) passInput.focus();
      }
    });
  }

  if (passInput) {
    passInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        // Determine which button to click based on what's visible
        // Default to login
        authAction("login");
      }
    });
  }

  // Auto-focus the first input
  setTimeout(() => {
    if (userIdInput) userIdInput.focus();
  }, 300);
}

async function authAction(type) {
  console.log("Auth action:", type);

  // Get input elements directly
  const userIdInput = document.getElementById("auth-userid");
  const nameInput = document.getElementById("auth-name");
  const passInput = document.getElementById("auth-pass");

  // Get values with proper trimming
  const userId = userIdInput ? userIdInput.value.trim() : "";
  const name = nameInput ? nameInput.value.trim() : "";
  const password = passInput ? passInput.value : "";

  console.log(
    "UserId:",
    userId,
    "Name:",
    name,
    "Password length:",
    password.length,
  );

  // Validation
  if (!userId || !password) {
    showToast("User ID and password are required", "error");
    // Highlight empty fields
    if (!userId && userIdInput) {
      userIdInput.classList.add("input-error");
      userIdInput.focus();
      setTimeout(() => userIdInput.classList.remove("input-error"), 2000);
    }
    if (!password && passInput) {
      passInput.classList.add("input-error");
      if (!userId) passInput.focus();
      setTimeout(() => passInput.classList.remove("input-error"), 2000);
    }
    return;
  }

  if (type === "signup" && !name) {
    showToast("Full name is required for signup", "error");
    if (nameInput) {
      nameInput.classList.add("input-error");
      nameInput.focus();
      setTimeout(() => nameInput.classList.remove("input-error"), 2000);
    }
    return;
  }

  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    if (passInput) {
      passInput.classList.add("input-error");
      passInput.focus();
      setTimeout(() => passInput.classList.remove("input-error"), 2000);
    }
    return;
  }

  // Get button references
  const btn =
    type === "login"
      ? document.getElementById("auth-login")
      : document.getElementById("auth-signup");

  if (!btn) {
    console.error("Button not found for type:", type);
    return;
  }

  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Please wait...';
  btn.disabled = true;

  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: type,
        userId,
        name: type === "signup" ? name : undefined,
        password,
      }),
    });

    const data = await res.json();
    console.log("Auth response:", data);

    if (data.error) {
      showToast(data.error, "error");
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      return;
    }

    if (data.require2FA) {
      show2FA(data.tempToken);
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      return;
    }

    localStorage.setItem("ss_token", data.token);
    localStorage.setItem("ss_user", JSON.stringify(data.user));
    state.user = data.user;

    if (!state.sessionId) {
      const sid = prompt("Enter Session ID to create or join:", generateId());
      if (sid) {
        state.sessionId = sid.toUpperCase();
        localStorage.setItem("ss_session", state.sessionId);
        await createSession(state.sessionId);
      }
    }

    showDashboard();
    showToast(`Welcome, ${state.user.name}!`, "success");
  } catch (err) {
    console.error("Auth error:", err);
    showToast("Network error. Please try again.", "error");
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
}

function show2FA(tempToken) {
  const app = $("#app");
  app.innerHTML = `
    <div class="overlay active">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-logo" style="background: linear-gradient(135deg, var(--warning), #e17055);">
            <i class="fas fa-shield-halved"></i>
          </div>
          <h1 class="modal-title">Two-Factor Authentication</h1>
          <p class="modal-subtitle">Enter the 6-digit code from your authenticator app</p>
        </div>

        <div class="otp-input-group" id="otp-group">
          <input type="text" class="otp-input" maxlength="1" data-index="0" aria-label="Digit 1" inputmode="numeric">
          <input type="text" class="otp-input" maxlength="1" data-index="1" aria-label="Digit 2" inputmode="numeric">
          <input type="text" class="otp-input" maxlength="1" data-index="2" aria-label="Digit 3" inputmode="numeric">
          <input type="text" class="otp-input" maxlength="1" data-index="3" aria-label="Digit 4" inputmode="numeric">
          <input type="text" class="otp-input" maxlength="1" data-index="4" aria-label="Digit 5" inputmode="numeric">
          <input type="text" class="otp-input" maxlength="1" data-index="5" aria-label="Digit 6" inputmode="numeric">
        </div>

        <button class="btn btn-primary btn-full btn-lg" id="2fa-verify">
          <i class="fas fa-check"></i>
          Verify Code
        </button>

        <div class="modal-footer">
          <button class="btn btn-ghost btn-full text-sm" onclick="checkAuth()">
            <i class="fas fa-arrow-left"></i>
            Back to Login
          </button>
        </div>
      </div>
    </div>`;

  // OTP input handling
  const otpInputs = $$(".otp-input");
  otpInputs.forEach((input, i) => {
    input.addEventListener("input", (e) => {
      const val = e.target.value.replace(/\D/g, "");
      e.target.value = val;
      if (val && i < 5) otpInputs[i + 1].focus();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value && i > 0) {
        otpInputs[i - 1].focus();
      }
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, 6);
      text.split("").forEach((char, idx) => {
        if (otpInputs[idx]) otpInputs[idx].value = char;
      });
      if (text.length === 6) otpInputs[5].focus();
    });
  });

  $("#2fa-verify").onclick = async () => {
    const code = otpInputs.map((i) => i.value).join("");
    if (code.length !== 6) {
      return showToast("Please enter all 6 digits", "error");
    }

    const btn = $("#2fa-verify");
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    btn.disabled = true;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify-2fa", tempToken, code }),
      }).then((r) => r.json());

      if (res.error) {
        showToast(res.error, "error");
        btn.innerHTML = '<i class="fas fa-check"></i> Verify Code';
        btn.disabled = false;
        otpInputs.forEach((i) => {
          i.value = "";
          i.classList.add("input-error");
        });
        setTimeout(
          () => otpInputs.forEach((i) => i.classList.remove("input-error")),
          1000,
        );
        return;
      }

      localStorage.setItem("ss_token", res.token);
      localStorage.setItem("ss_user", JSON.stringify(res.user));
      state.user = res.user;
      showDashboard();
      showToast("Authentication successful!", "success");
    } catch (err) {
      showToast("Network error. Please try again.", "error");
      btn.innerHTML = '<i class="fas fa-check"></i> Verify Code';
      btn.disabled = false;
    }
  };

  // Auto-focus first input
  setTimeout(() => otpInputs[0]?.focus(), 300);
}

async function createSession(sessionId) {
  const password = prompt("Set a password for this session:");
  if (!password || password.length < 4) {
    return showToast("Session password must be at least 4 characters", "error");
  }

  try {
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", password, sessionId }),
    });
    showToast("Session created successfully!", "success");
  } catch (err) {
    showToast("Error creating session", "error");
  }
}

// ========== DASHBOARD ==========
function showDashboard() {
  const app = $("#app");
  app.innerHTML = `
    <!-- Sidebar Overlay (Mobile) -->
    <div class="sidebar-overlay" onclick="toggleSidebar()"></div>
    
    <div class="app-layout">
      <!-- Sidebar -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-brand-icon">
            <i class="fas fa-bolt"></i>
          </div>
          <span class="sidebar-brand-text">SyncSpace</span>
          <span class="sidebar-brand-badge">v3.0</span>
        </div>

        <div class="sidebar-search">
          <div class="input-group" style="margin-bottom:0;">
            <div class="input-wrapper">
              <input type="text" id="search-input" class="input has-icon" placeholder="Search sections..." aria-label="Search sections" style="min-height:36px; font-size:13px; padding:8px 12px 8px 36px;">
              <i class="fas fa-search input-icon" style="font-size:12px;"></i>
            </div>
          </div>
        </div>

        <div class="sidebar-section-title">
          <span>Sections</span>
          <button class="btn btn-ghost btn-icon sm" onclick="createSection()" title="Add Section">
            <i class="fas fa-plus"></i>
          </button>
        </div>

        <div class="sidebar-list" id="section-list">
          <div class="empty-state" style="padding:var(--space-xl);">
            <div class="empty-state-icon" style="font-size:32px;"><i class="fas fa-folder-open"></i></div>
            <p class="text-xs text-muted">No sections yet</p>
          </div>
        </div>

        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="sidebar-avatar">${getInitials(state.user?.name)}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name truncate">${state.user?.name || "User"}</div>
              <div class="sidebar-user-role">${state.user?.role || "Editor"}</div>
            </div>
          </div>
          
          <div style="display:flex; gap:var(--space-xs);">
            <button class="btn btn-ghost btn-icon sm" onclick="showTemplates()" title="Templates">
              <i class="fas fa-wand-magic-sparkles"></i>
            </button>
            <button class="btn btn-ghost btn-icon sm" onclick="exportData()" title="Export">
              <i class="fas fa-download"></i>
            </button>
            <button class="btn btn-ghost btn-icon sm" onclick="toggleTheme()" title="Toggle Theme">
              <i class="fas fa-${state.theme === "dark" ? "sun" : "moon"}"></i>
            </button>
            <button class="btn btn-ghost btn-icon sm" onclick="logout()" title="Sign Out" style="margin-left:auto; color:var(--danger);">
              <i class="fas fa-right-from-bracket"></i>
            </button>
          </div>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="main-content">
        <div class="top-bar">
          <div class="top-bar-left">
            <button class="btn btn-ghost btn-icon" onclick="toggleSidebar()" style="display:none;" id="menu-btn">
              <i class="fas fa-bars"></i>
            </button>
            <span class="top-bar-title" id="top-bar-title">Editor</span>
            ${state.sessionId ? `<span class="top-bar-session"><i class="fas fa-link" style="margin-right:4px;"></i>${state.sessionId}</span>` : ""}
          </div>
          <div class="top-bar-right">
            <div class="live-dot" title="Connected"></div>
            <span class="text-xs text-muted">Live</span>
          </div>
        </div>

        <div class="tab-bar" id="tab-bar">
          <div class="tab active" data-tab="editor" onclick="switchTab('editor')">
            <i class="fas fa-pen-to-square"></i>
            <span>Editor</span>
          </div>
          <div class="tab" data-tab="files" onclick="switchTab('files')">
            <i class="fas fa-folder"></i>
            <span>Files</span>
          </div>
          <div class="tab" data-tab="whiteboard" onclick="switchTab('whiteboard')">
            <i class="fas fa-palette"></i>
            <span>Board</span>
          </div>
          <div class="tab" data-tab="chat" onclick="switchTab('chat')">
            <i class="fas fa-comments"></i>
            <span>Chat</span>
          </div>
          <div class="tab" data-tab="todos" onclick="switchTab('todos')">
            <i class="fas fa-list-check"></i>
            <span>Tasks</span>
          </div>
        </div>

        <div class="typing-indicator" id="typing-indicator">
          <div class="typing-dots">
            <span></span><span></span><span></span>
          </div>
          <span id="typing-text">Someone is typing...</span>
        </div>

        <div class="content-area" id="content-area">
          <div class="content-area-inner" id="content-inner"></div>
        </div>
      </main>
    </div>

    <!-- Mobile Bottom Nav -->
    <nav class="bottom-nav">
      <div class="bottom-nav-items">
        <div class="bottom-nav-item active" data-tab="editor" onclick="switchTab('editor')">
          <i class="fas fa-pen-to-square"></i>
          <span>Editor</span>
        </div>
        <div class="bottom-nav-item" data-tab="chat" onclick="switchTab('chat')">
          <i class="fas fa-comments"></i>
          <span>Chat</span>
        </div>
        <div class="bottom-nav-item" data-tab="files" onclick="switchTab('files')">
          <i class="fas fa-folder"></i>
          <span>Files</span>
        </div>
        <div class="bottom-nav-item" data-tab="todos" onclick="switchTab('todos')">
          <i class="fas fa-list-check"></i>
          <span>Tasks</span>
        </div>
        <div class="bottom-nav-item" data-tab="whiteboard" onclick="switchTab('whiteboard')">
          <i class="fas fa-palette"></i>
          <span>Board</span>
        </div>
      </div>
    </nav>`;

  // Show menu button on mobile
  const menuBtn = $("#menu-btn");
  if (window.innerWidth <= 1024 && menuBtn) {
    menuBtn.style.display = "flex";
  }
  window.addEventListener("resize", () => {
    if (menuBtn) {
      menuBtn.style.display = window.innerWidth <= 1024 ? "flex" : "none";
    }
  });

  // Setup search
  const searchInput = $("#search-input");
  if (searchInput) {
    searchInput.addEventListener(
      "input",
      debounce((e) => {
        const term = e.target.value.toLowerCase();
        $$(".section-item").forEach((s) => {
          const name =
            $(".section-item-name", s)?.textContent?.toLowerCase() || "";
          s.style.display = name.includes(term) ? "flex" : "none";
        });
      }, 200),
    );
  }

  initEditor();
  loadSections();
}

function logout() {
  if (confirm("Are you sure you want to sign out?")) {
    localStorage.clear();
    state.user = null;
    state.sessionId = null;
    state.currentSection = null;
    state.cache.clear();
    location.reload();
  }
}

// ========== EDITOR ==========
function initEditor() {
  const inner = $("#content-inner");
  if (!inner) return;

  if (!state.currentSection) {
    inner.innerHTML = `
      <div class="empty-state" style="padding-top: 80px;">
        <div class="empty-state-icon"><i class="fas fa-pen-fancy"></i></div>
        <h3 class="empty-state-title">Select a section to start editing</h3>
        <p class="empty-state-text">Choose a section from the sidebar or create a new one to begin writing.</p>
        <button class="btn btn-primary" onclick="createSection()">
          <i class="fas fa-plus"></i>
          Create Section
        </button>
      </div>`;
    return;
  }

  inner.innerHTML = `
    <div class="editor-container">
      <div class="editor-toolbar">
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('bold')" title="Bold (Ctrl+B)"><i class="fas fa-bold"></i></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('italic')" title="Italic (Ctrl+I)"><i class="fas fa-italic"></i></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('underline')" title="Underline (Ctrl+U)"><i class="fas fa-underline"></i></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('strikeThrough')" title="Strikethrough"><i class="fas fa-strikethrough"></i></button>
        <div class="divider"></div>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('formatBlock', 'H1')" title="Heading 1"><b>H1</b></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('formatBlock', 'H2')" title="Heading 2"><b>H2</b></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('formatBlock', 'H3')" title="Heading 3"><b>H3</b></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('formatBlock', 'P')" title="Paragraph"><i class="fas fa-paragraph"></i></button>
        <div class="divider"></div>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('insertUnorderedList')" title="Bullet List"><i class="fas fa-list-ul"></i></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('insertOrderedList')" title="Numbered List"><i class="fas fa-list-ol"></i></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('formatBlock', 'BLOCKQUOTE')" title="Quote"><i class="fas fa-quote-left"></i></button>
        <div class="divider"></div>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('insertHorizontalRule')" title="Divider"><i class="fas fa-minus"></i></button>
        <button class="btn btn-ghost btn-icon sm" onclick="execCmd('removeFormat')" title="Clear Formatting"><i class="fas fa-eraser"></i></button>
        <div style="margin-left:auto; display:flex; align-items:center; gap:var(--space-sm);">
          <span class="text-xs text-muted" id="save-status">Saved</span>
        </div>
      </div>
      <div class="editor-body">
        <div contenteditable="true" class="rich-editor" id="rich-editor" aria-label="Rich text editor"></div>
      </div>
    </div>`;

  const editor = $("#rich-editor");

  // Load content
  loadTextContent(state.currentSection);

  // Auto-save
  editor.addEventListener("input", () => {
    const status = $("#save-status");
    if (status) status.textContent = "Saving...";

    clearTimeout(state.saveTimeout);
    state.saveTimeout = setTimeout(() => {
      if (state.currentSection) {
        saveText(state.currentSection, editor.innerHTML);
        if (status) status.textContent = "Saved";
      }
    }, 800);

    // Broadcast typing
    broadcastTyping();
  });
}

function execCmd(command, value = null) {
  document.execCommand(command, false, value);
  $("#rich-editor")?.focus();
}

async function loadTextContent(sectionId) {
  try {
    const res = await fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", sectionId }),
    });
    const data = await res.json();
    const editor = $("#rich-editor");
    if (editor) editor.innerHTML = data?.content || "";
  } catch (err) {
    console.error("Load text error:", err);
  }
}

async function saveText(sectionId, content) {
  try {
    await fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        sectionId,
        sessionId: state.sessionId,
        content,
      }),
    });
    cacheInvalidate(`text_${sectionId}`);
  } catch (err) {
    console.error("Save error:", err);
  }
}

function broadcastTyping() {
  if (!state.sb || !state.sessionId) return;
  state.sb.channel("typing").send({
    type: "broadcast",
    event: "typing",
    payload: { user: state.user?.name || "Someone" },
  });
}

// ========== SECTIONS ==========
async function loadSections() {
  if (!state.sessionId) return;

  try {
    const data = await swr(`sections_${state.sessionId}`, async () => {
      const res = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", sessionId: state.sessionId }),
      });
      return res.json();
    });

    const list = $("#section-list");
    if (!list) return;

    if (!data || data.length === 0) {
      list.innerHTML = `
        <div class="empty-state" style="padding:var(--space-xl);">
          <div class="empty-state-icon" style="font-size:32px;"><i class="fas fa-folder-open"></i></div>
          <p class="text-xs text-muted">No sections yet</p>
        </div>`;
      return;
    }

    const icons = [
      "fa-file-lines",
      "fa-file-code",
      "fa-file-pen",
      "fa-file-word",
      "fa-note-sticky",
      "fa-bookmark",
    ];

    list.innerHTML = "";
    data.forEach((s, i) => {
      const div = document.createElement("div");
      div.className = `section-item ${s.id === state.currentSection ? "active" : ""}`;
      div.draggable = true;
      div.dataset.id = s.id;

      div.innerHTML = `
        <div class="section-item-icon">
          <i class="fas ${icons[i % icons.length]}"></i>
        </div>
        <div class="section-item-content">
          <div class="section-item-name">${s.name}</div>
          <div class="section-item-meta">Section ${i + 1}</div>
        </div>
        <div class="section-item-actions">
          <button class="btn btn-ghost btn-icon sm" onclick="event.stopPropagation(); deleteSection('${s.id}')" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>`;

      div.addEventListener("click", () => selectSection(s.id));
      div.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showSectionContextMenu(e, s);
      });

      // Drag events
      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", s.id);
        div.style.opacity = "0.5";
      });
      div.addEventListener("dragend", () => {
        div.style.opacity = "1";
      });
      div.addEventListener("dragover", (e) => {
        e.preventDefault();
        div.style.borderTop = "2px solid var(--accent)";
      });
      div.addEventListener("dragleave", () => {
        div.style.borderTop = "none";
      });
      div.addEventListener("drop", (e) => {
        e.preventDefault();
        div.style.borderTop = "none";
        const dragId = e.dataTransfer.getData("text/plain");
        if (dragId && dragId !== s.id) {
          reorderSections(dragId, s.id);
        }
      });

      list.appendChild(div);
    });
  } catch (err) {
    console.error("Load sections error:", err);
  }
}

function showSectionContextMenu(e, section) {
  const menu = $("#context-menu");
  menu.innerHTML = `
    <div class="context-menu-item" onclick="renameSection('${section.id}', '${section.name.replace(/'/g, "\\'")}')">
      <i class="fas fa-pen"></i> Rename
    </div>
    <div class="context-menu-item" onclick="duplicateSection('${section.id}', '${section.name.replace(/'/g, "\\'")}')">
      <i class="fas fa-copy"></i> Duplicate
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item danger" onclick="deleteSection('${section.id}')">
      <i class="fas fa-trash"></i> Delete
    </div>`;

  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.classList.add("visible");
}

async function renameSection(id, oldName) {
  $("#context-menu")?.classList.remove("visible");
  const name = prompt("New name:", oldName);
  if (!name || name === oldName) return;

  try {
    await fetch("/api/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", sectionId: id, name }),
    }).catch(() => {});
    cacheInvalidate(`sections_${state.sessionId}`);
    loadSections();
    showToast("Section renamed", "success", 2000);
  } catch (err) {
    showToast("Error renaming section", "error");
  }
}

async function duplicateSection(id, name) {
  $("#context-menu")?.classList.remove("visible");
  try {
    await fetch("/api/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        sessionId: state.sessionId,
        name: `${name} (Copy)`,
      }),
    });
    cacheInvalidate(`sections_${state.sessionId}`);
    loadSections();
    showToast("Section duplicated", "success", 2000);
  } catch (err) {
    showToast("Error duplicating section", "error");
  }
}

async function selectSection(id) {
  state.currentSection = id;
  loadSections();

  if (state.activeTab === "editor") {
    initEditor();
  } else {
    switchTab("editor");
  }

  if (state.sidebarOpen) toggleSidebar();
}

async function createSection() {
  const name = prompt("Section name:");
  if (!name?.trim()) return;

  try {
    await fetch("/api/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        sessionId: state.sessionId,
        name: name.trim(),
      }),
    });
    cacheInvalidate(`sections_${state.sessionId}`);
    loadSections();
    showToast("Section created!", "success", 2000);
  } catch (err) {
    showToast("Error creating section", "error");
  }
}

async function deleteSection(id) {
  $("#context-menu")?.classList.remove("visible");
  if (!confirm("Delete this section and all its content?")) return;

  try {
    await fetch("/api/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", sectionId: id }),
    });
    cacheInvalidate(`sections_${state.sessionId}`);

    if (state.currentSection === id) {
      state.currentSection = null;
      if (state.activeTab === "editor") initEditor();
    }

    loadSections();
    showToast("Section deleted", "success", 2000);
  } catch (err) {
    showToast("Error deleting section", "error");
  }
}

async function reorderSections(dragId, dropId) {
  const items = $$(".section-item");
  const ids = items.map((el) => el.dataset.id).filter(Boolean);

  const fromIdx = ids.indexOf(dragId);
  const toIdx = ids.indexOf(dropId);
  if (fromIdx === -1 || toIdx === -1) return;

  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, dragId);

  try {
    await fetch("/api/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", order: ids }),
    });
    cacheInvalidate(`sections_${state.sessionId}`);
    loadSections();
  } catch (err) {
    console.error("Reorder error:", err);
  }
}

// ========== TABS ==========
function switchTab(tab) {
  state.activeTab = tab;

  // Update tab bar
  $$(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tab),
  );
  $$(".bottom-nav-item").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tab),
  );

  // Update title
  const titles = {
    editor: "Editor",
    files: "Files",
    whiteboard: "Whiteboard",
    chat: "Chat",
    todos: "Tasks",
  };
  const titleEl = $("#top-bar-title");
  if (titleEl) titleEl.textContent = titles[tab] || tab;

  // Load content
  if (tab === "editor") initEditor();
  else if (tab === "files") loadFiles();
  else if (tab === "chat") initChat();
  else if (tab === "whiteboard") initWhiteboard();
  else if (tab === "todos") initTodos();
}

// ========== FILES ==========
async function loadFiles() {
  const inner = $("#content-inner");
  if (!inner) return;

  inner.innerHTML = `
    <div class="files-header">
      <div>
        <h2 style="font-size:18px; font-weight:600; margin-bottom:var(--space-xs);">Files</h2>
        <p class="text-sm text-muted">Upload and manage your files</p>
      </div>
      <button class="btn btn-primary" onclick="$('#file-input')?.click()">
        <i class="fas fa-cloud-arrow-up"></i>
        Upload File
      </button>
      <input type="file" id="file-input" accept="image/*,.pdf,.txt" style="display:none" aria-label="Upload file">
    </div>

    <div class="file-drop-zone" id="file-drop-zone">
      <div class="file-drop-zone-icon"><i class="fas fa-cloud-arrow-up"></i></div>
      <p class="file-drop-zone-text">Drag & drop files here, or click to browse</p>
      <p class="file-drop-zone-hint">Supports: Images, PDF, TXT • Max 2MB</p>
    </div>

    <div class="file-grid" id="file-grid">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>`;

  // File input change
  $("#file-input").addEventListener("change", (e) => {
    if (e.target.files[0]) handleFileUpload(e.target.files[0]);
    e.target.value = "";
  });

  // Drag & drop
  const dropZone = $("#file-drop-zone");
  dropZone.addEventListener("click", () => $("#file-input")?.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]);
  });

  // Load files
  try {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", sessionId: state.sessionId }),
    });
    const data = await res.json();
    renderFileGrid(data || []);
  } catch (err) {
    $("#file-grid").innerHTML =
      '<p class="text-muted text-center" style="grid-column:1/-1;">Error loading files</p>';
  }
}

function renderFileGrid(files) {
  const grid = $("#file-grid");
  if (!grid) return;

  if (files.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1; padding:var(--space-2xl);">
        <div class="empty-state-icon"><i class="fas fa-folder-open"></i></div>
        <h3 class="empty-state-title">No files yet</h3>
        <p class="empty-state-text">Upload your first file to get started.</p>
      </div>`;
    return;
  }

  grid.innerHTML = "";
  files.forEach((f) => {
    const div = document.createElement("div");
    div.className = "file-card";
    div.innerHTML = `
      <div class="file-card-actions">
        <button class="btn btn-ghost btn-icon sm" onclick="event.stopPropagation(); deleteFile('${f.id}')" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <div class="file-card-preview">
        ${
          f.file_type?.startsWith("image/")
            ? `<img src="${f.file_data}" alt="${f.file_name}" loading="lazy">`
            : `<i class="fas ${getFileIcon(f.file_type)} file-icon-large"></i>`
        }
      </div>
      <div class="file-card-info">
        <div class="file-card-name" title="${f.file_name}">${f.file_name}</div>
        <div class="file-card-meta">
          <span>${formatFileSize(f.file_size)}</span>
          <span>•</span>
          <span>${formatDate(f.created_at)}</span>
        </div>
      </div>`;

    div.addEventListener("click", () => previewFile(f));
    grid.appendChild(div);
  });
}

async function handleFileUpload(file) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
  ];
  if (!allowedTypes.includes(file.type)) {
    return showToast("File type not supported", "error");
  }
  if (file.size > 2 * 1024 * 1024) {
    return showToast("File too large (max 2MB)", "error");
  }

  showToast("Uploading file...", "info", 2000);

  try {
    let data;
    if (file.type.startsWith("image/") && file.size > 500000) {
      const canvas = document.createElement("canvas");
      const img = await createImageBitmap(file);
      const ratio = Math.min(1, 800 / img.width);
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL(file.type, 0.7);
    } else {
      data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
      });
    }

    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload",
        sessionId: state.sessionId,
        sectionId: state.currentSection,
        file: { name: file.name, type: file.type, size: file.size, data },
      }),
    });

    showToast("File uploaded!", "success");
    loadFiles();
  } catch (err) {
    showToast("Error uploading file", "error");
  }
}

async function deleteFile(id) {
  if (!confirm("Delete this file?")) return;

  try {
    await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", file: { id } }),
    });
    showToast("File deleted", "success", 2000);
    loadFiles();
  } catch (err) {
    showToast("Error deleting file", "error");
  }
}

function previewFile(file) {
  if (file.file_type === "application/pdf") {
    window.open(file.file_data, "_blank");
    return;
  }

  const inner = $("#content-inner");
  if (!inner) return;

  inner.innerHTML = `
    <div style="text-align:center; padding:var(--space-xl);">
      ${
        file.file_type?.startsWith("image/")
          ? `<img src="${file.file_data}" alt="${file.file_name}" style="max-width:100%; max-height:70vh; border-radius:var(--radius-lg); box-shadow:var(--shadow-lg);">`
          : `<div style="padding:var(--space-3xl);"><i class="fas ${getFileIcon(file.file_type)}" style="font-size:64px; color:var(--text-tertiary);"></i></div>`
      }
      <div style="margin-top:var(--space-lg);">
        <h3 style="margin-bottom:var(--space-sm);">${file.file_name}</h3>
        <p class="text-sm text-muted">${formatFileSize(file.file_size)} • ${formatDate(file.created_at)}</p>
      </div>
      <button class="btn btn-secondary mt-lg" onclick="loadFiles()">
        <i class="fas fa-arrow-left"></i>
        Back to Files
      </button>
    </div>`;
}

// ========== CHAT ==========
function initChat() {
  const inner = $("#content-inner");
  if (!inner) return;

  inner.innerHTML = `
    <div class="chat-layout">
      <div class="chat-messages" id="chat-messages">
        <div class="empty-state" style="padding:var(--space-3xl);">
          <div class="empty-state-icon"><i class="fas fa-comments"></i></div>
          <h3 class="empty-state-title">No messages yet</h3>
          <p class="empty-state-text">Start a conversation with your team.</p>
        </div>
      </div>
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <textarea class="chat-input" id="chat-input" placeholder="Type a message..." aria-label="Chat message" rows="1"></textarea>
        </div>
        <button class="chat-send-btn" id="chat-send" title="Send message">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
    </div>`;

  const input = $("#chat-input");
  const sendBtn = $("#chat-send");

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  sendBtn.addEventListener("click", sendChat);

  loadChat();
}

async function loadChat() {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", sessionId: state.sessionId }),
    });
    const data = await res.json();
    renderChatMessages(data || []);
  } catch (err) {
    console.error("Load chat error:", err);
  }
}

function renderChatMessages(messages) {
  const container = $("#chat-messages");
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-3xl);">
        <div class="empty-state-icon"><i class="fas fa-comments"></i></div>
        <h3 class="empty-state-title">No messages yet</h3>
        <p class="empty-state-text">Start a conversation with your team.</p>
      </div>`;
    return;
  }

  container.innerHTML = "";
  messages.forEach((m) => {
    const isSelf = m.user_name === state.user?.name;
    const div = document.createElement("div");
    div.className = `chat-message ${isSelf ? "self" : ""}`;
    div.innerHTML = `
      <div class="chat-avatar">${getInitials(m.user_name)}</div>
      <div class="chat-bubble">
        <div class="chat-bubble-name">${m.user_name}</div>
        <div class="chat-bubble-text">${escapeHtml(m.message)}</div>
        <div class="chat-bubble-time">${formatDate(m.created_at)}</div>
      </div>`;
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

async function sendChat() {
  const input = $("#chat-input");
  const message = input?.value?.trim();
  if (!message) return;

  const sendBtn = $("#chat-send");
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        sessionId: state.sessionId,
        userName: state.user?.name || "Anonymous",
        message,
      }),
    });

    input.value = "";
    input.style.height = "auto";
    loadChat();
  } catch (err) {
    showToast("Error sending message", "error");
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ========== WHITEBOARD ==========
function initWhiteboard() {
  const inner = $("#content-inner");
  if (!inner) return;

  inner.innerHTML = `
    <div class="whiteboard-container" id="whiteboard-container">
      <div class="whiteboard-toolbar">
        <button class="btn btn-ghost btn-icon sm active" data-tool="pen" onclick="setWbTool('pen')" title="Pen">
          <i class="fas fa-pen"></i>
        </button>
        <button class="btn btn-ghost btn-icon sm" data-tool="eraser" onclick="setWbTool('eraser')" title="Eraser">
          <i class="fas fa-eraser"></i>
        </button>
        <div class="divider"></div>
        <input type="color" value="#6c5ce7" id="wb-color" style="width:32px; height:32px; border:none; background:none; cursor:pointer;" title="Color">
        <input type="range" min="1" max="20" value="3" id="wb-size" style="width:80px; cursor:pointer;" title="Brush Size">
        <div class="divider"></div>
        <button class="btn btn-ghost btn-icon sm" onclick="clearWhiteboard()" title="Clear">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <canvas class="whiteboard-canvas" id="wb-canvas"></canvas>
    </div>`;

  const container = $("#whiteboard-container");
  const canvas = $("#wb-canvas");
  const ctx = canvas.getContext("2d");

  const resize = () => {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height - 44;
    ctx.fillStyle = state.theme === "dark" ? "#1a1a25" : "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener("resize", debounce(resize, 200));

  canvas.style.touchAction = "none";
  let drawing = false;
  let lastX = 0,
    lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    lastX = e.offsetX;
    lastY = e.offsetY;
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const tool = state.whiteboardState.tool;
    const color = $("#wb-color")?.value || "#6c5ce7";
    const size = parseInt($("#wb-size")?.value || "3");

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(e.offsetX, e.offsetY);

    if (tool === "eraser") {
      ctx.strokeStyle = state.theme === "dark" ? "#1a1a25" : "#ffffff";
      ctx.lineWidth = size * 3;
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    lastX = e.offsetX;
    lastY = e.offsetY;
  });

  canvas.addEventListener("pointerup", () => (drawing = false));
  canvas.addEventListener("pointerleave", () => (drawing = false));
}

function setWbTool(tool) {
  state.whiteboardState.tool = tool;
  $$("[data-tool]").forEach((b) =>
    b.classList.toggle("active", b.dataset.tool === tool),
  );
  const canvas = $("#wb-canvas");
  if (canvas) canvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
}

function clearWhiteboard() {
  if (!confirm("Clear the whiteboard?")) return;
  const canvas = $("#wb-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = state.theme === "dark" ? "#1a1a25" : "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  showToast("Whiteboard cleared", "info", 2000);
}

// ========== TODOS ==========
async function initTodos() {
  const inner = $("#content-inner");
  if (!inner) return;

  inner.innerHTML = `
    <div class="todos-header">
      <div>
        <h2 style="font-size:18px; font-weight:600; margin-bottom:var(--space-xs);">Tasks</h2>
        <p class="text-sm text-muted">Track your team's progress</p>
      </div>
      <div class="todos-stats" id="todo-stats"></div>
    </div>

    <div class="todo-input-row">
      <div class="input-wrapper" style="flex:1;">
        <input type="text" id="todo-input" class="input has-icon" placeholder="Add a new task..." aria-label="New task">
        <i class="fas fa-plus input-icon"></i>
      </div>
      <button class="btn btn-primary" onclick="addTodo()" style="min-height:42px; width:auto; padding:0 var(--space-xl);">
        <i class="fas fa-plus"></i>
        Add
      </button>
    </div>

    <div class="todo-list" id="todo-list">
      <div class="skeleton skeleton-card" style="height:52px; margin-bottom:var(--space-sm);"></div>
      <div class="skeleton skeleton-card" style="height:52px; margin-bottom:var(--space-sm);"></div>
      <div class="skeleton skeleton-card" style="height:52px;"></div>
    </div>`;

  $("#todo-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTodo();
  });

  loadTodos();
}

async function loadTodos() {
  try {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", sessionId: state.sessionId }),
    });
    const data = await res.json();
    renderTodos(data || []);
  } catch (err) {
    $("#todo-list").innerHTML =
      '<p class="text-muted text-center">Error loading tasks</p>';
  }
}

function renderTodos(todos) {
  // Stats
  const stats = $("#todo-stats");
  if (stats) {
    const total = todos.length;
    const done = todos.filter((t) => t.completed).length;
    const pending = total - done;
    stats.innerHTML = `
      <div class="todo-stat">
        <div class="todo-stat-value">${total}</div>
        <div class="todo-stat-label">Total</div>
      </div>
      <div class="todo-stat">
        <div class="todo-stat-value" style="color:var(--success);">${done}</div>
        <div class="todo-stat-label">Done</div>
      </div>
      <div class="todo-stat">
        <div class="todo-stat-value" style="color:var(--warning);">${pending}</div>
        <div class="todo-stat-label">Pending</div>
      </div>`;
  }

  // List
  const list = $("#todo-list");
  if (!list) return;

  if (todos.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="padding:var(--space-2xl);">
        <div class="empty-state-icon"><i class="fas fa-clipboard-check"></i></div>
        <h3 class="empty-state-title">No tasks yet</h3>
        <p class="empty-state-text">Add your first task to start tracking progress.</p>
      </div>`;
    return;
  }

  // Sort: pending first, then completed
  const sorted = [...todos].sort((a, b) => a.completed - b.completed);

  list.innerHTML = "";
  sorted.forEach((t) => {
    const div = document.createElement("div");
    div.className = "todo-item";
    div.innerHTML = `
      <div class="todo-checkbox ${t.completed ? "checked" : ""}" onclick="toggleTodo('${t.id}', ${!t.completed})">
        <i class="fas fa-check"></i>
      </div>
      <span class="todo-text ${t.completed ? "completed" : ""}">${escapeHtml(t.text)}</span>
      <button class="btn btn-ghost btn-icon sm todo-delete" onclick="deleteTodo('${t.id}')" title="Delete">
        <i class="fas fa-xmark"></i>
      </button>`;
    list.appendChild(div);
  });
}

async function addTodo() {
  const input = $("#todo-input");
  const text = input?.value?.trim();
  if (!text) return;

  input.value = "";
  input.disabled = true;

  try {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        sessionId: state.sessionId,
        text,
      }),
    });
    loadTodos();
  } catch (err) {
    showToast("Error adding task", "error");
  } finally {
    input.disabled = false;
    input.focus();
  }
}

async function toggleTodo(id, completed) {
  try {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", todoId: id, completed }),
    });
    loadTodos();
  } catch (err) {
    showToast("Error updating task", "error");
  }
}

async function deleteTodo(id) {
  try {
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", todoId: id }),
    });
    loadTodos();
    showToast("Task deleted", "success", 2000);
  } catch (err) {
    showToast("Error deleting task", "error");
  }
}

// ========== REALTIME ==========
function setupRealtime() {
  if (!state.sb) return;

  // Main channel
  const channel = state.sb
    .channel("syncspace-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sections" },
      () => loadSections(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "texts" },
      (payload) => {
        if (payload.new && state.currentSection === payload.new.section_id) {
          const editor = $("#rich-editor");
          if (
            editor &&
            document.activeElement !== editor &&
            editor.innerHTML !== payload.new.content
          ) {
            editor.innerHTML = payload.new.content;
          }
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chat_messages" },
      () => {
        if (state.activeTab === "chat") loadChat();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "todos" },
      () => {
        if (state.activeTab === "todos") loadTodos();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "files" },
      () => {
        if (state.activeTab === "files") loadFiles();
      },
    )
    .subscribe();

  state.channels.push(channel);

  // Typing channel
  const typingChannel = state.sb
    .channel("typing")
    .on("broadcast", { event: "typing" }, (payload) => {
      const indicator = $("#typing-indicator");
      const text = $("#typing-text");
      if (indicator && text && payload.payload?.user !== state.user?.name) {
        text.textContent = `${payload.payload.user} is typing...`;
        indicator.classList.add("visible");
        clearTimeout(state.typingTimeout);
        state.typingTimeout = setTimeout(() => {
          indicator.classList.remove("visible");
        }, 2500);
      }
    })
    .subscribe();

  state.channels.push(typingChannel);
}

// ========== KEYBOARD SHORTCUTS ==========
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (state.currentSection) {
        const editor = $("#rich-editor");
        if (editor) saveText(state.currentSection, editor.innerHTML);
        showToast("Saved!", "success", 1500);
      }
    }

    // Ctrl+/: Shortcuts help
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      showToast("Ctrl+S: Save | Ctrl+1-5: Switch tabs", "info", 4000);
    }

    // Ctrl+1-5: Switch tabs
    const tabKeys = {
      1: "editor",
      2: "files",
      3: "whiteboard",
      4: "chat",
      5: "todos",
    };
    if ((e.ctrlKey || e.metaKey) && tabKeys[e.key]) {
      e.preventDefault();
      switchTab(tabKeys[e.key]);
    }
  });
}

// ========== SESSION TIMEOUT ==========
function setupSessionTimeout() {
  let timeout;
  const resetTimer = () => {
    clearTimeout(timeout);
    timeout = setTimeout(
      () => {
        if (localStorage.getItem("ss_token")) {
          showToast("Session expired due to inactivity", "warning");
          setTimeout(() => {
            localStorage.clear();
            location.reload();
          }, 2000);
        }
      },
      30 * 60 * 1000,
    );
  };
  ["mousemove", "keypress", "scroll", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, resetTimer, { passive: true });
  });
  resetTimer();
}

// ========== SERVICE WORKER ==========
function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

// ========== EXPORT ==========
async function exportData() {
  try {
    const res = await fetch("/api/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", sessionId: state.sessionId }),
    });
    const data = await res.json();

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `syncspace_${state.sessionId}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Data exported successfully!", "success");
  } catch (err) {
    showToast("Error exporting data", "error");
  }
}

// ========== TEMPLATES ==========
function showTemplates() {
  const templates = {
    "📋 Meeting Notes":
      "<h1>Meeting Notes</h1><p><strong>Date:</strong> <br><strong>Attendees:</strong></p><ul><li></li></ul><h2>Agenda</h2><ol><li></li></ol><h2>Action Items</h2><ul><li>☐ </li></ul><h2>Notes</h2><p></p>",
    "📊 Project Plan":
      "<h1>Project Plan</h1><p><strong>Project Name:</strong> <br><strong>Start Date:</strong> <br><strong>Deadline:</strong></p><h2>Objectives</h2><ul><li></li></ul><h2>Milestones</h2><ol><li><strong>Phase 1</strong> — </li><li><strong>Phase 2</strong> — </li><li><strong>Phase 3</strong> — </li></ol><h2>Risks</h2><ul><li></li></ul>",
    "🐛 Bug Report":
      "<h1>Bug Report</h1><p><strong>Title:</strong> <br><strong>Severity:</strong> ☐ Critical ☐ High ☐ Medium ☐ Low<br><strong>Environment:</strong> </p><h2>Steps to Reproduce</h2><ol><li></li></ol><h2>Expected Behavior</h2><p></p><h2>Actual Behavior</h2><p></p><h2>Screenshots</h2><p></p>",
    "📝 Weekly Report":
      "<h1>Weekly Report</h1><p><strong>Week of:</strong> <br><strong>Team:</strong> </p><h2>Accomplishments</h2><ul><li></li></ul><h2>In Progress</h2><ul><li></li></ul><h2>Blockers</h2><ul><li></li></ul><h2>Next Week Goals</h2><ul><li></li></ul>",
    "💡 Brainstorm":
      "<h1>Brainstorm Session</h1><p><strong>Topic:</strong> <br><strong>Date:</strong> </p><h2>Ideas</h2><ul><li>💡 </li><li>💡 </li><li>💡 </li></ul><h2>Pros & Cons</h2><p></p><h2>Decision</h2><p></p>",
  };

  const app = $("#app");
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-logo" style="background: linear-gradient(135deg, var(--warning), #e17055);">
          <i class="fas fa-wand-magic-sparkles"></i>
        </div>
        <h1 class="modal-title">Templates</h1>
        <p class="modal-subtitle">Choose a template to get started quickly</p>
      </div>
      <div style="display:flex; flex-direction:column; gap:var(--space-sm);">
        ${Object.keys(templates)
          .map(
            (name) => `
          <button class="btn btn-secondary" style="justify-content:flex-start; text-align:left;" data-template="${name}">
            ${name}
          </button>
        `,
          )
          .join("")}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-full" onclick="this.closest('.overlay').classList.remove('active')">
          Cancel
        </button>
      </div>
    </div>`;

  app.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("active"));

  overlay.querySelectorAll("[data-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.template;
      if (templates[name] && state.currentSection) {
        const editor = $("#rich-editor");
        if (editor) {
          editor.innerHTML = templates[name];
          saveText(state.currentSection, editor.innerHTML);
          showToast("Template applied!", "success");
        }
      } else if (!state.currentSection) {
        showToast("Please select a section first", "warning");
      }
      overlay.classList.remove("active");
      setTimeout(() => overlay.remove(), 300);
    });
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.remove("active");
      setTimeout(() => overlay.remove(), 300);
    }
  });
}

// ========== MANUAL CONFIG ==========
function showManualConfig() {
  const app = $("#app");
  app.innerHTML = `
    <div class="overlay active" id="config-overlay">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-logo" style="background: linear-gradient(135deg, var(--warning), #e17055);">
            <i class="fas fa-gear"></i>
          </div>
          <h1 class="modal-title">Manual Setup Required</h1>
          <p class="modal-subtitle">Enter your Supabase credentials to connect. You can get these from your Supabase dashboard.</p>
        </div>
        <div class="config-grid">
          <div class="input-group" style="margin-bottom:0;">
            <label class="text-sm text-muted mb-sm" style="display:block;">Supabase URL</label>
            <input type="url" id="cfg-url" class="input" placeholder="https://your-project.supabase.co" value="${localStorage.getItem("sb_url") || ""}">
          </div>
          <div class="input-group" style="margin-bottom:0;">
            <label class="text-sm text-muted mb-sm" style="display:block;">Anon Key</label>
            <input type="password" id="cfg-key" class="input" placeholder="eyJhbGciOi..." value="${localStorage.getItem("sb_key") || ""}">
          </div>
        </div>
        <button class="btn btn-primary btn-full btn-lg mt-lg" onclick="saveManualConfig()">
          <i class="fas fa-plug"></i>
          Connect
        </button>
        <div class="modal-footer" style="margin-top:var(--space-lg);">
          <p class="text-xs text-muted">Credentials are stored locally in your browser</p>
        </div>
      </div>
    </div>`;
}

function saveManualConfig() {
  const url = $("#cfg-url")?.value?.trim();
  const key = $("#cfg-key")?.value?.trim();

  if (!url || !key) {
    return showToast("Both fields are required", "error");
  }

  try {
    new URL(url);
  } catch (e) {
    return showToast("Invalid Supabase URL format", "error");
  }

  localStorage.setItem("sb_url", url);
  localStorage.setItem("sb_key", key);

  if (window.supabase) {
    state.sb = window.supabase.createClient(url, key);
    setupRealtime();
    checkAuth();
    setupKeyboardShortcuts();
    setupSessionTimeout();
    registerSW();
    setupGlobalListeners();
  } else {
    // If supabase isn't loaded yet, reload to load it
    location.reload();
    return;
  }

  const overlay = document.getElementById("config-overlay");
  if (overlay) {
    overlay.classList.remove("active");
    setTimeout(() => overlay.remove(), 300);
  }

  showToast("Configuration saved! Connected successfully.", "success");
}

// ========== GLOBALIZE ==========
window.createSection = createSection;
window.deleteSection = deleteSection;
window.switchTab = switchTab;
window.toggleTheme = toggleTheme;
window.exportData = exportData;
window.showTemplates = showTemplates;
window.logout = logout;
window.toggleSidebar = toggleSidebar;
window.saveManualConfig = saveManualConfig;
window.execCmd = execCmd;
window.addTodo = addTodo;
window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;
window.deleteFile = deleteFile;
window.setWbTool = setWbTool;
window.clearWhiteboard = clearWhiteboard;
window.previewFile = previewFile;
window.loadFiles = loadFiles;
window.checkAuth = checkAuth;

// ========== START ==========
window.onload = init;
