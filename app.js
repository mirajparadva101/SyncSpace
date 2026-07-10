/* ============================================================
   SyncSpace app.js — Realtime-first rewrite
   • Chat: id-based upsert (no duplicates)
   • Editor: DB save + broadcast live content to joiners
   • Board: stroke broadcast + DB snapshot + clear sync
   • Session delete: creator-only; joiners auto-leave
   • Fallback poll if postgres_changes quiet
   ============================================================ */
(() => {
  "use strict";

  const SESSION_MS = 30 * 60 * 1000;
  const SAVE_MS = 500;
  const BOARD_SAVE_MS = 600;
  const MAX_FILE = 2 * 1024 * 1024;
  const LS = {
    users: "ss_users_v3",
    sessions: "ss_sessions_v3",
    auth: "ss_auth_v3",
    recent: "ss_recent_v3",
  };

  const S = {
    sb: null,
    demo: true,
    user: null,
    session: null,
    sections: [],
    activeSectionId: null,
    texts: {},
    files: [],
    todos: [],
    messages: [],
    msgById: new Map(),
    boardData: "",
    channel: null,
    channelName: null,
    demoPoll: null,
    fallbackPoll: null,
    saveTimer: null,
    boardTimer: null,
    timerInterval: null,
    timerEndsAt: null,
    unreadChat: 0,
    activePanel: "editor",
    wb: { tool: "pen", drawing: false, last: null, dpr: 1, bound: false },
    connected: false,
    remoteTyping: null,
    typingClear: null,
    typingAt: 0,
    applyingEditor: false,
    editorDirty: false,
    lastLocalEditAt: 0,
    clientId: uid(10),
    leaving: false,
    presence: {},
    statsAnimated: false,
    lastTextHash: {},
    lastBoardHash: "",
  };

  /* ---------- utils ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function uid(n = 6) {
    const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const a = crypto.getRandomValues(new Uint8Array(n));
    return [...a].map((x) => c[x % c.length]).join("");
  }
  function uuid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : uid(8) + "-" + uid(4) + "-" + uid(8);
  }
  function safeParse(raw, fb) {
    try {
      return raw ? JSON.parse(raw) : fb;
    } catch {
      return fb;
    }
  }
  async function sha256(text) {
    if (!crypto?.subtle) throw new Error("Use HTTPS for hashing");
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function sanitizeHtml(html) {
    const t = document.createElement("template");
    t.innerHTML = String(html || "");
    const ban = new Set([
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
    (function walk(n) {
      [...n.childNodes].forEach((ch) => {
        if (ch.nodeType === 1) {
          if (ban.has(ch.tagName)) {
            ch.remove();
            return;
          }
          [...ch.attributes].forEach((at) => {
            const name = at.name.toLowerCase();
            if (
              name.startsWith("on") ||
              /^\s*javascript:/i.test(at.value || "")
            )
              ch.removeAttribute(at.name);
          });
          walk(ch);
        } else if (ch.nodeType === 8) ch.remove();
      });
    })(t.content);
    return t.innerHTML;
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
    for (let i = 0; i < seed.length; i++)
      h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return `linear-gradient(135deg,hsl(${h % 360} 70% 55%),hsl(${(h + 40) % 360} 70% 45%))`;
  }
  function normalizeUserId(id) {
    return String(id || "")
      .trim()
      .toLowerCase();
  }
  function formatBytes(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x < 0) return "—";
    if (x < 1024) return `${x} B`;
    if (x < 1048576) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / 1048576).toFixed(2)} MB`;
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
      const d = new Date(iso),
        t = new Date(),
        y = new Date();
      y.setDate(t.getDate() - 1);
      if (d.toDateString() === t.toDateString()) return "Today";
      if (d.toDateString() === y.toDateString()) return "Yesterday";
      return d.toLocaleDateString();
    } catch {
      return "";
    }
  }
  function cleanCfg(v) {
    if (v == null) return "";
    let s = String(v).trim();
    if ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))
      s = s.slice(1, -1).trim();
    return s;
  }
  function normUrl(u) {
    let s = cleanCfg(u);
    if (!s) return "";
    if (!s.includes("://")) s = "https://" + s.replace(/^\/+/, "");
    if (s.startsWith("http://")) s = "https://" + s.slice(7);
    return s.replace(/\/$/, "");
  }
  function hashStr(s) {
    let h = 2166136261;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
  function isEditorEmpty(el) {
    if (!el) return true;
    if ((el.innerText || "").replace(/\u00a0/g, " ").trim()) return false;
    const h = (el.innerHTML || "").replace(/\s+/g, "").toLowerCase();
    return (
      !h ||
      h === "<br>" ||
      h === "<div><br></div>" ||
      h === "<p><br></p>" ||
      h === "<p></p>"
    );
  }
  function updateEditorEmpty() {
    const ed = $("#editor");
    if (ed) ed.classList.toggle("is-empty", isEditorEmpty(ed));
  }

  /* ---------- UI chrome ---------- */
  function showView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${name}`)?.classList.add("active");
    closeSidebar();
    closeMobileNav();
    if (name === "landing") animateStats();
    if (name === "hub") renderRecent();
    if (name === "dashboard" && S.activePanel === "whiteboard") {
      requestAnimationFrame(() => resizeWhiteboard(true));
    }
  }
  function setLoading(on, text = "Loading…") {
    const el = $("#loading");
    if (!el) return;
    el.hidden = !on;
    const t = $("#loading-text");
    if (t) t.textContent = text;
  }
  function toast(msg, type = "info", ms = 3200) {
    const wrap = $("#toasts");
    if (!wrap) return;
    while (wrap.children.length >= 5) wrap.firstChild.remove();
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    const icon =
      type === "success"
        ? "fa-circle-check"
        : type === "error"
          ? "fa-circle-exclamation"
          : "fa-circle-info";
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
    el.querySelector("span").textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 300);
    }, ms);
  }
  function setConn(st) {
    const d = $("#conn-dot");
    if (!d) return;
    d.classList.remove("online", "offline");
    if (st === "online") {
      d.classList.add("online");
      S.connected = true;
      d.title = "Connected";
    } else if (st === "offline") {
      d.classList.add("offline");
      S.connected = false;
      d.title = "Offline";
    } else {
      S.connected = false;
      d.title = "Connecting…";
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
    } else if (state === "live") {
      el.textContent = "Live update";
      el.classList.add("saving");
    } else el.textContent = state;
  }
  function closeMobileNav() {
    $("#nav-links")?.classList.remove("open");
    $("#nav-toggle")?.setAttribute("aria-expanded", "false");
  }
  function closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    const b = $("#sidebar-backdrop");
    if (b) b.hidden = true;
  }
  function openSidebar() {
    $("#sidebar")?.classList.add("open");
    const b = $("#sidebar-backdrop");
    if (b) b.hidden = false;
  }

  /* ---------- Demo store ---------- */
  function emptyData() {
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
  const Demo = {
    users: safeParse(localStorage.getItem(LS.users), {}),
    sessions: safeParse(localStorage.getItem(LS.sessions), {}),
    persist() {
      try {
        localStorage.setItem(LS.users, JSON.stringify(this.users));
        localStorage.setItem(LS.sessions, JSON.stringify(this.sessions));
        localStorage.setItem(LS.sessions + "_tick", String(Date.now()));
      } catch (e) {
        if (e?.name === "QuotaExceededError")
          toast("Storage full — delete files/sessions", "error", 5000);
        throw e;
      }
    },
    reload() {
      this.users = safeParse(localStorage.getItem(LS.users), this.users);
      this.sessions = safeParse(
        localStorage.getItem(LS.sessions),
        this.sessions,
      );
    },
    data(id) {
      if (!id || !this.sessions[id]) return null;
      if (!this.sessions[id].data) this.sessions[id].data = emptyData();
      return this.sessions[id].data;
    },
  };

  /* ---------- Supabase init ---------- */
  async function initSupabase() {
    let url = "",
      key = "";
    if (window.SYNCSPACE_CONFIG?.url && window.SYNCSPACE_CONFIG?.key) {
      url = normUrl(window.SYNCSPACE_CONFIG.url);
      key = cleanCfg(window.SYNCSPACE_CONFIG.key);
    } else {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (res.ok) {
          const cfg = await res.json();
          url = normUrl(cfg.url || "");
          key = cleanCfg(cfg.key || "");
        }
      } catch {
        /* demo */
      }
    }
    if (url && key && window.supabase) {
      if (!(key.startsWith("eyJ") || key.startsWith("sb_"))) {
        toast("Invalid Supabase key format", "error", 6000);
        S.demo = true;
        S.sb = null;
        setConn("online");
        return false;
      }
      S.sb = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 30 } },
      });
      // Probe
      const { error } = await S.sb
        .from("users")
        .select("user_id", { head: true, count: "exact" })
        .limit(1);
      if (
        error &&
        (error.status === 401 ||
          /jwt|api key|unauthorized/i.test(error.message || ""))
      ) {
        toast("Supabase 401: fix SUPABASE_ANON_KEY & redeploy", "error", 7000);
        S.sb = null;
        S.demo = true;
        setConn("online");
        return false;
      }
      if (error && /permission denied/i.test(error.message || "")) {
        toast(
          "permission denied — run supabase-fix.sql in SQL Editor",
          "error",
          8000,
        );
      }
      S.demo = false;
      setConn("online");
      console.info("[SyncSpace] Supabase ready", url);
      return true;
    }
    S.demo = true;
    S.sb = null;
    setConn("online");
    console.info("[SyncSpace] DEMO mode");
    return false;
  }

  /* ---------- Auth ---------- */
  function persistAuth() {
    if (S.user) localStorage.setItem(LS.auth, JSON.stringify(S.user));
    else localStorage.removeItem(LS.auth);
  }
  function restoreAuth() {
    return safeParse(localStorage.getItem(LS.auth), null);
  }
  function showLogin() {
    $("#auth-login").hidden = false;
    $("#auth-signup").hidden = true;
    $("#login-error").hidden = true;
  }
  function showSignup(pre = "") {
    $("#auth-login").hidden = true;
    $("#auth-signup").hidden = false;
    $("#signup-error").hidden = true;
    if (pre) $("#signup-userid").value = pre;
  }
  function updatePwStrength(pw) {
    const box = $("#pw-strength");
    if (!box) return;
    let sc = 0;
    if (pw.length >= 6) sc++;
    if (pw.length >= 10) sc++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) sc++;
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) sc++;
    box.classList.remove("weak", "medium", "strong");
    const lab = box.querySelector(".strength-label");
    if (!pw) {
      lab.textContent = "Weak";
      return;
    }
    if (sc <= 1) {
      box.classList.add("weak");
      lab.textContent = "Weak";
    } else if (sc <= 2) {
      box.classList.add("medium");
      lab.textContent = "Medium";
    } else {
      box.classList.add("strong");
      lab.textContent = "Strong";
    }
  }
  async function findUser(userId) {
    const id = normalizeUserId(userId);
    if (S.demo) return Demo.users[id] || null;
    const { data, error } = await S.sb
      .from("users")
      .select("user_id,name,password,role,created_at")
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
      .select("user_id,name,role")
      .single();
    if (error) throw error;
    return data;
  }
  async function handleLogin(e) {
    e.preventDefault();
    const userId = normalizeUserId($("#login-userid").value);
    const password = $("#login-password").value;
    const err = $("#login-error");
    err.hidden = true;
    const btn = $("#login-btn");
    btn.disabled = true;
    btn.querySelector(".btn-spinner").hidden = false;
    try {
      if (userId.length < 3) throw new Error("User ID min 3 chars");
      if (password.length < 6) throw new Error("Password min 6 chars");
      const user = await findUser(userId);
      if (!user) {
        toast("Account not found — create one", "info");
        showSignup(userId);
        return;
      }
      if ((await sha256(password)) !== user.password)
        throw new Error("Incorrect password");
      S.user = {
        user_id: user.user_id,
        name: user.name,
        role: user.role || "member",
      };
      persistAuth();
      enterHub();
      toast(`Welcome, ${S.user.name}!`, "success");
    } catch (ex) {
      err.textContent = ex.message || "Login failed";
      err.hidden = false;
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
    const err = $("#signup-error");
    err.hidden = true;
    const btn = $("#signup-btn");
    btn.disabled = true;
    btn.querySelector(".btn-spinner").hidden = false;
    try {
      if (name.length < 2) throw new Error("Enter full name");
      if (userId.length < 3 || !/^[a-z0-9_.-]+$/.test(userId))
        throw new Error("Invalid User ID");
      if (password.length < 6) throw new Error("Password min 6 chars");
      if (password !== confirm) throw new Error("Passwords do not match");
      if (await findUser(userId)) throw new Error("User ID taken");
      const user = await createUser({ user_id: userId, name, password });
      S.user = {
        user_id: user.user_id,
        name: user.name,
        role: user.role || "member",
      };
      persistAuth();
      enterHub();
      toast("Account created!", "success");
    } catch (ex) {
      err.textContent = ex.message || "Signup failed";
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector(".btn-spinner").hidden = true;
    }
  }
  async function logout() {
    await leaveSession({ silent: true });
    S.user = null;
    persistAuth();
    showLogin();
    showView("auth");
    toast("Logged out", "info");
  }
  function enterHub() {
    if (!S.user) return showView("auth");
    $("#hub-name").textContent = S.user.name;
    $("#hub-userid").textContent = "@" + S.user.user_id;
    const av = $("#hub-avatar");
    av.textContent = initials(S.user.name);
    av.style.background = avatarColor(S.user.user_id);
    showView("hub");
  }

  /* ---------- Recent ---------- */
  function getRecent() {
    return safeParse(localStorage.getItem(LS.recent), []);
  }
  function pushRecent(sess) {
    if (!sess?.id) return;
    const list = getRecent().filter((r) => r.id !== sess.id);
    list.unshift({ id: sess.id, name: sess.name, at: Date.now() });
    localStorage.setItem(LS.recent, JSON.stringify(list.slice(0, 8)));
  }
  function renderRecent() {
    const box = $("#hub-recent"),
      list = $("#recent-list");
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
      li.innerHTML = `<span class="mono"></span><span></span>`;
      li.querySelector(".mono").textContent = r.id;
      li.querySelector("span:last-child").textContent = r.name || "";
      li.style.cursor = "pointer";
      li.onclick = () => {
        $("#join-id").value = r.id;
        $("#join-password").focus();
      };
      list.appendChild(li);
    });
  }

  /* ---------- Sessions ---------- */
  async function uniqueSessionId() {
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
    throw new Error("Could not allocate session ID");
  }
  async function createSession(name, password) {
    const clean = String(name || "").trim();
    if (!clean) throw new Error("Session name required");
    if (password.length < 3) throw new Error("Session password min 3 chars");
    const id = await uniqueSessionId();
    const hash = await sha256(password);
    const endsAt = new Date(Date.now() + SESSION_MS).toISOString();
    if (S.demo) {
      const secId = uuid();
      Demo.sessions[id] = {
        id,
        name: clean,
        password: hash,
        created_by: S.user.user_id,
        ends_at: endsAt,
        created_at: new Date().toISOString(),
        data: emptyData(),
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
      return { id, name: clean, created_by: S.user.user_id, ends_at: endsAt };
    }
    const { error } = await S.sb
      .from("sessions")
      .insert({
        id,
        name: clean,
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
    return { id, name: clean, created_by: S.user.user_id, ends_at: endsAt };
  }
  async function joinSession(id, password) {
    id = String(id || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (id.length !== 6) throw new Error("Session ID must be 6 chars");
    if (!password || password.length < 3)
      throw new Error("Enter session password");
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
    const { data, error } = await S.sb
      .from("sessions")
      .select("id,name,password,created_by,ends_at")
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
      S.session.created_by && S.session.created_by === S.user.user_id;
    if (!isOwner) {
      toast("Only the session creator can delete", "error");
      return;
    }
    if (!confirm("Delete this session for everyone?")) return;
    const id = S.session.id;
    try {
      setLoading(true, "Deleting…");
      if (S.demo) {
        delete Demo.sessions[id];
        Demo.persist();
        // notify other tabs via storage tick already
      } else {
        // Broadcast kill signal first so joiners leave immediately
        broadcast("session", { type: "deleted", session_id: id });
        const { error } = await S.sb.from("sessions").delete().eq("id", id);
        if (error) throw error;
      }
      localStorage.setItem(
        LS.recent,
        JSON.stringify(getRecent().filter((r) => r.id !== id)),
      );
      toast("Session deleted", "success");
      await leaveSession({ silent: true, skipSave: true });
      enterHub();
    } catch (ex) {
      toast(ex.message || "Delete failed", "error");
    } finally {
      setLoading(false);
    }
  }
  async function forceLeaveDeleted() {
    if (!S.session || S.leaving) return;
    toast("Session was deleted by the creator", "error", 5000);
    await leaveSession({ silent: true, skipSave: true });
    enterHub();
  }
  async function enterSession(session) {
    S.session = session;
    S.leaving = false;
    setLoading(true, "Joining…");
    try {
      await loadSessionData();
      await setupRealtime();
      startTimer();
      renderShell();
      pushRecent(session);
      showView("dashboard");
      switchPanel("editor");
      toast(`Joined ${session.name}`, "success");
    } catch (ex) {
      console.error(ex);
      toast(ex.message || "Join failed", "error");
      await teardownRealtime();
      stopTimer();
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
    S.msgById = new Map();
    S.boardData = "";
    S.unreadChat = 0;
    S.presence = {};
    S.remoteTyping = null;
    S.editorDirty = false;
    S.lastTextHash = {};
    S.lastBoardHash = "";
  }
  async function leaveSession({ silent = false, skipSave = false } = {}) {
    if (S.leaving) return;
    S.leaving = true;
    try {
      clearTimeout(S.saveTimer);
      S.saveTimer = null;
      clearTimeout(S.boardTimer);
      S.boardTimer = null;
      clearTimeout(S.typingClear);
      S.typingClear = null;
      stopTimer();
      if (!skipSave && S.session && S.activeSectionId) {
        try {
          await saveText(
            S.activeSectionId,
            $("#editor")?.innerHTML || "",
            true,
          );
        } catch {
          /* */
        }
        try {
          await persistBoard(true);
        } catch {
          /* */
        }
      }
      await teardownRealtime();
      clearSessionState();
      const ed = $("#editor");
      if (ed) ed.innerHTML = "";
      updateEditorEmpty();
      if (!silent && S.user) {
        enterHub();
        toast("Left session", "info");
      }
    } finally {
      S.leaving = false;
    }
  }
  function renderShell() {
    if (!S.session || !S.user) return;
    $("#session-id-label").textContent = S.session.id;
    $("#session-name-label").textContent = S.session.name;
    const av = $("#dash-avatar");
    av.textContent = initials(S.user.name);
    av.style.background = avatarColor(S.user.user_id);
    const del = $("#delete-session-btn");
    if (del) {
      const owner =
        S.session.created_by && S.session.created_by === S.user.user_id;
      del.hidden = !owner;
    }
    renderSections();
    renderChat(true);
    renderTasks();
    renderFiles();
    renderPresence();
    updateChatBadge();
    setConn(S.demo || S.connected ? "online" : "connecting");
  }

  /* ---------- Load data ---------- */
  async function loadSessionData() {
    if (S.demo) {
      Demo.reload();
      const data = Demo.data(S.session.id);
      if (!data) throw new Error("Session missing");
      S.sections = [...(data.sections || [])].sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      S.texts = { ...(data.texts || {}) };
      S.messages = [...(data.messages || [])];
      S.msgById = new Map(S.messages.map((m) => [m.id, m]));
      S.todos = [...(data.todos || [])];
      S.files = [...(data.files || [])];
      S.boardData = data.board || "";
      S.lastBoardHash = hashStr(S.boardData);
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
      loadEditor(S.activeSectionId);
      return;
    }
    const sid = S.session.id;
    const [secR, textR, chatR, todoR, fileR, boardR] = await Promise.all([
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
      S.sb.from("todos").select("*").eq("session_id", sid).order("created_at"),
      S.sb
        .from("files")
        .select("*")
        .eq("session_id", sid)
        .order("created_at", { ascending: false }),
      S.sb.from("whiteboards").select("*").eq("session_id", sid).maybeSingle(),
    ]);
    if (secR.error) throw secR.error;
    S.sections = secR.data || [];
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
    (textR.data || []).forEach((t) => {
      const prev = S.texts[t.section_id];
      if (
        !prev ||
        new Date(t.updated_at || 0) >= new Date(prev.updated_at || 0)
      )
        S.texts[t.section_id] = t;
    });
    S.messages = chatR.data || [];
    S.msgById = new Map(S.messages.map((m) => [m.id, m]));
    S.todos = todoR.data || [];
    S.files = fileR.data || [];
    S.boardData = boardR.data?.data || "";
    S.lastBoardHash = hashStr(S.boardData);
    if (!boardR.data)
      await S.sb
        .from("whiteboards")
        .upsert({ session_id: sid, data: "", updated_by: S.user.user_id });
    S.activeSectionId = S.sections[0].id;
    loadEditor(S.activeSectionId);
  }

  /* ---------- Realtime core ---------- */
  async function teardownRealtime() {
    if (S.demoPoll) {
      clearInterval(S.demoPoll);
      S.demoPoll = null;
    }
    if (S.fallbackPoll) {
      clearInterval(S.fallbackPoll);
      S.fallbackPoll = null;
    }
    if (S.channel && S.sb) {
      try {
        await S.sb.removeChannel(S.channel);
      } catch {
        /* */
      }
    }
    S.channel = null;
    S.channelName = null;
  }

  function broadcast(event, payload) {
    if (S.demo || !S.channel || typeof S.channel.send !== "function" || !S.user)
      return;
    try {
      S.channel.send({
        type: "broadcast",
        event,
        payload: {
          ...payload,
          user_id: S.user.user_id,
          user_name: S.user.name,
          client_id: S.clientId,
          ts: Date.now(),
        },
      });
    } catch (e) {
      console.warn("broadcast", e);
    }
  }

  async function setupRealtime() {
    await teardownRealtime();
    if (!S.session) return;

    if (S.demo) {
      let tick = localStorage.getItem(LS.sessions + "_tick") || "";
      S.demoPoll = setInterval(() => {
        if (!S.session || S.leaving) return;
        const t = localStorage.getItem(LS.sessions + "_tick") || "";
        Demo.reload();
        if (!Demo.sessions[S.session.id]) {
          forceLeaveDeleted();
          return;
        }
        if (t === tick) return;
        tick = t;
        pullDemoState();
      }, 700);
      // storage event for other tabs
      window.addEventListener("storage", onStorage);
      setConn("online");
      return;
    }

    const sid = S.session.id;
    S.channelName = `ss:${sid}`;
    const ch = S.sb.channel(S.channelName, {
      config: { broadcast: { self: false }, presence: { key: S.user.user_id } },
    });

    // ---- Chat INSERT (dedupe by id) ----
    ch.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `session_id=eq.${sid}`,
      },
      (p) => {
        upsertMessage(p.new, { fromRemote: true });
      },
    );

    // ---- Todos ----
    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "todos",
        filter: `session_id=eq.${sid}`,
      },
      (p) => {
        if (p.eventType === "INSERT") {
          if (!S.todos.find((t) => t.id === p.new.id)) S.todos.push(p.new);
        } else if (p.eventType === "UPDATE") {
          const i = S.todos.findIndex((t) => t.id === p.new.id);
          if (i >= 0) S.todos[i] = p.new;
          else S.todos.push(p.new);
        } else if (p.eventType === "DELETE") {
          S.todos = S.todos.filter((t) => t.id !== p.old.id);
        }
        renderTasks();
      },
    );

    // ---- Files ----
    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "files",
        filter: `session_id=eq.${sid}`,
      },
      (p) => {
        if (p.eventType === "INSERT") {
          if (!S.files.find((f) => f.id === p.new.id)) S.files.unshift(p.new);
        } else if (p.eventType === "DELETE") {
          S.files = S.files.filter((f) => f.id !== p.old.id);
        }
        renderFiles();
      },
    );

    // ---- Sections ----
    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sections",
        filter: `session_id=eq.${sid}`,
      },
      (p) => {
        if (
          p.eventType === "INSERT" &&
          !S.sections.find((s) => s.id === p.new.id)
        )
          S.sections.push(p.new);
        else if (p.eventType === "UPDATE") {
          const i = S.sections.findIndex((s) => s.id === p.new.id);
          if (i >= 0) S.sections[i] = p.new;
        } else if (p.eventType === "DELETE") {
          S.sections = S.sections.filter((s) => s.id !== p.old.id);
          if (S.activeSectionId === p.old.id && S.sections[0]) {
            S.activeSectionId = S.sections[0].id;
            loadEditor(S.activeSectionId);
          }
        }
        S.sections.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        renderSections();
      },
    );

    // ---- Texts UPDATE (editor content) ----
    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "texts",
        filter: `session_id=eq.${sid}`,
      },
      (p) => {
        const row = p.new;
        if (!row) return;
        if (row.updated_by === S.user.user_id) {
          S.texts[row.section_id] = row;
          return;
        }
        applyRemoteText(row);
      },
    );

    // ---- Whiteboard snapshot ----
    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "whiteboards",
        filter: `session_id=eq.${sid}`,
      },
      (p) => {
        const row = p.new;
        if (!row || row.updated_by === S.user.user_id) return;
        const data = row.data || "";
        if (hashStr(data) === S.lastBoardHash) return;
        S.boardData = data;
        S.lastBoardHash = hashStr(data);
        if (S.activePanel === "whiteboard") restoreBoard(data);
      },
    );

    // ---- Session deleted ----
    ch.on(
      "postgres_changes",
      {
        event: "DELETE",
        schema: "public",
        table: "sessions",
        filter: `id=eq.${sid}`,
      },
      () => {
        forceLeaveDeleted();
      },
    );

    // ---- Broadcasts (fast path for editor/board/chat/session) ----
    ch.on("broadcast", { event: "editor" }, ({ payload }) => {
      if (
        !payload ||
        payload.client_id === S.clientId ||
        payload.user_id === S.user.user_id
      )
        return;
      applyRemoteText(
        {
          section_id: payload.section_id,
          content: payload.content,
          updated_at: new Date(payload.ts || Date.now()).toISOString(),
          updated_by: payload.user_id,
        },
        true,
      );
    });

    ch.on("broadcast", { event: "whiteboard" }, ({ payload }) => {
      if (!payload || payload.client_id === S.clientId) return;
      if (payload.type === "clear") {
        clearCanvasLocal();
        S.boardData = "";
        S.lastBoardHash = hashStr("");
        return;
      }
      if (payload.type === "stroke" && payload.from && payload.to) {
        drawLine(
          payload.from,
          payload.to,
          payload.color,
          payload.size,
          payload.erase,
        );
      }
      if (payload.type === "snapshot" && typeof payload.data === "string") {
        if (hashStr(payload.data) !== S.lastBoardHash) {
          S.boardData = payload.data;
          S.lastBoardHash = hashStr(payload.data);
          if (S.activePanel === "whiteboard") restoreBoard(payload.data);
        }
      }
    });

    ch.on("broadcast", { event: "chat" }, ({ payload }) => {
      if (!payload?.message) return;
      if (payload.client_id === S.clientId) return;
      upsertMessage(payload.message, { fromRemote: true });
    });

    ch.on("broadcast", { event: "session" }, ({ payload }) => {
      if (payload?.type === "deleted" && payload.session_id === sid)
        forceLeaveDeleted();
    });

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

    ch.on("presence", { event: "sync" }, () => {
      S.presence = ch.presenceState() || {};
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
          /* */
        }
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setConn("offline");
        setTimeout(() => {
          if (S.session && !S.leaving && S.channel === ch) setupRealtime();
        }, 2000);
      } else setConn("connecting");
    });

    S.channel = ch;

    // Fallback poll every 4s: session alive + text/board catch-up
    S.fallbackPoll = setInterval(() => {
      if (S.session && !S.leaving) fallbackSync();
    }, 4000);
  }

  function onStorage(e) {
    if (!S.session || S.leaving) return;
    if (e.key === LS.sessions || e.key === LS.sessions + "_tick") {
      Demo.reload();
      if (!Demo.sessions[S.session.id]) forceLeaveDeleted();
      else pullDemoState();
    }
  }

  function pullDemoState() {
    const data = Demo.data(S.session.id);
    if (!data) return;
    // messages
    let chatChanged = false;
    (data.messages || []).forEach((m) => {
      if (!S.msgById.has(m.id)) {
        upsertMessage(m, { fromRemote: true, silent: true });
        chatChanged = true;
      }
    });
    if (chatChanged) renderChat(true);
    S.todos = [...(data.todos || [])];
    renderTasks();
    S.files = [...(data.files || [])];
    renderFiles();
    S.sections = [...(data.sections || [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    renderSections();
    // texts
    Object.values(data.texts || {}).forEach((row) => {
      if (row.updated_by === S.user.user_id) {
        S.texts[row.section_id] = row;
        return;
      }
      applyRemoteText(row);
    });
    // board
    const b = data.board || "";
    if (hashStr(b) !== S.lastBoardHash) {
      S.boardData = b;
      S.lastBoardHash = hashStr(b);
      if (S.activePanel === "whiteboard") restoreBoard(b);
    }
  }

  async function fallbackSync() {
    if (S.demo || !S.sb || !S.session) return;
    try {
      const { data: sess, error } = await S.sb
        .from("sessions")
        .select("id")
        .eq("id", S.session.id)
        .maybeSingle();
      if (error) return;
      if (!sess) {
        await forceLeaveDeleted();
        return;
      }
      // texts
      const { data: texts } = await S.sb
        .from("texts")
        .select("*")
        .eq("session_id", S.session.id);
      (texts || []).forEach((row) => {
        if (row.updated_by === S.user.user_id) {
          S.texts[row.section_id] = row;
          return;
        }
        const prev = S.texts[row.section_id];
        if (
          !prev ||
          new Date(row.updated_at || 0) > new Date(prev.updated_at || 0)
        )
          applyRemoteText(row);
      });
      // board
      const { data: board } = await S.sb
        .from("whiteboards")
        .select("*")
        .eq("session_id", S.session.id)
        .maybeSingle();
      if (board && board.updated_by !== S.user.user_id) {
        const d = board.data || "";
        if (hashStr(d) !== S.lastBoardHash) {
          S.boardData = d;
          S.lastBoardHash = hashStr(d);
          if (S.activePanel === "whiteboard") restoreBoard(d);
        }
      }
      // chat catch-up
      const { data: chats } = await S.sb
        .from("chat_messages")
        .select("*")
        .eq("session_id", S.session.id)
        .order("created_at", { ascending: false })
        .limit(50);
      let added = false;
      (chats || []).reverse().forEach((m) => {
        if (!S.msgById.has(m.id)) {
          upsertMessage(m, { fromRemote: true, silent: true });
          added = true;
        }
      });
      if (added) renderChat(true);
    } catch (e) {
      console.warn("fallbackSync", e);
    }
  }

  /* ---------- Editor remote apply ---------- */
  function applyRemoteText(row, fromBroadcast = false) {
    if (!row?.section_id) return;
    const content = sanitizeHtml(row.content || "");
    const h = hashStr(content);
    if (
      S.lastTextHash[row.section_id] === h &&
      S.texts[row.section_id]?.content === content
    ) {
      S.texts[row.section_id] = { ...S.texts[row.section_id], ...row, content };
      return;
    }
    S.texts[row.section_id] = { ...S.texts[row.section_id], ...row, content };
    S.lastTextHash[row.section_id] = h;

    if (row.section_id !== S.activeSectionId) return;

    const ed = $("#editor");
    if (!ed) return;
    // If user is actively typing (dirty within 800ms), don't clobber — mark live
    const typingNow = S.editorDirty && Date.now() - S.lastLocalEditAt < 800;
    if (typingNow && document.activeElement === ed) {
      setSaveStatus("live");
      return;
    }
    if (ed.innerHTML === content) return;
    S.applyingEditor = true;
    ed.innerHTML = content;
    S.applyingEditor = false;
    S.editorDirty = false;
    updateEditorEmpty();
    setSaveStatus("live");
    setTimeout(() => setSaveStatus("saved"), 1000);
  }

  /* ---------- Chat upsert (NO DUPLICATES) ---------- */
  function upsertMessage(msg, { fromRemote = false, silent = false } = {}) {
    if (!msg || !msg.id) return;
    if (S.msgById.has(msg.id)) return; // already have it
    S.msgById.set(msg.id, msg);
    S.messages.push(msg);
    S.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (
      fromRemote &&
      S.activePanel !== "chat" &&
      msg.user_id !== S.user?.user_id
    ) {
      S.unreadChat += 1;
      updateChatBadge();
    }
    if (!silent) renderChat(true);
  }

  /* ---------- Timer ---------- */
  function startTimer() {
    stopTimer();
    let ends = S.session?.ends_at ? new Date(S.session.ends_at).getTime() : NaN;
    if (!Number.isFinite(ends)) {
      ends = Date.now() + SESSION_MS;
      S.session.ends_at = new Date(ends).toISOString();
      if (S.demo && Demo.sessions[S.session.id]) {
        Demo.sessions[S.session.id].ends_at = S.session.ends_at;
        Demo.persist();
      }
    }
    S.timerEndsAt = ends;
    const el = $("#session-timer");
    let toasted = false;
    const tick = () => {
      if (!el) return;
      const left = Math.max(0, S.timerEndsAt - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (left <= 0 && !toasted) {
        toasted = true;
        toast("Session timer ended", "info", 4000);
      }
    };
    tick();
    S.timerInterval = setInterval(tick, 1000);
  }
  function stopTimer() {
    if (S.timerInterval) clearInterval(S.timerInterval);
    S.timerInterval = null;
  }

  /* ---------- Sections + Editor ---------- */
  function renderSections() {
    const list = $("#section-list");
    if (!list) return;
    list.innerHTML = "";
    S.sections.forEach((sec) => {
      const li = document.createElement("li");
      li.className = `section-item${sec.id === S.activeSectionId ? " active" : ""}`;
      li.innerHTML = `<span class="sec-name"></span><button class="sec-del" type="button" title="Delete"><i class="fa-solid fa-xmark"></i></button>`;
      li.querySelector(".sec-name").textContent = sec.name;
      li.onclick = (e) => {
        if (!e.target.closest(".sec-del")) selectSection(sec.id);
      };
      li.ondblclick = (e) => {
        if (!e.target.closest(".sec-del")) renameSection(sec.id);
      };
      li.querySelector(".sec-del").onclick = (e) => {
        e.stopPropagation();
        deleteSection(sec.id);
      };
      list.appendChild(li);
    });
    const active = S.sections.find((s) => s.id === S.activeSectionId);
    const n = $("#editor-section-name");
    if (n) n.textContent = active?.name || "Untitled";
  }
  async function selectSection(id) {
    if (!id || id === S.activeSectionId) return;
    if (S.activeSectionId)
      await saveText(S.activeSectionId, $("#editor")?.innerHTML || "", true);
    S.activeSectionId = id;
    loadEditor(id);
    renderSections();
  }
  function loadEditor(sectionId) {
    const row = S.texts[sectionId];
    const ed = $("#editor");
    if (!ed) return;
    S.applyingEditor = true;
    ed.innerHTML = sanitizeHtml(row?.content || "");
    S.applyingEditor = false;
    S.editorDirty = false;
    S.lastTextHash[sectionId] = hashStr(ed.innerHTML);
    updateEditorEmpty();
    setSaveStatus("saved");
  }
  function scheduleSave() {
    if (S.applyingEditor || S.leaving || !S.session) return;
    S.editorDirty = true;
    S.lastLocalEditAt = Date.now();
    setSaveStatus("saving");
    updateEditorEmpty();
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => {
      S.saveTimer = null;
      if (!S.session || !S.activeSectionId || S.leaving) return;
      saveText(S.activeSectionId, $("#editor")?.innerHTML || "", false);
    }, SAVE_MS);
    // live broadcast for joiners (even before DB save finishes)
    throttleTyping("editor");
    broadcast("editor", {
      section_id: S.activeSectionId,
      content: sanitizeHtml($("#editor")?.innerHTML || ""),
    });
  }
  async function saveText(sectionId, content, immediate) {
    if (!S.session || !sectionId || S.leaving) return;
    const sessionId = S.session.id;
    const clean = sanitizeHtml(content);
    const now = new Date().toISOString();
    S.lastTextHash[sectionId] = hashStr(clean);
    try {
      if (S.demo) {
        const data = Demo.data(sessionId);
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
        data.texts[sectionId].updated_by = S.user.user_id;
        S.texts[sectionId] = data.texts[sectionId];
        Demo.persist();
        S.editorDirty = false;
        if (S.session?.id === sessionId) setSaveStatus("saved");
        return;
      }
      const existing = S.texts[sectionId];
      let saved;
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
        saved = data;
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
        saved = data;
      }
      if (S.session?.id === sessionId) {
        S.texts[sectionId] = saved;
        S.editorDirty = false;
        setSaveStatus("saved");
        // ensure peers get it even if postgres_changes lag
        broadcast("editor", { section_id: sectionId, content: clean });
      }
    } catch (e) {
      console.error(e);
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
        const data = Demo.data(S.session.id);
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
    } catch (e) {
      toast(e.message || "Add failed", "error");
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
        const row = Demo.data(S.session.id).sections.find((s) => s.id === id);
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
      toast("Renamed", "success");
    } catch (e) {
      toast(e.message || "Rename failed", "error");
    }
  }
  async function deleteSection(id) {
    if (S.sections.length <= 1) {
      toast("Keep at least one section", "error");
      return;
    }
    if (!confirm("Delete section?")) return;
    try {
      if (S.demo) {
        const data = Demo.data(S.session.id);
        data.sections = data.sections.filter((s) => s.id !== id);
        delete data.texts[id];
        Demo.persist();
      } else {
        const { error } = await S.sb.from("sections").delete().eq("id", id);
        if (error) throw error;
      }
      S.sections = S.sections.filter((s) => s.id !== id);
      delete S.texts[id];
      if (S.activeSectionId === id) {
        S.activeSectionId = S.sections[0]?.id || null;
        if (S.activeSectionId) loadEditor(S.activeSectionId);
      }
      renderSections();
      toast("Deleted", "success");
    } catch (e) {
      toast(e.message || "Delete failed", "error");
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
      if (S.demo) versions = Demo.data(S.session.id)?.versions[sectionId] || [];
      else {
        const { data, error } = await S.sb
          .from("text_versions")
          .select("*")
          .eq("section_id", sectionId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        versions = data || [];
      }
    } catch (e) {
      list.innerHTML = `<li class="history-item">${escapeHtml(e.message || "Failed")}</li>`;
      return;
    }
    if (!versions.length) {
      list.innerHTML = '<li class="history-item">No versions yet</li>';
      return;
    }
    list.innerHTML = "";
    versions.forEach((v) => {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML = `<span></span><button class="btn btn-ghost btn-sm" type="button">Restore</button>`;
      li.querySelector("span").textContent = new Date(
        v.created_at,
      ).toLocaleString();
      li.querySelector("button").onclick = async () => {
        if (S.activeSectionId !== sectionId) await selectSection(sectionId);
        S.applyingEditor = true;
        $("#editor").innerHTML = sanitizeHtml(v.content || "");
        S.applyingEditor = false;
        updateEditorEmpty();
        await saveText(sectionId, $("#editor").innerHTML, true);
        $("#history-modal").hidden = true;
        toast("Restored", "success");
      };
      list.appendChild(li);
    });
  }

  /* ---------- Chat UI ---------- */
  function updateChatBadge() {
    const n =
      S.unreadChat > 0
        ? S.unreadChat > 99
          ? "99+"
          : String(S.unreadChat)
        : "";
    ["#chat-badge", "#chat-badge-mobile"].forEach((sel) => {
      const b = $(sel);
      if (!b) return;
      if (S.unreadChat > 0) {
        b.hidden = false;
        b.textContent = n;
      } else b.hidden = true;
    });
  }
  function renderChat(stick = false) {
    const box = $("#chat-messages"),
      empty = $("#chat-empty");
    if (!box || !empty) return;
    const near =
      stick || box.scrollHeight - box.scrollTop - box.clientHeight < 100;
    [...box.children].forEach((c) => {
      if (c.id !== "chat-empty") c.remove();
    });
    if (!S.messages.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    let last = "";
    S.messages.forEach((msg) => {
      const lab = formatDateLabel(msg.created_at);
      if (lab && lab !== last) {
        last = lab;
        const sep = document.createElement("div");
        sep.className = "chat-date-sep";
        sep.textContent = lab;
        box.appendChild(sep);
      }
      const mine = msg.user_id
        ? msg.user_id === S.user.user_id
        : msg.user_name === S.user.name;
      const row = document.createElement("div");
      row.className = `chat-msg${mine ? " mine" : ""}`;
      const seed = msg.user_id || msg.user_name || "";
      row.innerHTML = `<div class="msg-avatar" style="background:${avatarColor(seed)}">${escapeHtml(initials(msg.user_name))}</div>
        <div class="msg-body"><div class="msg-name"></div><div class="msg-text"></div><div class="msg-time"></div></div>`;
      row.querySelector(".msg-name").textContent = msg.user_name;
      row.querySelector(".msg-text").textContent = msg.message;
      row.querySelector(".msg-time").textContent = formatTime(msg.created_at);
      box.appendChild(row);
    });
    if (near) box.scrollTop = box.scrollHeight;
  }
  async function sendChat(e) {
    e.preventDefault();
    if (!S.session) return;
    const input = $("#chat-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    const row = {
      id: uuid(),
      session_id: S.session.id,
      user_id: S.user.user_id,
      user_name: S.user.name,
      message,
      created_at: new Date().toISOString(),
    };
    // optimistic once
    upsertMessage(row, { fromRemote: false });
    try {
      if (S.demo) {
        Demo.data(S.session.id).messages.push(row);
        Demo.persist();
        return;
      }
      broadcast("chat", { message: row });
      const { data, error } = await S.sb
        .from("chat_messages")
        .insert({
          id: row.id,
          session_id: row.session_id,
          user_id: row.user_id,
          user_name: row.user_name,
          message: row.message,
        })
        .select()
        .single();
      if (error) throw error;
      // if server returned same id we're good; if different, map it
      if (data && data.id !== row.id) {
        S.msgById.delete(row.id);
        S.messages = S.messages.filter((m) => m.id !== row.id);
        upsertMessage(data, { fromRemote: false });
      }
    } catch (ex) {
      // rollback optimistic
      S.msgById.delete(row.id);
      S.messages = S.messages.filter((m) => m.id !== row.id);
      renderChat(true);
      toast(ex.message || "Send failed", "error");
      input.value = message;
    }
  }
  function throttleTyping(where) {
    const now = Date.now();
    if (now - S.typingAt < 700) return;
    S.typingAt = now;
    broadcast("typing", { where });
  }
  function updateTypingUI() {
    const ed = $("#typing-indicator"),
      chat = $("#chat-typing");
    if (!ed || !chat) return;
    if (S.remoteTyping?.where === "editor") {
      ed.hidden = false;
      ed.textContent = `${S.remoteTyping.user_name} is typing…`;
    } else ed.hidden = true;
    if (S.remoteTyping?.where === "chat") {
      chat.hidden = false;
      chat.textContent = `${S.remoteTyping.user_name} is typing…`;
    } else chat.hidden = true;
  }
  function renderPresence() {
    const el = $("#online-users");
    if (!el) return;
    el.innerHTML = "";
    const people = [];
    if (S.demo && S.user)
      people.push({ user_id: S.user.user_id, name: S.user.name });
    else
      Object.values(S.presence || {}).forEach((arr) =>
        (arr || []).forEach((p) => {
          if (p?.user_id && !people.find((x) => x.user_id === p.user_id))
            people.push(p);
        }),
      );
    people.slice(0, 8).forEach((p) => {
      const c = document.createElement("span");
      c.className = "ou-chip";
      c.style.background = avatarColor(p.user_id || p.name);
      c.textContent = initials(p.name || p.user_id || "?");
      c.title = p.name || p.user_id;
      el.appendChild(c);
    });
  }

  /* ---------- Tasks ---------- */
  function renderTasks() {
    const list = $("#task-list"),
      empty = $("#task-empty");
    if (!list || !empty) return;
    list.innerHTML = "";
    const total = S.todos.length;
    const done = S.todos.filter((t) => t.completed).length;
    $("#task-total").textContent = total;
    $("#task-done").textContent = done;
    $("#task-pending").textContent = total - done;
    $("#task-progress").style.width = total
      ? `${Math.round((done / total) * 100)}%`
      : "0%";
    if (!total) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    [
      ...S.todos.filter((t) => !t.completed),
      ...S.todos.filter((t) => t.completed),
    ].forEach((t) => {
      const li = document.createElement("li");
      li.className = `task-item${t.completed ? " done" : ""}`;
      li.innerHTML = `<button class="task-check" type="button"><i class="fa-solid fa-check"></i></button><span class="task-text"></span><button class="task-del" type="button"><i class="fa-solid fa-trash"></i></button>`;
      li.querySelector(".task-text").textContent = t.text;
      li.querySelector(".task-check").onclick = () =>
        toggleTodo(t.id, !t.completed);
      li.querySelector(".task-del").onclick = () => deleteTodo(t.id);
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
        Demo.data(S.session.id).todos.push(row);
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
    } catch (ex) {
      toast(ex.message || "Add failed", "error");
    }
  }
  async function toggleTodo(id, completed) {
    try {
      if (S.demo) {
        const t = Demo.data(S.session.id).todos.find((x) => x.id === id);
        if (t) t.completed = completed;
        Demo.persist();
        const l = S.todos.find((x) => x.id === id);
        if (l) l.completed = completed;
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
    } catch (ex) {
      toast(ex.message || "Update failed", "error");
    }
  }
  async function deleteTodo(id) {
    try {
      if (S.demo) {
        const d = Demo.data(S.session.id);
        d.todos = d.todos.filter((t) => t.id !== id);
        Demo.persist();
        S.todos = S.todos.filter((t) => t.id !== id);
        renderTasks();
        return;
      }
      const { error } = await S.sb.from("todos").delete().eq("id", id);
      if (error) throw error;
      S.todos = S.todos.filter((t) => t.id !== id);
      renderTasks();
    } catch (ex) {
      toast(ex.message || "Delete failed", "error");
    }
  }

  /* ---------- Whiteboard ---------- */
  function getCanvas() {
    return $("#whiteboard");
  }
  function resizeWhiteboard(force = false) {
    const canvas = getCanvas();
    if (!canvas) return;
    const stage = canvas.parentElement;
    if (!stage || stage.clientWidth < 2 || stage.clientHeight < 2) return;
    const oldDpr = S.wb.dpr || 1;
    const prev = document.createElement("canvas");
    prev.width = canvas.width;
    prev.height = canvas.height;
    if (canvas.width && canvas.height)
      prev.getContext("2d").drawImage(canvas, 0, 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stage.clientWidth,
      h = stage.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (prev.width && prev.height)
      ctx.drawImage(prev, 0, 0, prev.width / oldDpr, prev.height / oldDpr);
    else if (force && S.boardData) restoreBoard(S.boardData);
    S.wb.dpr = dpr;
  }
  function restoreBoard(dataUrl) {
    const canvas = getCanvas();
    if (!canvas) return;
    if (!dataUrl) {
      clearCanvasLocal();
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
    const rect = getCanvas().getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
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
      ctx.strokeStyle = "#000";
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
  async function persistBoard(immediate = false) {
    if (!S.session) return;
    const run = async () => {
      const canvas = getCanvas();
      if (!canvas?.width) return;
      const sessionId = S.session.id;
      try {
        const url = canvas.toDataURL("image/png");
        S.boardData = url;
        S.lastBoardHash = hashStr(url);
        broadcast("whiteboard", { type: "snapshot", data: url });
        if (S.demo) {
          const d = Demo.data(sessionId);
          if (d) {
            d.board = url;
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
      } catch (e) {
        console.warn("board save", e);
      }
    };
    if (immediate) {
      clearTimeout(S.boardTimer);
      S.boardTimer = null;
      await run();
      return;
    }
    clearTimeout(S.boardTimer);
    S.boardTimer = setTimeout(run, BOARD_SAVE_MS);
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
    if (!confirm("Clear whiteboard for everyone?")) return;
    clearCanvasLocal();
    S.boardData = "";
    S.lastBoardHash = hashStr("");
    broadcast("whiteboard", { type: "clear" });
    if (S.demo) {
      const d = Demo.data(S.session.id);
      if (d) {
        d.board = "";
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

  /* ---------- Files ---------- */
  const ALLOWED = new Set([
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
  function fileIcon(type = "", name = "") {
    if (type.startsWith("image/"))
      return { icon: "fa-file-image", color: "#00cec9" };
    if (type === "application/pdf" || /\.pdf$/i.test(name))
      return { icon: "fa-file-pdf", color: "#ff6b6b" };
    if (type.includes("word") || /\.docx?$/i.test(name))
      return { icon: "fa-file-word", color: "#74b9ff" };
    if (
      type.includes("sheet") ||
      type.includes("excel") ||
      /\.xlsx?$/i.test(name)
    )
      return { icon: "fa-file-excel", color: "#55efc4" };
    return { icon: "fa-file", color: "#dfe6e9" };
  }
  function renderFiles() {
    const grid = $("#files-grid"),
      empty = $("#files-empty");
    if (!grid || !empty) return;
    grid.innerHTML = "";
    if (!S.files.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    S.files.forEach((file) => {
      const ftype = file.file_type || "application/octet-stream";
      const meta = fileIcon(ftype, file.file_name || "");
      const card = document.createElement("article");
      card.className = "file-card";
      card.innerHTML = `<div class="file-preview"></div><div class="file-meta"><div class="file-name"></div><div class="file-size"></div></div>
        <div class="file-actions"><button class="btn btn-ghost" type="button" data-a="dl"><i class="fa-solid fa-download"></i></button>
        <button class="btn btn-ghost" type="button" data-a="rm"><i class="fa-solid fa-trash"></i></button></div>`;
      card.querySelector(".file-name").textContent = file.file_name || "file";
      card.querySelector(".file-size").textContent = formatBytes(
        file.file_size,
      );
      const prev = card.querySelector(".file-preview");
      if (ftype.startsWith("image/") && file.file_data) {
        const img = document.createElement("img");
        img.src = file.file_data;
        img.alt = "";
        img.loading = "lazy";
        prev.appendChild(img);
      } else
        prev.innerHTML = `<i class="fa-solid ${meta.icon} file-icon" style="color:${meta.color}"></i>`;
      card.querySelector('[data-a="dl"]').onclick = () => downloadFile(file.id);
      card.querySelector('[data-a="rm"]').onclick = () => deleteFile(file.id);
      grid.appendChild(card);
    });
  }
  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error("read fail"));
      r.readAsDataURL(file);
    });
  }
  async function compressIfNeeded(file, dataUrl) {
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
          const r = Math.min(max / width, max / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve({
          dataUrl: c.toDataURL("image/jpeg", 0.82),
          type: "image/jpeg",
          name: file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg",
        });
      };
      img.onerror = () =>
        resolve({ dataUrl, type: file.type, name: file.name });
      img.src = dataUrl;
    });
  }
  async function handleFiles(list) {
    if (!S.session) return;
    const files = [...list];
    if (!files.length) return;
    setLoading(true, "Uploading…");
    let ok = 0,
      skip = 0;
    try {
      for (const file of files) {
        if (file.size > MAX_FILE) {
          toast(`${file.name} > 2MB`, "error");
          skip++;
          continue;
        }
        if (
          !ALLOWED.has(file.type) &&
          !/\.(jpe?g|png|gif|webp|pdf|txt|docx?|xlsx?)$/i.test(file.name)
        ) {
          toast(`${file.name}: type`, "error");
          skip++;
          continue;
        }
        let dataUrl = await readAsDataURL(file);
        const c = await compressIfNeeded(file, dataUrl);
        dataUrl = c.dataUrl;
        const row = {
          id: uuid(),
          session_id: S.session.id,
          section_id: S.activeSectionId,
          file_name: c.name,
          file_data: dataUrl,
          file_type: c.type || "application/octet-stream",
          file_size: Math.min(file.size, Math.ceil(dataUrl.length * 0.75)),
          created_at: new Date().toISOString(),
        };
        if (S.demo) {
          Demo.data(S.session.id).files.unshift(row);
          Demo.persist();
          S.files.unshift(row);
          ok++;
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
            ok++;
          }
        }
      }
      renderFiles();
      if (ok)
        toast(`Uploaded ${ok}${skip ? ` (${skip} skipped)` : ""}`, "success");
    } catch (e) {
      toast(e.message || "Upload failed", "error");
    } finally {
      setLoading(false);
    }
  }
  function downloadFile(id) {
    const file = S.files.find((f) => f.id === id);
    if (!file?.file_data) {
      toast("Not found", "error");
      return;
    }
    try {
      let dataUrl = file.file_data;
      if (!dataUrl.includes(","))
        dataUrl = `data:${file.file_type};base64,${dataUrl}`;
      const b64 = dataUrl.split(",")[1];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], {
        type: file.file_type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name || "file";
      a.click();
      URL.revokeObjectURL(url);
      toast("Download started", "success");
    } catch {
      toast("Download failed", "error");
    }
  }
  async function deleteFile(id) {
    if (!confirm("Delete file?")) return;
    try {
      if (S.demo) {
        const d = Demo.data(S.session.id);
        d.files = d.files.filter((f) => f.id !== id);
        Demo.persist();
        S.files = S.files.filter((f) => f.id !== id);
      } else {
        const { error } = await S.sb.from("files").delete().eq("id", id);
        if (error) throw error;
        S.files = S.files.filter((f) => f.id !== id);
      }
      renderFiles();
      toast("Deleted", "success");
    } catch (e) {
      toast(e.message || "Delete failed", "error");
    }
  }

  /* ---------- Panels ---------- */
  function switchPanel(name) {
    if (!name) return;
    S.activePanel = name;
    $$(".panel").forEach((p) => p.classList.remove("active"));
    $(`#panel-${name}`)?.classList.add("active");
    $$(".sidebar-nav .nav-item, #bottom-nav .nav-item").forEach((b) =>
      b.classList.toggle("active", b.dataset.panel === name),
    );
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

  /* ---------- Stats ---------- */
  async function animateStats() {
    let users = 0,
      sessions = 0,
      messages = 0,
      tasks = 0;
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
        /* */
      }
    } else {
      users = Object.keys(Demo.users).length;
      sessions = Object.keys(Demo.sessions).length;
      Object.values(Demo.sessions).forEach((ss) => {
        messages += (ss.data?.messages || []).length;
        tasks += (ss.data?.todos || []).filter((x) => x.completed).length;
      });
    }
    const map = { users, sessions, messages, tasks };
    $$("[data-stat]").forEach((el) => {
      el.textContent = (map[el.dataset.stat] || 0).toLocaleString();
    });
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === "goto-auth") {
        showView("auth");
        showLogin();
      } else if (a === "goto-landing") showView("landing");
      else if (a === "show-signup")
        showSignup(normalizeUserId($("#login-userid").value));
      else if (a === "show-login") showLogin();
      else if (a === "logout") logout();
      else if (a === "leave-session") leaveSession({ silent: false });
    });
    $("#nav-toggle")?.addEventListener("click", () => {
      const open = $("#nav-links")?.classList.toggle("open");
      $("#nav-toggle")?.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".nav")) closeMobileNav();
    });
    $("#form-login")?.addEventListener("submit", handleLogin);
    $("#form-signup")?.addEventListener("submit", handleSignup);
    $("#signup-password")?.addEventListener("input", (e) =>
      updatePwStrength(e.target.value),
    );
    $("#form-create-session")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        setLoading(true, "Creating…");
        const session = await createSession(
          $("#create-name").value.trim(),
          $("#create-password").value,
        );
        await enterSession(session);
        e.target.reset();
      } catch (ex) {
        toast(ex.message || "Create failed", "error");
      } finally {
        setLoading(false);
      }
    });
    $("#form-join-session")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        setLoading(true, "Joining…");
        const session = await joinSession(
          $("#join-id").value,
          $("#join-password").value,
        );
        await enterSession(session);
        e.target.reset();
      } catch (ex) {
        toast(ex.message || "Join failed", "error");
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
        await navigator.clipboard.writeText(S.session.id);
        toast("Session ID copied", "success");
      } catch {
        toast("Copy failed", "error");
      }
    });
    $("#delete-session-btn")?.addEventListener("click", deleteSession);
    $("#add-section-btn")?.addEventListener("click", addSection);
    $("#sidebar-toggle")?.addEventListener("click", () => {
      if ($("#sidebar")?.classList.contains("open")) closeSidebar();
      else openSidebar();
    });
    $("#sidebar-backdrop")?.addEventListener("click", closeSidebar);
    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-panel]");
      if (nav?.dataset.panel) switchPanel(nav.dataset.panel);
    });
    $$(".editor-toolbar .tool-btn[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd,
          val = btn.dataset.val;
        try {
          if (cmd === "formatBlock")
            document.execCommand(
              "formatBlock",
              false,
              val.startsWith("<") ? val : `<${val}>`,
            );
          else document.execCommand(cmd, false, null);
        } catch {
          /* */
        }
        $("#editor")?.focus();
        scheduleSave();
      });
    });
    $("#editor")?.addEventListener("input", scheduleSave);
    $("#editor")?.addEventListener("blur", () => {
      if (S.session && S.activeSectionId && !S.leaving) {
        clearTimeout(S.saveTimer);
        saveText(S.activeSectionId, $("#editor").innerHTML, true);
      }
    });
    $("#history-btn")?.addEventListener("click", openHistory);
    $$("[data-close]").forEach((b) =>
      b.addEventListener("click", () => {
        const m = $(`#${b.dataset.close}`);
        if (m) m.hidden = true;
      }),
    );
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
    const dz = $("#dropzone"),
      fi = $("#file-input");
    dz?.addEventListener("click", () => fi?.click());
    fi?.addEventListener("change", () => {
      handleFiles(fi.files);
      fi.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) =>
      dz?.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add("dragover");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      dz?.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove("dragover");
      }),
    );
    dz?.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));
    window.addEventListener("resize", () => {
      if (S.activePanel === "whiteboard") resizeWhiteboard(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSidebar();
        closeMobileNav();
        const m = $("#history-modal");
        if (m) m.hidden = true;
      }
    });
    window.addEventListener("beforeunload", () => {
      if (!S.session || !S.activeSectionId || !S.demo) return;
      try {
        const data = Demo.data(S.session.id);
        if (data?.texts[S.activeSectionId]) {
          data.texts[S.activeSectionId].content = sanitizeHtml(
            $("#editor")?.innerHTML || "",
          );
          if (S.boardData) data.board = S.boardData;
          Demo.persist();
        }
      } catch {
        /* */
      }
    });
  }

  /* ---------- Boot ---------- */
  async function boot() {
    bindEvents();
    setLoading(true, "Starting SyncSpace…");
    try {
      await initSupabase();
      const saved = restoreAuth();
      if (saved?.user_id) {
        try {
          const user = await findUser(saved.user_id);
          if (user) {
            S.user = {
              user_id: user.user_id,
              name: user.name,
              role: user.role || "member",
            };
            persistAuth();
            enterHub();
          } else {
            localStorage.removeItem(LS.auth);
            showView("landing");
          }
        } catch {
          if (S.demo && saved.name) {
            S.user = {
              user_id: normalizeUserId(saved.user_id),
              name: saved.name,
              role: "member",
            };
            enterHub();
          } else showView("landing");
        }
      } else showView("landing");
      animateStats();
    } catch (e) {
      console.error(e);
      showView("landing");
      toast("Limited mode", "info");
    } finally {
      setLoading(false);
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(new URL("sw.js", location.href).pathname)
        .catch(() => {});
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
