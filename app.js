/* ============================================================
   SyncSpace — Application Logic (rewrite)
   Fixes: leave/delete navigation, save races, chat/file/todo
   dedupe, editor merge, whiteboard persist+clear sync, DPR,
   unread badges, ownership, timers, demo multi-tab fingerprint
   ============================================================ */

(() => {
  "use strict";

  const SESSION_MS = 30 * 60 * 1000;
  const SAVE_DEBOUNCE = 800;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const MAX_TOASTS = 5;
  const LS = {
    users: "ss_users_v2",
    sessions: "ss_sessions_v2",
    auth: "ss_auth_v2",
    recent: "ss_recent_v2",
  };

  const ALLOWED_MIME = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);

  // -------------------- State --------------------
  const S = {
    sb: null,
    demo: true,
    user: null,
    session: null, // { id, name, created_by, ends_at, passwordHash? }
    sections: [],
    activeSectionId: null,
    texts: {},
    files: [],
    todos: [],
    messages: [],
    boardData: "",
    channel: null,
    demoPoll: null,
    saveTimer: null,
    saveGeneration: 0,
    timerInterval: null,
    timerEndsAt: null,
    unreadChat: 0,
    knownMessageIds: new Set(),
    activePanel: "editor",
    wb: { tool: "pen", drawing: false, last: null, dpr: 1, bound: false },
    connected: false,
    remoteTyping: null,
    typingClear: null,
    typingThrottle: 0,
    boardSaveTimer: null,
    presence: {},
    applyingRemoteEditor: false,
    statsAnimated: false,
    leaving: false,
  };

  // -------------------- Demo store --------------------
  const Demo = {
    users: safeParse(localStorage.getItem(LS.users), {}),
    sessions: safeParse(localStorage.getItem(LS.sessions), {}),
    persist() {
      try {
        localStorage.setItem(LS.users, JSON.stringify(this.users));
        localStorage.setItem(LS.sessions, JSON.stringify(this.sessions));
      } catch (err) {
        if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
          toast(
            "Storage full — remove some files or clear old sessions",
            "error",
            5000,
          );
        }
        throw err;
      }
    },
    getSessionData(id) {
      if (!id || !this.sessions[id]) return null;
      if (!this.sessions[id].data) {
        this.sessions[id].data = emptySessionData();
      }
      return this.sessions[id].data;
    },
    fingerprint(id) {
      const d = this.getSessionData(id);
      if (!d) return "";
      return [
        d.messages.length,
        d.messages.map((m) => m.id).join(","),
        d.todos
          .map((t) => `${t.id}:${t.completed ? 1 : 0}:${t.text}`)
          .join("|"),
        d.files.map((f) => f.id).join(","),
        d.sections.map((s) => `${s.id}:${s.name}`).join("|"),
        (d.board || "").length,
        Object.keys(d.texts || {})
          .map(
            (k) =>
              `${k}:${(d.texts[k].content || "").length}:${d.texts[k].updated_at || ""}`,
          )
          .join(";"),
      ].join("::");
    },
  };

  function emptySessionData() {
    return {
      sections: [],
      texts: {},
      messages: [],
      todos: [],
      files: [],
      versions: {},
      board: "",
    };
  }

  function safeParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  // -------------------- DOM helpers --------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function showView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    const el = $(`#view-${name}`);
    if (el) el.classList.add("active");
    closeMobileNav();
    closeSidebar();
    if (name === "landing") animateStats();
    if (name === "hub") renderRecentSessions();
    if (name === "dashboard") {
      requestAnimationFrame(() => {
        if (S.activePanel === "whiteboard") resizeWhiteboard(true);
      });
    }
  }

  function setLoading(on, text = "Loading…") {
    const el = $("#loading");
    if (!el) return;
    el.hidden = !on;
    const t = $("#loading-text");
    if (t) t.textContent = text;
  }

  function toast(message, type = "info", ms = 3200) {
    const wrap = $("#toasts");
    if (!wrap) return;
    while (wrap.children.length >= MAX_TOASTS) wrap.firstElementChild.remove();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    const icon =
      type === "success"
        ? "fa-circle-check"
        : type === "error"
          ? "fa-circle-exclamation"
          : "fa-circle-info";
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    el.querySelector("span").textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  function setConn(status) {
    const dot = $("#conn-dot");
    if (!dot) return;
    dot.classList.remove("online", "offline");
    if (status === "online") {
      dot.classList.add("online");
      S.connected = true;
      dot.title = "Connected";
    } else if (status === "offline") {
      dot.classList.add("offline");
      S.connected = false;
      dot.title = "Offline";
    } else {
      S.connected = false;
      dot.title = "Connecting…";
    }
  }

  function setSaveStatus(state) {
    const el = $("#save-status");
    if (!el) return;
    el.classList.remove("saving", "saved", "error");
    if (state === "saving") {
      el.textContent = "Saving…";
      el.classList.add("saving");
    } else if (state === "saved") {
      el.textContent = "Saved";
      el.classList.add("saved");
    } else if (state === "error") {
      el.textContent = "Save failed";
      el.classList.add("error");
    } else if (state === "conflict") {
      el.textContent = "Updated remotely";
      el.classList.add("saving");
    } else {
      el.textContent = state;
    }
  }

  function initials(name = "U") {
    return (
      String(name || "U")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0].toUpperCase())
        .join("") || "U"
    );
  }

  function avatarColor(seed = "") {
    let h = 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 70% 45%))`;
  }

  function uid(len = 6) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    const arr = crypto.getRandomValues(new Uint8Array(len));
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function sha256(text) {
    if (!window.crypto?.subtle) {
      throw new Error(
        "Secure context required (use HTTPS) for password hashing",
      );
    }
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Basic HTML sanitizer for editor content (no scripts/handlers) */
  function sanitizeHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const banned = new Set([
      "SCRIPT",
      "STYLE",
      "IFRAME",
      "OBJECT",
      "EMBED",
      "LINK",
      "META",
      "BASE",
      "FORM",
      "INPUT",
      "BUTTON",
      "TEXTAREA",
      "SELECT",
    ]);
    const walk = (node) => {
      const children = [...node.childNodes];
      for (const child of children) {
        if (child.nodeType === 1) {
          const tag = child.tagName;
          if (banned.has(tag)) {
            child.remove();
            continue;
          }
          [...child.attributes].forEach((attr) => {
            const n = attr.name.toLowerCase();
            const v = attr.value || "";
            if (n.startsWith("on") || n === "srcdoc" || n === "formaction") {
              child.removeAttribute(attr.name);
            } else if (
              (n === "href" || n === "src" || n === "xlink:href") &&
              /^\s*javascript:/i.test(v)
            ) {
              child.removeAttribute(attr.name);
            }
          });
          walk(child);
        } else if (child.nodeType === 8) {
          child.remove();
        }
      }
    };
    walk(template.content);
    return template.innerHTML;
  }

  function formatBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return "—";
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function formatDateLabel(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const yday = new Date();
      yday.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return "Today";
      if (d.toDateString() === yday.toDateString()) return "Yesterday";
      return d.toLocaleDateString();
    } catch {
      return "";
    }
  }

  function normalizeUserId(id) {
    return String(id || "")
      .trim()
      .toLowerCase();
  }

  function isEditorVisuallyEmpty(el) {
    if (!el) return true;
    const text = (el.innerText || "").replace(/\u00a0/g, " ").trim();
    if (text.length) return false;
    const html = (el.innerHTML || "").replace(/\s+/g, "").toLowerCase();
    return (
      !html ||
      html === "<br>" ||
      html === "<div><br></div>" ||
      html === "<p><br></p>" ||
      html === "<p></p>"
    );
  }

  function updateEditorEmptyClass() {
    const ed = $("#editor");
    if (!ed) return;
    ed.classList.toggle("is-empty", isEditorVisuallyEmpty(ed));
  }

  function closeMobileNav() {
    const links = $("#nav-links");
    const toggle = $("#nav-toggle");
    links?.classList.remove("open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    const bd = $("#sidebar-backdrop");
    if (bd) bd.hidden = true;
  }

  function openSidebar() {
    $("#sidebar")?.classList.add("open");
    const bd = $("#sidebar-backdrop");
    if (bd) bd.hidden = false;
  }

  // -------------------- Config / Supabase --------------------
  async function initSupabase() {
    let url = "";
    let key = "";

    if (window.SYNCSPACE_CONFIG?.url && window.SYNCSPACE_CONFIG?.key) {
      url = window.SYNCSPACE_CONFIG.url;
      key = window.SYNCSPACE_CONFIG.key;
    } else {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (res.ok) {
          const cfg = await res.json();
          url = cfg.url || "";
          key = cfg.key || "";
        }
      } catch {
        /* demo */
      }
    }

    if (url && key && window.supabase) {
      S.sb = window.supabase.createClient(url, key, {
        realtime: { params: { eventsPerSecond: 20 } },
      });
      S.demo = false;
      setConn("connecting");
      return true;
    }

    S.demo = true;
    S.sb = null;
    setConn("online");
    console.info(
      "[SyncSpace] DEMO mode (localStorage). Configure Supabase for multi-device realtime.",
    );
    return false;
  }

  // -------------------- Stats --------------------
  function animateCounter(el, target, duration = 1200) {
    const start = performance.now();
    const prefersReduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReduce) {
      el.textContent = Math.round(target).toLocaleString();
      return;
    }
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function loadLandingStats() {
    let users = 0;
    let sessions = 0;
    let messages = 0;
    let tasks = 0;

    if (!S.demo && S.sb) {
      try {
        const [u, s, m, t] = await Promise.all([
          S.sb.from("users").select("*", { count: "exact", head: true }),
          S.sb.from("sessions").select("*", { count: "exact", head: true }),
          S.sb
            .from("chat_messages")
            .select("*", { count: "exact", head: true }),
          S.sb
            .from("todos")
            .select("*", { count: "exact", head: true })
            .eq("completed", true),
        ]);
        users = u.count || 0;
        sessions = s.count || 0;
        messages = m.count || 0;
        tasks = t.count || 0;
      } catch {
        /* zeros */
      }
    } else {
      users = Object.keys(Demo.users).length;
      sessions = Object.keys(Demo.sessions).length;
      Object.values(Demo.sessions).forEach((sess) => {
        const d = sess.data || {};
        messages += (d.messages || []).length;
        tasks += (d.todos || []).filter((x) => x.completed).length;
      });
    }
    return { users, sessions, messages, tasks };
  }

  async function animateStats() {
    const stats = await loadLandingStats();
    const map = {
      users: stats.users,
      sessions: stats.sessions,
      messages: stats.messages,
      tasks: stats.tasks,
    };
    $$("[data-stat]").forEach((el) => {
      const key = el.dataset.stat;
      const val = map[key] || 0;
      if (S.statsAnimated) el.textContent = val.toLocaleString();
      else animateCounter(el, val);
    });
    S.statsAnimated = true;
  }

  // -------------------- Auth --------------------
  function persistUserSession() {
    if (S.user) localStorage.setItem(LS.auth, JSON.stringify(S.user));
    else localStorage.removeItem(LS.auth);
  }

  function restoreUserSession() {
    return safeParse(localStorage.getItem(LS.auth), null);
  }

  function showLogin() {
    $("#auth-login").hidden = false;
    $("#auth-signup").hidden = true;
    $("#login-error").hidden = true;
  }

  function showSignup(prefillId = "") {
    $("#auth-login").hidden = true;
    $("#auth-signup").hidden = false;
    $("#signup-error").hidden = true;
    if (prefillId) $("#signup-userid").value = prefillId;
  }

  function updatePasswordStrength(pw) {
    const box = $("#pw-strength");
    if (!box) return;
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
    box.classList.remove("weak", "medium", "strong");
    const label = box.querySelector(".strength-label");
    if (!pw) {
      label.textContent = "Weak";
      return;
    }
    if (score <= 1) {
      box.classList.add("weak");
      label.textContent = "Weak";
    } else if (score <= 2) {
      box.classList.add("medium");
      label.textContent = "Medium";
    } else {
      box.classList.add("strong");
      label.textContent = "Strong";
    }
  }

  async function findUser(userId) {
    const id = normalizeUserId(userId);
    if (S.demo) return Demo.users[id] || null;
    const { data, error } = await S.sb
      .from("users")
      .select("user_id, name, password, role, created_at")
      .eq("user_id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createUser({ user_id, name, password }) {
    const id = normalizeUserId(user_id);
    const hash = await sha256(password);
    if (S.demo) {
      if (Demo.users[id]) throw new Error("User ID already taken");
      Demo.users[id] = {
        user_id: id,
        name: name.trim(),
        password: hash,
        role: "member",
        created_at: new Date().toISOString(),
      };
      Demo.persist();
      return Demo.users[id];
    }
    const { data, error } = await S.sb
      .from("users")
      .insert({
        user_id: id,
        name: name.trim(),
        password: hash,
        role: "member",
      })
      .select("user_id, name, role, created_at")
      .single();
    if (error) throw error;
    return data;
  }

  async function handleLogin(e) {
    e.preventDefault();
    const userId = normalizeUserId($("#login-userid").value);
    const password = $("#login-password").value;
    const errEl = $("#login-error");
    errEl.hidden = true;
    const btn = $("#login-btn");
    btn.disabled = true;
    btn.querySelector(".btn-spinner").hidden = false;

    try {
      if (userId.length < 3)
        throw new Error("User ID must be at least 3 characters");
      if (password.length < 6)
        throw new Error("Password must be at least 6 characters");
      const user = await findUser(userId);
      if (!user) {
        toast("Account not found — create one to continue", "info");
        showSignup(userId);
        return;
      }
      const hash = await sha256(password);
      if (hash !== user.password) throw new Error("Incorrect password");
      S.user = {
        user_id: user.user_id,
        name: user.name,
        role: user.role || "member",
      };
      persistUserSession();
      enterHub();
      toast(`Welcome back, ${S.user.name}!`, "success");
    } catch (err) {
      errEl.textContent = err.message || "Login failed";
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector(".btn-spinner").hidden = true;
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    const name = $("#signup-name").value.trim();
    const userId = normalizeUserId($("#signup-userid").value);
    const password = $("#signup-password").value;
    const confirm = $("#signup-confirm").value;
    const errEl = $("#signup-error");
    errEl.hidden = true;
    const btn = $("#signup-btn");
    btn.disabled = true;
    btn.querySelector(".btn-spinner").hidden = false;

    try {
      if (name.length < 2) throw new Error("Please enter your full name");
      if (userId.length < 3)
        throw new Error("User ID must be at least 3 characters");
      if (!/^[a-z0-9_.-]+$/.test(userId))
        throw new Error("User ID: letters, numbers, _ . - only");
      if (password.length < 6)
        throw new Error("Password must be at least 6 characters");
      if (password !== confirm) throw new Error("Passwords do not match");
      // Block very weak passwords
      if (
        password === userId ||
        password === "123456" ||
        password === "password"
      ) {
        throw new Error("Password is too common — choose a stronger one");
      }

      const existing = await findUser(userId);
      if (existing) throw new Error("User ID already taken");

      const user = await createUser({ user_id: userId, name, password });
      S.user = {
        user_id: user.user_id,
        name: user.name,
        role: user.role || "member",
      };
      persistUserSession();
      enterHub();
      toast("Account created successfully!", "success");
    } catch (err) {
      errEl.textContent = err.message || "Signup failed";
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector(".btn-spinner").hidden = true;
    }
  }

  async function logout() {
    await leaveSession({ silent: true, skipSave: false });
    S.user = null;
    persistUserSession();
    showLogin();
    showView("auth");
    toast("Logged out", "info");
  }

  function enterHub() {
    if (!S.user) return showView("auth");
    $("#hub-name").textContent = S.user.name;
    $("#hub-userid").textContent = `@${S.user.user_id}`;
    const av = $("#hub-avatar");
    av.textContent = initials(S.user.name);
    av.style.background = avatarColor(S.user.user_id);
    showView("hub");
  }

  // -------------------- Recent sessions (device) --------------------
  function getRecent() {
    return safeParse(localStorage.getItem(LS.recent), []);
  }

  function pushRecent(session) {
    if (!session?.id) return;
    const list = getRecent().filter((r) => r.id !== session.id);
    list.unshift({ id: session.id, name: session.name, at: Date.now() });
    localStorage.setItem(LS.recent, JSON.stringify(list.slice(0, 8)));
  }

  function renderRecentSessions() {
    const box = $("#hub-recent");
    const list = $("#recent-list");
    if (!box || !list) return;
    const recent = getRecent();
    if (!recent.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    list.innerHTML = "";
    recent.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="mono"></span><span class="recent-name"></span>`;
      li.querySelector(".mono").textContent = r.id;
      li.querySelector(".recent-name").textContent = r.name || "";
      li.title = "Click to fill Join form";
      li.style.cursor = "pointer";
      li.addEventListener("click", () => {
        $("#join-id").value = r.id;
        $("#join-password").focus();
      });
      list.appendChild(li);
    });
  }

  // -------------------- Sessions --------------------
  async function generateUniqueSessionId() {
    for (let i = 0; i < 12; i++) {
      const id = uid(6);
      if (S.demo) {
        if (!Demo.sessions[id]) return id;
      } else {
        const { data, error } = await S.sb
          .from("sessions")
          .select("id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return id;
      }
    }
    throw new Error("Could not allocate session ID — try again");
  }

  async function createSession(name, password) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Session name is required");
    if (password.length < 3)
      throw new Error("Session password must be at least 3 characters");

    const id = await generateUniqueSessionId();
    const hash = await sha256(password);
    const endsAt = new Date(Date.now() + SESSION_MS).toISOString();

    if (S.demo) {
      const secId = uuid();
      Demo.sessions[id] = {
        id,
        name: cleanName,
        password: hash,
        created_by: S.user.user_id,
        ends_at: endsAt,
        created_at: new Date().toISOString(),
        data: emptySessionData(),
      };
      Demo.sessions[id].data.sections.push({
        id: secId,
        session_id: id,
        name: "Main",
        sort_order: 0,
        created_at: new Date().toISOString(),
      });
      Demo.sessions[id].data.texts[secId] = {
        id: uuid(),
        section_id: secId,
        session_id: id,
        content: "",
        updated_at: new Date().toISOString(),
      };
      Demo.persist();
      return {
        id,
        name: cleanName,
        created_by: S.user.user_id,
        ends_at: endsAt,
      };
    }

    const { error } = await S.sb.from("sessions").insert({
      id,
      name: cleanName,
      password: hash,
      created_by: S.user.user_id,
      ends_at: endsAt,
    });
    if (error) throw error;

    const { data: section, error: sErr } = await S.sb
      .from("sections")
      .insert({ session_id: id, name: "Main", sort_order: 0 })
      .select()
      .single();
    if (sErr) throw sErr;
    await S.sb
      .from("texts")
      .insert({ section_id: section.id, session_id: id, content: "" });
    await S.sb
      .from("whiteboards")
      .upsert({ session_id: id, data: "", updated_by: S.user.user_id });
    return { id, name: cleanName, created_by: S.user.user_id, ends_at: endsAt };
  }

  async function joinSession(id, password) {
    id = String(id || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (id.length !== 6) throw new Error("Session ID must be 6 characters");
    if (!password || password.length < 3)
      throw new Error("Enter the session password");
    const hash = await sha256(password);

    if (S.demo) {
      const sess = Demo.sessions[id];
      if (!sess) throw new Error("Session not found");
      if (sess.password !== hash) throw new Error("Incorrect session password");
      return {
        id: sess.id,
        name: sess.name,
        created_by: sess.created_by || null,
        ends_at: sess.ends_at || null,
      };
    }

    // Don't select password into client state beyond verification
    const { data, error } = await S.sb
      .from("sessions")
      .select("id, name, password, created_by, ends_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Session not found");
    if (data.password !== hash) throw new Error("Incorrect session password");
    return {
      id: data.id,
      name: data.name,
      created_by: data.created_by || null,
      ends_at: data.ends_at || null,
    };
  }

  async function deleteSession() {
    if (!S.session) return;
    const isOwner =
      !S.session.created_by || S.session.created_by === S.user.user_id;
    if (!isOwner) {
      toast("Only the session creator can delete this session", "error");
      return;
    }
    if (
      !confirm("Delete this session and all its data? This cannot be undone.")
    )
      return;
    const id = S.session.id;
    try {
      setLoading(true, "Deleting session…");
      if (S.demo) {
        delete Demo.sessions[id];
        Demo.persist();
      } else {
        const { error } = await S.sb.from("sessions").delete().eq("id", id);
        if (error) throw error;
      }
      // Remove from recent
      localStorage.setItem(
        LS.recent,
        JSON.stringify(getRecent().filter((r) => r.id !== id)),
      );
      toast("Session deleted", "success");
      await leaveSession({ silent: true, skipSave: true });
      enterHub();
    } catch (err) {
      toast(err.message || "Failed to delete session", "error");
    } finally {
      setLoading(false);
    }
  }

  async function enterSession(session) {
    S.session = session;
    S.leaving = false;
    setLoading(true, "Joining workspace…");
    try {
      await loadSessionData();
      setupRealtime();
      startSessionTimer();
      renderDashboardShell();
      pushRecent(session);
      showView("dashboard");
      switchPanel("editor");
      toast(`Joined ${session.name}`, "success");
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to join session", "error");
      await teardownRealtime();
      stopSessionTimer();
      clearSessionState();
      enterHub();
    } finally {
      setLoading(false);
    }
  }

  function clearSessionState() {
    S.session = null;
    S.sections = [];
    S.activeSectionId = null;
    S.texts = {};
    S.files = [];
    S.todos = [];
    S.messages = [];
    S.boardData = "";
    S.unreadChat = 0;
    S.knownMessageIds = new Set();
    S.presence = {};
    S.remoteTyping = null;
  }

  async function leaveSession({ silent = false, skipSave = false } = {}) {
    if (S.leaving) return;
    S.leaving = true;
    try {
      // Cancel pending debounced save, then flush once
      if (S.saveTimer) {
        clearTimeout(S.saveTimer);
        S.saveTimer = null;
      }
      if (S.boardSaveTimer) {
        clearTimeout(S.boardSaveTimer);
        S.boardSaveTimer = null;
      }
      if (S.typingClear) {
        clearTimeout(S.typingClear);
        S.typingClear = null;
      }

      stopSessionTimer();

      if (!skipSave && S.session && S.activeSectionId) {
        const html = $("#editor")?.innerHTML || "";
        try {
          await saveTextImmediate(S.activeSectionId, html);
        } catch (err) {
          console.warn("Final save failed", err);
        }
        try {
          await persistBoard(true);
        } catch {
          /* ignore */
        }
      }

      await teardownRealtime();
      clearSessionState();

      // Clear dashboard DOM remnants
      const ed = $("#editor");
      if (ed) ed.innerHTML = "";
      updateEditorEmptyClass();

      if (!silent && S.user) {
        enterHub();
        toast("Left session", "info");
      }
    } finally {
      S.leaving = false;
    }
  }

  function renderDashboardShell() {
    if (!S.session || !S.user) return;
    $("#session-id-label").textContent = S.session.id;
    $("#session-name-label").textContent = S.session.name;
    const av = $("#dash-avatar");
    av.textContent = initials(S.user.name);
    av.style.background = avatarColor(S.user.user_id);

    const delBtn = $("#delete-session-btn");
    if (delBtn) {
      const isOwner =
        !S.session.created_by || S.session.created_by === S.user.user_id;
      delBtn.hidden = !isOwner;
      delBtn.title = isOwner ? "Delete session" : "Only creator can delete";
    }

    renderSections();
    renderChat(true);
    renderTasks();
    renderFiles();
    renderPresence();
    updateChatBadge();
    setConn(S.demo || S.connected ? "online" : "connecting");
  }

  async function loadSessionData() {
    if (S.demo) {
      const data = Demo.getSessionData(S.session.id);
      if (!data) throw new Error("Session data missing");
      S.sections = [...(data.sections || [])].sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      S.texts = { ...(data.texts || {}) };
      S.messages = [...(data.messages || [])];
      S.todos = [...(data.todos || [])];
      S.files = [...(data.files || [])];
      S.boardData = data.board || "";
      S.knownMessageIds = new Set(S.messages.map((m) => m.id));

      if (!S.sections.length) {
        const secId = uuid();
        const sec = {
          id: secId,
          session_id: S.session.id,
          name: "Main",
          sort_order: 0,
          created_at: new Date().toISOString(),
        };
        data.sections.push(sec);
        data.texts[secId] = {
          id: uuid(),
          section_id: secId,
          session_id: S.session.id,
          content: "",
          updated_at: new Date().toISOString(),
        };
        Demo.persist();
        S.sections = [sec];
        S.texts = { ...data.texts };
      }
      S.activeSectionId = S.sections[0].id;
      loadEditorContent(S.activeSectionId);
      return;
    }

    const sid = S.session.id;
    const [secRes, textRes, chatRes, todoRes, fileRes, boardRes] =
      await Promise.all([
        S.sb
          .from("sections")
          .select("*")
          .eq("session_id", sid)
          .order("sort_order"),
        S.sb.from("texts").select("*").eq("session_id", sid),
        S.sb
          .from("chat_messages")
          .select("*")
          .eq("session_id", sid)
          .order("created_at")
          .limit(200),
        S.sb
          .from("todos")
          .select("*")
          .eq("session_id", sid)
          .order("created_at"),
        S.sb
          .from("files")
          .select("*")
          .eq("session_id", sid)
          .order("created_at", { ascending: false }),
        S.sb
          .from("whiteboards")
          .select("*")
          .eq("session_id", sid)
          .maybeSingle(),
      ]);

    if (secRes.error) throw secRes.error;
    S.sections = secRes.data || [];
    if (!S.sections.length) {
      const { data: section, error } = await S.sb
        .from("sections")
        .insert({ session_id: sid, name: "Main", sort_order: 0 })
        .select()
        .single();
      if (error) throw error;
      await S.sb
        .from("texts")
        .insert({ section_id: section.id, session_id: sid, content: "" });
      S.sections = [section];
    }

    S.texts = {};
    (textRes.data || []).forEach((t) => {
      // Prefer newest if duplicates ever exist
      const prev = S.texts[t.section_id];
      if (!prev || new Date(t.updated_at) > new Date(prev.updated_at || 0)) {
        S.texts[t.section_id] = t;
      }
    });
    S.messages = chatRes.data || [];
    S.knownMessageIds = new Set(S.messages.map((m) => m.id));
    S.todos = todoRes.data || [];
    S.files = fileRes.data || [];
    S.boardData = boardRes.data?.data || "";
    if (!boardRes.data) {
      await S.sb
        .from("whiteboards")
        .upsert({ session_id: sid, data: "", updated_by: S.user.user_id });
    }
    S.activeSectionId = S.sections[0].id;
    loadEditorContent(S.activeSectionId);
  }

  // -------------------- Realtime --------------------
  async function teardownRealtime() {
    if (S.demoPoll) {
      clearInterval(S.demoPoll);
      S.demoPoll = null;
    }
    if (S.channel && S.sb) {
      try {
        await S.sb.removeChannel(S.channel);
      } catch {
        /* ignore */
      }
    }
    S.channel = null;
  }

  function setupRealtime() {
    // fire-and-forget cleanup of previous
    teardownRealtime();

    if (S.demo || !S.sb) {
      let lastFp = Demo.fingerprint(S.session.id);
      S.demoPoll = setInterval(() => {
        if (!S.session || S.leaving) return;
        try {
          // Reload sessions from storage for multi-tab
          Demo.sessions = safeParse(
            localStorage.getItem(LS.sessions),
            Demo.sessions,
          );
          const fp = Demo.fingerprint(S.session.id);
          if (fp === lastFp) return;
          lastFp = fp;
          const data = Demo.getSessionData(S.session.id);
          if (!data) return;

          // messages
          const prevCount = S.messages.length;
          const newMsgs = data.messages || [];
          const added = newMsgs.filter((m) => !S.knownMessageIds.has(m.id));
          S.messages = [...newMsgs];
          S.knownMessageIds = new Set(S.messages.map((m) => m.id));
          if (added.length) {
            if (S.activePanel !== "chat") {
              S.unreadChat += added.filter(
                (m) => m.user_id !== S.user.user_id,
              ).length;
              updateChatBadge();
            }
            renderChat(true);
          } else if (newMsgs.length !== prevCount) {
            renderChat(true);
          }

          S.todos = [...(data.todos || [])];
          renderTasks();
          S.files = [...(data.files || [])];
          renderFiles();

          // sections
          const secs = [...(data.sections || [])].sort(
            (a, b) => a.sort_order - b.sort_order,
          );
          S.sections = secs;
          if (!S.sections.find((s) => s.id === S.activeSectionId)) {
            if (S.sections[0]) {
              S.activeSectionId = S.sections[0].id;
              loadEditorContent(S.activeSectionId);
            }
          }
          renderSections();

          // texts remote
          S.texts = { ...(data.texts || {}) };
          const row = S.texts[S.activeSectionId];
          const ed = $("#editor");
          if (
            row &&
            ed &&
            document.activeElement !== ed &&
            !S.applyingRemoteEditor
          ) {
            const remote = sanitizeHtml(row.content || "");
            if (ed.innerHTML !== remote) {
              S.applyingRemoteEditor = true;
              ed.innerHTML = remote;
              updateEditorEmptyClass();
              S.applyingRemoteEditor = false;
              setSaveStatus("conflict");
              setTimeout(() => setSaveStatus("saved"), 1200);
            }
          }

          // board
          if ((data.board || "") !== S.boardData) {
            S.boardData = data.board || "";
            if (S.activePanel === "whiteboard") restoreBoard(S.boardData);
          }
        } catch (err) {
          console.warn("demo poll", err);
        }
      }, 900);
      setConn("online");
      return;
    }

    const sid = S.session.id;
    const ch = S.sb.channel(`session:${sid}`, {
      config: {
        broadcast: { self: false },
        presence: { key: S.user.user_id },
      },
    });

    ch.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        const row = payload.new;
        if (!row?.id || S.knownMessageIds.has(row.id)) return;
        S.knownMessageIds.add(row.id);
        S.messages.push(row);
        if (S.activePanel !== "chat" && row.user_id !== S.user.user_id) {
          S.unreadChat += 1;
          updateChatBadge();
        }
        renderChat(true);
      },
    );

    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "todos",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!S.todos.find((t) => t.id === payload.new.id))
            S.todos.push(payload.new);
        } else if (payload.eventType === "UPDATE") {
          const i = S.todos.findIndex((t) => t.id === payload.new.id);
          if (i >= 0) S.todos[i] = payload.new;
          else S.todos.push(payload.new);
        } else if (payload.eventType === "DELETE") {
          S.todos = S.todos.filter((t) => t.id !== payload.old.id);
        }
        renderTasks();
      },
    );

    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "files",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!S.files.find((f) => f.id === payload.new.id))
            S.files.unshift(payload.new);
        } else if (payload.eventType === "DELETE") {
          S.files = S.files.filter((f) => f.id !== payload.old.id);
        }
        renderFiles();
      },
    );

    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sections",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!S.sections.find((s) => s.id === payload.new.id))
            S.sections.push(payload.new);
        } else if (payload.eventType === "UPDATE") {
          const i = S.sections.findIndex((s) => s.id === payload.new.id);
          if (i >= 0) S.sections[i] = payload.new;
        } else if (payload.eventType === "DELETE") {
          S.sections = S.sections.filter((s) => s.id !== payload.old.id);
          if (S.activeSectionId === payload.old.id) {
            if (S.sections[0]) {
              S.activeSectionId = S.sections[0].id;
              loadEditorContent(S.activeSectionId);
            } else {
              S.activeSectionId = null;
              const ed = $("#editor");
              if (ed) ed.innerHTML = "";
            }
          }
        }
        S.sections.sort((a, b) => a.sort_order - b.sort_order);
        renderSections();
      },
    );

    ch.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "texts",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        const row = payload.new;
        if (row.updated_by && row.updated_by === S.user.user_id) {
          S.texts[row.section_id] = row;
          return;
        }
        S.texts[row.section_id] = row;
        if (row.section_id === S.activeSectionId) {
          const ed = $("#editor");
          if (!ed) return;
          const remote = sanitizeHtml(row.content || "");
          if (document.activeElement !== ed) {
            S.applyingRemoteEditor = true;
            ed.innerHTML = remote;
            updateEditorEmptyClass();
            S.applyingRemoteEditor = false;
            setSaveStatus("conflict");
            setTimeout(() => setSaveStatus("saved"), 1200);
          } else if (ed.innerHTML !== remote) {
            // Soft notice while typing — don't clobber caret
            setSaveStatus("conflict");
          }
        }
      },
    );

    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "whiteboards",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        const row = payload.new;
        if (!row || row.updated_by === S.user.user_id) return;
        if ((row.data || "") === S.boardData) return;
        S.boardData = row.data || "";
        if (S.activePanel === "whiteboard") restoreBoard(S.boardData);
      },
    );

    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (!payload || payload.user_id === S.user.user_id) return;
      S.remoteTyping = payload;
      updateTypingUI();
      clearTimeout(S.typingClear);
      S.typingClear = setTimeout(() => {
        S.remoteTyping = null;
        updateTypingUI();
      }, 2000);
    });

    ch.on("broadcast", { event: "whiteboard" }, ({ payload }) => {
      if (!payload || payload.user_id === S.user.user_id) return;
      if (payload.type === "clear") {
        clearCanvasLocal();
        S.boardData = "";
        return;
      }
      applyRemoteStroke(payload);
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      S.presence = state || {};
      renderPresence();
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        setConn("online");
        try {
          await ch.track({
            user_id: S.user.user_id,
            name: S.user.name,
            online_at: new Date().toISOString(),
          });
        } catch {
          /* presence optional */
        }
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setConn("offline");
        // light reconnect
        setTimeout(() => {
          if (S.session && !S.leaving && S.channel === ch) setupRealtime();
        }, 2500);
      } else {
        setConn("connecting");
      }
    });

    S.channel = ch;
  }

  function broadcast(event, payload) {
    if (S.demo || !S.channel || typeof S.channel.send !== "function" || !S.user)
      return;
    S.channel.send({
      type: "broadcast",
      event,
      payload: { ...payload, user_id: S.user.user_id, user_name: S.user.name },
    });
  }

  function throttleTyping(where) {
    const now = Date.now();
    if (now - S.typingThrottle < 600) return;
    S.typingThrottle = now;
    broadcast("typing", { where });
  }

  function updateTypingUI() {
    const ed = $("#typing-indicator");
    const chat = $("#chat-typing");
    if (!ed || !chat) return;
    if (S.remoteTyping?.where === "editor") {
      ed.hidden = false;
      ed.textContent = `${S.remoteTyping.user_name} is typing…`;
    } else {
      ed.hidden = true;
    }
    if (S.remoteTyping?.where === "chat") {
      chat.hidden = false;
      chat.textContent = `${S.remoteTyping.user_name} is typing…`;
    } else {
      chat.hidden = true;
    }
  }

  function renderPresence() {
    const el = $("#online-users");
    if (!el) return;
    el.innerHTML = "";
    const people = [];
    Object.values(S.presence || {}).forEach((arr) => {
      (arr || []).forEach((p) => {
        if (p?.user_id && !people.find((x) => x.user_id === p.user_id))
          people.push(p);
      });
    });
    // Always include self in demo
    if (S.demo && S.user) {
      people.length = 0;
      people.push({ user_id: S.user.user_id, name: S.user.name });
    }
    people.slice(0, 8).forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "ou-chip";
      chip.style.background = avatarColor(p.user_id || p.name);
      chip.textContent = initials(p.name || p.user_id || "?");
      chip.title = p.name || p.user_id;
      el.appendChild(chip);
    });
  }

  // -------------------- Timer (shared ends_at) --------------------
  function startSessionTimer() {
    stopSessionTimer();
    let ends = S.session?.ends_at ? new Date(S.session.ends_at).getTime() : NaN;
    if (!Number.isFinite(ends)) {
      ends = Date.now() + SESSION_MS;
      S.session.ends_at = new Date(ends).toISOString();
      if (S.demo) {
        const sess = Demo.sessions[S.session.id];
        if (sess) {
          sess.ends_at = S.session.ends_at;
          Demo.persist();
        }
      }
    }
    S.timerEndsAt = ends;
    const el = $("#session-timer");
    let endedToast = false;
    const tick = () => {
      if (!el) return;
      const left = Math.max(0, S.timerEndsAt - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (left <= 0 && !endedToast) {
        endedToast = true;
        toast(
          "Session timer ended — you can stay or leave anytime",
          "info",
          5000,
        );
      }
    };
    tick();
    S.timerInterval = setInterval(tick, 1000);
  }

  function stopSessionTimer() {
    if (S.timerInterval) clearInterval(S.timerInterval);
    S.timerInterval = null;
  }

  // -------------------- Sections + Editor --------------------
  function renderSections() {
    const list = $("#section-list");
    if (!list) return;
    list.innerHTML = "";
    S.sections.forEach((sec) => {
      const li = document.createElement("li");
      li.className = `section-item${sec.id === S.activeSectionId ? " active" : ""}`;
      li.dataset.id = sec.id;
      li.innerHTML = `
        <span class="sec-name"></span>
        <button class="sec-del" title="Delete section" type="button" aria-label="Delete section"><i class="fa-solid fa-xmark"></i></button>
      `;
      li.querySelector(".sec-name").textContent = sec.name;
      li.querySelector(".sec-name").title = "Double-click to rename";
      li.addEventListener("click", (e) => {
        if (e.target.closest(".sec-del")) return;
        selectSection(sec.id);
      });
      li.addEventListener("dblclick", (e) => {
        if (e.target.closest(".sec-del")) return;
        renameSection(sec.id);
      });
      li.querySelector(".sec-del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSection(sec.id);
      });
      list.appendChild(li);
    });
    const active = S.sections.find((s) => s.id === S.activeSectionId);
    const nameEl = $("#editor-section-name");
    if (nameEl) nameEl.textContent = active?.name || "Untitled";
  }

  async function selectSection(id) {
    if (!id || id === S.activeSectionId) return;
    if (S.activeSectionId) {
      await saveTextImmediate(S.activeSectionId, $("#editor")?.innerHTML || "");
    }
    S.activeSectionId = id;
    loadEditorContent(id);
    renderSections();
  }

  function loadEditorContent(sectionId) {
    const row = S.texts[sectionId];
    const ed = $("#editor");
    if (!ed) return;
    S.applyingRemoteEditor = true;
    ed.innerHTML = sanitizeHtml(row?.content || "");
    S.applyingRemoteEditor = false;
    updateEditorEmptyClass();
    setSaveStatus("saved");
  }

  function scheduleSave() {
    if (S.applyingRemoteEditor || S.leaving || !S.session) return;
    setSaveStatus("saving");
    updateEditorEmptyClass();
    clearTimeout(S.saveTimer);
    const gen = ++S.saveGeneration;
    S.saveTimer = setTimeout(() => {
      S.saveTimer = null;
      if (gen !== S.saveGeneration) return;
      if (!S.session || !S.activeSectionId || S.leaving) return;
      saveTextImmediate(S.activeSectionId, $("#editor")?.innerHTML || "");
    }, SAVE_DEBOUNCE);
    throttleTyping("editor");
  }

  async function saveTextImmediate(sectionId, content) {
    if (!S.session || !sectionId || S.leaving) return;
    const sessionId = S.session.id;
    const clean = sanitizeHtml(content);
    const now = new Date().toISOString();

    try {
      if (S.demo) {
        const data = Demo.getSessionData(sessionId);
        if (!data) return;
        if (!data.texts[sectionId]) {
          data.texts[sectionId] = {
            id: uuid(),
            section_id: sectionId,
            session_id: sessionId,
            content: "",
            updated_at: now,
          };
        }
        const prev = data.texts[sectionId].content;
        if (prev && prev !== clean) {
          if (!data.versions[sectionId]) data.versions[sectionId] = [];
          data.versions[sectionId].unshift({
            id: uuid(),
            section_id: sectionId,
            content: prev,
            created_at: now,
          });
          data.versions[sectionId] = data.versions[sectionId].slice(0, 20);
        }
        data.texts[sectionId].content = clean;
        data.texts[sectionId].updated_at = now;
        data.texts[sectionId].updated_by = S.user?.user_id;
        S.texts[sectionId] = data.texts[sectionId];
        Demo.persist();
        if (S.session?.id === sessionId) setSaveStatus("saved");
        return;
      }

      const existing = S.texts[sectionId];
      if (existing?.id) {
        if (existing.content && existing.content !== clean) {
          await S.sb
            .from("text_versions")
            .insert({ section_id: sectionId, content: existing.content });
        }
        const { data, error } = await S.sb
          .from("texts")
          .update({
            content: clean,
            updated_at: now,
            updated_by: S.user.user_id,
          })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        if (S.session?.id === sessionId) S.texts[sectionId] = data;
      } else {
        const { data, error } = await S.sb
          .from("texts")
          .upsert(
            {
              section_id: sectionId,
              session_id: sessionId,
              content: clean,
              updated_at: now,
              updated_by: S.user.user_id,
            },
            { onConflict: "section_id" },
          )
          .select()
          .single();
        if (error) throw error;
        if (S.session?.id === sessionId) S.texts[sectionId] = data;
      }
      if (S.session?.id === sessionId) setSaveStatus("saved");
    } catch (err) {
      console.error(err);
      if (S.session?.id === sessionId) setSaveStatus("error");
    }
  }

  async function addSection() {
    const name = prompt("Section name:", "Untitled");
    if (name === null) return;
    const clean = (name || "Untitled").trim().slice(0, 48) || "Untitled";
    const sort_order = S.sections.length
      ? Math.max(...S.sections.map((s) => s.sort_order || 0)) + 1
      : 0;

    try {
      if (S.demo) {
        const sec = {
          id: uuid(),
          session_id: S.session.id,
          name: clean,
          sort_order,
          created_at: new Date().toISOString(),
        };
        const data = Demo.getSessionData(S.session.id);
        data.sections.push(sec);
        data.texts[sec.id] = {
          id: uuid(),
          section_id: sec.id,
          session_id: S.session.id,
          content: "",
          updated_at: new Date().toISOString(),
        };
        Demo.persist();
        S.sections.push(sec);
        S.texts[sec.id] = data.texts[sec.id];
        await selectSection(sec.id);
        toast("Section added", "success");
        return;
      }

      const { data: sec, error } = await S.sb
        .from("sections")
        .insert({ session_id: S.session.id, name: clean, sort_order })
        .select()
        .single();
      if (error) throw error;
      await S.sb
        .from("texts")
        .insert({ section_id: sec.id, session_id: S.session.id, content: "" });
      if (!S.sections.find((s) => s.id === sec.id)) S.sections.push(sec);
      S.texts[sec.id] = { section_id: sec.id, content: "" };
      await selectSection(sec.id);
      toast("Section added", "success");
    } catch (err) {
      toast(err.message || "Could not add section", "error");
    }
  }

  async function renameSection(id) {
    const sec = S.sections.find((s) => s.id === id);
    if (!sec) return;
    const name = prompt("Rename section:", sec.name);
    if (name === null) return;
    const clean = name.trim().slice(0, 48) || sec.name;
    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        const row = data.sections.find((s) => s.id === id);
        if (row) row.name = clean;
        Demo.persist();
        sec.name = clean;
      } else {
        const { error } = await S.sb
          .from("sections")
          .update({ name: clean })
          .eq("id", id);
        if (error) throw error;
        sec.name = clean;
      }
      renderSections();
      toast("Section renamed", "success");
    } catch (err) {
      toast(err.message || "Rename failed", "error");
    }
  }

  async function deleteSection(id) {
    if (S.sections.length <= 1) {
      toast("Keep at least one section", "error");
      return;
    }
    if (!confirm("Delete this section and its content?")) return;
    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        data.sections = data.sections.filter((s) => s.id !== id);
        delete data.texts[id];
        delete data.versions[id];
        Demo.persist();
      } else {
        const { error } = await S.sb.from("sections").delete().eq("id", id);
        if (error) throw error;
      }
      S.sections = S.sections.filter((s) => s.id !== id);
      delete S.texts[id];
      if (S.activeSectionId === id) {
        S.activeSectionId = S.sections[0]?.id || null;
        if (S.activeSectionId) loadEditorContent(S.activeSectionId);
      }
      renderSections();
      toast("Section deleted", "success");
    } catch (err) {
      toast(err.message || "Delete failed", "error");
    }
  }

  async function openHistory() {
    const sectionId = S.activeSectionId;
    if (!sectionId) return;
    const list = $("#history-list");
    list.innerHTML = '<li class="history-item">Loading…</li>';
    $("#history-modal").hidden = false;

    let versions = [];
    try {
      if (S.demo) {
        versions = Demo.getSessionData(S.session.id)?.versions[sectionId] || [];
      } else {
        const { data, error } = await S.sb
          .from("text_versions")
          .select("*")
          .eq("section_id", sectionId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        versions = data || [];
      }
    } catch (err) {
      list.innerHTML = `<li class="history-item">${escapeHtml(err.message || "Failed to load")}</li>`;
      return;
    }

    if (!versions.length) {
      list.innerHTML =
        '<li class="history-item">No versions yet. Keep editing to create history.</li>';
      return;
    }

    list.innerHTML = "";
    versions.forEach((v) => {
      const li = document.createElement("li");
      li.className = "history-item";
      const when = new Date(v.created_at).toLocaleString();
      li.innerHTML = `<span></span><button class="btn btn-ghost btn-sm" type="button">Restore</button>`;
      li.querySelector("span").textContent = when;
      li.querySelector("button").addEventListener("click", async () => {
        if (S.activeSectionId !== sectionId) await selectSection(sectionId);
        const ed = $("#editor");
        S.applyingRemoteEditor = true;
        ed.innerHTML = sanitizeHtml(v.content || "");
        S.applyingRemoteEditor = false;
        updateEditorEmptyClass();
        await saveTextImmediate(sectionId, ed.innerHTML);
        $("#history-modal").hidden = true;
        toast("Version restored", "success");
      });
      list.appendChild(li);
    });
  }

  // -------------------- Chat --------------------
  function updateChatBadge() {
    const n =
      S.unreadChat > 0
        ? S.unreadChat > 99
          ? "99+"
          : String(S.unreadChat)
        : "";
    ["#chat-badge", "#chat-badge-mobile"].forEach((sel) => {
      const badge = $(sel);
      if (!badge) return;
      if (S.unreadChat > 0) {
        badge.hidden = false;
        badge.textContent = n;
      } else {
        badge.hidden = true;
      }
    });
  }

  function renderChat(stickBottom = false) {
    const box = $("#chat-messages");
    const empty = $("#chat-empty");
    if (!box || !empty) return;
    const wasNearBottom =
      stickBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 100;

    [...box.children].forEach((c) => {
      if (c.id !== "chat-empty") c.remove();
    });

    if (!S.messages.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    let lastDate = "";
    S.messages.forEach((msg) => {
      const label = formatDateLabel(msg.created_at);
      if (label && label !== lastDate) {
        lastDate = label;
        const sep = document.createElement("div");
        sep.className = "chat-date-sep";
        sep.textContent = label;
        box.appendChild(sep);
      }
      const mine = msg.user_id
        ? msg.user_id === S.user.user_id
        : msg.user_name === S.user.name;
      const row = document.createElement("div");
      row.className = `chat-msg${mine ? " mine" : ""}`;
      const seed = msg.user_id || msg.user_name || "";
      row.innerHTML = `
        <div class="msg-avatar" style="background:${avatarColor(seed)}">${escapeHtml(initials(msg.user_name))}</div>
        <div class="msg-body">
          <div class="msg-name"></div>
          <div class="msg-text"></div>
          <div class="msg-time"></div>
        </div>
      `;
      row.querySelector(".msg-name").textContent = msg.user_name;
      row.querySelector(".msg-text").textContent = msg.message;
      row.querySelector(".msg-time").textContent = formatTime(msg.created_at);
      box.appendChild(row);
    });

    if (wasNearBottom) box.scrollTop = box.scrollHeight;
  }

  async function sendChat(e) {
    e.preventDefault();
    if (!S.session) return;
    const input = $("#chat-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";

    const tempId = uuid();
    const row = {
      id: tempId,
      session_id: S.session.id,
      user_id: S.user.user_id,
      user_name: S.user.name,
      message,
      created_at: new Date().toISOString(),
    };

    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        data.messages.push(row);
        Demo.persist();
        S.knownMessageIds.add(row.id);
        S.messages.push(row);
        renderChat(true);
        return;
      }

      // Optimistic local (dedupe by known set when realtime echoes)
      S.knownMessageIds.add(tempId);
      // Don't push temp if we wait for server id — wait for insert result
      const { data, error } = await S.sb
        .from("chat_messages")
        .insert({
          session_id: S.session.id,
          user_id: S.user.user_id,
          user_name: S.user.name,
          message,
        })
        .select()
        .single();
      if (error) throw error;
      S.knownMessageIds.delete(tempId);
      if (!S.knownMessageIds.has(data.id)) {
        S.knownMessageIds.add(data.id);
        S.messages.push(data);
        renderChat(true);
      }
    } catch (err) {
      toast(err.message || "Failed to send", "error");
      input.value = message;
    }
  }

  // -------------------- Tasks --------------------
  function renderTasks() {
    const list = $("#task-list");
    const empty = $("#task-empty");
    if (!list || !empty) return;
    list.innerHTML = "";
    const total = S.todos.length;
    const done = S.todos.filter((t) => t.completed).length;
    const pending = total - done;
    $("#task-total").textContent = total;
    $("#task-done").textContent = done;
    $("#task-pending").textContent = pending;
    $("#task-progress").style.width = total
      ? `${Math.round((done / total) * 100)}%`
      : "0%";

    if (!total) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    // pending first, then done
    const ordered = [
      ...S.todos.filter((t) => !t.completed),
      ...S.todos.filter((t) => t.completed),
    ];

    ordered.forEach((t) => {
      const li = document.createElement("li");
      li.className = `task-item${t.completed ? " done" : ""}`;
      li.innerHTML = `
        <button class="task-check" type="button" aria-label="Toggle"><i class="fa-solid fa-check"></i></button>
        <span class="task-text"></span>
        <button class="task-del" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
      `;
      li.querySelector(".task-text").textContent = t.text;
      li.querySelector(".task-check").addEventListener("click", () =>
        toggleTodo(t.id, !t.completed),
      );
      li.querySelector(".task-del").addEventListener("click", () =>
        deleteTodo(t.id),
      );
      list.appendChild(li);
    });
  }

  async function addTodo(e) {
    e.preventDefault();
    if (!S.session) return;
    const input = $("#task-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    try {
      if (S.demo) {
        const row = {
          id: uuid(),
          session_id: S.session.id,
          text,
          completed: false,
          created_at: new Date().toISOString(),
        };
        Demo.getSessionData(S.session.id).todos.push(row);
        Demo.persist();
        S.todos.push(row);
        renderTasks();
        return;
      }
      const { data, error } = await S.sb
        .from("todos")
        .insert({ session_id: S.session.id, text, completed: false })
        .select()
        .single();
      if (error) throw error;
      if (!S.todos.find((t) => t.id === data.id)) {
        S.todos.push(data);
        renderTasks();
      }
    } catch (err) {
      toast(err.message || "Could not add task", "error");
    }
  }

  async function toggleTodo(id, completed) {
    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        const t = data.todos.find((x) => x.id === id);
        if (t) t.completed = completed;
        Demo.persist();
        const local = S.todos.find((x) => x.id === id);
        if (local) local.completed = completed;
        renderTasks();
        return;
      }
      const { data, error } = await S.sb
        .from("todos")
        .update({ completed })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      const i = S.todos.findIndex((t) => t.id === id);
      if (i >= 0) S.todos[i] = data;
      renderTasks();
    } catch (err) {
      toast(err.message || "Update failed", "error");
    }
  }

  async function deleteTodo(id) {
    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        data.todos = data.todos.filter((t) => t.id !== id);
        Demo.persist();
        S.todos = S.todos.filter((t) => t.id !== id);
        renderTasks();
        return;
      }
      const { error } = await S.sb.from("todos").delete().eq("id", id);
      if (error) throw error;
      S.todos = S.todos.filter((t) => t.id !== id);
      renderTasks();
    } catch (err) {
      toast(err.message || "Delete failed", "error");
    }
  }

  // -------------------- Whiteboard --------------------
  function getCanvas() {
    return $("#whiteboard");
  }

  function resizeWhiteboard(forceRestore = false) {
    const canvas = getCanvas();
    if (!canvas) return;
    const stage = canvas.parentElement;
    if (!stage || stage.clientWidth < 2 || stage.clientHeight < 2) return;

    const oldDpr = S.wb.dpr || 1;
    const prev = document.createElement("canvas");
    prev.width = canvas.width;
    prev.height = canvas.height;
    if (canvas.width && canvas.height) {
      prev.getContext("2d").drawImage(canvas, 0, 0);
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (prev.width && prev.height) {
      // Draw previous bitmap in CSS pixel space using OLD dpr
      ctx.drawImage(prev, 0, 0, prev.width / oldDpr, prev.height / oldDpr);
    } else if (forceRestore && S.boardData) {
      restoreBoard(S.boardData);
    }

    S.wb.dpr = dpr;
  }

  function restoreBoard(dataUrl) {
    const canvas = getCanvas();
    if (!canvas || !dataUrl) {
      if (!dataUrl) clearCanvasLocal();
      return;
    }
    const img = new Image();
    img.onload = () => {
      resizeWhiteboard(false);
      const ctx = canvas.getContext("2d");
      const dpr = S.wb.dpr || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
    };
    img.onerror = () => {};
    img.src = dataUrl;
  }

  function clearCanvasLocal() {
    const canvas = getCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(S.wb.dpr || 1, 0, 0, S.wb.dpr || 1, 0, 0);
  }

  function canvasPos(e) {
    const canvas = getCanvas();
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: src.clientX - rect.left,
      y: src.clientY - rect.top,
    };
  }

  function drawLine(from, to, color, size, erase) {
    const canvas = getCanvas();
    if (!canvas || !from || !to) return;
    const ctx = canvas.getContext("2d");
    const dpr = S.wb.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    if (erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function applyRemoteStroke(payload) {
    if (!payload?.from || !payload?.to) return;
    drawLine(
      payload.from,
      payload.to,
      payload.color,
      payload.size,
      payload.erase,
    );
  }

  async function persistBoard(immediate = false) {
    if (!S.session) return;
    const run = async () => {
      const canvas = getCanvas();
      if (!canvas || !canvas.width) return;
      const sessionId = S.session.id;
      try {
        const url = canvas.toDataURL("image/png");
        S.boardData = url;
        if (S.demo) {
          const data = Demo.getSessionData(sessionId);
          if (data) {
            data.board = url;
            Demo.persist();
          }
          return;
        }
        await S.sb.from("whiteboards").upsert({
          session_id: sessionId,
          data: url,
          updated_at: new Date().toISOString(),
          updated_by: S.user.user_id,
        });
      } catch (err) {
        console.warn("board persist", err);
      }
    };

    if (immediate) {
      if (S.boardSaveTimer) clearTimeout(S.boardSaveTimer);
      S.boardSaveTimer = null;
      await run();
      return;
    }
    clearTimeout(S.boardSaveTimer);
    S.boardSaveTimer = setTimeout(run, 500);
  }

  function setupWhiteboardEvents() {
    const canvas = getCanvas();
    if (!canvas || S.wb.bound) return;
    S.wb.bound = true;

    const start = (e) => {
      if (e.type === "mousedown" && e.button !== 0) return;
      e.preventDefault();
      S.wb.drawing = true;
      S.wb.last = canvasPos(e);
    };
    const move = (e) => {
      if (!S.wb.drawing || !S.wb.last) return;
      e.preventDefault();
      const pos = canvasPos(e);
      const color = $("#wb-color").value;
      const size = Number($("#wb-size").value) || 4;
      const erase = S.wb.tool === "eraser";
      drawLine(S.wb.last, pos, color, size, erase);
      broadcast("whiteboard", {
        type: "stroke",
        from: S.wb.last,
        to: pos,
        color,
        size,
        erase,
      });
      S.wb.last = pos;
    };
    const end = () => {
      if (S.wb.drawing) persistBoard(false);
      S.wb.drawing = false;
      S.wb.last = null;
    };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
  }

  async function clearWhiteboard() {
    if (!confirm("Clear the whiteboard for everyone?")) return;
    clearCanvasLocal();
    S.boardData = "";
    broadcast("whiteboard", { type: "clear" });
    if (S.demo) {
      const data = Demo.getSessionData(S.session.id);
      if (data) {
        data.board = "";
        Demo.persist();
      }
    } else if (S.sb && S.session) {
      await S.sb.from("whiteboards").upsert({
        session_id: S.session.id,
        data: "",
        updated_at: new Date().toISOString(),
        updated_by: S.user.user_id,
      });
    }
    toast("Whiteboard cleared", "info");
  }

  // -------------------- Files --------------------
  function getFileIcon(type = "", name = "") {
    const t = type || "";
    if (t.startsWith("image/"))
      return { icon: "fa-file-image", color: "#00cec9" };
    if (t === "application/pdf" || /\.pdf$/i.test(name))
      return { icon: "fa-file-pdf", color: "#ff6b6b" };
    if (t.includes("word") || /\.docx?$/i.test(name))
      return { icon: "fa-file-word", color: "#74b9ff" };
    if (t.includes("excel") || t.includes("sheet") || /\.xlsx?$/i.test(name))
      return { icon: "fa-file-excel", color: "#55efc4" };
    if (t.startsWith("text/") || /\.txt$/i.test(name))
      return { icon: "fa-file-lines", color: "#a29bfe" };
    return { icon: "fa-file", color: "#dfe6e9" };
  }

  function renderFiles() {
    const grid = $("#files-grid");
    const empty = $("#files-empty");
    if (!grid || !empty) return;
    grid.innerHTML = "";
    if (!S.files.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    S.files.forEach((file) => {
      const card = document.createElement("article");
      card.className = "file-card";
      const ftype = file.file_type || "application/octet-stream";
      const meta = getFileIcon(ftype, file.file_name || "");
      const isImg = ftype.startsWith("image/");
      card.innerHTML = `
        <div class="file-preview"></div>
        <div class="file-meta">
          <div class="file-name"></div>
          <div class="file-size"></div>
        </div>
        <div class="file-actions">
          <button class="btn btn-ghost" type="button" data-act="download"><i class="fa-solid fa-download"></i> Download</button>
          <button class="btn btn-ghost" type="button" data-act="delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;
      card.querySelector(".file-name").textContent = file.file_name || "file";
      card.querySelector(".file-name").title = file.file_name || "";
      card.querySelector(".file-size").textContent = formatBytes(
        file.file_size,
      );
      const preview = card.querySelector(".file-preview");
      if (isImg && file.file_data) {
        const img = document.createElement("img");
        img.src = file.file_data;
        img.alt = file.file_name || "";
        img.loading = "lazy";
        preview.appendChild(img);
      } else {
        preview.innerHTML = `<i class="fa-solid ${meta.icon} file-icon" style="color:${meta.color}"></i>`;
      }
      card
        .querySelector('[data-act="download"]')
        .addEventListener("click", () => downloadFile(file.id));
      card
        .querySelector('[data-act="delete"]')
        .addEventListener("click", () => deleteFile(file.id));
      grid.appendChild(card);
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  async function compressImageIfNeeded(file, dataUrl) {
    if (
      !file.type.startsWith("image/") ||
      file.type === "image/gif" ||
      file.size < 600 * 1024
    ) {
      return { dataUrl, type: file.type, name: file.name };
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        let { width, height } = img;
        if (width > max || height > max) {
          const ratio = Math.min(max / width, max / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        const out = c.toDataURL("image/jpeg", 0.82);
        const newName = file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg";
        resolve({ dataUrl: out, type: "image/jpeg", name: newName });
      };
      img.onerror = () =>
        resolve({ dataUrl, type: file.type, name: file.name });
      img.src = dataUrl;
    });
  }

  async function handleFiles(fileList) {
    if (!S.session) return;
    const files = [...fileList];
    if (!files.length) return;
    setLoading(true, "Uploading…");
    let uploaded = 0;
    let skipped = 0;
    try {
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          toast(`${file.name} exceeds 2MB`, "error");
          skipped++;
          continue;
        }
        const okType =
          ALLOWED_MIME.has(file.type) ||
          /\.(jpe?g|png|gif|webp|pdf|txt|docx?|xlsx?)$/i.test(file.name);
        if (!okType) {
          toast(`${file.name}: unsupported type`, "error");
          skipped++;
          continue;
        }

        let dataUrl = await readFileAsDataURL(file);
        const compressed = await compressImageIfNeeded(file, dataUrl);
        dataUrl = compressed.dataUrl;
        const fileType =
          compressed.type || file.type || "application/octet-stream";
        const fileName = compressed.name || file.name;
        const approxSize = Math.ceil((dataUrl.length * 3) / 4);
        if (approxSize > MAX_FILE_BYTES * 1.4) {
          toast(`${fileName} still too large after compression`, "error");
          skipped++;
          continue;
        }

        const row = {
          id: uuid(),
          session_id: S.session.id,
          section_id: S.activeSectionId,
          file_name: fileName,
          file_data: dataUrl,
          file_type: fileType,
          file_size: Math.min(file.size, approxSize),
          created_at: new Date().toISOString(),
        };

        if (S.demo) {
          Demo.getSessionData(S.session.id).files.unshift(row);
          Demo.persist();
          S.files.unshift(row);
          uploaded++;
        } else {
          const { data, error } = await S.sb
            .from("files")
            .insert({
              session_id: row.session_id,
              section_id: row.section_id,
              file_name: row.file_name,
              file_data: row.file_data,
              file_type: row.file_type,
              file_size: row.file_size,
            })
            .select()
            .single();
          if (error) throw error;
          if (!S.files.find((f) => f.id === data.id)) {
            S.files.unshift(data);
            uploaded++;
          }
        }
      }
      renderFiles();
      if (uploaded)
        toast(
          `Uploaded ${uploaded} file${uploaded > 1 ? "s" : ""}${skipped ? ` (${skipped} skipped)` : ""}`,
          "success",
        );
      else if (skipped) toast("No files uploaded", "error");
    } catch (err) {
      toast(err.message || "Upload failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function downloadFile(fileId) {
    const file = S.files.find((f) => f.id === fileId);
    if (!file?.file_data) {
      toast("File not found", "error");
      return;
    }
    try {
      toast(`Downloading ${file.file_name}…`, "info", 1800);
      let dataUrl = file.file_data;
      if (!dataUrl.includes(",")) {
        dataUrl = `data:${file.file_type || "application/octet-stream"};base64,${dataUrl}`;
      }
      const base64 = dataUrl.split(",")[1];
      if (!base64) throw new Error("Invalid file data");
      const byteCharacters = atob(base64);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++)
        byteArray[i] = byteCharacters.charCodeAt(i);
      const blob = new Blob([byteArray], {
        type: file.file_type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Download started", "success");
    } catch (err) {
      console.error(err);
      toast("Download failed", "error");
    }
  }

  async function deleteFile(id) {
    if (!confirm("Delete this file?")) return;
    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        data.files = data.files.filter((f) => f.id !== id);
        Demo.persist();
        S.files = S.files.filter((f) => f.id !== id);
      } else {
        const { error } = await S.sb.from("files").delete().eq("id", id);
        if (error) throw error;
        S.files = S.files.filter((f) => f.id !== id);
      }
      renderFiles();
      toast("File deleted", "success");
    } catch (err) {
      toast(err.message || "Delete failed", "error");
    }
  }

  // -------------------- Panels --------------------
  function switchPanel(name) {
    if (!name) return;
    S.activePanel = name;
    $$(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $(`#panel-${name}`);
    if (panel) panel.classList.add("active");

    $$(".sidebar-nav .nav-item, #bottom-nav .nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.panel === name);
    });

    const titles = {
      editor: "Editor",
      chat: "Team Chat",
      tasks: "Tasks",
      whiteboard: "Whiteboard",
      files: "Files",
    };
    $("#panel-title").textContent = titles[name] || name;

    if (name === "chat") {
      S.unreadChat = 0;
      updateChatBadge();
      renderChat(true);
    }
    if (name === "whiteboard") {
      requestAnimationFrame(() => {
        resizeWhiteboard(true);
        setupWhiteboardEvents();
        if (S.boardData) restoreBoard(S.boardData);
      });
    }
    closeSidebar();
  }

  // -------------------- Events --------------------
  function bindEvents() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "goto-auth") {
        showView("auth");
        showLogin();
      } else if (action === "goto-landing") {
        showView("landing");
      } else if (action === "show-signup") {
        showSignup(normalizeUserId($("#login-userid").value));
      } else if (action === "show-login") {
        showLogin();
      } else if (action === "logout") {
        logout();
      } else if (action === "leave-session") {
        leaveSession({ silent: false });
      }
    });

    $("#nav-toggle")?.addEventListener("click", () => {
      const links = $("#nav-links");
      const open = links?.classList.toggle("open");
      $("#nav-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".nav")) closeMobileNav();
    });

    $("#form-login")?.addEventListener("submit", handleLogin);
    $("#form-signup")?.addEventListener("submit", handleSignup);
    $("#signup-password")?.addEventListener("input", (e) =>
      updatePasswordStrength(e.target.value),
    );

    $("#form-create-session")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("#create-name").value.trim();
      const password = $("#create-password").value;
      try {
        setLoading(true, "Creating session…");
        const session = await createSession(name, password);
        await enterSession(session);
        e.target.reset();
      } catch (err) {
        toast(err.message || "Create failed", "error");
      } finally {
        setLoading(false);
      }
    });

    $("#form-join-session")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#join-id").value.trim().toUpperCase();
      const password = $("#join-password").value;
      try {
        setLoading(true, "Joining…");
        const session = await joinSession(id, password);
        await enterSession(session);
        e.target.reset();
      } catch (err) {
        toast(err.message || "Join failed", "error");
      } finally {
        setLoading(false);
      }
    });

    $("#join-id")?.addEventListener("input", (e) => {
      e.target.value = e.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
    });

    $("#copy-session-id")?.addEventListener("click", async () => {
      if (!S.session) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(S.session.id);
        } else {
          const ta = document.createElement("textarea");
          ta.value = S.session.id;
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          if (!ok) throw new Error("copy failed");
        }
        toast("Session ID copied", "success");
      } catch {
        toast("Could not copy — select ID manually", "error");
      }
    });

    $("#delete-session-btn")?.addEventListener("click", deleteSession);
    $("#add-section-btn")?.addEventListener("click", addSection);
    $("#sidebar-toggle")?.addEventListener("click", () => {
      const open = $("#sidebar")?.classList.contains("open");
      if (open) closeSidebar();
      else openSidebar();
    });
    $("#sidebar-backdrop")?.addEventListener("click", closeSidebar);

    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-panel]");
      if (!nav || !nav.dataset.panel) return;
      // ignore if inside a form button without panel intent already handled
      switchPanel(nav.dataset.panel);
    });

    $$(".editor-toolbar .tool-btn[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val;
        try {
          if (cmd === "formatBlock") {
            // Prefer bracket form for broader browser support
            const tag = val.startsWith("<") ? val : `<${val}>`;
            document.execCommand("formatBlock", false, tag);
          } else {
            document.execCommand(cmd, false, null);
          }
        } catch {
          /* ignore */
        }
        $("#editor")?.focus();
        scheduleSave();
      });
    });

    $("#editor")?.addEventListener("input", scheduleSave);
    $("#editor")?.addEventListener("blur", () => {
      if (S.session && S.activeSectionId && !S.leaving) {
        clearTimeout(S.saveTimer);
        saveTextImmediate(S.activeSectionId, $("#editor").innerHTML);
      }
    });
    $("#history-btn")?.addEventListener("click", openHistory);
    $$("[data-close]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.close;
        const m = $(`#${id}`);
        if (m) m.hidden = true;
      });
    });
    $("#history-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "history-modal") e.target.hidden = true;
    });

    $("#form-chat")?.addEventListener("submit", sendChat);
    $("#chat-input")?.addEventListener("input", () => throttleTyping("chat"));
    $("#form-task")?.addEventListener("submit", addTodo);

    $$("[data-wb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("[data-wb]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        S.wb.tool = btn.dataset.wb;
      });
    });
    $("#wb-clear")?.addEventListener("click", clearWhiteboard);

    const dz = $("#dropzone");
    const fi = $("#file-input");
    dz?.addEventListener("click", () => fi?.click());
    fi?.addEventListener("change", () => {
      handleFiles(fi.files);
      fi.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) => {
      dz?.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      dz?.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove("dragover");
      });
    });
    dz?.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

    window.addEventListener("resize", () => {
      if (S.activePanel === "whiteboard") resizeWhiteboard(false);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        document.documentElement.style.setProperty(
          "--vvh",
          `${window.visualViewport.height}px`,
        );
        if (S.activePanel === "chat") {
          const box = $("#chat-messages");
          if (box) box.scrollTop = box.scrollHeight;
        }
      });
    }

    window.addEventListener("beforeunload", () => {
      if (!S.session || !S.activeSectionId) return;
      const html = $("#editor")?.innerHTML || "";
      if (S.demo) {
        try {
          const data = Demo.getSessionData(S.session.id);
          if (data?.texts[S.activeSectionId]) {
            data.texts[S.activeSectionId].content = sanitizeHtml(html);
            Demo.persist();
          }
          if (data && S.boardData) data.board = S.boardData;
          Demo.persist();
        } catch {
          /* ignore */
        }
      }
      // Supabase: best-effort keepalive is limited; blur-save covers most cases
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSidebar();
        closeMobileNav();
        const modal = $("#history-modal");
        if (modal && !modal.hidden) modal.hidden = true;
      }
    });

    window.addEventListener("unhandledrejection", (e) => {
      console.warn("Unhandled rejection", e.reason);
    });
  }

  // -------------------- Boot --------------------
  async function boot() {
    bindEvents();
    setLoading(true, "Starting SyncSpace…");
    try {
      await initSupabase();
      const saved = restoreUserSession();
      if (saved?.user_id) {
        try {
          const user = await findUser(saved.user_id);
          if (user && user.user_id === normalizeUserId(saved.user_id)) {
            // Soft restore: still require that account exists; password not re-prompted (session convenience)
            S.user = {
              user_id: user.user_id,
              name: user.name,
              role: user.role || "member",
            };
            persistUserSession();
            enterHub();
          } else {
            localStorage.removeItem(LS.auth);
            showView("landing");
          }
        } catch {
          // Offline demo: allow cached identity
          if (S.demo && saved.user_id && saved.name) {
            S.user = {
              user_id: normalizeUserId(saved.user_id),
              name: saved.name,
              role: saved.role || "member",
            };
            enterHub();
          } else {
            showView("landing");
          }
        }
      } else {
        showView("landing");
      }
      animateStats();
    } catch (err) {
      console.error(err);
      showView("landing");
      toast("Started in limited mode", "info");
    } finally {
      setLoading(false);
    }

    if ("serviceWorker" in navigator) {
      const swPath = new URL("sw.js", window.location.href).pathname;
      navigator.serviceWorker.register(swPath).catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
