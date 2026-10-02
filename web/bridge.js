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

  async function signOut(appDispatch) {
    if (appDispatch) dispatch = appDispatch;
    window.clearTimeout(pushTimer);

    if (sb && user && latestState) {
      try {
        await push(latestState); // flush before the session goes away
      } catch (e) {
        /* leaving matters more than the last write */
      }
    }
    unwatchRemote();
    if (sb) {
      try {
        await sb.auth.signOut();
      } catch (e) {
        /* local sign-out proceeds regardless */
      }
    }

    user = null;
    writeMeta({ localChangedAt: null });
    if (dispatch) dispatch({ t: 'signOut' });
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

    if (applyingRemote) return;

    if (sb && user) {
      writeMeta({ localChangedAt: new Date().toISOString() });
      schedulePush();
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

    // asset path, so the patched bundle does not hardcode it
    logo: './huat-cat.png',
  };
})();
