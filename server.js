import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env ONLY in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// ========== SECURITY MIDDLEWARE ==========
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", process.env.SUPABASE_URL],
      },
    },
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

// CORS - Allow all origins for development
app.use(
  cors({
    origin: true,
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

// ========== RATE LIMITING ==========
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: "Too many authentication attempts. Please try again later.",
  },
});
app.use("/api/auth", authLimiter);

// ========== SUPABASE CLIENT ==========
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

// ========== HEALTH CHECK ==========
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ========== AUTH ROUTES ==========
app.post("/api/auth", async (req, res) => {
  // ========== DEBUG LOGS ==========
  console.log("=== AUTH REQUEST ===");
  console.log("Body:", JSON.stringify(req.body, null, 2));
  console.log("Supabase URL:", process.env.SUPABASE_URL ? "Set" : "Not set");
  console.log(
    "Supabase Key:",
    process.env.SUPABASE_ANON_KEY ? "Set" : "Not set",
  );
  console.log("=========================================");
  // ========== END DEBUG LOGS ==========

  const { action, userId, name, password, tempToken, code } = req.body;

  // Log the request for debugging
  console.log("Auth request:", {
    action,
    userId,
    name: name || "not provided",
  });

  try {
    // SIGNUP
    if (action === "signup") {
      console.log("Processing signup for:", userId);

      if (!userId || !name || !password) {
        console.log("Missing fields:", {
          userId: !!userId,
          name: !!name,
          password: !!password,
        });
        return res.status(400).json({ error: "All fields required" });
      }

      if (password.length < 6) {
        return res
          .status(400)
          .json({ error: "Password must be at least 6 characters" });
      }

      // Check if user already exists
      const { data: existingUser, error: checkError } = await supabase
        .from("users")
        .select("user_id")
        .eq("user_id", userId)
        .single();

      if (existingUser) {
        return res.status(400).json({ error: "User already exists" });
      }

      const hash = await bcrypt.hash(password, 10);

      // Insert user - using direct insert without RLS issues
      const { data, error } = await supabase
        .from("users")
        .insert([
          {
            user_id: userId,
            name: name,
            password: hash,
            role: "editor",
          },
        ])
        .select();

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(400).json({ error: error.message });
      }

      console.log("User created successfully:", userId);
      return res.json({ message: "User created successfully" });
    }

    // LOGIN
    if (action === "login") {
      console.log("Processing login for:", userId);

      if (!userId || !password) {
        return res.status(400).json({ error: "All fields required" });
      }

      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (error || !user) {
        console.log("User not found:", userId);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        console.log("Invalid password for:", userId);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (user.two_factor_secret) {
        const tempToken = jwt.sign(
          { userId: user.user_id },
          process.env.JWT_SECRET,
          { expiresIn: "5m" },
        );
        return res.json({
          require2FA: true,
          tempToken,
          user: { name: user.name },
        });
      }

      const token = jwt.sign(
        { userId: user.user_id, role: user.role || "editor" },
        process.env.JWT_SECRET,
        { expiresIn: "24h" },
      );

      return res.json({
        token,
        user: { name: user.name, role: user.role || "editor" },
      });
    }

    // VERIFY 2FA
    if (action === "verify-2fa") {
      if (!tempToken || !code) {
        return res.status(400).json({ error: "All fields required" });
      }

      const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("user_id", decoded.userId)
        .single();

      if (error || !user) {
        return res.status(401).json({ error: "User not found" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: "base32",
        token: code,
        window: 2,
      });

      if (!verified) {
        return res.status(401).json({ error: "Invalid 2FA code" });
      }

      const token = jwt.sign(
        { userId: user.user_id, role: user.role || "editor" },
        process.env.JWT_SECRET,
        { expiresIn: "24h" },
      );

      return res.json({
        token,
        user: { name: user.name, role: user.role || "editor" },
      });
    }

    // SETUP 2FA
    if (action === "setup-2fa") {
      if (!userId) {
        return res.status(400).json({ error: "User ID required" });
      }

      const secret = speakeasy.generateSecret({
        name: `SyncSpace (${userId})`,
      });
      const qr = await QRCode.toDataURL(secret.otpauth_url);

      await supabase
        .from("users")
        .update({ two_factor_secret: secret.base32 })
        .eq("user_id", userId);

      return res.json({
        secret: secret.base32,
        qr,
        otpauth_url: secret.otpauth_url,
      });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Auth error:", err);
    return res
      .status(500)
      .json({ error: "Internal server error: " + err.message });
  }
});

// ========== SESSIONS ROUTES ==========
app.post("/api/sessions", async (req, res) => {
  const { action, password, sessionId } = req.body;

  try {
    if (action === "create") {
      if (!password || password.length < 4) {
        return res
          .status(400)
          .json({ error: "Password must be at least 4 characters" });
      }

      const id = Math.random().toString(36).substring(2, 8).toUpperCase();
      const hashedPassword = await bcrypt.hash(password, 10);

      const { data, error } = await supabase
        .from("sessions")
        .insert({ id, password: hashedPassword })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({
        session: data,
        message: "Session created successfully",
      });
    }

    if (action === "join") {
      if (!sessionId || !password) {
        return res
          .status(400)
          .json({ error: "Session ID and password required" });
      }

      const { data: session, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId.toUpperCase())
        .single();

      if (error || !session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const isValid = await bcrypt.compare(password, session.password);
      if (!isValid) {
        return res.status(401).json({ error: "Invalid session password" });
      }

      return res.json({
        message: "Joined successfully",
        sessionId: session.id,
      });
    }

    if (action === "delete") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", sessionId);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ message: "Session deleted successfully" });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Session error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== SECTIONS ROUTES ==========
app.post("/api/sections", async (req, res) => {
  const { action, sessionId, name, sectionId, order } = req.body;

  try {
    if (action === "list") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { data, error } = await supabase
        .from("sections")
        .select("*")
        .eq("session_id", sessionId)
        .order("sort_order", { ascending: true });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || []);
    }

    if (action === "create") {
      if (!sessionId || !name) {
        return res.status(400).json({ error: "Session ID and name required" });
      }

      const { count } = await supabase
        .from("sections")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);

      const { data, error } = await supabase
        .from("sections")
        .insert({
          session_id: sessionId,
          name,
          sort_order: count || 0,
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data);
    }

    if (action === "delete") {
      if (!sectionId) {
        return res.status(400).json({ error: "Section ID required" });
      }

      const { error } = await supabase
        .from("sections")
        .delete()
        .eq("id", sectionId);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ message: "Section deleted successfully" });
    }

    if (action === "reorder") {
      if (!order || !Array.isArray(order)) {
        return res.status(400).json({ error: "Valid order array required" });
      }

      for (let i = 0; i < order.length; i++) {
        await supabase
          .from("sections")
          .update({ sort_order: i })
          .eq("id", order[i]);
      }

      return res.json({ message: "Sections reordered successfully" });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Section error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== TEXT ROUTES ==========
app.post("/api/text", async (req, res) => {
  const { action, sectionId, sessionId, content } = req.body;

  try {
    if (action === "get") {
      if (!sectionId) {
        return res.status(400).json({ error: "Section ID required" });
      }

      const { data, error } = await supabase
        .from("texts")
        .select("*")
        .eq("section_id", sectionId)
        .single();

      if (error && error.code !== "PGRST116") {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || { content: "", section_id: sectionId });
    }

    if (action === "save") {
      if (!sectionId || !sessionId) {
        return res
          .status(400)
          .json({ error: "Section ID and Session ID required" });
      }

      const { data: existing, error: checkError } = await supabase
        .from("texts")
        .select("id")
        .eq("section_id", sectionId)
        .single();

      let textError;
      if (existing) {
        const { error } = await supabase
          .from("texts")
          .update({
            content: content || "",
            updated_at: new Date().toISOString(),
          })
          .eq("section_id", sectionId);
        textError = error;
      } else {
        const { error } = await supabase.from("texts").insert({
          section_id: sectionId,
          session_id: sessionId,
          content: content || "",
        });
        textError = error;
      }

      if (textError) {
        return res.status(400).json({ error: textError.message });
      }

      await supabase.from("text_versions").insert({
        section_id: sectionId,
        content: content || "",
      });

      return res.json({
        message: "Saved successfully",
        versioned: true,
      });
    }

    if (action === "history") {
      if (!sectionId) {
        return res.status(400).json({ error: "Section ID required" });
      }

      const { data, error } = await supabase
        .from("text_versions")
        .select("*")
        .eq("section_id", sectionId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || []);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Text error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== FILES ROUTES ==========
app.post("/api/files", async (req, res) => {
  const { action, sessionId, sectionId, file } = req.body;

  try {
    if (action === "upload") {
      if (!sessionId || !file) {
        return res.status(400).json({ error: "Session ID and file required" });
      }

      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
      ];

      if (!allowedTypes.includes(file.type)) {
        return res.status(400).json({
          error:
            "File type not allowed. Allowed: JPEG, PNG, GIF, WEBP, PDF, TXT",
        });
      }

      if (file.size > 2 * 1024 * 1024) {
        return res.status(400).json({
          error: "File too large. Maximum size: 2MB",
        });
      }

      const { data, error } = await supabase
        .from("files")
        .insert({
          session_id: sessionId,
          section_id: sectionId || null,
          file_name: file.name,
          file_data: file.data,
          file_type: file.type,
          file_size: file.size,
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({
        message: "File uploaded successfully",
        file: data,
      });
    }

    if (action === "list") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { data, error } = await supabase
        .from("files")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || []);
    }

    if (action === "delete") {
      if (!file?.id) {
        return res.status(400).json({ error: "File ID required" });
      }

      const { error } = await supabase.from("files").delete().eq("id", file.id);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ message: "File deleted successfully" });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("File error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== CHAT ROUTES ==========
app.post("/api/chat", async (req, res) => {
  const { action, sessionId, userName, message } = req.body;

  try {
    if (action === "send") {
      if (!sessionId || !userName || !message) {
        return res.status(400).json({ error: "All fields required" });
      }

      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          session_id: sessionId,
          user_name: userName,
          message,
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({
        message: "Message sent",
        data,
      });
    }

    if (action === "get") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || []);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== TODOS ROUTES ==========
app.post("/api/todos", async (req, res) => {
  const { action, sessionId, text, todoId, completed } = req.body;

  try {
    if (action === "create") {
      if (!sessionId || !text) {
        return res.status(400).json({ error: "Session ID and text required" });
      }

      const { data, error } = await supabase
        .from("todos")
        .insert({ session_id: sessionId, text })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data);
    }

    if (action === "list") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { data, error } = await supabase
        .from("todos")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || []);
    }

    if (action === "toggle") {
      if (!todoId) {
        return res.status(400).json({ error: "Todo ID required" });
      }

      const { data, error } = await supabase
        .from("todos")
        .update({ completed: !!completed })
        .eq("id", todoId)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data);
    }

    if (action === "delete") {
      if (!todoId) {
        return res.status(400).json({ error: "Todo ID required" });
      }

      const { error } = await supabase.from("todos").delete().eq("id", todoId);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ message: "Todo deleted successfully" });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Todo error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== ACTIVITY LOG ==========
app.post("/api/activity", async (req, res) => {
  const { action, sessionId, userName, details } = req.body;

  try {
    if (action === "log") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { error } = await supabase.from("activity_logs").insert({
        session_id: sessionId,
        user_name: userName || "Anonymous",
        action: details || "Action performed",
      });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json({ message: "Activity logged" });
    }

    if (action === "get") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID required" });
      }

      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      return res.json(data || []);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Activity error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ========== STATS ==========
app.get("/api/stats", async (req, res) => {
  try {
    const [users, sessions] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("sessions").select("id", { count: "exact", head: true }),
    ]);

    res.json({
      users: users.count || 0,
      sessions: sessions.count || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== CONFIG ==========
app.get("/api/config", (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn("Missing Supabase environment variables");
    return res.status(500).json({
      error: "Server configuration incomplete",
      details: "Missing SUPABASE_URL or SUPABASE_ANON_KEY",
    });
  }

  res.json({
    url: url,
    key: key,
  });
});

// ========== SERVE FRONTEND ==========
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log(`🚀 SyncSpace server running on http://localhost:${PORT}`);
});
