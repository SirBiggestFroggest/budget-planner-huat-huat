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
 *  SET UP
 *      supabase secrets set GEMINI_API_KEY=...        (never commit it)
 *      supabase functions deploy assistant
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

type Task = 'chat' | 'categorise' | 'summarise' | 'insights';

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

  const tasks: Task[] = ['chat', 'categorise', 'summarise', 'insights'];
  if (!payload || !tasks.includes(payload.task)) {
    return json({ error: `task must be one of: ${tasks.join(', ')}` }, 400);
  }

  const { contents, jsonOnly, useTools } = buildRequest(payload);
  if (!contents.length) return json({ error: 'Nothing to say.' }, 400);

  const body = JSON.stringify({
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

  if (body.length > MAX_INPUT_CHARS) {
    return json({ error: 'TOO_LARGE', message: 'That is more ledger than the assistant can read at once.' }, 413);
  }

  let lastStatus = 0;

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
      console.error('[assistant] gemini', res.status, 'on', model, (await res.text()).slice(0, 300));
      // 404 = model gone for this key, 429/503 = busy. Both are worth retrying
      // on the next model. A 400 or 403 is about the request or the key itself,
      // so another model will fail identically — stop and report.
      if (res.status === 400 || res.status === 401 || res.status === 403) break;
      continue;
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text: string = parts
      .map((x: { text?: string }) => x.text ?? '')
      .join('')
      .trim();
    const call = parts.find((x: { functionCall?: unknown }) => x.functionCall)?.functionCall;

    if (call) {
      // A proposal, not a change. The page confirms it with the person.
      return json({ ok: true, model, action: { name: call.name, args: call.args ?? {} }, text });
    }

    if (!text) {
      lastStatus = 502;
      console.error('[assistant] empty candidate on', model, 'finish:', data?.candidates?.[0]?.finishReason);
      continue;
    }

    if (jsonOnly) {
      try {
        return json({ ok: true, model, result: JSON.parse(text) });
      } catch {
        lastStatus = 502;
        continue;
      }
    }

    return json({ ok: true, model, text });
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
