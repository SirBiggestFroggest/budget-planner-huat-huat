/** Huat Huat · AI assistant, as a Supabase Edge Function.
 *
 *  WHY THIS EXISTS AT ALL
 *
 *  A Google AI Studio key is a real secret: anyone holding it can spend your
 *  quota. It therefore cannot live in the page, unlike the Supabase publishable
 *  key, which is public by design and has row level security standing behind
 *  it. So the browser never sees the Gemini key. It calls this function with
 *  its Supabase session; the function holds the key and calls Gemini.
 *
 *  Supabase verifies the caller's JWT before this code runs, so only a
 *  signed-in user reaches it.
 *
 *  SET UP
 *      supabase secrets set GEMINI_API_KEY=...        (never commit it)
 *      supabase functions deploy assistant
 *
 *  Optional: GEMINI_MODEL to pin a different model, ALLOWED_ORIGIN to narrow
 *  CORS to your deployed site.
 *
 *  PRIVACY
 *
 *  The caller sends a compact digest, never the whole ledger, and nothing here
 *  is logged. Entries in categories their owner marked private are filtered out
 *  on the client before they ever reach this function.
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// The site is served from a different origin to the function, so preflight has
// to be answered. Set ALLOWED_ORIGIN to your deployed URL to narrow this.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Keeps one runaway request from burning the quota. */
const MAX_INPUT_CHARS = 24_000;

type Task = 'categorise' | 'ask' | 'summarise';

interface Payload {
  task: Task;
  // categorise
  merchant?: string;
  amount?: number;
  categories?: Array<{ id: string; label: string; group?: string }>;
  // ask / summarise
  question?: string;
  summary?: unknown; // compact ledger digest built by the client
}

const SYSTEM = [
  'You are the assistant inside Huat Huat, a manual budget ledger that a couple',
  'keeps by hand. You are concise, concrete and never preachy about money.',
  'You never invent figures: if the data given does not answer the question,',
  'say exactly what is missing. Amounts are in the currency the data uses;',
  'do not convert. Keep answers under 120 words unless asked for detail.',
].join(' ');

function buildPrompt(p: Payload): { prompt: string; jsonOnly: boolean } {
  switch (p.task) {
    case 'categorise': {
      const list = (p.categories ?? [])
        .map((c) => `${c.id} = ${c.label}${c.group ? ` (${c.group})` : ''}`)
        .join('\n');
      return {
        jsonOnly: true,
        prompt:
          `Pick the single best category for this transaction.\n\n` +
          `Merchant: ${p.merchant ?? '(none)'}\n` +
          `Amount: ${p.amount ?? '(unknown)'}\n\n` +
          `Categories:\n${list}\n\n` +
          `Reply with JSON only: {"categoryId":"<id>","confidence":<0-1>}\n` +
          `Use null for categoryId if nothing fits.`,
      };
    }
    case 'ask':
      return {
        jsonOnly: false,
        prompt:
          `Here is a digest of the ledger as JSON:\n\n${JSON.stringify(p.summary ?? {})}\n\n` +
          `Question: ${p.question ?? ''}\n\n` +
          `Answer from this data alone.`,
      };
    case 'summarise':
      return {
        jsonOnly: false,
        prompt:
          `Here is a digest of the month as JSON:\n\n${JSON.stringify(p.summary ?? {})}\n\n` +
          `Write a short monthly recap for the two people who keep this ledger: ` +
          `what moved, what overran its plan, and one thing worth watching. ` +
          `Plain prose, no headings, no bullet points.`,
      };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  if (!GEMINI_API_KEY) {
    // Explicit, because this is the single most likely setup mistake.
    return json(
      { error: 'NO_API_KEY', message: 'GEMINI_API_KEY is not set on this function. See the README.' },
      503,
    );
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }

  if (!payload || !['categorise', 'ask', 'summarise'].includes(payload.task)) {
    return json({ error: 'task must be one of: categorise, ask, summarise' }, 400);
  }

  const { prompt, jsonOnly } = buildPrompt(payload);
  if (prompt.length > MAX_INPUT_CHARS) {
    return json({ error: 'TOO_LARGE', message: 'That is more ledger than the assistant can read at once.' }, 413);
  }

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: jsonOnly ? 0 : 0.4,
          maxOutputTokens: jsonOnly ? 120 : 600,
          ...(jsonOnly ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      // Surface the status so the client can tell "bad key" from "rate limited",
      // but never echo the key or the full upstream body to the browser.
      console.error('[assistant] gemini error', res.status, detail.slice(0, 300));
      return json(
        {
          error: 'UPSTREAM',
          status: res.status,
          message:
            res.status === 400 || res.status === 403
              ? 'Gemini rejected the request — check the API key, and that the model name is available to it.'
              : 'The assistant could not be reached. Try again in a moment.',
        },
        502,
      );
    }

    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';

    if (!text.trim()) {
      return json({ error: 'EMPTY', message: 'The assistant had nothing to say.' }, 502);
    }

    if (jsonOnly) {
      try {
        return json({ ok: true, result: JSON.parse(text) });
      } catch {
        return json({ error: 'BAD_JSON', message: 'The assistant did not return usable JSON.' }, 502);
      }
    }

    return json({ ok: true, text: text.trim() });
  } catch (err) {
    console.error('[assistant] failed', err instanceof Error ? err.message : err);
    return json({ error: 'FAILED', message: 'The assistant could not be reached.' }, 502);
  }
});
