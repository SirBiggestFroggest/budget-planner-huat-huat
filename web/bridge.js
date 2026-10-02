/** The seam between the ledger bundle and everything outside it.
 *
 *  This is a plain classic script, so it runs to completion before the module
 *  bundle is evaluated. That ordering is the whole trick: by the time the
 *  bundle's top-level constants are built, `window.__hh` already exists, and
 *  the places the bundle was patched to call into it resolve.
 *
 *  What lives here:
 *    - the fresh-account starting state (no demo data, real dates)
 *    - partner-awareness, so a solo ledger never mentions a partner
 *    - sign-in through Supabase (Google, or a real emailed magic link)
 *    - the ledger document, stored per user in Supabase Postgres
 *
 *  The app still works with none of it. With no Supabase project configured,
 *  or with nobody signed in, the ledger lives in this browser's localStorage
 *  and the UI says so rather than pretending to sync.
 */
(function () {
  'use strict';

  var STORE_KEY = 'huat-huat.ledger.v2';
  var LEGACY_KEYS = ['huat-huat.ledger.v1'];
  var META_KEY = 'huat-huat.sync.v1';
  var DEVICE_KEY = 'huat-huat.device.v1';
  var PUSH_DEBOUNCE = 2500;

  var ME = 'nia'; // internal slot ids the bundle was built around
  var PARTNER = 'theo';
  var JOINT = 'joint';

  var UI = window.__hhUI;

  // -------------------------------------------------------------------------
  // Dates
  // -------------------------------------------------------------------------

  /** Local calendar date, not UTC — an entry belongs to the day the person is
   *  living in, not the day in Greenwich. */
  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function thisMonth() {
    return todayISO().slice(0, 7);
  }

  // -------------------------------------------------------------------------
  // Fresh account
  // -------------------------------------------------------------------------

  /** Starter categories. Deliberately generic: a new ledger should be usable on
   *  day one without being someone else's budget. */
  var GROUPS = [
    ['housing', 'Housing', '#4F6E9A', ['Rent', 'Home & garden']],
    ['food', 'Food & Drink', '#B0542C', ['Groceries', 'Restaurants & bars', 'Coffee']],
    ['bills', 'Bills & Utilities', '#3F5A6E', ['Electric', 'Internet', 'Phone', 'Water & garbage', 'Subscriptions']],
    ['transport', 'Transport', '#6E8F5A', ['Car payment', 'Gas', 'Transit', 'Parking']],
    ['financial', 'Financial', '#8A5A7A', ['Student loan', 'Insurance', 'Fees']],
    ['personal', 'Personal & Fun', '#A88A2E', ['Flex money', 'Shopping', 'Fitness', 'Pets']],
    ['health', 'Health', '#7A7468', ['Medical', 'Pharmacy']],
    ['travel', 'Travel', '#C9A24A', ['Flights', 'Hotels']],
    ['income', 'Income', '#1F6F63', ['Paycheck', 'Invoice paid', 'Rental income', 'Dividends']],
  ];

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Y';
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** A ledger starts with one person and the joint pot. The partner slot is
   *  created only when someone actually adds a partner — until then nothing in
   *  the UI should imply a second person exists. */
  function freshMembers() {
    return [
      { id: ME, name: 'You', initial: 'Y', color: '#4F6E9A', email: null, kind: 'person' },
      { id: JOINT, name: 'Joint', initial: 'J', color: '#3F4A3A', kind: 'joint' },
    ];
  }

  function freshState() {
    var month = thisMonth();
    var groups = GROUPS.map(function (g) {
      return { id: g[0], label: g[1], color: g[2] };
    });
    var categories = GROUPS.reduce(function (acc, g) {
      g[3].forEach(function (text) {
        acc.push({ id: g[0] + ':' + slug(text), groupId: g[0], label: text });
      });
      return acc;
    }, []);

    return {
      members: freshMembers(),
      accounts: [],
      groups: groups,
      categories: categories,
      transactions: [],
      recurring: [],
      goals: [],
      holdings: [],
      dividends: [],
      shares: [],
      budgets: [
        {
          month: month,
          rollover: false,
          lines: groups
            .filter(function (g) {
              return g.id !== 'income';
            })
            .map(function (g) {
              return { id: 'bl_' + month + '_' + g.id, groupId: g.id, label: g.label, color: g.color, planned: 0 };
            }),
          flex: [{ memberId: ME, allowance: 0 }],
        },
      ],
      checkins: [],
      session: null,
      // Categories whose entries never leave this ledger. Empty by default:
      // sharing is the norm in a joint book, privacy is the deliberate choice.
      privateCategories: [],
      months: [month],
      today: todayISO(),
    };
  }

  /** Brings a stored ledger up to the current date.
   *
   *  `today` lives inside the saved state, which was harmless when the
   *  prototype had it frozen at a constant. Now that it is real, a ledger saved
   *  yesterday would still believe it is yesterday until something rewrote it.
   *  Rolling into a new month also needs that month to exist with the plan
   *  carried forward, mirroring what the app already does when an entry lands
   *  in a month it has not seen.
   */
  function rehydrate(state) {
    if (!state || typeof state !== 'object') return state;

    var month = thisMonth();
    var next = Object.assign({}, state, { today: todayISO() });

    // Entries merged in from the household are not ours to keep. They are
    // re-fetched every session, so a stored copy would double them on the next
    // merge and, worse, write another person's spending into our ledger row.
    if (Array.isArray(next.transactions)) {
      next.transactions = next.transactions.filter(function (t) {
        return !t || !t.fromShared;
      });
    }
    if (!Array.isArray(next.privateCategories)) next.privateCategories = [];

    if (!Array.isArray(next.months) || next.months.indexOf(month) !== -1) return next;
    next.months = next.months.concat([month]).sort();

    if (!Array.isArray(next.budgets) || next.budgets.some(function (b) { return b.month === month; })) {
      return next;
    }

    var last = next.budgets[next.budgets.length - 1];
    next.budgets = next.budgets
      .concat([
        {
          month: month,
          rollover: (last && last.rollover) || false,
          lines: ((last && last.lines) || []).map(function (line, i) {
            return Object.assign({}, line, { id: 'bl_' + month + '_' + i });
          }),
          flex: ((last && last.flex) || []).map(function (f) {
            return Object.assign({}, f);
          }),
        },
      ])
      .sort(function (a, b) {
        return a.month < b.month ? -1 : 1;
      });

    return next;
  }

  // -------------------------------------------------------------------------
  // Members and partner awareness
  //
  // Every one of these takes the ledger explicitly rather than reading a cached
  // copy. The bundle calls them during render, and a cache updated from an
  // effect would still hold the previous value at that point — so a partner
  // added a moment ago would not appear until something else re-rendered.
  // -------------------------------------------------------------------------

  function memberOf(state, id) {
    if (!state || !state.members) return null;
    for (var i = 0; i < state.members.length; i++) {
      if (state.members[i].id === id) return state.members[i];
    }
    return null;
  }

  function hasPartner(state) {
    return !!memberOf(state, PARTNER);
  }

  function meName(state) {
    var m = memberOf(state, ME);
    return (m && m.name) || 'You';
  }

  function partnerName(state) {
    var m = memberOf(state, PARTNER);
    return (m && m.name) || 'Partner';
  }

  /** Placeholder for the note field, which flags an entry for the other person.
   *  With nobody else on the ledger there is no one to flag it to. */
  function notePlaceholder(state, memberId) {
    if (!hasPartner(state)) return 'Add a note (optional)';
    var other = memberId === PARTNER ? meName(state) : partnerName(state);
    return 'Note for ' + other + ' (optional)';
  }

  /** " · Sam wrote 3, Alex wrote 1", or nothing at all when solo — every entry
   *  being yours is not worth a sentence. */
  function wroteSuffix(state, stats) {
    if (!hasPartner(state) || !stats) return '';
    return (
      ' · ' + meName(state) + ' wrote ' + stats.byNia + ', ' + partnerName(state) + ' wrote ' + stats.byTheo
    );
  }

  function wroteNote(state, stats) {
    if (!hasPartner(state) || !stats) return '';
    return meName(state) + ' ' + stats.byNia + ' · ' + partnerName(state) + ' ' + stats.byTheo;
  }

  /** Segments for the "who spent what" bar. */
  function spendParts(state, sums) {
    var parts = [{ value: sums.nia, color: 'var(--nia)', label: meName(state) }];
    if (hasPartner(state)) {
      parts.push({ value: sums.theo, color: 'var(--theo)', label: partnerName(state) });
    }
    parts.push({ value: sums.joint, color: 'var(--joint)', label: 'Joint' });
    return parts;
  }

  /** Columns for the recurring "who pays" breakdown. */
  function paidRows(state, sums) {
    var rows = [[meName(state) + ' paid', sums.nia, 'var(--nia)']];
    if (hasPartner(state)) {
      rows.push([partnerName(state) + ' paid', sums.theo, 'var(--theo)']);
    }
    rows.push(['Joint account', sums.joint, 'var(--joint)']);
    return rows;
  }

  /** Goal funding options. Splitting implies two people, so a solo ledger is
   *  offered only the one honest choice. */
  function splitOptions(state) {
    if (!hasPartner(state)) return [[ME, meName(state) + ' alone']];
    return [
      ['even', 'Split evenly'],
      ['income', 'By income'],
      [ME, meName(state) + ' alone'],
      [PARTNER, partnerName(state) + ' alone'],
    ];
  }

  function fundingSplit(state, formatted) {
    if (!hasPartner(state)) return meName(state) + ' ' + formatted[0];
    return meName(state) + ' ' + formatted[0] + ' · ' + partnerName(state) + ' ' + formatted[1];
  }

  // -------------------------------------------------------------------------
  // Identity written onto the ledger
  // -------------------------------------------------------------------------

  /** Keeps the joint avatar's initials in step with whoever is on the ledger. */
  function withJointInitials(members) {
    var people = members.filter(function (m) {
      return m.kind === 'person';
    });
    return members.map(function (m) {
      if (m.kind !== 'joint') return m;
      return Object.assign({}, m, {
        initial:
          people
            .map(function (p) {
              return (p.initial || '?')[0];
            })
            .join('') || 'J',
      });
    });
  }

  function withIdentity(state, profile) {
    var members = state.members.map(function (m) {
      if (m.id !== ME) return m;
      return Object.assign({}, m, {
        name: profile.name,
        email: profile.email || null,
        initial: initialsOf(profile.name),
        color: profile.color || m.color,
      });
    });

    var shares = (state.shares || []).filter(function (s) {
      return s.memberId !== ME;
    });
    shares = shares.concat([
      {
        id: 'sh_' + ME,
        memberId: ME,
        name: profile.name,
        email: profile.email || null,
        role: 'Full access',
        scope: 'Everything',
        status: 'active',
      },
    ]);

    return Object.assign({}, state, {
      members: withJointInitials(members),
      shares: shares,
      today: todayISO(),
    });
  }

  /** Adds, updates or removes the partner slot. */
  function withPartner(state, partner) {
    var members = state.members.filter(function (m) {
      return m.id !== PARTNER;
    });
    var shares = (state.shares || []).filter(function (s) {
      return s.memberId !== PARTNER;
    });

    if (partner) {
      // Keep the partner between the owner and the joint pot, so avatar rows
      // and member pickers read in a sensible order.
      var jointAt = -1;
      for (var i = 0; i < members.length; i++) {
        if (members[i].kind === 'joint') {
          jointAt = i;
          break;
        }
      }
      var row = {
        id: PARTNER,
        name: partner.name,
        initial: initialsOf(partner.name),
        color: partner.color || '#B0542C',
        email: partner.email || null,
        kind: 'person',
      };
      if (jointAt === -1) members.push(row);
      else members.splice(jointAt, 0, row);

      shares = shares.concat([
        {
          id: 'sh_' + PARTNER,
          memberId: PARTNER,
          name: partner.name,
          email: partner.email || null,
          role: 'Full access',
          scope: 'Everything',
          status: 'active',
        },
      ]);
    }

    return Object.assign({}, state, { members: withJointInitials(members), shares: shares });
  }

  // -------------------------------------------------------------------------
  // Local storage bookkeeping
  // -------------------------------------------------------------------------

  function readMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeMeta(patch) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(Object.assign(readMeta(), patch)));
    } catch (e) {
      /* storage can be unavailable; sync degrades, the app does not */
    }
  }

  /** Stable per-browser id, so a realtime echo of our own write is recognisable
   *  and does not bounce back as "your other device changed this". */
  function deviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'dev_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return 'dev_ephemeral';
    }
  }

  // -------------------------------------------------------------------------
  // Supabase
  // -------------------------------------------------------------------------

  var cfg = window.HUAT_CONFIG || {};
  var configured =
    !!cfg.supabaseUrl &&
    !!cfg.supabaseAnonKey &&
    !/^YOUR_/.test(cfg.supabaseUrl) &&
    !/^YOUR_/.test(cfg.supabaseAnonKey);

  var sb = null;
  if (configured && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  var user = null; // supabase auth user
  var latestState = null;
  var dispatch = null;
  var pushTimer = null;
  var sharedPushTimer = null;
  var applyingRemote = false;
  var started = false;
  var channel = null;

  function accountEmail() {
    return (user && user.email) || null;
  }

  function profileFromAuth() {
    if (!user) return null;
    var m = user.user_metadata || {};
    return {
      name: m.full_name || m.name || (user.email ? user.email.split('@')[0] : 'You'),
      email: user.email || null,
    };
  }

  // -------------------------------------------------------------------------
  // Applying a ledger from elsewhere
  // -------------------------------------------------------------------------

  /** The bundle's reducer already has an `import` case that swaps the whole
   *  ledger, which is exactly what adopting a remote copy needs. */
  function applyState(next) {
    if (!dispatch || !next) return;
    applyingRemote = true;
    dispatch({ t: 'import', state: next });
    // Cleared on a macrotask, after React has flushed the reducer and run the
    // save effect that calls back into onState.
    window.setTimeout(function () {
      applyingRemote = false;
    }, 0);
  }

  // -------------------------------------------------------------------------
  // Pull / push
  // -------------------------------------------------------------------------

  async function pull() {
    if (!sb || !user) return null;
    var res = await sb.from('ledgers').select('state, updated_at, device').eq('user_id', user.id).maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) return null;
    return { state: res.data.state, updatedAt: res.data.updated_at, device: res.data.device };
  }

  async function push(state) {
    if (!sb || !user) return null;
    var res = await sb
      .from('ledgers')
      .upsert({ user_id: user.id, state: state, device: deviceId() }, { onConflict: 'user_id' })
      .select('updated_at')
      .single();
    if (res.error) throw res.error;
    return res.data.updated_at;
  }

  function schedulePush() {
    if (!sb || !user) return;
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(pushNow, PUSH_DEBOUNCE);
  }

  async function pushNow() {
    if (!sb || !user || !latestState) return;
    try {
      UI.status('Saving…', 'ok', true);
      var updatedAt = await push(latestState);
      writeMeta({ syncedAt: updatedAt, localChangedAt: null });
      UI.status('Saved');
    } catch (err) {
      console.error('[sync] push failed', err);
      UI.status('Offline — saved in this browser', 'error');
    }
  }

  /** Decides whose copy wins and applies it. Last write wins, judged by the
   *  server's clock rather than any browser's. */
  async function reconcile(reason) {
    if (!sb || !user) return;
    var meta = readMeta();
    try {
      var remote = await pull();

      if (!remote) {
        await pushNow(); // nothing up there yet; this browser seeds the account
        return;
      }

      var localChanged = meta.localChangedAt;
      var remoteIsNewer = !localChanged || remote.updatedAt > localChanged;

      if (remoteIsNewer) {
        applyState(rehydrate(remote.state));
        writeMeta({ syncedAt: remote.updatedAt, localChangedAt: null });
        UI.status(reason === 'remote' ? 'Updated from your other device' : 'Ledger loaded');
      } else {
        await pushNow();
      }
    } catch (err) {
      console.error('[sync] reconcile failed', err);
      UI.status('Could not reach the server', 'error');
    }
  }

  function watchRemote() {
    if (!sb || !user || channel) return;
    channel = sb
      .channel('ledger:' + user.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ledgers', filter: 'user_id=eq.' + user.id },
        function (payload) {
          var row = payload.new || {};
          if (row.device && row.device === deviceId()) return; // our own write
          reconcile('remote');
        },
      )
      .subscribe();
  }

  function unwatchRemote() {
    if (channel && sb) {
      try {
        sb.removeChannel(channel);
      } catch (e) {
        /* already gone */
      }
    }
    channel = null;
  }

  // -------------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------------

  /** Shown when there is no Supabase project behind the site.
   *
   *  It must offer a way forward as well as an explanation: without one, both
   *  sign-in buttons are dead ends and an unconfigured deployment cannot be
   *  opened at all, which makes it impossible to even look at.
   */
  function notConfigured(appDispatch) {
    UI.message(
      'No account storage yet',
      'This site has no Supabase project configured, so there is nowhere to keep ' +
        'an account. You can still use the ledger — it will be saved in this ' +
        'browser only, and will not follow you to another device.',
      true,
      {
        label: 'Use it in this browser',
        onClick: function () {
          localSignIn(appDispatch);
        },
      },
    );
  }

  var signInFlight = false;

  async function googleSignIn(appDispatch) {
    if (appDispatch) dispatch = appDispatch;
    if (signInFlight) return;
    if (!sb) return notConfigured(appDispatch);

    signInFlight = true;
    try {
      UI.message('Taking you to Google…', 'You will come straight back here once you are signed in.', false);
      var res = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (res.error) throw res.error;
      // On success the browser navigates away; nothing after this runs.
    } catch (err) {
      console.error('[auth] google sign-in failed', err);
      UI.message('Sign-in did not start', err.message || String(err), true);
    } finally {
      signInFlight = false;
    }
  }

  /** The prototype's "email me a sign-in link" never sent an email. Through
   *  Supabase it now genuinely does. */
  async function emailSignIn(appDispatch, email) {
    if (appDispatch) dispatch = appDispatch;
    var address = String(email || '').trim();
    if (!sb) return notConfigured(appDispatch);
    if (!address) {
      return UI.message('Need an email address', 'Type the address you want the sign-in link sent to.', true);
    }

    try {
      UI.message('Sending…', 'Asking for a sign-in link for ' + address + '.', false);
      var res = await sb.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      });
      if (res.error) throw res.error;
      UI.message('Check your inbox', 'A sign-in link is on its way to ' + address + '. Open it in this browser.', true);
    } catch (err) {
      console.error('[auth] magic link failed', err);
      UI.message('Could not send the link', err.message || String(err), true);
    }
  }

  /** Start using the app with no account at all. Honest about the trade. */
  function localSignIn(appDispatch, email) {
    if (appDispatch) dispatch = appDispatch;
    var base = latestState || freshState();
    var address = String(email || '').trim();
    var name = address ? address.split('@')[0] : 'You';
    var next = withIdentity(base, { name: name, email: address || null });
    next.session = { memberId: ME, email: address || null, name: name };
    applyState(next);
    UI.status('Saved in this browser only');
  }

  var signingOut = false;

  /** Signing out clears the screen first and tidies up afterwards.
   *
   *  It used to flush the ledger and revoke the session *before* telling the UI
   *  anything, which meant two network round trips stood between the click and
   *  any visible response. try/catch does not help there: it catches a
   *  rejection, not a request that simply hangs. On a slow or unreachable
   *  connection the button was indistinguishable from broken.
   *
   *  So the session is dropped immediately, and the flush and revoke happen
   *  behind it under a timeout. The worst case is now a ledger that syncs on
   *  next sign-in, rather than somebody stuck on a screen they asked to leave.
   */
  async function signOut(appDispatch) {
    if (appDispatch) dispatch = appDispatch;
    if (signingOut) return;
    signingOut = true;

    window.clearTimeout(pushTimer);
    window.clearTimeout(sharedPushTimer);

    var hadSession = !!(sb && user);
    var pending = latestState;

    unwatchRemote();
    unwatchHousehold();
    if (dispatch) dispatch({ t: 'signOut' });
    UI.status('Signed out');

    /** Never let one stalled call hold the rest up. */
    function bounded(promise) {
      return Promise.race([
        Promise.resolve(promise).catch(function () {}),
        new Promise(function (resolve) {
          window.setTimeout(resolve, 4000);
        }),
      ]);
    }

    // Drop the stored session first, with scope 'local'. Three reasons it is
    // not inside the `hadSession` branch below:
    //   - it touches no network, so it cannot stall;
    //   - without it, a revoke that times out leaves Supabase's token in
    //     localStorage and the next reload signs the person straight back in;
    //   - `hadSession` reflects *our* bookkeeping, and that can disagree with
    //     what Supabase has stored — if the session lookup stalled at startup,
    //     `user` is null while a perfectly good token sits on disk. Gating this
    //     on it would skip the one step that actually signs someone out.
    if (sb) {
      try {
        await sb.auth.signOut({ scope: 'local' });
      } catch (e) {
        /* nothing stored to clear */
      }
    }

    if (hadSession) {
      // Now the parts that do need the network, each bounded so neither can
      // hold up the other.
      await bounded(push(pending)); // `user` is still set, so this can write
      user = null;
      await bounded(sb.auth.signOut({ scope: 'global' })); // revoke server-side
    }

    user = null;
    household = null;
    householdMembers = [];
    writeMeta({ localChangedAt: null });
    signingOut = false;
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  function openProfile(appDispatch, state) {
    if (appDispatch) dispatch = appDispatch;
    var current = state || latestState || freshState();
    var me = memberOf(current, ME) || { name: 'You', email: null, color: '#4F6E9A' };
    var partner = memberOf(current, PARTNER);

    UI.profile({
      accountEmail: accountEmail(),
      me: { name: me.name, email: me.email, color: me.color },
      partner: partner ? { name: partner.name, email: partner.email, color: partner.color } : null,
      onSave: function (result) {
        var next = withIdentity(current, result.me);
        next = withPartner(next, result.partner);
        if (next.session) {
          next.session = Object.assign({}, next.session, { name: result.me.name, email: result.me.email });
        }
        applyState(next);
        UI.status('Profile updated');
      },
    });
  }

  // -------------------------------------------------------------------------
  // Households: two accounts, one shared book
  // -------------------------------------------------------------------------
  //
  // Each person keeps their own private ledger. A household is the overlap.
  // Entries flow into it automatically, except those in categories their owner
  // marked private — so the default is shared and privacy is the deliberate
  // choice, which is the way round a joint book actually works.
  //
  // Shared entries are rows rather than a second document, so two people adding
  // at the same moment cannot overwrite each other.

  var household = null; // { id, name }
  var householdMembers = []; // rows from household_members
  var sharedChannel = null;

  function isPrivateCategory(state, categoryId) {
    if (!categoryId || !state) return false;
    return (state.privateCategories || []).indexOf(categoryId) !== -1;
  }

  /** My transactions that are allowed into the shared book. */
  function shareableTransactions(state) {
    return (state.transactions || []).filter(function (t) {
      return t && !t.fromShared && !isPrivateCategory(state, t.categoryId);
    });
  }

  /** The other people in the household. */
  function otherMembers() {
    return householdMembers.filter(function (m) {
      return !user || m.user_id !== user.id;
    });
  }

  async function loadHousehold() {
    if (!sb || !user) return null;

    // Anything addressed to this email that nobody has claimed becomes ours.
    // This is what lets an invitation exist before the person does.
    try {
      if (user.email) {
        await sb
          .from('household_members')
          .update({ user_id: user.id, status: 'active' })
          .is('user_id', null)
          .ilike('email', user.email);
      }
    } catch (err) {
      console.error('[household] claiming invites failed', err);
    }

    var mine = await sb.from('household_members').select('household_id').eq('user_id', user.id).limit(1);
    if (mine.error) throw mine.error;

    var id = mine.data && mine.data[0] && mine.data[0].household_id;
    if (!id) {
      household = null;
      householdMembers = [];
      return null;
    }

    var h = await sb.from('households').select('id,name').eq('id', id).maybeSingle();
    if (h.error) throw h.error;
    household = h.data || null;

    var members = await sb
      .from('household_members')
      .select('id,user_id,email,display_name,color,status')
      .eq('household_id', id);
    if (members.error) throw members.error;
    householdMembers = members.data || [];

    return household;
  }

  /** Creates the household on first invite. The inviter is a member too. */
  async function ensureHousehold(name) {
    if (household) return household;
    if (!sb || !user) throw new Error('Sign in first.');

    var created = await sb
      .from('households')
      .insert({ name: name || 'Our ledger', created_by: user.id })
      .select('id,name')
      .single();
    if (created.error) throw created.error;

    var me = await sb.from('household_members').insert({
      household_id: created.data.id,
      user_id: user.id,
      email: user.email,
      display_name: meName(latestState || freshState()),
      status: 'active',
    });
    if (me.error) throw me.error;

    household = created.data;
    await loadHousehold();
    return household;
  }

  async function inviteMember(email, displayName) {
    var address = String(email || '').trim().toLowerCase();
    if (!address) throw new Error('Enter an email address.');
    if (user && address === String(user.email || '').toLowerCase()) {
      throw new Error('That is your own address.');
    }

    await ensureHousehold();
    var res = await sb.from('household_members').insert({
      household_id: household.id,
      email: address,
      display_name: displayName || address.split('@')[0],
      color: '#B0542C',
      status: 'invited',
    });
    // 23505 is a unique violation: already invited, which is not an error here.
    if (res.error && res.error.code !== '23505') throw res.error;
    await loadHousehold();
  }

  async function removeMember(memberRowId) {
    var res = await sb.from('household_members').delete().eq('id', memberRowId);
    if (res.error) throw res.error;
    await loadHousehold();
  }

  // --- pushing our side ----------------------------------------------------

  /** Mirrors our shareable entries into the household, and withdraws any that
   *  no longer qualify — deleted, or moved into a private category. */
  async function pushShared(state) {
    if (!sb || !user || !household) return;

    var mine = shareableTransactions(state);
    var rows = mine.map(function (t) {
      return { household_id: household.id, author_id: user.id, source_tx_id: t.id, tx: t };
    });

    if (rows.length) {
      var up = await sb
        .from('shared_entries')
        .upsert(rows, { onConflict: 'household_id,author_id,source_tx_id' });
      if (up.error) throw up.error;
    }

    // Withdraw anything of ours up there that is no longer shareable.
    var existing = await sb
      .from('shared_entries')
      .select('source_tx_id')
      .eq('household_id', household.id)
      .eq('author_id', user.id);
    if (existing.error) throw existing.error;

    var keep = {};
    mine.forEach(function (t) {
      keep[t.id] = true;
    });
    var stale = (existing.data || [])
      .map(function (r) {
        return r.source_tx_id;
      })
      .filter(function (id) {
        return !keep[id];
      });

    if (stale.length) {
      var del = await sb
        .from('shared_entries')
        .delete()
        .eq('household_id', household.id)
        .eq('author_id', user.id)
        .in('source_tx_id', stale);
      if (del.error) throw del.error;
    }
  }

  // --- pulling their side --------------------------------------------------

  /** Entries other members shared, shaped as transactions attributed to the
   *  partner slot. Marked `fromShared` so they are stripped before any save and
   *  never mistaken for our own. */
  async function pullShared() {
    if (!sb || !user || !household) return [];

    var res = await sb
      .from('shared_entries')
      .select('author_id,source_tx_id,tx')
      .eq('household_id', household.id)
      .neq('author_id', user.id);
    if (res.error) throw res.error;

    return (res.data || []).map(function (row) {
      return Object.assign({}, row.tx, {
        id: 'shared_' + String(row.author_id).slice(0, 8) + '_' + row.source_tx_id,
        memberId: PARTNER,
        enteredBy: PARTNER,
        fromShared: true,
        reviewed: true,
      });
    });
  }

  /** Folds the household into the ledger: the partner slot takes their name and
   *  their shared entries join ours, so every existing screen shows both of you.
   *  Nothing new had to be built for that — the app already attributes each
   *  entry to a member. */
  async function mergeHousehold(state) {
    if (!household) return state;

    var others = otherMembers();
    var active = others.filter(function (m) {
      return m.status === 'active';
    });
    var face = active[0] || others[0];
    var next = state;

    if (face) {
      next = withPartner(next, {
        name: face.display_name || String(face.email || 'Partner').split('@')[0],
        email: face.email,
        color: face.color || '#B0542C',
      });
    }

    var theirs = [];
    try {
      theirs = await pullShared();
    } catch (err) {
      console.error('[household] could not read shared entries', err);
    }

    var ours = (next.transactions || []).filter(function (t) {
      return !t.fromShared;
    });

    return Object.assign({}, next, {
      transactions: ours.concat(theirs).sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      }),
    });
  }

  async function refreshHousehold(reason) {
    if (!sb || !user) return;
    try {
      await loadHousehold();
      if (!household || !latestState) return;
      var merged = await mergeHousehold(latestState);
      applyState(merged);
      latestState = merged;
      watchHousehold();
      if (reason === 'remote') UI.status('Updated from your household');
    } catch (err) {
      console.error('[household] refresh failed', err);
    }
  }

  function watchHousehold() {
    if (!sb || !user || !household || sharedChannel) return;
    sharedChannel = sb
      .channel('household:' + household.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_entries', filter: 'household_id=eq.' + household.id },
        function (payload) {
          var row = payload.new || payload.old || {};
          if (row.author_id === user.id) return; // our own write echoing back
          refreshHousehold('remote');
        },
      )
      .subscribe();
  }

  function unwatchHousehold() {
    if (sharedChannel && sb) {
      try {
        sb.removeChannel(sharedChannel);
      } catch (e) {
        /* already gone */
      }
    }
    sharedChannel = null;
    household = null;
    householdMembers = [];
  }

  // -------------------------------------------------------------------------
  // The assistant
  // -------------------------------------------------------------------------

  /** Calls the Edge Function. The Gemini key lives there, never here: it is a
   *  real secret with no row level security behind it, so a page holding it
   *  would hand it to anyone who opened View Source. */
  async function askAssistant(body) {
    if (!sb) throw new Error('Sign in to use the assistant.');
    var res = await sb.functions.invoke('assistant', { body: body });
    if (res.error) throw new Error(res.error.message || 'The assistant could not be reached.');
    if (res.data && res.data.error) throw new Error(res.data.message || res.data.error);
    return res.data;
  }

  /** A compact digest — never the whole ledger. Private categories are stripped
   *  here too, so they are not merely hidden from the household: they never
   *  reach the model either. */
  function digest(state, month) {
    var m = month || thisMonth();
    var visible = (state.transactions || []).filter(function (t) {
      return (
        t &&
        typeof t.date === 'string' &&
        t.date.slice(0, 7) === m &&
        !isPrivateCategory(state, t.categoryId)
      );
    });

    var labelOf = {};
    (state.categories || []).forEach(function (c) {
      labelOf[c.id] = c.label;
    });

    var byCategory = {};
    var byMember = {};
    var income = 0;

    visible.forEach(function (t) {
      var who =
        t.memberId === PARTNER ? partnerName(state) : t.memberId === JOINT ? 'Joint' : meName(state);
      if (t.amount > 0) {
        income += t.amount;
      } else {
        var label = labelOf[t.categoryId] || 'Uncategorised';
        byCategory[label] = (byCategory[label] || 0) + Math.abs(t.amount);
        byMember[who] = (byMember[who] || 0) + Math.abs(t.amount);
      }
    });

    var planned = {};
    var budget = (state.budgets || []).filter(function (b) {
      return b.month === m;
    })[0];
    if (budget) {
      (budget.lines || []).forEach(function (line) {
        planned[line.label] = line.planned;
      });
    }

    var round = function (n) {
      return Math.round(n * 100) / 100;
    };

    return {
      month: m,
      entries: visible.length,
      income: round(income),
      byMember: byMember,
      byCategory: Object.keys(byCategory).map(function (label) {
        return { label: label, spent: round(byCategory[label]), planned: planned[label] };
      }),
    };
  }

  function uncategorised(state) {
    return (state.transactions || []).filter(function (t) {
      return t && !t.fromShared && !t.categoryId && t.amount < 0;
    });
  }

  /** Categorises everything still unsorted. Only the category id comes back,
   *  and it is accepted only if it is one we actually offered — the model does
   *  not get to invent a category, or write anything else into the entry. */
  async function categoriseAll(appDispatch, onProgress) {
    if (appDispatch) dispatch = appDispatch;
    var state = latestState;
    if (!state) return { done: 0, seen: 0 };

    var todo = uncategorised(state).slice(0, 25);
    if (!todo.length) return { done: 0, seen: 0 };

    var groupOf = {};
    (state.groups || []).forEach(function (g) {
      groupOf[g.id] = g.label;
    });
    var categories = (state.categories || []).map(function (c) {
      return { id: c.id, label: c.label, group: groupOf[c.groupId] };
    });

    var valid = {};
    categories.forEach(function (c) {
      valid[c.id] = true;
    });

    var applied = 0;
    for (var i = 0; i < todo.length; i++) {
      var t = todo[i];
      if (onProgress) onProgress(i + 1, todo.length);
      var out = await askAssistant({
        task: 'categorise',
        merchant: t.merchant,
        amount: t.amount,
        categories: categories,
      });
      var picked = out && out.result && out.result.categoryId;
      if (picked && valid[picked]) {
        dispatch({ t: 'updateTx', id: t.id, patch: { categoryId: picked } });
        applied++;
      }
    }

    return { done: applied, seen: todo.length };
  }

  // -------------------------------------------------------------------------
  // Context the assistant is given
  // -------------------------------------------------------------------------

  /** Richer than the monthly digest: enough recent detail to answer "which shop
   *  did we spend most at", plus a few months of totals for comparisons, plus
   *  the ids it needs to propose a change.
   *
   *  Still a summary, not the ledger. Private categories are removed here, so
   *  they are not merely hidden from the household — they never reach the model.
   */
  function chatContext(state) {
    var round = function (n) {
      return Math.round(n * 100) / 100;
    };

    var labelOf = {};
    (state.categories || []).forEach(function (c) {
      labelOf[c.id] = c.label;
    });
    var groupLabel = {};
    (state.groups || []).forEach(function (g) {
      groupLabel[g.id] = g.label;
    });

    var visible = (state.transactions || []).filter(function (t) {
      return t && !isPrivateCategory(state, t.categoryId);
    });

    // Last three months of per-category totals, for comparisons.
    var byMonth = (state.months || []).slice(-3).map(function (m) {
      var rows = {};
      var income = 0;
      visible.forEach(function (t) {
        if (String(t.date || '').slice(0, 7) !== m) return;
        if (t.amount > 0) {
          income += t.amount;
        } else {
          var label = labelOf[t.categoryId] || 'Uncategorised';
          rows[label] = (rows[label] || 0) + Math.abs(t.amount);
        }
      });
      var budget = (state.budgets || []).filter(function (b) {
        return b.month === m;
      })[0];
      var planned = {};
      if (budget) {
        (budget.lines || []).forEach(function (l) {
          planned[l.label] = l.planned;
        });
      }
      return {
        month: m,
        income: round(income),
        byCategory: Object.keys(rows).map(function (label) {
          return { label: label, spent: round(rows[label]), planned: planned[label] };
        }),
      };
    });

    // Enough individual entries to answer merchant-level questions, newest
    // first and capped — the whole ledger would be slow, costly, and more than
    // the question needs.
    var recent = visible
      .slice()
      .sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      })
      .slice(0, 80)
      .map(function (t) {
        return {
          date: t.date,
          merchant: t.merchant,
          amount: round(t.amount),
          category: labelOf[t.categoryId] || null,
          who: t.memberId === PARTNER ? partnerName(state) : t.memberId === JOINT ? 'Joint' : meName(state),
        };
      });

    return {
      today: state.today,
      thisMonth: thisMonth(),
      members: (state.members || []).map(function (m) {
        return { id: m.id, name: m.name };
      }),
      categories: (state.categories || [])
        .filter(function (c) {
          return !isPrivateCategory(state, c.id);
        })
        .map(function (c) {
          return { id: c.id, label: c.label, group: groupLabel[c.groupId] };
        }),
      budgetGroups: (state.groups || []).map(function (g) {
        return { id: g.id, label: g.label };
      }),
      goals: (state.goals || []).map(function (g) {
        return { id: g.id, label: g.label, target: g.target, saved: g.saved, due: g.due };
      }),
      accounts: (state.accounts || []).map(function (a) {
        return { id: a.id, label: a.label, balance: a.balance };
      }),
      months: byMonth,
      recent: recent,
    };
  }

  // -------------------------------------------------------------------------
  // Proposed changes
  // -------------------------------------------------------------------------
  //
  // The model proposes; the person approves; only then does anything change.
  // Every argument is re-checked here against the real ledger, because a
  // plausible-looking id or a mistyped amount must not reach the reducer.

  function money(n) {
    var v = Number(n);
    return (v < 0 ? '-' : '') + Math.abs(v).toFixed(2);
  }

  function describeAction(action) {
    var state = latestState || freshState();
    var a = (action && action.args) || {};

    if (action.name === 'log_entry') {
      var cat = (state.categories || []).filter(function (c) {
        return c.id === a.categoryId;
      })[0];
      var who = memberOf(state, a.memberId) || memberOf(state, ME);
      var problem = null;
      if (typeof a.amount !== 'number' || !isFinite(a.amount) || a.amount === 0) {
        problem = 'That amount did not come through as a number.';
      } else if (a.categoryId && !cat) {
        problem = 'That category does not exist in your ledger.';
      }
      return {
        title: a.amount > 0 ? 'Log money in' : 'Log an entry',
        rows: [
          ['Amount', money(a.amount)],
          ['Merchant', a.merchant || '—'],
          ['Category', cat ? cat.label : 'Uncategorised'],
          ['Date', a.date || state.today],
          ['Paid by', who ? who.name : '—'],
        ].concat(a.note ? [['Note', a.note]] : []),
        problem: problem,
      };
    }

    if (action.name === 'set_budget_line') {
      var group = (state.groups || []).filter(function (g) {
        return g.id === a.groupId;
      })[0];
      return {
        title: 'Change this month’s budget',
        rows: [
          ['Category', group ? group.label : a.groupId],
          ['New plan', money(a.planned)],
        ].concat(a.reason ? [['Why', a.reason]] : []),
        problem: !group
          ? 'That budget category does not exist in your ledger.'
          : typeof a.planned !== 'number' || a.planned < 0
            ? 'That planned amount is not usable.'
            : null,
      };
    }

    if (action.name === 'set_goal_contribution') {
      var goal = (state.goals || []).filter(function (g) {
        return g.id === a.goalId;
      })[0];
      var member = memberOf(state, a.memberId) || memberOf(state, ME);
      return {
        title: 'Set a goal contribution',
        rows: [
          ['Goal', goal ? goal.label : a.goalId],
          ['Each month', money(a.amount)],
          ['From', member ? member.name : '—'],
        ].concat(a.reason ? [['Why', a.reason]] : []),
        problem: !goal ? 'That goal does not exist in your ledger.' : null,
      };
    }

    return { title: 'Unknown change', rows: [], problem: 'This is not something the app can apply.' };
  }

  async function applyAction(action) {
    var state = latestState || freshState();
    var a = (action && action.args) || {};
    var described = describeAction(action);
    if (described.problem) throw new Error(described.problem);

    if (action.name === 'log_entry') {
      var valid = {};
      (state.categories || []).forEach(function (c) {
        valid[c.id] = true;
      });
      dispatch({
        t: 'addTx',
        tx: {
          amount: a.amount,
          merchant: a.merchant || '',
          categoryId: a.categoryId && valid[a.categoryId] ? a.categoryId : null,
          date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : state.today,
          memberId: memberOf(state, a.memberId) ? a.memberId : (state.session && state.session.memberId) || ME,
          accountId: (state.accounts[0] && state.accounts[0].id) || null,
          note: a.note || '',
          flex: false,
          reviewed: true,
        },
      });
      return 'Saved ' + money(a.amount) + ' at ' + (a.merchant || 'an entry') + '.';
    }

    if (action.name === 'set_budget_line') {
      var budget = (state.budgets || []).filter(function (b) {
        return b.month === thisMonth();
      })[0];
      var line =
        budget &&
        (budget.lines || []).filter(function (l) {
          return l.groupId === a.groupId;
        })[0];
      if (!line) throw new Error('No budget line for that category this month.');
      dispatch({ t: 'setPlanned', month: thisMonth(), lineId: line.id, planned: a.planned });
      return 'Budget updated to ' + money(a.planned) + '.';
    }

    if (action.name === 'set_goal_contribution') {
      dispatch({
        t: 'setContribution',
        goalId: a.goalId,
        memberId: memberOf(state, a.memberId) ? a.memberId : ME,
        amount: a.amount,
      });
      return 'Contribution set to ' + money(a.amount) + ' a month.';
    }

    throw new Error('This is not something the app can apply.');
  }

  // -------------------------------------------------------------------------
  // Panels
  // -------------------------------------------------------------------------

  function openSharing(appDispatch, state) {
    if (appDispatch) dispatch = appDispatch;
    var current = state || latestState || freshState();

    if (!sb || !user) {
      return UI.message(
        'Sign in first',
        'Sharing a ledger needs an account, so the other person has something to join.',
        true,
      );
    }

    var groupOf = {};
    (current.groups || []).forEach(function (g) {
      groupOf[g.id] = g.label;
    });

    UI.sharing({
      members: householdMembers,
      myUserId: user.id,
      categories: (current.categories || []).map(function (c) {
        return { id: c.id, label: c.label, group: groupOf[c.groupId] };
      }),
      privateCategories: current.privateCategories || [],

      onInvite: async function (email) {
        await inviteMember(email);
        UI.status('Invited ' + email);
        await refreshHousehold();
        return householdMembers;
      },

      onRemove: async function (rowId) {
        await removeMember(rowId);
        await refreshHousehold();
        return householdMembers;
      },

      onSavePrivate: function (ids) {
        var next = Object.assign({}, latestState || current, { privateCategories: ids });
        applyState(next);
        latestState = next;
        UI.status(ids.length ? ids.length + ' categories kept private' : 'Everything is shared');
        // Withdraw anything that just became private.
        pushShared(next).catch(function (err) {
          console.error('[household] withdrawing private entries failed', err);
        });
      },
    });
  }

  function openAssistant(appDispatch, state) {
    if (appDispatch) dispatch = appDispatch;
    var current = state || latestState || freshState();

    UI.assistant({
      unsorted: uncategorised(current).length,

      onSend: async function (history) {
        var out = await askAssistant({
          task: 'chat',
          messages: history,
          context: chatContext(latestState || current),
        });
        return { text: out.text, action: out.action };
      },

      describeAction: describeAction,
      applyAction: applyAction,

      quick: [
        {
          label: 'Summarise this month',
          run: async function () {
            var out = await askAssistant({ task: 'summarise', summary: digest(latestState || current) });
            return out.text;
          },
        },
        {
          label: 'Anything I should know?',
          run: async function () {
            var out = await askAssistant({ task: 'insights', summary: chatContext(latestState || current) });
            return out.text;
          },
        },
        {
          label: 'Sort uncategorised',
          run: async function () {
            var res = await categoriseAll(dispatch);
            return res.done
              ? 'Categorised ' + res.done + ' of ' + res.seen + ' entries. They are on the Transactions screen.'
              : 'Nothing left to sort.';
          },
        },
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  /** Called from the bundle's save effect on every state change. */
  function onState(state, appDispatch) {
    latestState = state;
    dispatch = appDispatch || dispatch;

    if (!started) {
      started = true;
      start();
      return;
    }

    if (applyingRemote || signingOut) return;

    if (sb && user) {
      writeMeta({ localChangedAt: new Date().toISOString() });
      schedulePush();
      // Mirror into the household on the same debounce as the personal ledger,
      // so the two never drift apart.
      if (household) {
        window.clearTimeout(sharedPushTimer);
        sharedPushTimer = window.setTimeout(function () {
          pushShared(latestState).catch(function (err) {
            console.error('[household] push failed', err);
          });
        }, PUSH_DEBOUNCE);
      }
    }
  }

  async function adoptSession(session) {
    user = (session && session.user) || null;
    if (!user) return;

    var remote = null;
    try {
      remote = await pull();
    } catch (err) {
      console.error('[sync] initial pull failed', err);
    }

    if (remote && remote.state) {
      var adopted = rehydrate(remote.state);
      if (!adopted.session) {
        adopted.session = { memberId: ME, email: accountEmail(), name: meName(adopted) };
      }
      applyState(adopted);
      latestState = adopted;
      writeMeta({ syncedAt: remote.updatedAt, localChangedAt: null, accountId: user.id });
      UI.status('Ledger loaded');
    } else {
      // A brand-new account has no ledger yet; seed the owner slot from
      // whatever the identity provider told us about them.
      var p = profileFromAuth() || { name: 'You', email: null };
      var base = latestState && latestState.session ? latestState : freshState();
      var next = withIdentity(base, p);
      next.session = { memberId: ME, email: p.email, name: p.name };
      applyState(next);
      latestState = next;
      writeMeta({ accountId: user.id });
      await pushNow();
    }

    watchRemote();

    // Join whatever household this account belongs to, claiming any invitation
    // addressed to their email, then fold it into what they see.
    try {
      await loadHousehold();
      if (household) {
        var merged = await mergeHousehold(latestState || freshState());
        applyState(merged);
        latestState = merged;
        watchHousehold();
        await pushShared(merged);
      }
    } catch (err) {
      console.error('[household] setup failed', err);
    }
  }

  async function start() {
    console.info('[huat] boot ' + versionLabel() + ' · supabase ' + (sb ? 'configured' : 'NOT configured'));
    if (!sb) {
      UI.status('No account — saved in this browser');
      return;
    }

    try {
      var res = await sb.auth.getSession();
      if (res.data && res.data.session) await adoptSession(res.data.session);
    } catch (err) {
      console.error('[auth] session lookup failed', err);
    }

    // Covers the redirect back from Google and the magic-link landing.
    sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' && session && (!user || user.id !== session.user.id)) {
        adoptSession(session);
      } else if (event === 'SIGNED_OUT') {
        user = null;
        unwatchRemote();
      }
    });
  }

  function versionLabel() {
    return 'v1.1.0 · manual';
  }

  // -------------------------------------------------------------------------
  // Clearing what the prototype left behind
  // -------------------------------------------------------------------------

  // 1.0.0 shipped with a demo ledger under the v1 key. The key is versioned so
  // that data is never read again, and removed so it is not merely orphaned.
  try {
    LEGACY_KEYS.forEach(function (k) {
      localStorage.removeItem(k);
    });
  } catch (e) {
    /* nothing to clear */
  }

  window.__hh = {
    // state
    today: todayISO,
    months: function () {
      return [thisMonth()];
    },
    freshState: freshState,
    rehydrate: rehydrate,
    onState: onState,
    storeKey: STORE_KEY,
    versionLabel: versionLabel,

    // partner awareness, all state-first
    hasPartner: hasPartner,
    meName: meName,
    partnerName: partnerName,
    notePlaceholder: notePlaceholder,
    wroteSuffix: wroteSuffix,
    wroteNote: wroteNote,
    spendParts: spendParts,
    paidRows: paidRows,
    splitOptions: splitOptions,
    fundingSplit: fundingSplit,

    // actions
    googleSignIn: googleSignIn,
    emailSignIn: emailSignIn,
    localSignIn: localSignIn,
    signOut: signOut,
    openProfile: openProfile,
    openSharing: openSharing,
    openAssistant: openAssistant,

    // asset path, so the patched bundle does not hardcode it
    logo: './huat-cat.png',
  };
})();
