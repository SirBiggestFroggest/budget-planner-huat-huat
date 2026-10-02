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

/** Models to try, in order, until one answers.
 *
 *  Two things learned the hard way, both verified against a live key:
 *
 *  - `gemini-2.5-flash` is still *listed* by the models endpoint but returns
 *    404 "no longer available to new users" when actually called. Listing a
 *    model is not proof you can use it.
 *  - Flash models 503 under load often enough to matter, and it is transient.
 *    One name alone makes the assistant flaky for no reason.
 *
 *  GEMINI_MODEL overrides the whole chain with a single name.
 */
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const MODELS = (() => {
  const pinned = Deno.env.get('GEMINI_MODEL');
  return pinned ? [pinned] : FALLBACK_MODELS;
})();

const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: jsonOnly ? 0 : 0.4,
      // Current flash models "think" before answering, and those thinking
      // tokens come out of maxOutputTokens. Picking a category needs no
      // reasoning, and leaving thinking on burned the entire budget before a
      // single character of JSON was emitted — the reply came back truncated
      // and unparseable. Prose answers keep thinking, with room to afford it.
      maxOutputTokens: jsonOnly ? 256 : 2048,
      ...(jsonOnly
        ? { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
  });

  let lastStatus = 0;
  let lastDetail = '';

  for (const model of MODELS) {
    let res: Response;
    try {
      res = await fetch(endpointFor(model), {
        method: 'POST',
        // The key goes in a header, not the query string, so it cannot be
        // captured by anything that logs URLs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body,
      });
    } catch (err) {
      console.error('[assistant] network failure on', model, err instanceof Error ? err.message : err);
      lastStatus = 0;
      continue;
    }

    if (!res.ok) {
      lastStatus = res.status;
      lastDetail = (await res.text()).slice(0, 300);
      // 404 = model gone for this key, 429/503 = busy. Both are worth retrying
      // on the next model. A 400 or 403 is about the request or the key itself,
      // so another model will fail identically — stop and report.
      console.error('[assistant] gemini', res.status, 'on', model, lastDetail);
      if (res.status === 400 || res.status === 401 || res.status === 403) break;
      continue;
    }

    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';

    if (!text.trim()) {
      lastStatus = 502;
      lastDetail = 'empty candidate, finishReason=' + (data?.candidates?.[0]?.finishReason ?? '?');
      console.error('[assistant]', lastDetail, 'on', model);
      continue;
    }

    if (jsonOnly) {
      try {
        return json({ ok: true, model, result: JSON.parse(text) });
      } catch {
        lastStatus = 502;
        lastDetail = 'unparseable JSON';
        continue;
      }
    }

    return json({ ok: true, model, text: text.trim() });
  }

  return json(
    {
      error: 'UPSTREAM',
      status: lastStatus,
      message:
        lastStatus === 400 || lastStatus === 401 || lastStatus === 403
          ? 'Gemini rejected the request — check that GEMINI_API_KEY is valid.'
          : 'Every model was unavailable just now. Try again in a moment.',
    },
    502,
  );
});
