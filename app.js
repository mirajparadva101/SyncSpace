/* ============================================================
   SyncSpace — Application Logic
   Auth · Sessions · Realtime · Editor · Chat · Tasks · WB · Files
   ============================================================ */

(() => {
  "use strict";

  // -------------------- State --------------------
  const S = {
    sb: null,
    demo: true,
    user: null, // { user_id, name, role }
    session: null, // { id, name }
    sections: [],
    activeSectionId: null,
    texts: {}, // sectionId -> { id, content }
    files: [],
    todos: [],
    messages: [],
    channel: null,
    saveTimer: null,
    timerInterval: null,
    timerEndsAt: null,
    unreadChat: 0,
    activePanel: "editor",
    wb: { tool: "pen", drawing: false, last: null, dpr: 1 },
    typingTimer: null,
    connected: false,
    remoteTyping: null,
  };

  // Local demo store (when Supabase is not configured)
  const Demo = {
    users: JSON.parse(localStorage.getItem("ss_users") || "{}"),
    sessions: JSON.parse(localStorage.getItem("ss_sessions") || "{}"),
    persist() {
      localStorage.setItem("ss_users", JSON.stringify(this.users));
      localStorage.setItem("ss_sessions", JSON.stringify(this.sessions));
    },
    getSessionData(id) {
      if (!this.sessions[id]) return null;
      if (!this.sessions[id].data) {
        this.sessions[id].data = {
          sections: [],
          texts: {},
          messages: [],
          todos: [],
          files: [],
          versions: {},
          board: null,
        };
      }
      return this.sessions[id].data;
    },
  };

  // -------------------- DOM helpers --------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function showView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    const el = $(`#view-${name}`);
    if (el) el.classList.add("active");
    if (name === "landing") animateStats();
    if (name === "dashboard") {
      requestAnimationFrame(() => resizeWhiteboard());
    }
  }

  function setLoading(on, text = "Loading…") {
    const el = $("#loading");
    if (!el) return;
    el.hidden = !on;
    $("#loading-text").textContent = text;
  }

  function toast(message, type = "info", ms = 3200) {
    const wrap = $("#toasts");
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
    // status: online | offline | connecting
    const dot = $("#conn-dot");
    if (!dot) return;
    dot.classList.remove("online", "offline");
    if (status === "online") {
      dot.classList.add("online");
      S.connected = true;
    } else if (status === "offline") {
      dot.classList.add("offline");
      S.connected = false;
    } else {
      S.connected = false;
    }
    dot.title =
      status === "online"
        ? "Connected"
        : status === "offline"
          ? "Offline"
          : "Connecting…";
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
    } else {
      el.textContent = state;
    }
  }

  function initials(name = "U") {
    return (
      name
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

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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

  // -------------------- Config / Supabase --------------------
  async function initSupabase() {
    let url = "";
    let key = "";

    // Optional local override for development
    if (window.SYNCSPACE_CONFIG?.url && window.SYNCSPACE_CONFIG?.key) {
      url = window.SYNCSPACE_CONFIG.url;
      key = window.SYNCSPACE_CONFIG.key;
    } else {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const cfg = await res.json();
          url = cfg.url || "";
          key = cfg.key || "";
          if (cfg.demo) S.demo = true;
        }
      } catch {
        /* demo mode */
      }
    }

    if (url && key && window.supabase) {
      S.sb = window.supabase.createClient(url, key, {
        realtime: { params: { eventsPerSecond: 20 } },
      });
      S.demo = false;
      setConn("online");
      return true;
    }

    S.demo = true;
    S.sb = null;
    setConn("online"); // local demo is always "online"
    console.info(
      "[SyncSpace] Running in DEMO mode (localStorage). Configure Supabase for multi-device realtime.",
    );
    return false;
  }

  // -------------------- Stats (landing) --------------------
  function animateCounter(el, target, duration = 1200) {
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(
        from + (target - from) * eased,
      ).toLocaleString();
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function loadLandingStats() {
    let users = 128;
    let sessions = 42;
    let messages = 1840;
    let tasks = 960;

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
        if (typeof u.count === "number") users = u.count;
        if (typeof s.count === "number") sessions = s.count;
        if (typeof m.count === "number") messages = m.count;
        if (typeof t.count === "number") tasks = t.count;
      } catch {
        /* keep defaults */
      }
    } else {
      users = Math.max(users, Object.keys(Demo.users).length);
      sessions = Math.max(sessions, Object.keys(Demo.sessions).length);
    }

    return { users, sessions, messages, tasks };
  }

  let statsAnimated = false;
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
      if (statsAnimated) {
        el.textContent = (map[key] || 0).toLocaleString();
      } else {
        animateCounter(el, map[key] || 0);
      }
    });
    statsAnimated = true;
  }

  // -------------------- Auth --------------------
  function persistUserSession() {
    if (S.user) localStorage.setItem("ss_auth", JSON.stringify(S.user));
    else localStorage.removeItem("ss_auth");
  }

  function restoreUserSession() {
    try {
      const raw = localStorage.getItem("ss_auth");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
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
    if (pw.length >= 4) score++;
    if (pw.length >= 8) score++;
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
    if (S.demo) {
      return Demo.users[userId] || null;
    }
    const { data, error } = await S.sb
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createUser({ user_id, name, password }) {
    const hash = await sha256(password);
    if (S.demo) {
      if (Demo.users[user_id]) throw new Error("User ID already taken");
      Demo.users[user_id] = {
        user_id,
        name,
        password: hash,
        role: "member",
        created_at: new Date().toISOString(),
      };
      Demo.persist();
      return Demo.users[user_id];
    }
    const { data, error } = await S.sb
      .from("users")
      .insert({ user_id, name, password: hash, role: "member" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function handleLogin(e) {
    e.preventDefault();
    const userId = $("#login-userid").value.trim();
    const password = $("#login-password").value;
    const errEl = $("#login-error");
    errEl.hidden = true;
    const btn = $("#login-btn");
    btn.disabled = true;
    btn.querySelector(".btn-spinner").hidden = false;

    try {
      if (userId.length < 3)
        throw new Error("User ID must be at least 3 characters");
      const user = await findUser(userId);
      if (!user) {
        // Auto-signup flow
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
    const userId = $("#signup-userid").value.trim();
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
      if (!/^[a-zA-Z0-9_.-]+$/.test(userId))
        throw new Error("User ID: letters, numbers, _ . - only");
      if (password.length < 4)
        throw new Error("Password must be at least 4 characters");
      if (password !== confirm) throw new Error("Passwords do not match");

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

  function logout() {
    leaveSession(true);
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

  // -------------------- Sessions --------------------
  async function createSession(name, password) {
    const id = uid(6);
    const hash = await sha256(password);

    if (S.demo) {
      Demo.sessions[id] = {
        id,
        name,
        password: hash,
        created_at: new Date().toISOString(),
        data: {
          sections: [],
          texts: {},
          messages: [],
          todos: [],
          files: [],
          versions: {},
          board: null,
        },
      };
      // Default section
      const secId = uuid();
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
      return { id, name };
    }

    const { error } = await S.sb
      .from("sessions")
      .insert({ id, name, password: hash });
    if (error) throw error;

    // Default section + text row
    const { data: section, error: sErr } = await S.sb
      .from("sections")
      .insert({ session_id: id, name: "Main", sort_order: 0 })
      .select()
      .single();
    if (sErr) throw sErr;
    await S.sb
      .from("texts")
      .insert({ section_id: section.id, session_id: id, content: "" });
    return { id, name };
  }

  async function joinSession(id, password) {
    id = id.toUpperCase().trim();
    const hash = await sha256(password);

    if (S.demo) {
      const sess = Demo.sessions[id];
      if (!sess) throw new Error("Session not found");
      if (sess.password !== hash) throw new Error("Incorrect session password");
      return { id: sess.id, name: sess.name };
    }

    const { data, error } = await S.sb
      .from("sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Session not found");
    if (data.password !== hash) throw new Error("Incorrect session password");
    return { id: data.id, name: data.name };
  }

  async function deleteSession() {
    if (!S.session) return;
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
      toast("Session deleted", "success");
      leaveSession(true);
    } catch (err) {
      toast(err.message || "Failed to delete session", "error");
    } finally {
      setLoading(false);
    }
  }

  async function enterSession(session) {
    S.session = session;
    setLoading(true, "Joining workspace…");
    try {
      await loadSessionData();
      setupRealtime();
      startSessionTimer();
      renderDashboardShell();
      showView("dashboard");
      switchPanel("editor");
      toast(`Joined ${session.name}`, "success");
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to join session", "error");
      S.session = null;
    } finally {
      setLoading(false);
    }
  }

  function leaveSession(silent = false) {
    stopSessionTimer();
    teardownRealtime();
    // Save editor before leave
    if (S.activeSectionId) {
      const html = $("#editor")?.innerHTML || "";
      saveTextImmediate(S.activeSectionId, html);
    }
    S.session = null;
    S.sections = [];
    S.activeSectionId = null;
    S.texts = {};
    S.files = [];
    S.todos = [];
    S.messages = [];
    S.unreadChat = 0;
    if (!silent && S.user) {
      enterHub();
      toast("Left session", "info");
    }
  }

  function renderDashboardShell() {
    $("#session-id-label").textContent = S.session.id;
    $("#session-name-label").textContent = S.session.name;
    const av = $("#dash-avatar");
    av.textContent = initials(S.user.name);
    av.style.background = avatarColor(S.user.user_id);
    renderSections();
    renderChat();
    renderTasks();
    renderFiles();
    setConn(S.demo || S.connected ? "online" : "offline");
  }

  async function loadSessionData() {
    if (S.demo) {
      const data = Demo.getSessionData(S.session.id);
      S.sections = [...(data.sections || [])].sort(
        (a, b) => a.sort_order - b.sort_order,
      );
      S.texts = { ...(data.texts || {}) };
      S.messages = [...(data.messages || [])];
      S.todos = [...(data.todos || [])];
      S.files = [...(data.files || [])];
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
      // restore whiteboard
      if (data.board) {
        setTimeout(() => restoreBoard(data.board), 100);
      }
      return;
    }

    const sid = S.session.id;
    const [secRes, textRes, chatRes, todoRes, fileRes] = await Promise.all([
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
      S.texts[t.section_id] = t;
    });
    S.messages = chatRes.data || [];
    S.todos = todoRes.data || [];
    S.files = fileRes.data || [];
    S.activeSectionId = S.sections[0].id;
    loadEditorContent(S.activeSectionId);
  }

  // -------------------- Realtime --------------------
  function setupRealtime() {
    teardownRealtime();
    if (S.demo || !S.sb) {
      // Demo: poll localStorage lightly for multi-tab
      S.channel = setInterval(() => {
        try {
          const data = Demo.getSessionData(S.session?.id);
          if (!data) return;
          // lightweight sync of messages / todos / files counts
          if (data.messages.length !== S.messages.length) {
            S.messages = [...data.messages];
            if (S.activePanel !== "chat") {
              S.unreadChat = Math.max(S.unreadChat, 1);
              updateChatBadge();
            }
            renderChat();
          }
          if (JSON.stringify(data.todos) !== JSON.stringify(S.todos)) {
            S.todos = [...data.todos];
            renderTasks();
          }
          if (data.files.length !== S.files.length) {
            S.files = [...data.files];
            renderFiles();
          }
        } catch {
          /* ignore */
        }
      }, 1000);
      setConn("online");
      return;
    }

    const sid = S.session.id;
    const ch = S.sb.channel(`session:${sid}`, {
      config: { broadcast: { self: false }, presence: { key: S.user.user_id } },
    });

    ch.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter: `session_id=eq.${sid}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          S.messages.push(payload.new);
          if (S.activePanel !== "chat") {
            S.unreadChat += 1;
            updateChatBadge();
          }
          renderChat(true);
        }
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
          S.todos.push(payload.new);
        } else if (payload.eventType === "UPDATE") {
          const i = S.todos.findIndex((t) => t.id === payload.new.id);
          if (i >= 0) S.todos[i] = payload.new;
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
          if (S.activeSectionId === payload.old.id && S.sections[0]) {
            selectSection(S.sections[0].id);
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
        S.texts[row.section_id] = row;
        if (row.section_id === S.activeSectionId) {
          const ed = $("#editor");
          if (ed && document.activeElement !== ed) {
            ed.innerHTML = row.content || "";
          } else if (ed && ed.innerHTML !== row.content) {
            // soft update indicator
            setSaveStatus("Remote update");
            setTimeout(() => setSaveStatus("saved"), 1500);
          }
        }
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
      applyRemoteStroke(payload);
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") setConn("online");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        setConn("offline");
      else setConn("connecting");
    });

    S.channel = ch;
  }

  function teardownRealtime() {
    if (!S.channel) return;
    if (S.demo) {
      clearInterval(S.channel);
    } else if (S.sb) {
      try {
        S.sb.removeChannel(S.channel);
      } catch {
        /* */
      }
    }
    S.channel = null;
  }

  function broadcast(event, payload) {
    if (S.demo || !S.channel || typeof S.channel.send !== "function") return;
    S.channel.send({
      type: "broadcast",
      event,
      payload: { ...payload, user_id: S.user.user_id, user_name: S.user.name },
    });
  }

  function updateTypingUI() {
    const ed = $("#typing-indicator");
    const chat = $("#chat-typing");
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

  // -------------------- Timer (30 min session) --------------------
  function startSessionTimer() {
    stopSessionTimer();
    S.timerEndsAt = Date.now() + 30 * 60 * 1000;
    const el = $("#session-timer");
    const tick = () => {
      const left = Math.max(0, S.timerEndsAt - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (left <= 0) {
        stopSessionTimer();
        toast(
          "Session timer ended — you can stay, or leave anytime",
          "info",
          5000,
        );
        el.textContent = "00:00";
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
    list.innerHTML = "";
    S.sections.forEach((sec) => {
      const li = document.createElement("li");
      li.className = `section-item${sec.id === S.activeSectionId ? " active" : ""}`;
      li.dataset.id = sec.id;
      li.innerHTML = `
        <span class="sec-name"></span>
        <button class="sec-del" title="Delete section" type="button"><i class="fa-solid fa-xmark"></i></button>
      `;
      li.querySelector(".sec-name").textContent = sec.name;
      li.addEventListener("click", (e) => {
        if (e.target.closest(".sec-del")) return;
        selectSection(sec.id);
      });
      li.querySelector(".sec-del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSection(sec.id);
      });
      list.appendChild(li);
    });
    const active = S.sections.find((s) => s.id === S.activeSectionId);
    $("#editor-section-name").textContent = active?.name || "Untitled";
  }

  async function selectSection(id) {
    if (id === S.activeSectionId) return;
    // auto-save current
    if (S.activeSectionId) {
      await saveTextImmediate(S.activeSectionId, $("#editor").innerHTML);
    }
    S.activeSectionId = id;
    loadEditorContent(id);
    renderSections();
  }

  function loadEditorContent(sectionId) {
    const row = S.texts[sectionId];
    const ed = $("#editor");
    ed.innerHTML = row?.content || "";
    setSaveStatus("saved");
  }

  function scheduleSave() {
    setSaveStatus("saving");
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(() => {
      if (S.activeSectionId)
        saveTextImmediate(S.activeSectionId, $("#editor").innerHTML);
    }, 800);
    // typing broadcast
    broadcast("typing", { where: "editor" });
  }

  async function saveTextImmediate(sectionId, content) {
    try {
      const now = new Date().toISOString();
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        if (!data.texts[sectionId]) {
          data.texts[sectionId] = {
            id: uuid(),
            section_id: sectionId,
            session_id: S.session.id,
            content: "",
            updated_at: now,
          };
        }
        // version snapshot occasionally
        const prev = data.texts[sectionId].content;
        if (prev && prev !== content) {
          if (!data.versions[sectionId]) data.versions[sectionId] = [];
          data.versions[sectionId].unshift({
            id: uuid(),
            section_id: sectionId,
            content: prev,
            created_at: now,
          });
          data.versions[sectionId] = data.versions[sectionId].slice(0, 20);
        }
        data.texts[sectionId].content = content;
        data.texts[sectionId].updated_at = now;
        S.texts[sectionId] = data.texts[sectionId];
        Demo.persist();
        setSaveStatus("saved");
        return;
      }

      const existing = S.texts[sectionId];
      if (existing?.id) {
        // version
        if (existing.content && existing.content !== content) {
          await S.sb
            .from("text_versions")
            .insert({ section_id: sectionId, content: existing.content });
        }
        const { data, error } = await S.sb
          .from("texts")
          .update({ content, updated_at: now })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        S.texts[sectionId] = data;
      } else {
        const { data, error } = await S.sb
          .from("texts")
          .insert({ section_id: sectionId, session_id: S.session.id, content })
          .select()
          .single();
        if (error) throw error;
        S.texts[sectionId] = data;
      }
      setSaveStatus("saved");
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
    }
  }

  async function addSection() {
    const name = prompt("Section name:", "Untitled");
    if (name === null) return;
    const clean = (name || "Untitled").trim().slice(0, 48) || "Untitled";
    const sort_order = S.sections.length
      ? Math.max(...S.sections.map((s) => s.sort_order)) + 1
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
      S.sections.push(sec);
      S.texts[sec.id] = { section_id: sec.id, content: "" };
      await selectSection(sec.id);
      toast("Section added", "success");
    } catch (err) {
      toast(err.message || "Could not add section", "error");
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
        S.activeSectionId = S.sections[0].id;
        loadEditorContent(S.activeSectionId);
      }
      renderSections();
      toast("Section deleted", "success");
    } catch (err) {
      toast(err.message || "Delete failed", "error");
    }
  }

  async function openHistory() {
    const sectionId = S.activeSectionId;
    const list = $("#history-list");
    list.innerHTML = '<li class="history-item">Loading…</li>';
    $("#history-modal").hidden = false;

    let versions = [];
    try {
      if (S.demo) {
        versions = Demo.getSessionData(S.session.id).versions[sectionId] || [];
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
        $("#editor").innerHTML = v.content || "";
        await saveTextImmediate(sectionId, v.content || "");
        $("#history-modal").hidden = true;
        toast("Version restored", "success");
      });
      list.appendChild(li);
    });
  }

  // -------------------- Chat --------------------
  function updateChatBadge() {
    const badge = $("#chat-badge");
    if (S.unreadChat > 0) {
      badge.hidden = false;
      badge.textContent = S.unreadChat > 99 ? "99+" : String(S.unreadChat);
    } else {
      badge.hidden = true;
    }
  }

  function renderChat(stickBottom = false) {
    const box = $("#chat-messages");
    const empty = $("#chat-empty");
    const wasNearBottom =
      stickBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80;

    // clear except empty
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
      const mine =
        msg.user_name === S.user.name || msg.user_name === S.user.user_id;
      const row = document.createElement("div");
      row.className = `chat-msg${mine ? " mine" : ""}`;
      const avStyle = avatarColor(msg.user_name);
      row.innerHTML = `
        <div class="msg-avatar" style="background:${avStyle}">${escapeHtml(initials(msg.user_name))}</div>
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
    const input = $("#chat-input");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";

    const row = {
      id: uuid(),
      session_id: S.session.id,
      user_name: S.user.name,
      message,
      created_at: new Date().toISOString(),
    };

    try {
      if (S.demo) {
        const data = Demo.getSessionData(S.session.id);
        data.messages.push(row);
        Demo.persist();
        S.messages.push(row);
        renderChat(true);
        return;
      }
      const { data, error } = await S.sb
        .from("chat_messages")
        .insert({
          session_id: S.session.id,
          user_name: S.user.name,
          message,
        })
        .select()
        .single();
      if (error) throw error;
      // realtime will also deliver; avoid dup if already present
      if (!S.messages.find((m) => m.id === data.id)) {
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

    S.todos.forEach((t) => {
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

  function resizeWhiteboard() {
    const canvas = getCanvas();
    if (!canvas) return;
    const stage = canvas.parentElement;
    if (!stage || stage.clientWidth === 0) return;

    // preserve content
    const prev = document.createElement("canvas");
    prev.width = canvas.width;
    prev.height = canvas.height;
    prev.getContext("2d").drawImage(canvas, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.wb.dpr = dpr;
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

    // restore scaled
    if (prev.width && prev.height) {
      ctx.drawImage(
        prev,
        0,
        0,
        prev.width / (S.wb.dpr || dpr),
        prev.height / (S.wb.dpr || dpr),
      );
    }
  }

  function restoreBoard(dataUrl) {
    const canvas = getCanvas();
    if (!canvas || !dataUrl) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      ctx.setTransform(S.wb.dpr, 0, 0, S.wb.dpr, 0, 0);
      ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
    };
    img.src = dataUrl;
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
    const ctx = canvas.getContext("2d");
    ctx.setTransform(S.wb.dpr, 0, 0, S.wb.dpr, 0, 0);
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

  function persistBoard() {
    if (!S.session) return;
    const canvas = getCanvas();
    try {
      const url = canvas.toDataURL("image/png");
      if (S.demo) {
        Demo.getSessionData(S.session.id).board = url;
        Demo.persist();
      }
      // For Supabase, board is local/broadcast only (no dedicated table in schema)
    } catch {
      /* ignore security errors */
    }
  }

  function setupWhiteboardEvents() {
    const canvas = getCanvas();
    if (!canvas || canvas._ssBound) return;
    canvas._ssBound = true;

    const start = (e) => {
      e.preventDefault();
      S.wb.drawing = true;
      S.wb.last = canvasPos(e);
    };
    const move = (e) => {
      if (!S.wb.drawing) return;
      e.preventDefault();
      const pos = canvasPos(e);
      const color = $("#wb-color").value;
      const size = Number($("#wb-size").value) || 4;
      const erase = S.wb.tool === "eraser";
      drawLine(S.wb.last, pos, color, size, erase);
      broadcast("whiteboard", { from: S.wb.last, to: pos, color, size, erase });
      S.wb.last = pos;
    };
    const end = () => {
      if (S.wb.drawing) persistBoard();
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

  // -------------------- Files --------------------
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
  const MAX_BYTES = 2 * 1024 * 1024;

  function getFileIcon(type, name = "") {
    if (type.startsWith("image/"))
      return { icon: "fa-file-image", color: "#00cec9" };
    if (type === "application/pdf" || name.endsWith(".pdf"))
      return { icon: "fa-file-pdf", color: "#ff6b6b" };
    if (type.includes("word") || /\.docx?$/i.test(name))
      return { icon: "fa-file-word", color: "#74b9ff" };
    if (
      type.includes("excel") ||
      type.includes("sheet") ||
      /\.xlsx?$/i.test(name)
    )
      return { icon: "fa-file-excel", color: "#55efc4" };
    if (type.startsWith("text/") || name.endsWith(".txt"))
      return { icon: "fa-file-lines", color: "#a29bfe" };
    return { icon: "fa-file", color: "#dfe6e9" };
  }

  function renderFiles() {
    const grid = $("#files-grid");
    const empty = $("#files-empty");
    grid.innerHTML = "";
    if (!S.files.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    S.files.forEach((file) => {
      const card = document.createElement("article");
      card.className = "file-card";
      const meta = getFileIcon(file.file_type, file.file_name);
      const isImg = file.file_type.startsWith("image/");
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
      card.querySelector(".file-name").textContent = file.file_name;
      card.querySelector(".file-name").title = file.file_name;
      card.querySelector(".file-size").textContent = formatBytes(
        file.file_size,
      );
      const preview = card.querySelector(".file-preview");
      if (isImg && file.file_data) {
        const img = document.createElement("img");
        img.src = file.file_data;
        img.alt = file.file_name;
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
    if (!file.type.startsWith("image/") || file.size < 600 * 1024)
      return dataUrl;
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
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setLoading(true, "Uploading…");
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          toast(`${file.name} exceeds 2MB`, "error");
          continue;
        }
        // allow by extension fallback
        const okType =
          ALLOWED.has(file.type) ||
          /\.(jpe?g|png|gif|webp|pdf|txt|docx?|xlsx?)$/i.test(file.name);
        if (!okType) {
          toast(`${file.name}: unsupported type`, "error");
          continue;
        }
        let dataUrl = await readFileAsDataURL(file);
        dataUrl = await compressImageIfNeeded(file, dataUrl);
        // approximate size after compress
        const approxSize = Math.ceil((dataUrl.length * 3) / 4);

        const row = {
          id: uuid(),
          session_id: S.session.id,
          section_id: S.activeSectionId,
          file_name: file.name,
          file_data: dataUrl,
          file_type: file.type || "application/octet-stream",
          file_size: Math.min(file.size, approxSize),
          created_at: new Date().toISOString(),
        };

        if (S.demo) {
          Demo.getSessionData(S.session.id).files.unshift(row);
          Demo.persist();
          S.files.unshift(row);
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
          if (!S.files.find((f) => f.id === data.id)) S.files.unshift(data);
        }
      }
      renderFiles();
      toast("Upload complete", "success");
    } catch (err) {
      toast(err.message || "Upload failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function downloadFile(fileId) {
    const file = S.files.find((f) => f.id === fileId);
    if (!file) {
      toast("File not found", "error");
      return;
    }
    try {
      toast(`Downloading ${file.file_name}…`, "info", 1800);
      let dataUrl = file.file_data;
      if (!dataUrl.includes(",")) {
        dataUrl = `data:${file.file_type};base64,${dataUrl}`;
      }
      const base64 = dataUrl.split(",")[1];
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: file.file_type || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.file_name || "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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

  // -------------------- Panels / Nav --------------------
  function switchPanel(name) {
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
        resizeWhiteboard();
        setupWhiteboardEvents();
      });
    }

    // close mobile sidebar
    $("#sidebar")?.classList.remove("open");
  }

  // -------------------- Global events --------------------
  function bindEvents() {
    // data-action clicks
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
        showSignup($("#login-userid").value.trim());
      } else if (action === "show-login") {
        showLogin();
      } else if (action === "logout") {
        logout();
      } else if (action === "leave-session") {
        leaveSession();
      }
    });

    // nav toggle mobile landing
    $("#nav-toggle")?.addEventListener("click", () => {
      $(".nav-links")?.classList.toggle("open");
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
        await navigator.clipboard.writeText(S.session.id);
        toast("Session ID copied", "success");
      } catch {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = S.session.id;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("Session ID copied", "success");
      }
    });

    $("#delete-session-btn")?.addEventListener("click", deleteSession);
    $("#add-section-btn")?.addEventListener("click", addSection);
    $("#sidebar-toggle")?.addEventListener("click", () =>
      $("#sidebar").classList.toggle("open"),
    );

    // panel nav
    document.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-panel]");
      if (!nav) return;
      switchPanel(nav.dataset.panel);
    });

    // editor toolbar
    $$(".editor-toolbar .tool-btn[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        const val = btn.dataset.val;
        if (cmd === "formatBlock") {
          document.execCommand("formatBlock", false, val);
        } else {
          document.execCommand(cmd, false, null);
        }
        $("#editor").focus();
        scheduleSave();
      });
    });

    $("#editor")?.addEventListener("input", scheduleSave);
    $("#history-btn")?.addEventListener("click", openHistory);
    $$("[data-close]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.close;
        $(`#${id}`).hidden = true;
      });
    });
    $("#history-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "history-modal") e.target.hidden = true;
    });

    // chat
    $("#form-chat")?.addEventListener("submit", sendChat);
    $("#chat-input")?.addEventListener("input", () => {
      broadcast("typing", { where: "chat" });
    });

    // tasks
    $("#form-task")?.addEventListener("submit", addTodo);

    // whiteboard tools
    $$("[data-wb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("[data-wb]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        S.wb.tool = btn.dataset.wb;
      });
    });
    $("#wb-clear")?.addEventListener("click", () => {
      if (!confirm("Clear the whiteboard?")) return;
      const canvas = getCanvas();
      const ctx = canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(S.wb.dpr, 0, 0, S.wb.dpr, 0, 0);
      persistBoard();
      toast("Whiteboard cleared", "info");
    });

    // files
    const dz = $("#dropzone");
    const fi = $("#file-input");
    dz?.addEventListener("click", () => fi.click());
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
    dz?.addEventListener("drop", (e) => {
      handleFiles(e.dataTransfer.files);
    });

    // resize
    window.addEventListener("resize", () => {
      if (S.activePanel === "whiteboard") resizeWhiteboard();
    });

    // mobile keyboard / visualViewport
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

    // before unload save
    window.addEventListener("beforeunload", () => {
      if (S.session && S.activeSectionId) {
        const html = $("#editor")?.innerHTML || "";
        // best-effort sync for demo
        if (S.demo) {
          try {
            const data = Demo.getSessionData(S.session.id);
            if (data.texts[S.activeSectionId]) {
              data.texts[S.activeSectionId].content = html;
              Demo.persist();
            }
          } catch {
            /* */
          }
        }
      }
    });

    // global errors
    window.addEventListener("error", () => {
      /* swallow UI crashes — toast only for user-facing ops */
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
        // re-validate lightly
        try {
          const user = await findUser(saved.user_id);
          if (user) {
            S.user = {
              user_id: user.user_id,
              name: user.name,
              role: user.role || "member",
            };
            persistUserSession();
            enterHub();
          } else {
            showView("landing");
          }
        } catch {
          showView("landing");
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

    // PWA
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
