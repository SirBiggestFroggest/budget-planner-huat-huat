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
 *  TASKS
 *    chat        a conversation, which may propose an action to confirm
 *    categorise  one transaction -> one category id
 *    summarise   a month -> a short recap
 *    insights    unprompted observations about the ledger
 *
 *  ACTIONS
 *
 *  The model can propose logging an entry, setting a budget line or setting a
 *  goal contribution. It proposes; it never performs. The function returns the
 *  proposal, the page shows it as a card, and nothing touches the ledger until
 *  the person presses Save. That boundary is deliberate: a mis-heard "spent
 *  forty" should cost a glance, not a wrong number in a shared book.
 *
 *  LOOKING THINGS UP
 *
 *  Two of the tools are read-only, so this function runs them itself and hands
 *  the answer back to the model, which then writes the reply. The other three
 *  change the ledger and are never run here — they come back as proposals.
 *  Read is safe to do on your behalf; write is not.
 *
 *  `search_web` is a function declaration rather than Gemini's own grounding
 *  because the API refuses a request that carries a search tool alongside
 *  ordinary function declarations: "multiple tools are supported only when they
 *  are all search tools". Grounding is therefore done in a second, separate
 *  call that carries nothing else, and its text is returned as this tool's
 *  result. That keeps the ledger tools working, which switching the whole
 *  request to grounding would not.
 *
 *  SET UP
 *      supabase secrets set GEMINI_API_KEY=...        (never commit it)
 *      supabase secrets set QUOTES_API_KEY=...        (optional, finnhub.io)
 *      supabase functions deploy assistant
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

/** Finnhub, free tier. Optional: without it the assistant simply says it cannot
 *  look up a price, rather than guessing one. */
const QUOTES_API_KEY = Deno.env.get('QUOTES_API_KEY') ?? '';

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
const MAX_INPUT_CHARS = 60_000;
const MAX_TURNS = 24;

type Task = 'chat' | 'categorise' | 'summarise' | 'insights' | 'diagnose';

interface Turn {
  role: 'user' | 'model';
  text: string;
}

interface Payload {
  task: Task;
  messages?: Turn[];
  context?: unknown;
  merchant?: string;
  amount?: number;
  categories?: Array<{ id: string; label: string; group?: string }>;
  summary?: unknown;
}

// ---------------------------------------------------------------------------
// What the model is allowed to propose
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'log_entry',
        description:
          'Propose a new ledger entry from what the person described. Only call this when they are clearly ' +
          'recording something they spent or received, not when they are asking a question about past spending.',
        parameters: {
          type: 'OBJECT',
          properties: {
            amount: {
              type: 'NUMBER',
              description: 'Negative for money out, positive for money in. E.g. -23.50 for spending 23.50.',
            },
            merchant: { type: 'STRING', description: 'Who it was paid to, or received from.' },
            categoryId: {
              type: 'STRING',
              description: 'Must be one of the category ids given in the context. Omit if none fits.',
            },
            date: {
              type: 'STRING',
              description: 'YYYY-MM-DD. Resolve "yesterday" and similar against today in the context.',
            },
            memberId: {
              type: 'STRING',
              description: 'Who paid: one of the member ids in the context. Omit to use the person asking.',
            },
            note: { type: 'STRING', description: 'Anything else they said about it.' },
          },
          required: ['amount', 'merchant'],
        },
      },
      {
        name: 'set_budget_line',
        description: 'Propose changing the planned amount for one budget category this month.',
        parameters: {
          type: 'OBJECT',
          properties: {
            groupId: { type: 'STRING', description: 'The budget group id from the context.' },
            planned: { type: 'NUMBER', description: 'The new monthly planned amount, positive.' },
            reason: { type: 'STRING', description: 'One short sentence on why this figure.' },
          },
          required: ['groupId', 'planned'],
        },
      },
      {
        name: 'search_web',
        description:
          'Look something up on the web when the answer depends on the world rather than the ledger: ' +
          'rates, prices, what something typically costs, whether a company has had news. ' +
          'Do not use it for anything the ledger already knows.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'What to search for, as you would type it.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_quote',
        description:
          'The current price of one listed share or ETF by ticker. Use this rather than search_web ' +
          'when an exact figure is wanted, such as valuing a holding.',
        parameters: {
          type: 'OBJECT',
          properties: {
            symbol: { type: 'STRING', description: 'Ticker, e.g. AAPL. Uppercase.' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'set_goal_contribution',
        description: 'Propose how much to put towards a savings goal each month.',
        parameters: {
          type: 'OBJECT',
          properties: {
            goalId: { type: 'STRING', description: 'The goal id from the context.' },
            memberId: { type: 'STRING', description: 'Which member contributes.' },
            amount: { type: 'NUMBER', description: 'Monthly amount, positive.' },
            reason: { type: 'STRING', description: 'One short sentence on why this figure.' },
          },
          required: ['goalId', 'amount'],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// The tools this function runs itself
// ---------------------------------------------------------------------------
//
// Strictly read-only. Nothing here can change the ledger; the tools that can
// are returned to the page as proposals and confirmed by a person.

const LOOKUPS = new Set(['search_web', 'get_quote']);

/** How many times the model may look something up before answering. Two is
 *  enough for "price of X, and is that high?" and bounds a model that would
 *  otherwise search in circles on a question the web cannot settle. */
const MAX_LOOKUPS = 2;

/** A search-grounded call carrying no other tools, because the API will not
 *  accept grounding beside function declarations. */
async function searchWeb(query: string): Promise<{ text?: string; detail?: string }> {
  let detail = 'no model was tried';

  for (const model of MODELS) {
    try {
      const res = await fetch(endpointFor(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
          // These models think before answering and the thinking is paid for out
          // of this budget. 1024 was enough for the thinking and nothing else,
          // so the candidate came back with no text at all and the search looked
          // like it had failed. The same trap already cost this project once, in
          // categorise.
          generationConfig: { temperature: 0, maxOutputTokens: 4096 },
        }),
      });

      if (!res.ok) {
        detail = `${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
        console.error('[assistant] search', detail);
        continue;
      }

      const data = await res.json();
      const candidate = data?.candidates?.[0];
      const text: string = (candidate?.content?.parts ?? [])
        .map((x: { text?: string }) => x.text ?? '')
        .join('')
        .trim();

      if (text) return { text };

      detail = `${model}: empty candidate, finishReason=${candidate?.finishReason ?? 'none'}`;
      console.error('[assistant] search', detail);
    } catch (err) {
      detail = `${model}: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[assistant] search', detail);
    }
  }

  return { detail };
}

/** A price, from whichever source can answer.
 *
 *  Finnhub first, because that is the key you chose to set. Its free tier is
 *  essentially US-listed, so "the OCBC share price" came back empty from it —
 *  the bank is O39 on the SGX. Yahoo's chart endpoint needs no key and covers
 *  those markets, so it catches what Finnhub cannot. Checked against each
 *  other on AAPL: both returned 332.89.
 *
 *  Yahoo is unofficial and could change without notice, which is why it is the
 *  fallback and not the first choice.
 */
async function getQuote(symbol: string): Promise<Record<string, unknown>> {
  const ticker = String(symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-:^]{1,15}$/.test(ticker)) {
    return { error: 'That does not look like a ticker.' };
  }

  if (QUOTES_API_KEY) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${QUOTES_API_KEY}`,
      );
      if (res.ok) {
        const q = await res.json();
        // An unknown ticker answers with zeroes rather than an error here, which
        // would otherwise be reported as a share worth nothing.
        if (q && typeof q.c === 'number' && q.c !== 0) {
          return {
            source: 'finnhub',
            symbol: ticker,
            price: q.c,
            change: q.d,
            changePercent: q.dp,
            previousClose: q.pc,
            high: q.h,
            low: q.l,
            asOf: new Date().toISOString(),
          };
        }
      } else {
        console.error('[assistant] finnhub', res.status, 'for', ticker);
      }
    } catch (err) {
      console.error('[assistant] finnhub failed', err instanceof Error ? err.message : err);
    }
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) {
      return { error: `No price found for ${ticker}. It may be unlisted or the wrong ticker.` };
    }
    const d = await res.json();
    const meta = d?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number') {
      return { error: `No price found for ${ticker}. It may be unlisted or the wrong ticker.` };
    }
    const prev = meta?.previousClose ?? meta?.chartPreviousClose;
    return {
      source: 'yahoo',
      symbol: meta?.symbol ?? ticker,
      name: meta?.shortName,
      // Currency is not decoration here: OCBC quotes in SGD and Apple in USD,
      // and a bare number beside a ledger of one currency invites the wrong sum.
      currency: meta?.currency,
      price,
      previousClose: prev,
      change: typeof prev === 'number' ? Number((price - prev).toFixed(4)) : undefined,
      changePercent:
        typeof prev === 'number' && prev !== 0
          ? Number((((price - prev) / prev) * 100).toFixed(4))
          : undefined,
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[assistant] yahoo failed', err instanceof Error ? err.message : err);
    return { error: 'No price service could be reached.' };
  }
}

async function runLookup(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'search_web') {
    const r = await searchWeb(String(args?.query ?? ''));
    // The model is told it failed, not why. The reason is for the logs and the
    // diagnose task; repeating an HTTP status back to someone asking about a
    // share price helps nobody.
    if (r.text) return { result: r.text };
    // 429 is the grounded-search quota, which is far smaller than the ordinary
    // one. Worth naming: it is a billing setting, not a broken feature.
    const quota = (r.detail ?? '').includes('429');
    return {
      error: quota
        ? 'Web search is out of quota on this key today, so nothing could be looked up.'
        : 'The search came back with nothing.',
    };
  }
  if (name === 'get_quote') return await getQuote(String(args?.symbol ?? ''));
  return { error: 'Unknown lookup.' };
}

const SYSTEM = [
  'You are the assistant inside Huat Huat, a manual budget ledger a couple keeps by hand.',
  'You are concise, concrete and never preachy about money.',
  '',
  'Ground every figure in the ledger context you are given. Never invent a number.',
  'If the context does not contain what is needed, say exactly what is missing —',
  'the context is a summary, so it may genuinely not include a detail.',
  'Amounts are in the currency the data uses; never convert.',
  '',
  'When the person is recording something they spent or received, call log_entry.',
  'When they ask what to budget or whether they can afford something, answer from',
  'their actual history, and call set_budget_line or set_goal_contribution if a',
  'specific figure follows. Everything you propose is shown to them for approval',
  'before it is saved, so propose a concrete figure rather than asking them to pick.',
  '',
  'Do not call a tool merely to answer a question about past spending.',
  '',
  'You can look things up. Use get_quote for the price of a listed share or ETF,',
  'and search_web for anything else that depends on the world rather than the',
  'ledger. Prefer the ledger when it already holds the answer.',
  'Say where a figure came from, and when it was as of, so a price is never',
  'mistaken for something they recorded. If a lookup comes back with an error or',
  'nothing, say so plainly — never fill the gap with a number you remember,',
  'because a remembered price is always stale and reads exactly like a real one.',
  'Looking something up never changes the ledger; only the proposals do.',
  'Keep replies under 120 words unless asked for more.',
].join('\n');

/** Keep the most recent exchanges; a long scrollback is mostly noise, and all
 *  of it is billed on every request. */
function clampTurns(messages: Turn[]): Turn[] {
  return messages.slice(-MAX_TURNS);
}

function buildRequest(p: Payload) {
  switch (p.task) {
    case 'categorise': {
      const list = (p.categories ?? [])
        .map((c) => `${c.id} = ${c.label}${c.group ? ` (${c.group})` : ''}`)
        .join('\n');
      return {
        jsonOnly: true,
        useTools: false,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Pick the single best category for this transaction.\n\n` +
                  `Merchant: ${p.merchant ?? '(none)'}\n` +
                  `Amount: ${p.amount ?? '(unknown)'}\n\n` +
                  `Categories:\n${list}\n\n` +
                  `Reply with JSON only: {"categoryId":"<id>","confidence":<0-1>}\n` +
                  `Use null for categoryId if nothing fits.`,
              },
            ],
          },
        ],
      };
    }

    case 'summarise':
      return {
        jsonOnly: false,
        useTools: false,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Here is a digest of the month as JSON:\n\n${JSON.stringify(p.summary ?? {})}\n\n` +
                  `Write a short monthly recap for the two people who keep this ledger: ` +
                  `what moved, what overran its plan, and one thing worth watching. ` +
                  `Plain prose, no headings, no bullet points.`,
              },
            ],
          },
        ],
      };

    case 'insights':
      return {
        jsonOnly: false,
        useTools: false,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `Here is the ledger as JSON:\n\n${JSON.stringify(p.summary ?? {})}\n\n` +
                  `Without being asked, point out at most three things worth their attention: ` +
                  `charges that repeat and look like a forgotten subscription, spending well ` +
                  `outside their usual pattern, and any category drifting over plan. ` +
                  `One short sentence each, as a plain list with no headings. ` +
                  `If nothing stands out, say so in one line and stop.`,
              },
            ],
          },
        ],
      };

    case 'chat':
    default: {
      const contents = clampTurns(p.messages ?? []).map((t) => ({
        role: t.role === 'model' ? 'model' : 'user',
        parts: [{ text: t.text }],
      }));
      // The ledger rides on the first turn, so it is not repeated every message.
      if (contents.length) {
        contents[0] = {
          role: 'user',
          parts: [
            {
              text:
                `Ledger context as JSON:\n\n${JSON.stringify(p.context ?? {})}\n\n---\n\n` +
                contents[0].parts[0].text,
            },
          ],
        };
      }
      return { jsonOnly: false, useTools: true, contents };
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  if (!GEMINI_API_KEY) {
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

  const tasks: Task[] = ['chat', 'categorise', 'summarise', 'insights', 'diagnose'];
  if (!payload || !tasks.includes(payload.task)) {
    return json({ error: `task must be one of: ${tasks.join(', ')}` }, 400);
  }

  // A task that exercises the two lookups and says exactly what came back.
  // Read-only, and it reaches nothing a chat could not reach — it exists so a
  // broken lookup can be diagnosed without hunting through logs, which is how
  // the thought_signature failure had to be found.
  if (payload.task === 'diagnose') {
    const symbol = String((payload as { symbol?: string }).symbol ?? 'AAPL');
    const query = String((payload as { query?: string }).query ?? 'current price of OCBC shares');
    const [search, quote] = await Promise.all([searchWeb(query), getQuote(symbol)]);
    return json({
      ok: true,
      models: MODELS,
      quotesKeySet: Boolean(QUOTES_API_KEY),
      search: search.text ? { ok: true, sample: search.text.slice(0, 300) } : { ok: false, detail: search.detail },
      quote,
    });
  }

  const { contents, jsonOnly, useTools } = buildRequest(payload);
  if (!contents.length) return json({ error: 'Nothing to say.' }, 400);

  // Rebuilt after each lookup: the model's own call and the result are appended
  // to contents so it can answer with what came back.
  const makeBody = () => JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    ...(useTools ? { tools: TOOLS } : {}),
    generationConfig: {
      temperature: jsonOnly ? 0 : 0.4,
      // Current flash models "think" before answering, and those thinking
      // tokens come out of maxOutputTokens. Picking a category needs no
      // reasoning, and leaving thinking on burned the entire budget before a
      // single character of JSON was emitted — the reply came back truncated
      // and unparseable. Everything else keeps thinking, with room to afford it.
      maxOutputTokens: jsonOnly ? 256 : 2048,
      ...(jsonOnly
        ? { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
  });

  let body = makeBody();

  if (body.length > MAX_INPUT_CHARS) {
    return json({ error: 'TOO_LARGE', message: 'That is more ledger than the assistant can read at once.' }, 413);
  }

  let lastStatus = 0;
  let lookups = 0;
  let upstreamDetail = '';

  // Two loops, not one flattened list. A lookup has to re-ask the *same* model
  // with the result in hand, while a failure has to move on to the next one —
  // and a single list cannot tell those apart. Repeating each model in the list
  // instead made every genuine failure take four times as long, which turned a
  // couple of slow models into a 150-second idle timeout.
  // Labelled, because the inner loop means "ask this model again" and some
  // failures have to leave both loops at once. Without the label the retryable
  // branch below would re-ask the same failing model forever.
  outer: for (const model of MODELS) {
    let hop = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
      break;
    }

    if (!res.ok) {
      lastStatus = res.status;
      // Keep what Gemini actually said. A 400 is usually a malformed request,
      // and reporting it as "check your key" sends you to look at the one thing
      // that is demonstrably fine — which is exactly how this was first
      // misdiagnosed.
      upstreamDetail = (await res.text()).slice(0, 400);
      console.error('[assistant] gemini', res.status, 'on', model, upstreamDetail);
      // 404 = model gone for this key, 429/503 = busy. Both are worth trying
      // on the next model. A 400 or 403 is about the request or the key itself,
      // so another model will fail identically — stop and report.
      // A 400 or 403 is the request or the key: every other model fails the
      // same way, so stop asking.
      if (res.status === 400 || res.status === 401 || res.status === 403) break outer;
      // 404 = gone for this key, 429/503 = busy. Worth trying the next model,
      // never worth hammering this one.
      break;
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text: string = parts
      .map((x: { text?: string }) => x.text ?? '')
      .join('')
      .trim();
    const call = parts.find((x: { functionCall?: unknown }) => x.functionCall)?.functionCall;

    if (call) {
      // Read-only? Run it here and let the model carry on. Anything that would
      // change the ledger is returned instead, for a person to confirm.
      if (LOOKUPS.has(call.name)) {
        // Asked once too often: nudge it to answer. `hop` has to rise here too —
        // without that the nudge could be given forever to a model that keeps
        // asking, which is an endless loop ending in the 150s idle timeout.
        if (hop === MAX_LOOKUPS) {
          hop += 1;
          console.error('[assistant] lookup limit reached, nudging past', call.name);
          contents.push({
            role: 'user',
            parts: [{ text: 'You have looked things up enough. Answer with what you have.' }],
          });
          body = makeBody();
          continue;
        }

        // Nudged and still asking. Stop and say so rather than loop.
        if (hop > MAX_LOOKUPS) {
          console.error('[assistant] still calling', call.name, 'after the nudge; giving up');
          return json({
            ok: true,
            model,
            text: text || 'I could not finish looking that up. Ask me again in a moment.',
          });
        }

        hop += 1;
        lookups += 1;
        const result = await runLookup(call.name, (call.args ?? {}) as Record<string, unknown>);

        // Both halves are required: the model's own call, then its result.
        // Sending only the result leaves a reply that answers nothing.
        // contents was inferred from text-only turns, so these parts are widened
        // rather than fought with; Deno typechecks on deploy and would otherwise
        // refuse the function.
        const turns = contents as Array<Record<string, unknown>>;

        // The model's turn goes back exactly as it arrived. Rebuilding it as
        // { functionCall: call } looks equivalent and is not: a thinking model
        // attaches a thoughtSignature to that part, and sending the call back
        // without it is refused outright —
        //   "Function call is missing a thought_signature in functionCall
        //    parts ... function call `default_api:get_quote`, position 2"
        // Passing the whole content through also keeps any text or thought
        // parts that sat beside the call.
        const modelTurn = data?.candidates?.[0]?.content;
        turns.push(
          modelTurn && Array.isArray(modelTurn.parts)
            ? modelTurn
            : { role: 'model', parts: [{ functionCall: call }] },
        );
        turns.push({
          role: 'user',
          parts: [{ functionResponse: { name: call.name, response: result } }],
        });

        body = makeBody();
        if (body.length > MAX_INPUT_CHARS) {
          return json(
            { error: 'TOO_LARGE', message: 'That answer grew past what the assistant can hold.' },
            413,
          );
        }
        continue;
      }

      // A proposal, not a change. The page confirms it with the person.
      return json({ ok: true, model, action: { name: call.name, args: call.args ?? {} }, text });
    }

    if (!text) {
      lastStatus = 502;
      console.error('[assistant] empty candidate on', model, 'finish:', data?.candidates?.[0]?.finishReason);
      break;
    }

    if (jsonOnly) {
      try {
        return json({ ok: true, model, result: JSON.parse(text) });
      } catch {
        lastStatus = 502;
        break;
      }
    }

    return json({ ok: true, model, text });
    }
  }

  return json(
    {
      error: 'UPSTREAM',
      status: lastStatus,
      message:
        lastStatus === 401 || lastStatus === 403
          ? 'Gemini refused the key. Check GEMINI_API_KEY.'
          : lastStatus === 400
            ? 'Gemini rejected the request itself. The reason is in `detail`.'
            : 'Every model was unavailable just now. Try again in a moment.',
      detail: upstreamDetail || undefined,
    },
    502,
  );
});
