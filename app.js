/* ================================================================
   SyncSpace — Complete App Logic (Direct Supabase, No API Routes)
   ================================================================ */

// ==================== STATE ====================
const S = {
  user: null,
  session: null,
  sessionPassword: "",
  sections: [],
  activeSection: null,
  activeTab: "editor",
  theme: "dark",
  connected: false,
  chatMessages: [],
  todos: [],
  files: [],
  unreadChat: 0,
  lastActivity: Date.now(),
  saveTimer: null,
  wbDrawing: false,
  wbTool: "pen",
  wbColor: "#6c5ce7",
  wbSize: 3,
};

let db = null;
let channels = [];
const AVATAR_COLORS = [
  "#6c5ce7",
  "#00cec9",
  "#e17055",
  "#00b894",
  "#fdcb6e",
  "#e84393",
  "#0984e3",
  "#d63031",
  "#636e72",
  "#a29bfe",
];

// ==================== UTILITIES ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const genId = (len = 6) => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)];
  return r;
};
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const getInitials = (name) =>
  name
    .split(/[\s_\-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
const getAvatarColor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};
const formatTime = (ts) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const formatDate = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString();
};
const escHtml = (str) => {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
};

// Password hashing (client-side SHA-256)
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ==================== TOAST ====================
function showToast(msg, type = "info") {
  const icons = {
    success: "fa-check-circle",
    error: "fa-exclamation-circle",
    warning: "fa-exclamation-triangle",
    info: "fa-info-circle",
  };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${msg}</span>`;
  $("#toastContainer").appendChild(toast);
  setTimeout(() => {
    toast.classList.add("out");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==================== THEME ====================
function initTheme() {
  S.theme = localStorage.getItem("ss_theme") || "dark";
  applyTheme();
}
function applyTheme() {
  document.documentElement.setAttribute("data-theme", S.theme);
  const icon = $("#themeIcon");
  if (icon) icon.className = S.theme === "dark" ? "fas fa-moon" : "fas fa-sun";
  localStorage.setItem("ss_theme", S.theme);
}
function toggleTheme() {
  S.theme = S.theme === "dark" ? "light" : "dark";
  applyTheme();
}

// ==================== NAVIGATION ====================
function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
  const dash = document.getElementById("dashboard");
  if (id === "dashboard") dash.classList.add("active");
  else dash.classList.remove("active");
}

function switchTab(tab) {
  S.activeTab = tab;
  $$(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab),
  );
  $$(".bnav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab),
  );
  $$(".tab-panel").forEach((p) => p.classList.remove("active"));
  const panel = $(`#${tab}Panel`);
  if (panel) panel.classList.add("active");
  if (tab === "chat") {
    S.unreadChat = 0;
    updateChatBadge();
    scrollChatBottom();
  }
  if (tab === "whiteboard") resizeCanvas();
}

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebarOverlay").classList.add("active");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarOverlay").classList.remove("active");
}

function updateConnectionStatus(status) {
  const dot = $("#statusDot");
  const text = $("#statusText");
  dot.className = "status-dot " + status;
  const labels = {
    connected: "Connected",
    reconnecting: "Reconnecting",
    disconnected: "Disconnected",
  };
  text.textContent = labels[status] || status;
  S.connected = status === "connected";
}

// ==================== LOADING STEPS ====================
function setLoaderStep(stepName, status = "active") {
  const steps = $$(".loader-step");
  const targetStep = document.querySelector(
    `.loader-step[data-step="${stepName}"]`,
  );
  if (!targetStep) return;

  const allSteps = Array.from(steps);
  const idx = allSteps.indexOf(targetStep);

  allSteps.forEach((step, i) => {
    step.classList.remove("active", "done", "pending", "error");
    if (i < idx) {
      step.classList.add("done");
      step.querySelector(".step-icon").innerHTML =
        '<i class="fas fa-check-circle"></i>';
    } else if (i === idx) {
      step.classList.add(status);
      if (status === "active") {
        step.querySelector(".step-icon").innerHTML =
          '<i class="fas fa-circle-notch fa-spin"></i>';
      } else if (status === "done") {
        step.querySelector(".step-icon").innerHTML =
          '<i class="fas fa-check-circle"></i>';
      } else if (status === "error") {
        step.querySelector(".step-icon").innerHTML =
          '<i class="fas fa-times-circle"></i>';
      }
    } else {
      step.classList.add("pending");
      step.querySelector(".step-icon").innerHTML =
        '<i class="fas fa-circle" style="font-size:6px"></i>';
    }
  });
}

function showLoaderError(msg) {
  const el = $("#loaderError");
  $("#loaderErrorMsg").textContent = msg;
  el.classList.remove("hidden");
}

function hideLoader() {
  $("#loadingScreen").classList.add("hidden");
}

function showLoader() {
  $$(".loader-step").forEach((step) => {
    step.classList.remove("active", "done", "error");
    step.classList.add("pending");
    step.querySelector(".step-icon").innerHTML =
      '<i class="fas fa-circle" style="font-size:6px"></i>';
  });
  $("#loaderError").classList.add("hidden");
  $("#loadingScreen").classList.remove("hidden");
  setLoaderStep("init", "active");
}

const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ==================== AUTH (Direct Supabase) ====================
async function handleLogin(e) {
  e.preventDefault();
  const userId = $("#loginUserId").value.trim();
  const password = $("#loginPassword").value;
  const errorEl = $("#loginError");
  errorEl.classList.add("hidden");

  if (userId.length < 2)
    return showToast("User ID must be at least 2 characters", "warning");
  if (password.length < 6)
    return showToast("Password must be at least 6 characters", "warning");

  const btn = $("#loginBtn");
  btn.disabled = true;
  btn.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> <span>Checking...</span>';

  try {
    const { data: user, error } = await db
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      errorEl.textContent =
        "No account found with this User ID. Please create one.";
      errorEl.classList.remove("hidden");
      showSignupForm(userId);
      btn.disabled = false;
      btn.innerHTML = '<span>Login</span> <i class="fas fa-arrow-right"></i>';
      return;
    }

    const hashedInput = await hashPassword(password);
    if (hashedInput !== user.password) {
      errorEl.textContent = "Incorrect password. Try again.";
      errorEl.classList.remove("hidden");
      btn.disabled = false;
      btn.innerHTML = '<span>Login</span> <i class="fas fa-arrow-right"></i>';
      return;
    }

    S.user = { name: user.name, userId: user.user_id, role: user.role };
    localStorage.setItem("ss_user", JSON.stringify(S.user));
    $("#sessionUserName").textContent = S.user.name;
    showScreen("sessionScreen");
    showToast("Welcome back, " + S.user.name + "!", "success");
  } catch (err) {
    errorEl.textContent = err.message || "Login failed. Check your connection.";
    errorEl.classList.remove("hidden");
    showToast("Login failed", "error");
  }

  btn.disabled = false;
  btn.innerHTML = '<span>Login</span> <i class="fas fa-arrow-right"></i>';
}

async function handleSignup(e) {
  e.preventDefault();
  const name = $("#signupName").value.trim();
  const userId = $("#signupUserId").value.trim();
  const password = $("#signupPassword").value;
  const confirm = $("#signupConfirm").value;
  const errorEl = $("#signupError");
  errorEl.classList.add("hidden");

  if (name.length < 2)
    return showToast("Name must be at least 2 characters", "warning");
  if (userId.length < 2)
    return showToast("User ID must be at least 2 characters", "warning");
  if (password.length < 6)
    return showToast("Password must be at least 6 characters", "warning");
  if (password !== confirm) {
    errorEl.textContent = "Passwords do not match.";
    errorEl.classList.remove("hidden");
    return;
  }

  const btn = $("#signupBtn");
  btn.disabled = true;
  btn.innerHTML =
    '<i class="fas fa-spinner fa-spin"></i> <span>Creating account...</span>';

  try {
    const hashedPassword = await hashPassword(password);

    const { data: newUser, error } = await db
      .from("users")
      .insert({
        user_id: userId,
        name: name,
        password: hashedPassword,
        role: "member",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        errorEl.textContent =
          "This User ID is already taken. Try a different one.";
        errorEl.classList.remove("hidden");
        btn.disabled = false;
        btn.innerHTML =
          '<span>Create Account</span> <i class="fas fa-check"></i>';
        return;
      }
      throw error;
    }

    S.user = {
      name: newUser.name,
      userId: newUser.user_id,
      role: newUser.role,
    };
    localStorage.setItem("ss_user", JSON.stringify(S.user));
    $("#sessionUserName").textContent = S.user.name;
    showScreen("sessionScreen");
    showToast("Account created! Welcome, " + S.user.name + "!", "success");
  } catch (err) {
    errorEl.textContent = err.message || "Failed to create account.";
    errorEl.classList.remove("hidden");
    showToast("Signup failed", "error");
  }

  btn.disabled = false;
  btn.innerHTML = '<span>Create Account</span> <i class="fas fa-check"></i>';
}

function showSignupForm(userId) {
  $("#loginForm").classList.add("hidden");
  $("#signupForm").classList.remove("hidden");
  $("#signupUserId").value = userId || "";
  $("#signupName").focus();
}

function showLoginForm() {
  $("#signupForm").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  $("#signupError").classList.add("hidden");
  $("#loginError").classList.add("hidden");
  $("#loginPassword").value = "";
  $("#loginPassword").focus();
}

function handleLogout() {
  S.user = null;
  S.session = null;
  localStorage.removeItem("ss_user");
  localStorage.removeItem("ss_session");
  localStorage.removeItem("ss_session_pw");
  cleanupRealtime();
  showLoginForm();
  showScreen("authScreen");
  showToast("Logged out successfully", "info");
}

// ==================== SESSIONS (Direct Supabase) ====================
async function handleCreateSession(e) {
  e.preventDefault();
  const name = $("#createName").value.trim();
  const password = $("#createPassword").value;
  if (!name) return showToast("Please enter a session name", "warning");
  if (password.length < 4)
    return showToast(
      "Session password must be at least 4 characters",
      "warning",
    );

  try {
    let sessionId;
    for (let attempt = 0; attempt < 10; attempt++) {
      sessionId = genId(6);
      const { data: existing } = await db
        .from("sessions")
        .select("id")
        .eq("id", sessionId)
        .maybeSingle();
      if (!existing) break;
    }

    const hashedPassword = await hashPassword(password);

    const { data: session, error } = await db
      .from("sessions")
      .insert({ id: sessionId, name, password: hashedPassword })
      .select()
      .single();

    if (error) throw error;

    await db.from("sections").insert({
      session_id: sessionId,
      name: "Getting Started",
      sort_order: 0,
    });

    S.session = { id: session.id, name: session.name };
    S.sessionPassword = password;
    localStorage.setItem("ss_session", JSON.stringify(S.session));
    localStorage.setItem("ss_session_pw", password);

    await enterDashboard();
    showToast("Session created! Share ID: " + S.session.id, "success");
  } catch (err) {
    showToast(err.message || "Failed to create session", "error");
  }
}

async function handleJoinSession(e) {
  e.preventDefault();
  const id = $("#joinId").value.trim().toUpperCase();
  const password = $("#joinPassword").value;
  if (id.length !== 6)
    return showToast("Session ID must be 6 characters", "warning");

  try {
    const { data: session, error } = await db
      .from("sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!session) return showToast("Session not found", "error");

    const hashedInput = await hashPassword(password);
    if (hashedInput !== session.password)
      return showToast("Incorrect session password", "error");

    S.session = { id: session.id, name: session.name };
    S.sessionPassword = password;
    localStorage.setItem("ss_session", JSON.stringify(S.session));
    localStorage.setItem("ss_session_pw", password);

    await enterDashboard();
    showToast("Joined session successfully!", "success");
  } catch (err) {
    showToast(err.message || "Failed to join session", "error");
  }
}

async function leaveSession() {
  cleanupRealtime();
  S.session = null;
  S.sections = [];
  S.activeSection = null;
  S.chatMessages = [];
  S.todos = [];
  S.files = [];
  localStorage.removeItem("ss_session");
  localStorage.removeItem("ss_session_pw");
  showScreen("sessionScreen");
  showToast("Left the session", "info");
}

// ==================== DASHBOARD ENTRY ====================
async function enterDashboard() {
  showScreen("dashboard");
  $("#sidebarAvatar").textContent = getInitials(S.user.name);
  $("#sidebarAvatar").style.background =
    `linear-gradient(135deg, ${getAvatarColor(S.user.name)}, var(--secondary))`;
  $("#sidebarUserName").textContent = S.user.name;
  $("#sidebarSessionId").textContent = "ID: " + S.session.id;
  S.lastActivity = Date.now();

  await Promise.all([loadSections(), loadChat(), loadTodos(), loadFiles()]);
  setupRealtime();
  initWhiteboard();
  switchTab("editor");
}

// ==================== SECTIONS ====================
async function loadSections() {
  try {
    const { data, error } = await db
      .from("sections")
      .select("*")
      .eq("session_id", S.session.id)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    S.sections = data || [];
    renderSections();
    if (S.sections.length > 0 && !S.activeSection) {
      selectSection(S.sections[0].id);
    }
  } catch (err) {
    console.error("Load sections error:", err);
  }
}

function renderSections(filter = "") {
  const list = $("#sectionsList");
  const filtered = filter
    ? S.sections.filter((s) =>
        s.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : S.sections;
  list.innerHTML = filtered
    .map(
      (s) => `
    <div class="section-item ${s.id === S.activeSection ? "active" : ""}" data-id="${s.id}" draggable="true">
      <i class="fas fa-file-lines" style="font-size:13px;opacity:.5"></i>
      <span class="section-name">${escHtml(s.name)}</span>
      <button class="section-delete" data-delete="${s.id}" title="Delete section"><i class="fas fa-xmark"></i></button>
    </div>
  `,
    )
    .join("");

  list.querySelectorAll(".section-item").forEach((el) => {
    el.addEventListener("dragstart", onSectionDragStart);
    el.addEventListener("dragend", onSectionDragEnd);
    el.addEventListener("dragover", onSectionDragOver);
    el.addEventListener("dragleave", onSectionDragLeave);
    el.addEventListener("drop", onSectionDrop);
  });
}

async function createSection() {
  const name = "Section " + (S.sections.length + 1);
  try {
    const { data, error } = await db
      .from("sections")
      .insert({
        session_id: S.session.id,
        name,
        sort_order: S.sections.length,
      })
      .select()
      .single();
    if (error) throw error;
    S.sections.push(data);
    renderSections();
    selectSection(data.id);
    showToast("Section created", "success");
  } catch (err) {
    showToast("Failed to create section", "error");
  }
}

async function deleteSection(id) {
  if (S.sections.length <= 1)
    return showToast("Cannot delete the last section", "warning");
  try {
    await db.from("sections").delete().eq("id", id);
    await db.from("texts").delete().eq("section_id", id);
    await db.from("files").delete().eq("section_id", id);
    S.sections = S.sections.filter((s) => s.id !== id);
    if (S.activeSection === id) selectSection(S.sections[0].id);
    renderSections();
    showToast("Section deleted", "info");
  } catch (err) {
    showToast("Failed to delete section", "error");
  }
}

async function selectSection(id) {
  S.activeSection = id;
  const section = S.sections.find((s) => s.id === id);
  $("#activeSectionName").textContent = section
    ? section.name
    : "Select a section";
  renderSections($("#sectionSearch").value);
  await loadEditorContent();
  await loadFiles();
}

let dragSectionId = null;
function onSectionDragStart(e) {
  dragSectionId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}
function onSectionDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  dragSectionId = null;
  $$(".section-item").forEach((el) => el.classList.remove("drag-over"));
}
function onSectionDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
}
function onSectionDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}
async function onSectionDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  if (!dragSectionId) return;
  const targetId = e.currentTarget.dataset.id;
  if (dragSectionId === targetId) return;
  const fromIdx = S.sections.findIndex((s) => s.id === dragSectionId);
  const toIdx = S.sections.findIndex((s) => s.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = S.sections.splice(fromIdx, 1);
  S.sections.splice(toIdx, 0, moved);
  for (let i = 0; i < S.sections.length; i++) {
    await db
      .from("sections")
      .update({ sort_order: i })
      .eq("id", S.sections[i].id);
  }
  renderSections($("#sectionSearch").value);
}

// ==================== EDITOR ====================
async function loadEditorContent() {
  if (!S.activeSection) {
    $("#editorContent").innerHTML = "";
    return;
  }
  try {
    const { data, error } = await db
      .from("texts")
      .select("content")
      .eq("section_id", S.activeSection)
      .eq("session_id", S.session.id)
      .maybeSingle();
    if (error) throw error;
    $("#editorContent").innerHTML = data?.content || "";
    $("#editorSaveStatus").textContent = "Loaded";
  } catch (err) {
    console.error("Load editor error:", err);
  }
}

const saveEditorContent = debounce(async function () {
  if (!S.activeSection) return;
  const content = $("#editorContent").innerHTML;
  try {
    const existing = await db
      .from("texts")
      .select("id")
      .eq("section_id", S.activeSection)
      .eq("session_id", S.session.id)
      .maybeSingle();

    if (existing) {
      await db
        .from("texts")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await db.from("texts").insert({
        section_id: S.activeSection,
        session_id: S.session.id,
        content,
      });
    }
    await db
      .from("text_versions")
      .insert({ section_id: S.activeSection, content });
    $("#editorSaveStatus").textContent = "Saved";
    setTimeout(() => {
      if ($("#editorSaveStatus").textContent === "Saved")
        $("#editorSaveStatus").textContent = "Ready";
    }, 2000);
  } catch (err) {
    console.error("Save error:", err);
    $("#editorSaveStatus").textContent = "Save failed";
  }
}, 800);

function initEditorToolbar() {
  $("#editorToolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !btn.dataset.cmd) return;
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    const val = btn.dataset.value || null;
    if (cmd === "formatBlock" && val) {
      document.execCommand(cmd, false, `<${val}>`);
    } else {
      document.execCommand(cmd, false, val);
    }
    $("#editorContent").focus();
  });
  $("#editorContent").addEventListener("input", () => {
    $("#editorSaveStatus").textContent = "Typing...";
    saveEditorContent();
  });
}

// ==================== FILES ====================
async function loadFiles() {
  if (!S.session) return;
  try {
    let query = db.from("files").select("*").eq("session_id", S.session.id);
    if (S.activeSection) query = query.eq("section_id", S.activeSection);
    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) throw error;
    S.files = data || [];
    renderFiles();
  } catch (err) {
    console.error("Load files error:", err);
  }
}

function renderFiles() {
  const grid = $("#filesGrid");
  if (S.files.length === 0) {
    grid.innerHTML = "";
    return;
  }
  grid.innerHTML = S.files
    .map((f) => {
      const isImage = f.file_type.startsWith("image/");
      let preview = "";
      if (isImage)
        preview = `<img src="${f.file_data}" alt="${escHtml(f.file_name)}" loading="lazy">`;
      else if (f.file_type === "application/pdf")
        preview = `<i class="fas fa-file-pdf" style="color:var(--danger)"></i>`;
      else if (f.file_type === "text/plain")
        preview = `<i class="fas fa-file-lines" style="color:var(--primary)"></i>`;
      else preview = `<i class="fas fa-file" style="color:var(--fg-t)"></i>`;
      const sizeKB = (f.file_size / 1024).toFixed(1);
      return `
      <div class="file-card" data-id="${f.id}">
        <div class="file-preview" ${isImage ? `style="cursor:pointer" onclick="previewFile('${f.id}')"` : ""}>${preview}</div>
        <div class="file-info">
          <div class="file-name" title="${escHtml(f.file_name)}">${escHtml(f.file_name)}</div>
          <div class="file-meta">${sizeKB} KB</div>
        </div>
        <button class="file-delete" onclick="deleteFile('${f.id}')" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    })
    .join("");
}

async function handleFileUpload(files) {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
  ];
  const maxSize = 2 * 1024 * 1024;
  for (const file of files) {
    if (!allowed.includes(file.type)) {
      showToast(`"${file.name}" is not a supported type`, "error");
      continue;
    }
    if (file.size > maxSize) {
      showToast(`"${file.name}" exceeds 2MB limit`, "error");
      continue;
    }
    if (!S.activeSection) {
      showToast("Select a section first", "warning");
      return;
    }
    try {
      let fileData = await readFileAsBase64(file);
      if (file.type.startsWith("image/") && file.size > 500 * 1024) {
        fileData = await compressImage(fileData);
      }
      const { error } = await db.from("files").insert({
        session_id: S.session.id,
        section_id: S.activeSection,
        file_name: file.name,
        file_data: fileData,
        file_type: file.type,
        file_size: file.size,
      });
      if (error) throw error;
      showToast(`"${file.name}" uploaded`, "success");
    } catch (err) {
      showToast(`Failed to upload "${file.name}"`, "error");
    }
  }
  await loadFiles();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImage(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxW = 1200,
        maxH = 1200;
      let w = img.width,
        h = img.height;
      if (w > maxW) {
        h = (h * maxW) / w;
        w = maxW;
      }
      if (h > maxH) {
        w = (w * maxH) / h;
        h = maxH;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.src = base64;
  });
}

async function deleteFile(id) {
  try {
    await db.from("files").delete().eq("id", id);
    S.files = S.files.filter((f) => f.id !== id);
    renderFiles();
    showToast("File deleted", "info");
  } catch (err) {
    showToast("Failed to delete file", "error");
  }
}

function previewFile(id) {
  const file = S.files.find((f) => f.id === id);
  if (!file || !file.file_type.startsWith("image/")) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `<img src="${file.file_data}" alt="${escHtml(file.file_name)}"><button class="modal-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
  document.body.appendChild(overlay);
}

function initFileHandlers() {
  const dropzone = $("#fileDropzone");
  const fileInput = $("#fileInput");
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) handleFileUpload(e.target.files);
    fileInput.value = "";
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () =>
    dropzone.classList.remove("dragover"),
  );
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files);
  });
}

// ==================== CHAT ====================
async function loadChat() {
  if (!S.session) return;
  try {
    const { data, error } = await db
      .from("chat_messages")
      .select("*")
      .eq("session_id", S.session.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    S.chatMessages = data || [];
    renderChat();
  } catch (err) {
    console.error("Load chat error:", err);
  }
}

function renderChat() {
  const container = $("#chatMessages");
  const empty = $("#chatEmpty");
  if (S.chatMessages.length === 0) {
    container.innerHTML = "";
    container.appendChild(empty);
    empty.style.display = "flex";
    return;
  }
  empty.style.display = "none";
  let html = "";
  let lastDate = "";
  S.chatMessages.forEach((m) => {
    const dateStr = formatDate(m.created_at);
    if (dateStr !== lastDate) {
      html += `<div style="text-align:center;font-size:11px;color:var(--fg-t);padding:8px 0;font-weight:600">${dateStr}</div>`;
      lastDate = dateStr;
    }
    const isSelf = m.user_name === S.user.name;
    const color = getAvatarColor(m.user_name);
    html += `
      <div class="chat-msg ${isSelf ? "self" : ""}">
        <div class="chat-msg-avatar" style="background:${color}">${getInitials(m.user_name)}</div>
        <div class="chat-msg-body">
          <span class="chat-msg-name">${escHtml(m.user_name)}</span>
          <div class="chat-msg-bubble">${escHtml(m.message)}</div>
          <span class="chat-msg-time">${formatTime(m.created_at)}</span>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  scrollChatBottom();
}

function scrollChatBottom() {
  const c = $("#chatMessages");
  requestAnimationFrame(() => {
    c.scrollTop = c.scrollHeight;
  });
}

async function sendChatMessage() {
  const input = $("#chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  try {
    const { error } = await db.from("chat_messages").insert({
      session_id: S.session.id,
      user_name: S.user.name,
      message: msg,
    });
    if (error) throw error;
  } catch (err) {
    showToast("Failed to send message", "error");
  }
}

function updateChatBadge() {
  [$("#chatBadge"), $("#chatBadgeMobile")].forEach((b) => {
    if (!b) return;
    if (S.unreadChat > 0) {
      b.textContent = S.unreadChat > 99 ? "99+" : S.unreadChat;
      b.classList.remove("hidden");
    } else {
      b.classList.add("hidden");
    }
  });
}

function initChatHandlers() {
  $("#chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  $("#chatSendBtn").addEventListener("click", sendChatMessage);
}

// ==================== TASKS ====================
async function loadTodos() {
  if (!S.session) return;
  try {
    const { data, error } = await db
      .from("todos")
      .select("*")
      .eq("session_id", S.session.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    S.todos = data || [];
    renderTodos();
  } catch (err) {
    console.error("Load todos error:", err);
  }
}

function renderTodos() {
  const total = S.todos.length;
  const done = S.todos.filter((t) => t.completed).length;
  const pending = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  $("#tasksStats").innerHTML = `
    <div class="stat-card total"><div class="stat-num">${total}</div><div class="stat-label">Total</div></div>
    <div class="stat-card done"><div class="stat-num">${done}</div><div class="stat-label">Done</div></div>
    <div class="stat-card pending"><div class="stat-num">${pending}</div><div class="stat-label">Pending</div></div>
  `;
  $("#tasksProgressBar").style.width = pct + "%";

  const list = $("#tasksList");
  if (S.todos.length === 0) {
    list.innerHTML =
      '<div class="tasks-empty"><i class="fas fa-clipboard-list" style="font-size:32px;opacity:.3;margin-bottom:8px;display:block"></i>No tasks yet. Add one above!</div>';
    return;
  }
  list.innerHTML = S.todos
    .map(
      (t) => `
    <div class="task-item ${t.completed ? "completed" : ""}" data-id="${t.id}">
      <div class="task-check" onclick="toggleTodo('${t.id}')">${t.completed ? '<i class="fas fa-check"></i>' : ""}</div>
      <span class="task-text">${escHtml(t.text)}</span>
      <button class="task-delete" onclick="deleteTodo('${t.id}')" title="Delete"><i class="fas fa-trash"></i></button>
    </div>
  `,
    )
    .join("");
}

async function addTodo() {
  const input = $("#taskInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    const { error } = await db
      .from("todos")
      .insert({ session_id: S.session.id, text, completed: false });
    if (error) throw error;
  } catch (err) {
    showToast("Failed to add task", "error");
  }
}

async function toggleTodo(id) {
  const todo = S.todos.find((t) => t.id === id);
  if (!todo) return;
  try {
    const { error } = await db
      .from("todos")
      .update({ completed: !todo.completed })
      .eq("id", id);
    if (error) throw error;
  } catch (err) {
    showToast("Failed to update task", "error");
  }
}

async function deleteTodo(id) {
  try {
    await db.from("todos").delete().eq("id", id);
  } catch (err) {
    showToast("Failed to delete task", "error");
  }
}

function initTaskHandlers() {
  $("#taskInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTodo();
    }
  });
  $("#addTaskBtn").addEventListener("click", addTodo);
}

// ==================== WHITEBOARD ====================
let wbCtx = null;
let wbLastX = 0,
  wbLastY = 0;

function initWhiteboard() {
  const canvas = $("#wbCanvas");
  const container = $("#wbContainer");
  wbCtx = canvas.getContext("2d");
  resizeCanvas();

  function clearCanvas() {
    const bgColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg-t")
        .trim() || "#1a1a26";
    wbCtx.fillStyle = bgColor;
    wbCtx.fillRect(
      0,
      0,
      canvas.width / (window.devicePixelRatio || 1),
      canvas.height / (window.devicePixelRatio || 1),
    );
  }
  clearCanvas();

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e) {
    e.preventDefault();
    S.wbDrawing = true;
    const pos = getPos(e);
    wbLastX = pos.x;
    wbLastY = pos.y;
  }

  function draw(e) {
    if (!S.wbDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    wbCtx.beginPath();
    wbCtx.moveTo(wbLastX, wbLastY);
    wbCtx.lineTo(pos.x, pos.y);
    const bgColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg-t")
        .trim() || "#1a1a26";
    wbCtx.strokeStyle = S.wbTool === "eraser" ? bgColor : S.wbColor;
    wbCtx.lineWidth = S.wbTool === "eraser" ? S.wbSize * 4 : S.wbSize;
    wbCtx.lineCap = "round";
    wbCtx.lineJoin = "round";
    wbCtx.stroke();
    wbLastX = pos.x;
    wbLastY = pos.y;
  }

  function endDraw() {
    S.wbDrawing = false;
  }

  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  wbCtx = newCanvas.getContext("2d");
  clearCanvas();

  newCanvas.addEventListener("pointerdown", startDraw);
  newCanvas.addEventListener("pointermove", draw);
  newCanvas.addEventListener("pointerup", endDraw);
  newCanvas.addEventListener("pointerleave", endDraw);
  newCanvas.style.touchAction = "none";

  $$(".wb-tool[data-tool]").forEach((btn) => {
    btn.onclick = () => {
      $$(".wb-tool[data-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      S.wbTool = btn.dataset.tool;
      newCanvas.style.cursor = S.wbTool === "eraser" ? "cell" : "crosshair";
    };
  });

  $("#wbColor").oninput = (e) => {
    S.wbColor = e.target.value;
  };
  $("#wbSize").oninput = (e) => {
    S.wbSize = parseInt(e.target.value);
  };
  $("#wbClear").onclick = () => {
    clearCanvas();
    showToast("Canvas cleared", "info");
  };

  new ResizeObserver(() => resizeCanvas()).observe(container);
}

function resizeCanvas() {
  const canvas = $("#wbCanvas");
  const container = $("#wbContainer");
  if (!canvas || !container) return;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;

  let imageData = null;
  const oldW = canvas.width;
  const oldH = canvas.height;
  if (oldW > 0 && oldH > 0 && wbCtx) {
    try {
      imageData = wbCtx.getImageData(0, 0, oldW, oldH);
    } catch (e) {}
  }

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  wbCtx = canvas.getContext("2d");
  wbCtx.scale(dpr, dpr);

  const bgColor =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-t")
      .trim() || "#1a1a26";
  wbCtx.fillStyle = bgColor;
  wbCtx.fillRect(0, 0, rect.width, rect.height);

  if (imageData) {
    try {
      wbCtx.putImageData(imageData, 0, 0);
    } catch (e) {}
  }
}

// ==================== REALTIME ====================
function setupRealtime() {
  cleanupRealtime();
  if (!db || !S.session) return;

  const ch1 = db
    .channel("ss-sections")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sections",
        filter: `session_id=eq.${S.session.id}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!S.sections.find((s) => s.id === payload.new.id)) {
            S.sections.push(payload.new);
            S.sections.sort((a, b) => a.sort_order - b.sort_order);
            renderSections();
          }
        } else if (payload.eventType === "DELETE") {
          S.sections = S.sections.filter((s) => s.id !== payload.old.id);
          if (S.activeSection === payload.old.id && S.sections.length > 0)
            selectSection(S.sections[0].id);
          renderSections();
        } else if (payload.eventType === "UPDATE") {
          const idx = S.sections.findIndex((s) => s.id === payload.new.id);
          if (idx >= 0) {
            S.sections[idx] = payload.new;
            renderSections();
          }
        }
      },
    )
    .subscribe();

  const ch2 = db
    .channel("ss-texts")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "texts",
        filter: `session_id=eq.${S.session.id}`,
      },
      (payload) => {
        if (payload.new.section_id === S.activeSection) {
          const currentContent = $("#editorContent").innerHTML;
          if (payload.new.content !== currentContent) {
            const sel = saveSelection();
            $("#editorContent").innerHTML = payload.new.content || "";
            restoreSelection(sel);
            $("#editorSaveStatus").textContent = "Synced";
          }
        }
      },
    )
    .subscribe();

  const ch3 = db
    .channel("ss-chat")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `session_id=eq.${S.session.id}`,
      },
      (payload) => {
        if (!S.chatMessages.find((m) => m.id === payload.new.id)) {
          S.chatMessages.push(payload.new);
          renderChat();
          if (payload.new.user_name !== S.user.name && S.activeTab !== "chat") {
            S.unreadChat++;
            updateChatBadge();
          }
        }
      },
    )
    .subscribe();

  const ch4 = db
    .channel("ss-todos")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "todos",
        filter: `session_id=eq.${S.session.id}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!S.todos.find((t) => t.id === payload.new.id)) {
            S.todos.push(payload.new);
            renderTodos();
          }
        } else if (payload.eventType === "DELETE") {
          S.todos = S.todos.filter((t) => t.id !== payload.old.id);
          renderTodos();
        } else if (payload.eventType === "UPDATE") {
          const idx = S.todos.findIndex((t) => t.id === payload.new.id);
          if (idx >= 0) {
            S.todos[idx] = payload.new;
            renderTodos();
          }
        }
      },
    )
    .subscribe();

  const ch5 = db
    .channel("ss-files")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "files",
        filter: `session_id=eq.${S.session.id}`,
      },
      (payload) => {
        if (payload.eventType === "INSERT") {
          if (!S.files.find((f) => f.id === payload.new.id)) {
            S.files.unshift(payload.new);
            renderFiles();
          }
        } else if (payload.eventType === "DELETE") {
          S.files = S.files.filter((f) => f.id !== payload.old.id);
          renderFiles();
        }
      },
    )
    .subscribe();

  const ch6 = db
    .channel("ss-presence")
    .on("system", { event: "connected" }, () =>
      updateConnectionStatus("connected"),
    )
    .on("system", { event: "disconnected" }, () =>
      updateConnectionStatus("disconnected"),
    )
    .subscribe();

  channels = [ch1, ch2, ch3, ch4, ch5, ch6];
  updateConnectionStatus("connected");
}

function cleanupRealtime() {
  channels.forEach((ch) => {
    try {
      db?.removeChannel(ch);
    } catch (e) {}
  });
  channels = [];
  updateConnectionStatus("disconnected");
}

function saveSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) return sel.getRangeAt(0).cloneRange();
  return null;
}
function restoreSelection(range) {
  if (!range) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// ==================== SESSION TIMEOUT ====================
function checkSessionTimeout() {
  const elapsed = Date.now() - S.lastActivity;
  if (elapsed > 30 * 60 * 1000 && S.session) {
    showToast("Session timed out due to inactivity", "warning");
    leaveSession();
  }
}

// ==================== INIT ====================
async function init() {
  initTheme();
  showLoader();

  // Step 1: Initializing
  await tick(400);
  setLoaderStep("init", "done");

  // Step 2: Loading credentials
  setLoaderStep("creds", "active");
  await tick(300);

  let supabaseUrl = localStorage.getItem("ss_sb_url") || "";
  let supabaseKey = localStorage.getItem("ss_sb_key") || "";

  if (!supabaseUrl || !supabaseKey) {
    const params = new URLSearchParams(window.location.search);
    supabaseUrl = params.get("supabase_url") || "";
    supabaseKey = params.get("supabase_key") || "";
  }

  if (!supabaseUrl || !supabaseKey) {
    setLoaderStep("creds", "done");
    setLoaderStep("connect", "done");
    setLoaderStep("verify", "done");
    setLoaderStep("restore", "done");
    setLoaderStep("ready", "done");
    await tick(300);
    hideLoader();
    showScreen("configScreen");
    return;
  }

  setLoaderStep("creds", "done");

  // Step 3: Connecting to Supabase
  setLoaderStep("connect", "active");
  await tick(400);

  try {
    db = window.supabase.createClient(supabaseUrl, supabaseKey);
    setLoaderStep("connect", "done");

    // Step 4: Verifying connection
    setLoaderStep("verify", "active");
    const { error } = await db.from("users").select("user_id").limit(1);
    if (error) throw error;

    localStorage.setItem("ss_sb_url", supabaseUrl);
    localStorage.setItem("ss_sb_key", supabaseKey);
    setLoaderStep("verify", "done");

    // Step 5: Restoring session
    setLoaderStep("restore", "active");
    await tick(300);

    const savedUser = localStorage.getItem("ss_user");
    const savedSession = localStorage.getItem("ss_session");
    const savedSessionPw = localStorage.getItem("ss_session_pw");

    setLoaderStep("restore", "done");

    // Step 6: Ready
    setLoaderStep("ready", "active");
    await tick(300);
    setLoaderStep("ready", "done");
    await tick(200);
    hideLoader();

    if (savedUser && savedSession) {
      try {
        S.user = JSON.parse(savedUser);
        S.session = JSON.parse(savedSession);
        S.sessionPassword = savedSessionPw || "";
        $("#sessionUserName").textContent = S.user.name;
        await enterDashboard();
        return;
      } catch (e) {}
    }

    if (savedUser && !savedSession) {
      try {
        S.user = JSON.parse(savedUser);
        $("#sessionUserName").textContent = S.user.name;
        showScreen("sessionScreen");
        return;
      } catch (e) {}
    }

    showScreen("authScreen");
  } catch (err) {
    setLoaderStep("verify", "error");
    showLoaderError("Could not connect to Supabase. Check your URL and Key.");
    console.error("Connection error:", err);
    localStorage.removeItem("ss_sb_url");
    localStorage.removeItem("ss_sb_key");
  }
}

// ==================== EVENT LISTENERS ====================
document.addEventListener("DOMContentLoaded", () => {
  $("#configForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("#cfgUrl").value.trim();
    const key = $("#cfgKey").value.trim();
    if (!url || !key) return;

    localStorage.setItem("ss_sb_url", url);
    localStorage.setItem("ss_sb_key", key);

    window.location.href = window.location.pathname;
  });

  $("#loginFormEl").addEventListener("submit", handleLogin);
  $("#signupFormEl").addEventListener("submit", handleSignup);
  $("#backToLogin").addEventListener("click", showLoginForm);
  $("#logoutBtn").addEventListener("click", handleLogout);

  // Create Account button handler
  $("#showSignupBtn").addEventListener("click", function () {
    const userId = $("#loginUserId").value.trim();
    if (userId) {
      $("#signupUserId").value = userId;
    }
    showSignupForm(userId);
  });

  $("#createForm").addEventListener("submit", handleCreateSession);
  $("#joinForm").addEventListener("submit", handleJoinSession);
  $("#leaveSessionBtn").addEventListener("click", leaveSession);

  $("#menuBtn").addEventListener("click", openSidebar);
  $("#closeSidebar").addEventListener("click", closeSidebar);
  $("#sidebarOverlay").addEventListener("click", closeSidebar);
  $("#addSectionBtn").addEventListener("click", createSection);
  $("#sectionSearch").addEventListener("input", (e) =>
    renderSections(e.target.value),
  );

  $("#sectionsList").addEventListener("click", (e) => {
    const deleteBtn = e.target.closest("[data-delete]");
    if (deleteBtn) {
      e.stopPropagation();
      deleteSection(deleteBtn.dataset.delete);
      return;
    }
    const item = e.target.closest(".section-item");
    if (item) selectSection(item.dataset.id);
  });

  $("#themeToggle").addEventListener("click", toggleTheme);

  $("#tabBar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) switchTab(btn.dataset.tab);
  });
  $("#bottomNav").addEventListener("click", (e) => {
    const btn = e.target.closest(".bnav-btn");
    if (btn) {
      switchTab(btn.dataset.tab);
      closeSidebar();
    }
  });

  initEditorToolbar();
  initFileHandlers();
  initChatHandlers();
  initTaskHandlers();

  ["click", "keydown", "mousemove", "touchstart"].forEach((evt) => {
    document.addEventListener(
      evt,
      () => {
        S.lastActivity = Date.now();
      },
      { passive: true },
    );
  });
  setInterval(checkSessionTimeout, 60000);

  $("#loaderRetry").addEventListener("click", () => {
    showLoader();
    init();
  });

  init();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
