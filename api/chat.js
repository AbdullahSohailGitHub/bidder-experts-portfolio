export const config = { runtime: 'edge' };

// Stable, current model. (gemini-1.5-* is shut down; gemini-2.0-* retires June 2026.)
const MODEL = 'gemini-2.5-flash';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders
    });
  }

  try {
    const body = await req.json();
    const { messages, system } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid messages' }), {
        status: 400, headers: corsHeaders
      });
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server is missing GEMINI_API_KEY' }), {
        status: 500, headers: corsHeaders
      });
    }

    const geminiMessages = messages
      .filter(function (m) { return m && m.content; })
      .map(function (m) {
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content) }]
        };
      });

    const geminiRequest = {
      system_instruction: { parts: [{ text: system || '' }] },
      contents: geminiMessages,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
        topP: 0.9,
        // Disable "thinking" so the full token budget goes to the visible reply
        thinkingConfig: { thinkingBudget: 0 }
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      MODEL + ':generateContent?key=' + GEMINI_API_KEY;

    // Up to 2 attempts; retry only on 5xx / 429 (transient).
    let response = null;
    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequest)
      });
      if (response.ok) break;
      lastErr = await response.text();
      if (response.status < 500 && response.status !== 429) break;
      await new Promise(function (r) { setTimeout(r, 400); });
    }

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: 'Gemini API error', status: response.status, detail: lastErr
      }), { status: response.status, headers: corsHeaders });
    }

    const data = await response.json();

    // Whole prompt was blocked
    if (data.promptFeedback && data.promptFeedback.blockReason) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: "I can't help with that particular request, but I'm happy to answer anything about Bidder Experts \u2014 our services, pricing, team \u2014 or any other question." }]
      }), { status: 200, headers: corsHeaders });
    }

    const cand = data.candidates && data.candidates[0];
    let replyText = '';
    if (cand && cand.content && cand.content.parts) {
      replyText = cand.content.parts.map(function (p) { return p.text || ''; }).join('').trim();
    }

    // No text came back — explain based on why, instead of failing silently
    if (!replyText) {
      const fr = cand && cand.finishReason;
      let msg;
      if (fr === 'MAX_TOKENS') {
        msg = "That's a big one! Could you narrow the question down a little so I can give you a focused answer?";
      } else if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT') {
        msg = "I can't help with that one, but ask me anything about Bidder Experts' services, pricing, team, or any other topic.";
      } else {
        msg = "Sorry, I didn't quite catch that \u2014 could you rephrase? You can ask me about Bidder Experts' services, pricing, and team, or anything else.";
      }
      return new Response(JSON.stringify({ content: [{ type: 'text', text: msg }] }), {
        status: 200, headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({
      content: [{ type: 'text', text: replyText }]
    }), { status: 200, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders
    });
  }
}
