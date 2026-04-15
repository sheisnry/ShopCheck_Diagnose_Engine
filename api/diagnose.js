export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    prompt,
    answers,
    score,
    total,
    step,
    profile,
    quickAnswers,
    deepAnswers
  } = req.body || {};

  if (!prompt && !answers && !profile && !quickAnswers && !deepAnswers) {
    return res.status(400).json({ error: "Missing prompt or analysis input" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4";

  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY is missing" });
  }

  function safeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function extractOutputText(data) {
    if (typeof data?.output_text === "string" && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const items = Array.isArray(data?.output) ? data.output : [];
    const chunks = [];

    for (const item of items) {
      if (item?.type !== "message" || !Array.isArray(item?.content)) continue;
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part?.text === "string") {
          chunks.push(part.text);
        }
      }
    }

    return chunks.join("\n").trim();
  }

  function inferStep({ prompt, explicitStep, deepAnswers }) {
    if (explicitStep === 1 || explicitStep === 2) return explicitStep;
    if (deepAnswers && Object.keys(deepAnswers).length > 0) return 2;

    const text = safeString(prompt);
    if (
      /\*\*3 Action plan หลัก/i.test(text) ||
      /\*\*แผน 30 วัน/i.test(text) ||
      /\*\*ประเมิน Channel Fit/i.test(text) ||
      /Channel Fit/i.test(text)
    ) {
      return 2;
    }
    return 1;
  }

  const inferredStep = inferStep({
    prompt,
    explicitStep: step,
    deepAnswers
  });

  function buildPromptFromStructuredInput() {
    const p = profile || {};
    const qa = quickAnswers || {};
    const da = deepAnswers || {};

    const quickText = Object.entries(qa)
      .map(([key, val]) => {
        if (!val) return `- ${key}: ไม่ได้ตอบ`;
        const label = typeof val === "object" ? val.label || val.sub || "" : String(val);
        const scoreText =
          typeof val === "object" && typeof val.val !== "undefined"
            ? ` (คะแนน ${val.val})`
            : "";
        return `- ${key}: ${label}${scoreText}`;
      })
      .join("\n");

    const deepText = Object.entries(da)
      .map(([key, val]) => {
        if (!val) return `- ${key}: ไม่ได้ตอบ`;
        if (Array.isArray(val)) return `- ${key}: ${val.join(", ")}`;
        const label =
          typeof val === "object"
            ? val.label || val.sub || val.value || JSON.stringify(val)
            : String(val);
        return `- ${key}: ${label}`;
      })
      .join("\n");

    const profileText = [
      `ชื่อร้าน: ${p.shopName || "ไม่ระบุ"}`,
      `หมวดหมู่: ${p.shopCat || "ไม่ระบุ"}`,
      `สินค้าที่อยากดัน: ${p.heroProduct || "ไม่ระบุ"}`,
      `ออเดอร์ปัจจุบัน: ${p.monthlyOrders || "ไม่ระบุ"}`,
      `เป้าหมายออเดอร์: ${p.targetOrders || "ไม่ระบุ"}`,
      `ปัญหาหลักที่รู้สึก: ${p.mainProblem || "ไม่ระบุ"}`
    ].join("\n");

    if (inferredStep === 2) {
      return [
        "คุณกำลังวิเคราะห์ร้าน Shopee แบบเชิงลึกจากข้อมูลจริงของร้านนี้",
        "",
        "ข้อมูลร้าน:",
        profileText,
        "",
        "คำตอบ Part 1:",
        quickText || "- ไม่มี",
        "",
        "คำตอบ Part 2:",
        deepText || "- ไม่มี",
        "",
        "กรุณาตอบตามโครงนี้เท่านั้น:",
        "**3 Action plan หลัก**",
        "**แผน 30 วัน**",
        "**ประเมิน Channel Fit**"
      ].join("\n");
    }

    return [
      "คุณกำลังวิเคราะห์ร้าน Shopee แบบ quick diagnosis จาก checklist เบื้องต้น",
      "",
      "ข้อมูลร้าน:",
      profileText,
      "",
      "คำตอบ Part 1:",
      quickText || "- ไม่มี",
      "",
      `คะแนนรวม: ${typeof score !== "undefined" ? score : "-"} / ${
        typeof total !== "undefined" ? total : "-"
      }`,
      "",
      "กรุณาตอบตามโครงนี้เท่านั้น:",
      "**ภาพรวมร้าน**",
      "**จุดเด่นของร้านที่ต้องรักษาไว้**",
      "**จุดที่ต้องแก้ก่อน**",
      "**Action plan 1 ข้อที่ทำได้เลยสัปดาห์นี้**"
    ].join("\n");
  }

  const finalPrompt =
    safeString(prompt) ||
    buildPromptFromStructuredInput() ||
    `Analyze this Shopee store with score ${score}/${total}:\n${answers || ""}`;

  function hasRequiredSections(text, stepNumber) {
    if (!text) return false;

    if (stepNumber === 2) {
      return (
        /\*\*3 Action plan หลัก\*\*/i.test(text) &&
        /\*\*แผน 30 วัน\*\*/i.test(text) &&
        /\*\*ประเมิน Channel Fit\*\*/i.test(text)
      );
    }

    return (
      /\*\*ภาพรวมร้าน\*\*/i.test(text) &&
      /\*\*จุดเด่นของร้านที่ต้องรักษาไว้\*\*/i.test(text) &&
      /\*\*จุดที่ต้องแก้ก่อน\*\*/i.test(text) &&
      /\*\*Action plan 1 ข้อที่ทำได้เลยสัปดาห์นี้\*\*/i.test(text)
    );
  }

  const developerInstruction = [
    "You are ShopCheck analysis engine for Thai Shopee sellers.",
    "Write in natural Thai that sounds like an experienced ecommerce consultant, not AI copy.",
    "Do not sound motivational, vague, fluffy, or generic.",
    "Every statement must be grounded in the actual shop profile and answers from the prompt.",
    "Do not give equal weight to all issues. Pick the highest business-impact bottleneck first.",
    "Do not repeat textbook ecommerce advice unless it clearly matches the case.",
    "Avoid generic filler such as 'ควรทำการตลาดมากขึ้น', 'ควรพัฒนาร้าน', 'ควรใช้เครื่องมือให้ครบ'.",
    "Be specific about what is weak, why it matters, and what the seller should do next.",
    "When discussing price, distinguish between: real cost disadvantage, weak value communication, price-war category, and store too small to compete now.",
    "When discussing recommendations, respect business constraints. Do not recommend expensive or unrealistic actions if the shop is clearly resource-constrained.",
    "Always mention the product category and hero product where relevant.",
    "Do not invent data that is not in the prompt.",
    "Do not add markdown fences, intros, outros, disclaimers, or extra headings.",
    inferredStep === 2
      ? [
          "For step 2, make the analysis strategic and connected.",
          "The 3 action plans must not be random tips.",
          "They should follow a smart order: fix the foundation first, then improve conversion/offer, then scale traffic only where justified.",
          "The 30-day plan must feel realistic, sequential, and operational.",
          "Channel Fit must make a real judgment, not a diplomatic summary.",
          "If Shopee is not the best battlefield for this case, say so clearly and explain why."
        ].join(" ")
      : [
          "For step 1, deliver one sharp diagnosis, not a broad summary.",
          "The section 'จุดที่ต้องแก้ก่อน' should feel decisive and specific.",
          "Only mention strengths that are actually supported by the answers.",
          "The one-week action must be concrete and immediately doable."
        ].join(" ")
  ].join(" ");

  async function runOpenAI(input, maxOutputTokens = 3600) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: maxOutputTokens,
        instructions: developerInstruction,
        input
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || "OpenAI request failed";
      throw new Error(message);
    }

    return data;
  }

  function buildRepairPrompt(originalRequest, currentAnswer, stepNumber) {
    const requiredHeadings =
      stepNumber === 2
        ? [
            "**3 Action plan หลัก**",
            "**แผน 30 วัน**",
            "**ประเมิน Channel Fit**"
          ]
        : [
            "**ภาพรวมร้าน**",
            "**จุดเด่นของร้านที่ต้องรักษาไว้**",
            "**จุดที่ต้องแก้ก่อน**",
            "**Action plan 1 ข้อที่ทำได้เลยสัปดาห์นี้**"
          ];

    return [
      "Repair the answer below.",
      "Return only the final corrected Thai answer.",
      "Use the exact required headings below and do not add any others:",
      requiredHeadings.join("\n"),
      "",
      "Rules:",
      "- Keep the answer specific and grounded in the provided shop information.",
      "- Remove generic filler.",
      "- Make the diagnosis sharper and more commercially useful.",
      "- Do not add markdown fences.",
      "",
      "ORIGINAL REQUEST:",
      originalRequest,
      "",
      "CURRENT ANSWER:",
      currentAnswer || "[empty]"
    ].join("\n");
  }

  try {
    const firstPass = await runOpenAI(finalPrompt, inferredStep === 2 ? 4200 : 3000);
    let text = extractOutputText(firstPass);

    if (!hasRequiredSections(text, inferredStep)) {
      const repairPrompt = buildRepairPrompt(finalPrompt, text, inferredStep);
      const repaired = await runOpenAI(repairPrompt, inferredStep === 2 ? 4200 : 3200);
      const repairedText = extractOutputText(repaired);
      if (repairedText) text = repairedText;
    }

    if (!text) {
      throw new Error("Model returned empty output");
    }

    return res.status(200).json({ result: text });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unexpected server error"
    });
  }
}
