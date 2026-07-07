export default function handler(req, res) {
  // CORS headers for cross-origin access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Sirf GET requests allow karo
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel environment variables se credentials read karo
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  // Check karo credentials set hain ya nahi
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: "Supabase credentials not configured on server",
      configured: false,
      supabaseUrl: "",
      supabaseAnonKey: "",
    });
  }

  // Credentials return karo (Anon Key is meant to be public in Supabase)
  return res.status(200).json({
    configured: true,
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
  });
}
