export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      submissionId,
      profile,
      quickAnswers,
      deepAnswers,
      email,
      name,
      paymentMethod,
      version,
      step1AIResult,
      step2AIResult,
      step1Prompt,
      step2Prompt
    } = req.body || {};

    if (
      !profile?.shopCat ||
      !profile?.heroProduct ||
      !profile?.monthlyOrders ||
      !profile?.targetOrders
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Supabase env vars are missing" });
    }

    const cleanEmail = typeof email === "string" ? email.trim() : "";
    const hasRealEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
    const fallbackEmail = `draft+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@shopcheck.local`;
    const finalEmail = hasRealEmail ? cleanEmail : fallbackEmail;

    const payload = {
      shop_name: profile.shopName || null,
      shop_cat: profile.shopCat,
      hero_product: profile.heroProduct,
      monthly_orders: profile.monthlyOrders,
      target_orders: profile.targetOrders,
      main_problem: profile.mainProblem || null,
      email: finalEmail,
      name: name || null,
      payment_method: paymentMethod || null,
      quick_answers: quickAnswers || {},
      deep_answers: deepAnswers || {},
      version: version || "15APR_openai_v3",
      source: "shopcheck-web",
      status: hasRealEmail ? "new" : "draft",
      step1_ai_result: step1AIResult || null,
      step2_ai_result: step2AIResult || null,
      step1_prompt: step1Prompt || null,
      step2_prompt: step2Prompt || null
    };

    const baseHeaders = {
      "Content-Type": "application/json",
      "apikey": serviceRoleKey,
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Prefer": "return=representation"
    };

    let response;

    if (submissionId) {
      response = await fetch(
        `${supabaseUrl}/rest/v1/submissions?id=eq.${encodeURIComponent(submissionId)}`,
        {
          method: "PATCH",
          headers: baseHeaders,
          body: JSON.stringify(payload)
        }
      );
    } else {
      response = await fetch(`${supabaseUrl}/rest/v1/submissions`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(payload)
      });
    }

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: submissionId ? "Failed to update submission" : "Failed to save submission",
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      submission: Array.isArray(data) ? data[0] || null : data || null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected server error",
      details: error.message
    });
  }
}
