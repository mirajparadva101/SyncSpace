// Vercel serverless function — exposes Supabase public config securely
// Set env vars in Vercel: SUPABASE_URL, SUPABASE_ANON_KEY

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    return res.status(200).json({
      url: "",
      key: "",
      demo: true,
      message: "Supabase env not configured — running in demo mode",
    });
  }

  return res.status(200).json({ url, key, demo: false });
}
