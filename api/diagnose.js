export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, answers, score, total } = req.body || {};
  if (!prompt && !answers) return res.status(400).json({ error: 'Missing prompt or answers' });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.4';

  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing' });
  }

  const finalPrompt = prompt || `Analyze this Shopee store with score ${score}/${total}:\n${answers}`;
  const isStep2 = /\*\*3 Action plan หลัก|\*\*แผน 30 วัน|Channel Fit/i.test(finalPrompt);

  const developerInstruction = [
    'You are ShopCheck analysis engine for Thai Shopee sellers.',
    'Write natural Thai that sounds like a real consultant, not like AI copy.',
    'Follow the user-provided output structure and section names exactly.',
    'Do not add extra headings, disclaimers, markdown fences, or commentary outside the requested sections.',
    'Every recommendation must be tied to facts from the provided shop profile and answers.',
    'Avoid generic filler. Be specific about what is weak, why it matters, and what to do next.',
    'Rank issues by business impact, not by how easy they are to mention.',
    'If the shop has some strengths, mention them honestly. If it does not, say so plainly.',
    isStep2
      ? 'For step 2, make the 3 action plans feel strategic and connected: foundation first, then conversion/promo, then traffic. The 30-day plan must feel realistic and sequential.'
      : 'For step 1, identify the most decisive bottleneck first. Keep the diagnosis sharp. Do not water it down with equal-weight generic issues.'
  ].join(' ');

  function extractOutputText(data) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const items = Array.isArray(data?.output) ? data.output : [];
    const chunks = [];

    for (const item of items) {
      if (item?.type !== 'message' || !Array.isArray(item?.content)) continue;
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part?.text === 'string') {
          chunks.push(part.text);
        }
      }
    }

    return chunks.join('\n').trim();
  }

  function hasRequiredSections(text) {
    if (!text) return false;

    if (isStep2) {
      return (
        /\*\*3 Action plan หลัก/i.test(text) &&
        /\*\*แผน 30 วัน/i.test(text) &&
        /\*\*ประเมิน Channel Fit/i.test(text)
      );
    }

    return (
      /\*\*ภาพรวมร้าน/i.test(text) &&
      /\*\*จุดเด่นของร้านที่ต้องรักษาไว้\*\*/i.test(text) &&
      /\*\*จุดที่ต้องแก้ก่อน\*\*/i.test(text) &&
      /\*\*Action plan 1 ข้อที่ทำได้เลยสัปดาห์นี้\*\*/i.test(text)
    );
  }

  async function runOpenAI(input, maxOutputTokens = 3600) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
      const message = data?.error?.message || 'OpenAI request failed';
      throw new Error(message);
    }

    return data;
  }

  try {
    const firstPass = await runOpenAI(finalPrompt, isStep2 ? 4200 : 3000);
    let text = extractOutputText(firstPass);

    if (!hasRequiredSections(text)) {
      const repairPrompt = [
        'Repair the following answer so it follows the required headings exactly.',
        'Keep the substance, sharpen specificity, remove generic filler, and return only the corrected final answer.',
        '',
        'ORIGINAL REQUEST:',
        finalPrompt,
        '',
        'CURRENT ANSWER:',
        text || '[empty]'
      ].join('\n');

      const repaired = await runOpenAI(repairPrompt, isStep2 ? 4200 : 3200);
      const repairedText = extractOutputText(repaired);
      if (repairedText) text = repairedText;
    }

    if (!text) {
      throw new Error('Model returned empty output');
    }

    return res.status(200).json({ result: text });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
}
