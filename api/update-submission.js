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

    if (!submissionId) {
      return res.status(400).json({ error: "submissionId is required" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: "Supabase env vars are missing" });
    }

    const patch = {
      version: version || "15APR_openai_v3",
      step1_ai_result: step1AIResult || null,
      step2_ai_result: step2AIResult || null,
      step1_prompt: step1Prompt || null,
      step2_prompt: step2Prompt || null
    };

    if (profile) {
      patch.shop_name = profile.shopName || null;
      patch.shop_cat = profile.shopCat || null;
      patch.hero_product = profile.heroProduct || null;
      patch.monthly_orders = profile.monthlyOrders || null;
      patch.target_orders = profile.targetOrders || null;
      patch.main_problem = profile.mainProblem || null;
    }

    if (deepAnswers) {
      patch.deep_answers = deepAnswers;
    }

    if (typeof email === "string" && email.trim()) {
      patch.email = email.trim();
      patch.status = "new";
    }

    if (typeof name === "string") {
      patch.name = name.trim() || null;
    }

    if (paymentMethod) {
      patch.payment_method = paymentMethod;
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/submissions?id=eq.${encodeURIComponent(submissionId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify(patch)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Failed to update submission",
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      submission: data?.[0] || null
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected server error",
      details: error.message
    });
  }
}
