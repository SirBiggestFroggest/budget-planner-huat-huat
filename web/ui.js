/** Chrome that sits outside the React bundle: the sync pill, the blocking
 *  overlay, and the profile editor.
 *
 *  These are built with plain DOM rather than React on purpose. The app's
 *  original source was lost, so the only React we have is a minified bundle;
 *  adding components to it would mean surgery on machine-generated code.
 *  Hanging a few self-contained elements off <body> keeps that blast radius at
 *  zero, and none of these pieces needs to re-render with the ledger.
 *
 *  Styling mirrors the bundle's own tokens so it does not read as bolted on.
 */
(function () {
  'use strict';

  var SERIF = "'Instrument Serif',Georgia,serif";
  var SANS = 'Archivo,system-ui,sans-serif';

  function host() {
    // Loaded from <head>, so body may not exist yet. Every caller runs well
    // after parsing, but fall back rather than throw.
    return document.body || document.documentElement;
  }

  function el(tag, css, text) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text != null) node.textContent = text;
    return node;
  }

  function label(text) {
    return el(
      'div',
      'font:600 11px ' + SANS + ';letter-spacing:.5px;text-transform:uppercase;color:#7A7468',
      text,
    );
  }

  // -------------------------------------------------------------------------
  // Sync status pill
  // -------------------------------------------------------------------------

  var pill = null;
  var pillTimer = null;

  function status(text, tone, sticky) {
    if (!pill) {
      pill = el(
        'div',
        'position:fixed;right:16px;bottom:16px;z-index:9998;padding:7px 13px;' +
          'border-radius:999px;font:500 12px/1.2 ' + SANS + ';' +
          'background:#17150F;color:#EFE8DA;box-shadow:0 6px 22px rgba(0,0,0,.22);' +
          'opacity:0;transition:opacity .22s ease;pointer-events:none;max-width:60vw',
      );
      host().appendChild(pill);
    }
    pill.textContent = text;
    pill.style.background = tone === 'error' ? '#8C3F20' : '#17150F';
    pill.style.opacity = '1';
    window.clearTimeout(pillTimer);
    if (!sticky) {
      pillTimer = window.setTimeout(function () {
        pill.style.opacity = '0';
      }, 2600);
    }
  }

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------

  var overlay = null;

  function scrim() {
    // `overlay` is cached, so if the node ever leaves the document the cached
    // reference goes stale and every panel silently fails to appear. hide()
    // only sets display:none, so nothing in the app does that — but a detached
    // node is cheap to detect and expensive to debug.
    if (overlay && !overlay.isConnected) overlay = null;
    if (!overlay) {
      overlay = el(
        'div',
        'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;' +
          'background:rgba(23,21,15,.55);backdrop-filter:blur(2px);overflow:auto',
      );
      host().appendChild(overlay);
    }
    overlay.innerHTML = '';
    overlay.style.display = 'grid';
    return overlay;
  }

  function card(width) {
    return el(
      'div',
      'width:min(' + (width || 380) + 'px,100%);padding:26px 28px;border-radius:14px;' +
        'background:#F7F1E3;box-shadow:0 18px 50px rgba(0,0,0,.3);' +
        'font:400 14px/1.6 ' + SANS + ';color:#1B1915',
    );
  }

  function heading(text, size) {
    return el('div', 'font:400 ' + (size || 23) + 'px/1.2 ' + SERIF + ';margin-bottom:8px', text);
  }

  function button(text, kind) {
    var css = 'padding:9px 18px;border-radius:9px;font:500 13px ' + SANS + ';cursor:pointer;';
    if (kind === 'primary') {
      css += 'border:1px solid #17150F;background:#17150F;color:#FDFBF7';
    } else if (kind === 'danger') {
      css += 'border:1px solid #D8CEB8;background:#EFE9DE;color:#A6412B';
    } else {
      css += 'border:1px solid #D8CEB8;background:#EFE9DE;color:#1B1915';
    }
    var node = el('button', css, text);
    node.type = 'button';
    return node;
  }

  /** A plain message overlay.
   *
   *  `closable` adds a Close button. `action` — {label, onClick} — adds a
   *  primary button beside it, so a dead end can always offer a way forward.
   */
  function message(title, body, closable, action) {
    var box = card();
    box.style.textAlign = 'center';
    box.appendChild(heading(title));
    box.appendChild(el('div', 'color:#57534A', body));

    if (closable || action) {
      var row = el('div', 'display:flex;gap:8px;justify-content:center;margin-top:18px;flex-wrap:wrap');
      if (closable) {
        var close = button('Close');
        close.onclick = hide;
        row.appendChild(close);
      }
      if (action) {
        var go = button(action.label, 'primary');
        go.onclick = function () {
          hide();
          action.onClick();
        };
        row.appendChild(go);
      }
      box.appendChild(row);
    }

    scrim().appendChild(box);
  }

  function hide() {
    if (overlay) overlay.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Profile editor
  // -------------------------------------------------------------------------

  function field(labelText, hint) {
    var wrap = el('div', 'display:grid;gap:5px;text-align:left');
    wrap.appendChild(label(labelText));
    var input = el(
      'input',
      'border:1px solid #DDD4C2;background:#FDFBF7;border-radius:8px;padding:8px 10px;' +
        'font:400 13px ' + SANS + ';width:100%;color:#1B1915',
    );
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el('div', 'font:400 11px/1.45 ' + SANS + ';color:#7A7468', hint));
    return { wrap: wrap, input: input };
  }

  var SWATCHES = ['#4F6E9A', '#BD7342', '#359735', '#883053', '#32328F', '#888830', '#359097', '#613F2E', '#955CA3', '#335B41', '#B8474F', '#376A25', '#4E335B', '#359769', '#BD428C', '#BD42BD'];

  function colourPicker(selected, onPick) {
    var wrap = el('div', 'display:flex;gap:7px;flex-wrap:wrap');
    var current = selected;
    var dots = [];

    function paint() {
      dots.forEach(function (d) {
        d.node.style.border = d.colour === current ? '2px solid #1B1915' : '2px solid transparent';
      });
    }

    SWATCHES.forEach(function (colour) {
      var node = el('button', 'width:26px;height:26px;border-radius:50%;cursor:pointer;background:' + colour);
      node.type = 'button';
      node.setAttribute('aria-label', 'Colour ' + colour);
      node.onclick = function () {
        current = colour;
        paint();
        onPick(colour);
      };
      dots.push({ node: node, colour: colour });
      wrap.appendChild(node);
    });

    paint();
    return wrap;
  }

  function colourRow(labelText, selected, onPick) {
    var wrap = el('div', 'display:grid;gap:6px;text-align:left');
    wrap.appendChild(label(labelText));
    wrap.appendChild(colourPicker(selected, onPick));
    return wrap;
  }

  /**
   * Profile editor.
   *
   * @param {object} opts
   *   me           {name,email,color}       the signed-in person's slot
   *   partner      {name,email,color}|null  partner slot, null when none
   *   accountEmail string|null              shown read-only, for orientation
   *   onSave       fn({me, partner})        partner null means "no partner"
   */
  function profile(opts) {
    var box = card(440);
    box.appendChild(heading('Your profile', 25));
    box.appendChild(el('div', 'color:#57534A;margin-bottom:18px', 'How you appear on entries in this ledger.'));

    var body = el('div', 'display:grid;gap:14px');

    var name = field('Your name');
    name.input.value = opts.me.name || '';
    name.input.maxLength = 60;
    body.appendChild(name.wrap);

    var email = field('Your email', 'Shown on the ledger. It does not change the account you sign in with.');
    email.input.type = 'email';
    email.input.value = opts.me.email || '';
    body.appendChild(email.wrap);

    var myColour = opts.me.color || SWATCHES[0];
    body.appendChild(
      colourRow('Your colour', myColour, function (c) {
        myColour = c;
      }),
    );

    // --- partner ------------------------------------------------------------

    var section = el('div', 'border-top:1px solid #E0D7C5;margin-top:4px;padding-top:14px;display:grid;gap:12px');
    section.appendChild(label('Partner'));

    var hasPartner = !!opts.partner;
    var partnerColour = (opts.partner && opts.partner.color) || SWATCHES[1];

    var pName = field('Partner name');
    pName.input.value = (opts.partner && opts.partner.name) || '';
    pName.input.maxLength = 60;
    pName.input.placeholder = 'e.g. Sam';

    var pEmail = field('Partner email (optional)');
    pEmail.input.type = 'email';
    pEmail.input.value = (opts.partner && opts.partner.email) || '';

    var fields = el('div', 'display:grid;gap:12px');
    fields.appendChild(pName.wrap);
    fields.appendChild(pEmail.wrap);
    fields.appendChild(
      colourRow('Partner colour', partnerColour, function (c) {
        partnerColour = c;
      }),
    );

    var explain = el(
      'div',
      'font:400 11px/1.45 ' + SANS + ';color:#7A7468',
      'Adding a partner lets you attribute entries to them and splits the figures ' +
        'two ways. Until then the ledger stays single-handed.',
    );

    var toggle = button('Add a partner');
    toggle.style.justifySelf = 'start';

    function paintPartner() {
      fields.style.display = hasPartner ? 'grid' : 'none';
      explain.style.display = hasPartner ? 'none' : 'block';
      toggle.textContent = hasPartner ? 'Remove partner' : 'Add a partner';
      toggle.style.color = hasPartner ? '#A6412B' : '#1B1915';
    }

    toggle.onclick = function () {
      hasPartner = !hasPartner;
      paintPartner();
      if (hasPartner) pName.input.focus();
    };
    paintPartner();

    section.appendChild(explain);
    section.appendChild(fields);
    section.appendChild(toggle);
    body.appendChild(section);
    box.appendChild(body);

    // --- actions ------------------------------------------------------------

    var error = el('div', 'font:400 12px ' + SANS + ';color:#A6412B;margin-top:10px;text-align:left');
    error.style.display = 'none';
    box.appendChild(error);

    function fail(text, input) {
      error.textContent = text;
      error.style.display = 'block';
      input.focus();
    }

    var foot = el('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:18px');
    var cancel = button('Cancel');
    cancel.onclick = hide;
    var save = button('Save', 'primary');

    save.onclick = function () {
      var myName = name.input.value.trim();
      if (!myName) return fail('Your name cannot be empty.', name.input);
      if (hasPartner && !pName.input.value.trim()) {
        return fail('Give your partner a name, or remove them.', pName.input);
      }
      hide();
      opts.onSave({
        me: { name: myName, email: email.input.value.trim() || null, color: myColour },
        partner: hasPartner
          ? { name: pName.input.value.trim(), email: pEmail.input.value.trim() || null, color: partnerColour }
          : null,
      });
    };

    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);

    if (opts.accountEmail) {
      box.appendChild(
        el(
          'div',
          'font:400 11px ' + SANS + ';color:#9A9282;margin-top:14px;text-align:left',
          'Signed in as ' + opts.accountEmail,
        ),
      );
    }

    scrim().appendChild(box);
    name.input.focus();
  }

  // -------------------------------------------------------------------------
  // Sharing: who is in the household, and what stays private
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts
   *   members            household_members rows
   *   myUserId           so "you" can be labelled, and not offered a Remove
   *   categories         [{id,label,group}]
   *   privateCategories  [id]
   *   onInvite(email)    -> Promise<members>
   *   onRemove(rowId)    -> Promise<members>
   *   onSavePrivate(ids)
   */
  function sharing(opts) {
    var box = card(480);
    box.appendChild(heading('Share this ledger', 25));
    box.appendChild(
      el(
        'div',
        'color:#57534A;margin-bottom:18px',
        'Your partner signs in with their own account and keeps their own ledger. ' +
          'What you each log flows into this shared book, apart from anything in a private category.',
      ),
    );

    var error = el('div', 'font:400 12px ' + SANS + ';color:#A6412B;margin-top:10px');
    error.style.display = 'none';

    function showError(err) {
      error.textContent = (err && err.message) || String(err);
      error.style.display = 'block';
    }
    function clearError() {
      error.style.display = 'none';
    }

    // --- people -------------------------------------------------------------
    var people = el('div', 'display:grid;gap:12px');
    people.appendChild(label('People'));

    var list = el('div', 'display:grid;gap:6px');
    var members = opts.members || [];

    function paintList() {
      list.innerHTML = '';
      if (!members.length) {
        list.appendChild(
          el('div', 'font:400 12px ' + SANS + ';color:#7A7468', 'Nobody else yet — invite someone below.'),
        );
        return;
      }
      members.forEach(function (m) {
        var row = el(
          'div',
          'display:flex;align-items:center;gap:10px;border:1px solid #E8E1D2;border-radius:9px;padding:8px 10px',
        );
        var isMe = m.user_id && m.user_id === opts.myUserId;
        var name = m.display_name || String(m.email || '').split('@')[0];

        row.appendChild(
          el(
            'span',
            'width:26px;height:26px;border-radius:50%;flex:none;display:grid;place-items:center;' +
              'color:#fff;font:600 11px ' + SANS + ';background:' + (m.color || '#4F6E9A'),
            (name[0] || '?').toUpperCase(),
          ),
        );

        var who = el('div', 'min-width:0;flex:1');
        who.appendChild(el('div', 'font:600 13px ' + SANS + ';color:#1B1915', name + (isMe ? ' (you)' : '')));
        who.appendChild(
          el(
            'div',
            'font:400 11px ' + SANS + ';color:#7A7468;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
            m.email + (m.status === 'invited' ? ' · invited, not joined yet' : ''),
          ),
        );
        row.appendChild(who);

        if (!isMe) {
          var rm = button('Remove', 'danger');
          rm.style.padding = '5px 10px';
          rm.onclick = async function () {
            rm.disabled = true;
            rm.textContent = '…';
            try {
              members = (await opts.onRemove(m.id)) || [];
              paintList();
            } catch (err) {
              rm.disabled = false;
              rm.textContent = 'Remove';
              showError(err);
            }
          };
          row.appendChild(rm);
        }
        list.appendChild(row);
      });
    }
    paintList();
    people.appendChild(list);

    // --- invite -------------------------------------------------------------
    var inviteRow = el('div', 'display:flex;gap:8px;align-items:flex-start');
    var invite = field('');
    invite.wrap.style.flex = '1';
    invite.input.type = 'email';
    invite.input.placeholder = 'their@email.com';
    inviteRow.appendChild(invite.wrap);

    var send = button('Invite', 'primary');
    send.onclick = async function () {
      var address = invite.input.value.trim();
      if (!address) return showError(new Error('Enter their email address.'));
      send.disabled = true;
      send.textContent = 'Inviting…';
      try {
        members = (await opts.onInvite(address)) || members;
        invite.input.value = '';
        paintList();
        clearError();
      } catch (err) {
        showError(err);
      }
      send.disabled = false;
      send.textContent = 'Invite';
    };
    inviteRow.appendChild(send);
    people.appendChild(inviteRow);

    people.appendChild(
      el(
        'div',
        'font:400 11px/1.45 ' + SANS + ';color:#7A7468',
        'They will not see anything until they sign in with that address themselves.',
      ),
    );
    box.appendChild(people);

    // --- private categories -------------------------------------------------
    var priv = el('div', 'border-top:1px solid #E0D7C5;margin-top:16px;padding-top:14px;display:grid;gap:10px');
    priv.appendChild(label('Keep private'));
    priv.appendChild(
      el(
        'div',
        'font:400 11px/1.45 ' + SANS + ';color:#7A7468',
        'Everything is shared unless you tick it here. Entries in a ticked category stay in your ledger ' +
          'alone — they are not sent to the household, and the assistant never sees them either.',
      ),
    );

    var chosen = {};
    (opts.privateCategories || []).forEach(function (id) {
      chosen[id] = true;
    });

    var grid = el(
      'div',
      'display:grid;gap:4px;max-height:190px;overflow:auto;border:1px solid #E8E1D2;border-radius:9px;padding:8px',
    );

    var lastGroup = null;
    (opts.categories || []).forEach(function (c) {
      if (c.group && c.group !== lastGroup) {
        lastGroup = c.group;
        grid.appendChild(
          el(
            'div',
            'font:600 10px ' + SANS + ';letter-spacing:.6px;text-transform:uppercase;color:#9A9282;padding:6px 2px 2px',
            c.group,
          ),
        );
      }
      var line = el('label', 'display:flex;align-items:center;gap:8px;padding:3px 2px;cursor:pointer');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!chosen[c.id];
      cb.onchange = function () {
        if (cb.checked) chosen[c.id] = true;
        else delete chosen[c.id];
      };
      line.appendChild(cb);
      line.appendChild(el('span', 'font:400 13px ' + SANS + ';color:#1B1915', c.label));
      grid.appendChild(line);
    });

    priv.appendChild(grid);
    box.appendChild(priv);
    box.appendChild(error);

    var foot = el('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px');
    var close = button('Close');
    close.onclick = hide;
    var save = button('Save', 'primary');
    save.onclick = function () {
      hide();
      opts.onSavePrivate(Object.keys(chosen));
    };
    foot.appendChild(close);
    foot.appendChild(save);
    box.appendChild(foot);

    scrim().appendChild(box);
  }

  // -------------------------------------------------------------------------
  // The assistant, as a conversation
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts
   *   unsorted            count of uncategorised entries
   *   onSend(history)     -> Promise<{text?, action?}>
   *   describeAction(a)   -> {title, rows:[[label,value]], problem?}
   *   applyAction(a)      -> Promise<string>   confirmation line
   *   quick               [{label, run:() => Promise<string>}]
   */
  function assistant(opts) {
    var history = []; // [{role:'user'|'model', text}]

    var box = card(560);
    box.style.display = 'grid';
    box.style.gridTemplateRows = 'auto 1fr auto';
    box.style.maxHeight = 'min(82vh, 760px)';
    box.style.padding = '22px 24px';

    // --- head ---------------------------------------------------------------
    var head = el('div', 'display:flex;align-items:flex-start;gap:10px;margin-bottom:12px');
    var title = el('div', 'flex:1;min-width:0');
    title.appendChild(heading('Ask about your money', 23));
    title.appendChild(
      el(
        'div',
        'color:#57534A;font:400 12px/1.5 ' + SANS,
        'It sees a summary of your ledger, never anything in a private category.',
      ),
    );
    head.appendChild(title);
    var close = button('Close');
    close.style.padding = '6px 12px';
    close.onclick = hide;
    head.appendChild(close);
    box.appendChild(head);

    // --- transcript ---------------------------------------------------------
    var log = el(
      'div',
      'overflow-y:auto;min-height:180px;border:1px solid #E8E1D2;border-radius:10px;' +
        'padding:14px;background:#FDFBF7;display:flex;flex-direction:column;gap:10px',
    );
    box.appendChild(log);

    function scroll() {
      log.scrollTop = log.scrollHeight;
    }

    function bubble(role, text) {
      var mine = role === 'user';
      var wrap = el('div', 'display:flex;' + (mine ? 'justify-content:flex-end' : 'justify-content:flex-start'));
      var b = el(
        'div',
        'max-width:84%;padding:9px 12px;border-radius:12px;white-space:pre-wrap;' +
          'font:400 13.5px/1.6 ' + SANS + ';' +
          (mine
            ? 'background:#17150F;color:#EFE8DA;border-bottom-right-radius:4px'
            : 'background:#F1EADC;color:#1B1915;border-bottom-left-radius:4px'),
        text,
      );
      wrap.appendChild(b);
      log.appendChild(wrap);
      scroll();
      return b;
    }

    function note(text, tone) {
      var n = el(
        'div',
        'font:400 12px/1.5 ' + SANS + ';color:' + (tone === 'error' ? '#A6412B' : '#7A7468') + ';padding:0 2px',
        text,
      );
      log.appendChild(n);
      scroll();
      return n;
    }

    /** A proposed change, shown for approval. Nothing is saved until Save. */
    function actionCard(action) {
      var described = opts.describeAction(action);
      var wrap = el(
        'div',
        'border:1px solid #D8CEB8;border-radius:11px;padding:12px 13px;background:#F7F1E3;display:grid;gap:9px',
      );
      wrap.appendChild(
        el(
          'div',
          'font:600 11px ' + SANS + ';letter-spacing:.5px;text-transform:uppercase;color:#7A7468',
          described.title,
        ),
      );

      var table = el('div', 'display:grid;grid-template-columns:auto 1fr;gap:3px 12px;align-items:baseline');
      described.rows.forEach(function (row) {
        table.appendChild(el('div', 'font:400 12px ' + SANS + ';color:#7A7468', row[0]));
        table.appendChild(el('div', 'font:500 13px ' + SANS + ';color:#1B1915', String(row[1])));
      });
      wrap.appendChild(table);

      if (described.problem) {
        wrap.appendChild(el('div', 'font:400 12px/1.5 ' + SANS + ';color:#A6412B', described.problem));
      }

      var row = el('div', 'display:flex;gap:7px;justify-content:flex-end');
      var discard = button('Discard');
      discard.style.padding = '6px 12px';
      var save = button('Save', 'primary');
      save.style.padding = '6px 14px';
      if (described.problem) save.disabled = true;

      discard.onclick = function () {
        wrap.remove();
        note('Discarded.');
      };
      save.onclick = async function () {
        save.disabled = true;
        discard.disabled = true;
        save.textContent = 'Saving…';
        try {
          var line = await opts.applyAction(action);
          wrap.remove();
          note(line || 'Saved.');
        } catch (err) {
          save.textContent = 'Save';
          save.disabled = false;
          discard.disabled = false;
          note((err && err.message) || String(err), 'error');
        }
      };

      row.appendChild(discard);
      row.appendChild(save);
      wrap.appendChild(row);
      log.appendChild(wrap);
      scroll();
    }

    // --- composer -----------------------------------------------------------
    var foot = el('div', 'display:grid;gap:9px;margin-top:12px');

    var quickRow = el('div', 'display:flex;gap:7px;flex-wrap:wrap');
    (opts.quick || []).forEach(function (q) {
      var b = button(q.label);
      b.style.padding = '6px 11px';
      b.style.fontSize = '12px';
      b.onclick = async function () {
        b.disabled = true;
        var pending = note(q.label + '…');
        try {
          var out = await q.run();
          pending.remove();
          bubble('model', out);
          history.push({ role: 'model', text: out });
        } catch (err) {
          pending.remove();
          note((err && err.message) || String(err), 'error');
        }
        b.disabled = false;
      };
      quickRow.appendChild(b);
    });
    foot.appendChild(quickRow);

    var inputRow = el('div', 'display:flex;gap:8px;align-items:flex-start');
    var q = field('');
    q.wrap.style.flex = '1';
    q.input.placeholder = 'Ask, or just say what you spent';
    inputRow.appendChild(q.wrap);
    var send = button('Send', 'primary');
    inputRow.appendChild(send);
    foot.appendChild(inputRow);
    box.appendChild(foot);

    var busy = false;

    async function submit() {
      var text = q.input.value.trim();
      if (!text || busy) return;
      busy = true;
      send.disabled = true;
      q.input.value = '';

      bubble('user', text);
      history.push({ role: 'user', text: text });
      var thinking = note('Thinking…');

      try {
        var out = await opts.onSend(history.slice());
        thinking.remove();
        if (out.text) {
          bubble('model', out.text);
          history.push({ role: 'model', text: out.text });
        }
        if (out.action) {
          actionCard(out.action);
          // Keep the thread coherent for the next turn without replaying JSON.
          history.push({ role: 'model', text: '(proposed a change for them to confirm)' });
        }
        if (!out.text && !out.action) note('No reply came back. Try again.', 'error');
      } catch (err) {
        thinking.remove();
        note((err && err.message) || String(err), 'error');
      }

      busy = false;
      send.disabled = false;
      q.input.focus();
    }

    send.onclick = submit;
    q.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });

    note(
      opts.unsorted
        ? 'Try "dinner 32 at the pub yesterday", or ask what you spent. ' +
            opts.unsorted +
            ' entries still need a category.'
        : 'Try "dinner 32 at the pub yesterday", or ask what you spent this month.',
    );

    scrim().appendChild(box);
    q.input.focus();
  }

  // -------------------------------------------------------------------------
  // Category groups
  // -------------------------------------------------------------------------

  /**
   * Rename, recolour, add and remove budget category groups and the categories
   * inside them.
   *
   * @param {object} opts
   *   groups      [{id,label,color,inUse,planned,categories:[{id,label,inUse}]}]
   *   swatches    [hex]
   *   onSave(model)   the edited copy, with `removed` flags
   */
  function categories(opts) {
    // Work on a copy: nothing changes until Save.
    var model = opts.groups.map(function (g) {
      return {
        id: g.id,
        label: g.label,
        color: g.color,
        inUse: g.inUse,
        planned: g.planned,
        removed: false,
        categories: g.categories.map(function (c) {
          return { id: c.id, label: c.label, inUse: c.inUse, removed: false };
        }),
      };
    });

    var box = card(560);
    box.style.maxHeight = 'min(84vh, 780px)';
    box.style.display = 'grid';
    box.style.gridTemplateRows = 'auto auto 1fr auto auto';
    box.appendChild(heading('Category groups', 25));
    box.appendChild(
      el(
        'div',
        'color:#57534A;margin-bottom:14px;font:400 13px/1.55 ' + SANS,
        'Rename, recolour, or remove a group. Removing one also removes its budget line; ' +
          'entries already filed under it become uncategorised rather than disappearing.',
      ),
    );

    var list = el('div', 'overflow-y:auto;display:grid;gap:10px;padding-right:4px;align-content:start');

    function groupRow(g) {
      var wrap = el(
        'div',
        'border:1px solid #E0D7C5;border-radius:11px;padding:11px 12px;display:grid;gap:9px;background:#FDFBF7',
      );

      var top = el('div', 'display:flex;gap:9px;align-items:center');

      var swatch = el(
        'button',
        'width:22px;height:22px;border-radius:50%;flex:none;cursor:pointer;border:none;background:' + g.color,
      );
      swatch.type = 'button';
      swatch.title = 'Change colour';
      swatch.onclick = function () {
        // Step to the next colour no other group is holding. Two groups the same
        // shade is the thing this picker exists to avoid, so it skips rather
        // than offers and lets you make the clash by hand.
        var taken = {};
        model.forEach(function (o) {
          if (o !== g && !o.removed && o.color) taken[String(o.color).toUpperCase()] = true;
        });

        var from = opts.swatches.indexOf(g.color);
        var found = null;
        for (var step = 1; step <= opts.swatches.length; step++) {
          var next = opts.swatches[(from + step + opts.swatches.length) % opts.swatches.length];
          if (!taken[String(next).toUpperCase()]) {
            found = next;
            break;
          }
        }

        if (!found) {
          // More groups than colours. Saying so beats a dot that does nothing
          // when clicked and leaves you wondering whether it is broken.
          error.textContent =
            'Every colour is already taken by another group. Remove or merge one to free a colour.';
          error.style.color = '#A6412B';
          error.style.display = 'block';
          return;
        }

        g.color = found;
        swatch.style.background = g.color;
        error.style.display = 'none';
      };
      top.appendChild(swatch);

      var name = el(
        'input',
        'flex:1;min-width:0;border:1px solid #DDD4C2;background:#FFF;border-radius:8px;padding:6px 9px;' +
          'font:500 13px ' + SANS + ';color:#1B1915',
      );
      name.value = g.label;
      name.maxLength = 40;
      name.oninput = function () {
        g.label = name.value;
      };
      top.appendChild(name);

      var drop = button('Remove', 'danger');
      drop.style.padding = '5px 10px';
      top.appendChild(drop);
      wrap.appendChild(top);

      var meta = el('div', 'font:400 11px/1.45 ' + SANS + ';color:#7A7468');
      wrap.appendChild(meta);

      // --- categories inside it --------------------------------------------
      var kids = el('div', 'display:grid;gap:4px;padding-left:2px;justify-items:stretch');

      function paintKids() {
        kids.innerHTML = '';
        g.categories.forEach(function (c) {
          if (c.removed) return;
          var row = el('div', 'display:flex;gap:7px;align-items:center');
          var ci = el(
            'input',
            'flex:1;min-width:0;border:1px solid #E8E1D2;background:#FFF;border-radius:7px;padding:4px 8px;' +
              'font:400 12.5px ' + SANS + ';color:#1B1915',
          );
          ci.value = c.label;
          ci.maxLength = 40;
          ci.oninput = function () {
            c.label = ci.value;
          };
          row.appendChild(ci);

          var x = button('✕');
          x.style.padding = '3px 8px';
          x.title = c.inUse ? c.inUse + ' entries use this' : 'Remove';
          x.onclick = function () {
            c.removed = true;
            paintKids();
          };
          row.appendChild(x);
          kids.appendChild(row);
        });

        var add = button('＋ Category');
        add.style.padding = '4px 9px';
        add.style.fontSize = '12px';
        add.style.justifySelf = 'start';
        add.onclick = function () {
          g.categories.push({ id: null, label: '', inUse: 0, removed: false });
          paintKids();
          var inputs = kids.querySelectorAll('input');
          if (inputs.length) inputs[inputs.length - 1].focus();
        };
        kids.appendChild(add);
      }
      paintKids();
      wrap.appendChild(kids);

      function paintRemoved() {
        wrap.style.opacity = g.removed ? '0.45' : '1';
        name.disabled = g.removed;
        kids.style.display = g.removed ? 'none' : 'grid';
        drop.textContent = g.removed ? 'Keep' : 'Remove';
        drop.style.color = g.removed ? '#1B1915' : '#A6412B';
        meta.textContent = g.removed
          ? g.inUse
            ? 'Will be removed — ' + g.inUse + ' entries become uncategorised'
            : 'Will be removed'
          : g.inUse
            ? g.inUse + (g.inUse === 1 ? ' entry uses this group' : ' entries use this group')
            : 'Nothing filed under this yet';
      }
      drop.onclick = function () {
        g.removed = !g.removed;
        paintRemoved();
      };
      paintRemoved();

      return wrap;
    }

    function paint() {
      list.innerHTML = '';
      model.forEach(function (g) {
        list.appendChild(groupRow(g));
      });
    }
    paint();
    box.appendChild(list);

    var error = el('div', 'font:400 12px ' + SANS + ';color:#A6412B;margin-top:8px');
    error.style.display = 'none';
    box.appendChild(error);

    // --- actions ------------------------------------------------------------
    var foot = el('div', 'display:flex;gap:8px;align-items:center;margin-top:12px');

    var addGroup = button('＋ New group');
    addGroup.onclick = function () {
      // First colour nobody holds, rather than one picked by counting — which
      // handed the ninth group the first group's colour.
      var inUse = {};
      model.forEach(function (o) {
        if (!o.removed && o.color) inUse[String(o.color).toUpperCase()] = true;
      });
      var free = opts.swatches.find(function (c) {
        return !inUse[String(c).toUpperCase()];
      });

      model.push({
        id: null,
        label: '',
        color: free || opts.swatches[model.length % opts.swatches.length],
        inUse: 0,
        planned: 0,
        removed: false,
        categories: [],
      });
      paint();
      var inputs = list.querySelectorAll('input');
      if (inputs.length) inputs[inputs.length - 1].focus();
      list.scrollTop = list.scrollHeight;
    };
    foot.appendChild(addGroup);

    // Eight colours used to be shared between an unlimited number of groups, so
    // older ledgers have duplicates baked in — two groups the same shade in the
    // donut and in every bar. Changing the palette cannot reach colours already
    // stored, so this hands them out again, in order, skipping nothing.
    var spread = button('Spread the colours');
    spread.title = 'Give every group a different colour';
    spread.onclick = function () {
      var live = model.filter(function (g) {
        return !g.removed;
      });
      live.forEach(function (g, i) {
        g.color = opts.swatches[i % opts.swatches.length];
      });
      paint();
      var clashes = live.length - new Set(live.map(function (g) { return g.color; })).size;
      error.textContent =
        clashes > 0
          ? 'Recoloured. There are more groups than colours, so ' + clashes +
            ' still share one — rename or merge a few, or pick for them by hand.'
          : 'Recoloured — every group now has its own. Save to keep it.';
      error.style.color = clashes > 0 ? '#A6412B' : '#1F6F63';
      error.style.display = 'block';
    };
    foot.appendChild(spread);

    foot.appendChild(el('div', 'flex:1'));

    var cancel = button('Cancel');
    cancel.onclick = hide;
    var save = button('Save', 'primary');
    save.onclick = function () {
      var kept = model.filter(function (g) {
        return !g.removed;
      });
      if (kept.some(function (g) { return !String(g.label || '').trim(); })) {
        error.textContent = 'Every group needs a name.';
        error.style.display = 'block';
        return;
      }
      if (!kept.length) {
        error.textContent = 'Keep at least one group — the budget needs something to plan against.';
        error.style.display = 'block';
        return;
      }
      hide();
      opts.onSave(model);
    };
    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);

    scrim().appendChild(box);
  }

  // -------------------------------------------------------------------------
  // Ledger settings
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts
   *   household      {id,name,join_code,max_members} | null
   *   memberCount    how many people are in it
   *   onCreate()     -> Promise<household>
   *   onRegenerate() -> Promise<household>
   *   onRevokeCode() -> Promise<household>
   *   onSave(patch)  -> Promise<household>
   *   onJoin(code)   -> Promise<household>
   */
  function settings(opts) {
    var house = opts.household;

    var box = card(480);
    box.appendChild(heading('Ledger settings', 25));

    var error = el('div', 'font:400 12px ' + SANS + ';color:#A6412B;margin-top:10px');
    error.style.display = 'none';
    function fail(err) {
      error.textContent = (err && err.message) || String(err);
      error.style.display = 'block';
    }
    function clear() {
      error.style.display = 'none';
    }

    var body = el('div', 'display:grid;gap:16px');

    // --- nothing shared yet ---------------------------------------------------
    if (!house) {
      body.appendChild(
        el(
          'div',
          'color:#57534A;font:400 13px/1.6 ' + SANS,
          'You do not share a ledger yet. Create one to get a join code, or type the ' +
            'code someone gave you.',
        ),
      );

      var create = button('Create a shared ledger', 'primary');
      create.style.justifySelf = 'start';
      create.onclick = async function () {
        clear();
        create.disabled = true;
        create.textContent = 'Creating…';
        try {
          var h = await opts.onCreate();
          hide();
          settings(Object.assign({}, opts, { household: h, memberCount: 1 }));
        } catch (err) {
          create.disabled = false;
          create.textContent = 'Create a shared ledger';
          fail(err);
        }
      };
      body.appendChild(create);

      var joinWrap = el('div', 'border-top:1px solid #E0D7C5;padding-top:14px;display:grid;gap:9px');
      joinWrap.appendChild(label('Join with a code'));
      var joinRow = el('div', 'display:flex;gap:8px');
      var joinField = field('');
      joinField.wrap.style.flex = '1';
      joinField.input.placeholder = 'ABC123';
      joinField.input.maxLength = 7;
      joinField.input.style.letterSpacing = '2px';
      joinField.input.style.textTransform = 'uppercase';
      joinRow.appendChild(joinField.wrap);
      var joinBtn = button('Join', 'primary');
      joinBtn.onclick = async function () {
        clear();
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joining…';
        try {
          await opts.onJoin(joinField.input.value);
          hide();
        } catch (err) {
          fail(err);
          joinBtn.disabled = false;
          joinBtn.textContent = 'Join';
        }
      };
      joinRow.appendChild(joinBtn);
      joinWrap.appendChild(joinRow);
      body.appendChild(joinWrap);

      box.appendChild(body);
      box.appendChild(error);
      var footA = el('div', 'display:flex;justify-content:flex-end;margin-top:16px');
      var closeA = button('Close');
      closeA.onclick = hide;
      footA.appendChild(closeA);
      box.appendChild(footA);
      scrim().appendChild(box);
      return;
    }

    // --- name -----------------------------------------------------------------
    var name = field('Ledger name');
    name.input.value = house.name || 'Our ledger';
    name.input.maxLength = 50;
    body.appendChild(name.wrap);

    // --- join code ------------------------------------------------------------
    var codeWrap = el('div', 'display:grid;gap:8px');
    codeWrap.appendChild(label('Join code'));
    codeWrap.appendChild(
      el(
        'div',
        'font:400 11px/1.5 ' + SANS + ';color:#7A7468',
        'Anyone with this code and an account can join, up to the limit below. ' +
          'Read it out rather than emailing it.',
      ),
    );

    var MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
    var codeRow = el('div', 'display:flex;gap:8px;align-items:center');
    var codeBox = el(
      'div',
      'flex:1;border:1px solid #DDD4C2;background:#FDFBF7;border-radius:8px;padding:9px 12px;color:#1B1915',
    );

    function paintCode() {
      if (house.join_code) {
        codeBox.textContent = house.join_code;
        codeBox.style.font = '600 19px/1.2 ' + MONO;
        codeBox.style.letterSpacing = '4px';
        codeBox.style.color = '#1B1915';
      } else {
        codeBox.textContent = 'No code — nobody can join';
        codeBox.style.font = '400 13px ' + SANS;
        codeBox.style.letterSpacing = 'normal';
        codeBox.style.color = '#7A7468';
      }
      copy.disabled = !house.join_code;
      revoke.disabled = !house.join_code;
      regen.textContent = house.join_code ? 'New code' : 'Create a code';
    }

    codeRow.appendChild(codeBox);
    var copy = button('Copy');
    copy.onclick = function () {
      if (!house.join_code) return;
      try {
        navigator.clipboard.writeText(house.join_code);
        copy.textContent = 'Copied';
        window.setTimeout(function () {
          copy.textContent = 'Copy';
        }, 1500);
      } catch (e) {
        /* clipboard can be blocked; the code is on screen anyway */
      }
    };
    codeRow.appendChild(copy);
    codeWrap.appendChild(codeRow);

    var codeActions = el('div', 'display:flex;gap:7px');
    var regen = button('New code');
    regen.style.padding = '6px 11px';
    regen.onclick = async function () {
      clear();
      regen.disabled = true;
      try {
        house = await opts.onRegenerate();
        paintCode();
      } catch (err) {
        fail(err);
      }
      regen.disabled = false;
    };
    codeActions.appendChild(regen);

    var revoke = button('Turn off', 'danger');
    revoke.style.padding = '6px 11px';
    revoke.onclick = async function () {
      clear();
      revoke.disabled = true;
      try {
        house = await opts.onRevokeCode();
        paintCode();
      } catch (err) {
        fail(err);
        revoke.disabled = false;
      }
    };
    codeActions.appendChild(revoke);
    codeWrap.appendChild(codeActions);
    paintCode();
    body.appendChild(codeWrap);

    // --- the cap --------------------------------------------------------------
    var capWrap = el('div', 'border-top:1px solid #E0D7C5;padding-top:14px;display:grid;gap:8px');
    capWrap.appendChild(label('Most people allowed'));
    capWrap.appendChild(
      el(
        'div',
        'font:400 11px/1.5 ' + SANS + ';color:#7A7468',
        'Enforced by the database, not just here — a join past this limit is refused even ' +
          'if someone has the code. ' +
          opts.memberCount +
          (opts.memberCount === 1 ? ' person is' : ' people are') +
          ' in this ledger now.',
      ),
    );

    var cap = house.max_members || 2;
    var capRow = el('div', 'display:flex;gap:7px;flex-wrap:wrap');
    var capButtons = [];

    function paintCap() {
      capButtons.forEach(function (x) {
        var on = x.n === cap;
        x.node.style.background = on ? '#17150F' : '#EFE9DE';
        x.node.style.color = on ? '#FDFBF7' : '#1B1915';
        x.node.style.borderColor = on ? '#17150F' : '#D8CEB8';
        // Below the current membership is not a number the database would
        // accept, so it is not offered.
        x.node.disabled = x.n < opts.memberCount;
        x.node.style.opacity = x.node.disabled ? '0.4' : '1';
      });
    }

    [2, 3, 4, 5, 6, 8, 10].forEach(function (n) {
      var b = button(String(n));
      b.style.padding = '6px 13px';
      b.onclick = function () {
        cap = n;
        paintCap();
      };
      capButtons.push({ node: b, n: n });
      capRow.appendChild(b);
    });
    paintCap();
    capWrap.appendChild(capRow);
    body.appendChild(capWrap);

    box.appendChild(body);
    box.appendChild(error);

    var foot = el('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:18px');
    var cancel = button('Close');
    cancel.onclick = hide;
    var save = button('Save', 'primary');
    save.onclick = async function () {
      clear();
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        await opts.onSave({ name: name.input.value.trim() || 'Our ledger', max_members: cap });
        hide();
      } catch (err) {
        fail(err);
        save.disabled = false;
        save.textContent = 'Save';
      }
    };
    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);

    scrim().appendChild(box);
  }

  // -------------------------------------------------------------------------
  // Editing a recurring item
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts
   *   item        {label, amount, day, cadence, categoryId, accountId, memberId, kind}
   *   cadences    [string]
   *   categories  [{id,label,group}]
   *   accounts    [{id,label}]
   *   members     [{id,name}]
   *   onSave(patch)
   *   onDelete()
   */
  function recurring(opts) {
    var it = opts.item || {};

    var box = card(470);
    box.style.maxHeight = 'min(86vh, 820px)';
    box.style.display = 'grid';
    box.style.gridTemplateRows = 'auto 1fr auto auto';

    box.appendChild(heading(opts.title || 'Edit repeating item', 24));

    var body = el('div', 'display:grid;gap:13px;overflow-y:auto;padding-right:4px;align-content:start');

    var name = field('What it is');
    name.input.value = String(it.label || '').split(' — ')[0];
    name.input.maxLength = 60;
    body.appendChild(name.wrap);

    var amount = field('Amount each time', 'A positive figure — the direction is set below.');
    amount.input.value = Math.abs(Number(it.amount) || 0);
    amount.input.inputMode = 'decimal';
    body.appendChild(amount.wrap);

    // --- money in or out ------------------------------------------------------
    var kind = it.kind === 'income' ? 'income' : 'bill';
    var kindWrap = el('div', 'display:grid;gap:6px');
    kindWrap.appendChild(label('Direction'));
    var kindRow = el('div', 'display:flex;gap:7px');
    var kindBtns = [];

    function paintKind() {
      kindBtns.forEach(function (x) {
        var on = x.v === kind;
        x.node.style.background = on ? '#17150F' : '#EFE9DE';
        x.node.style.color = on ? '#FDFBF7' : '#1B1915';
        x.node.style.borderColor = on ? '#17150F' : '#D8CEB8';
      });
    }

    [['bill', 'Money out'], ['income', 'Money in']].forEach(function (pair) {
      var b = button(pair[1]);
      b.style.padding = '6px 13px';
      b.onclick = function () {
        kind = pair[0];
        paintKind();
      };
      kindBtns.push({ node: b, v: pair[0] });
      kindRow.appendChild(b);
    });
    paintKind();
    kindWrap.appendChild(kindRow);
    body.appendChild(kindWrap);

    var day = field('Day of the month', 'Between 1 and 31.');
    day.input.value = Number(it.day) || 1;
    day.input.inputMode = 'numeric';
    body.appendChild(day.wrap);

    function picker(labelText, options, current, onPick) {
      var wrap = el('div', 'display:grid;gap:6px');
      wrap.appendChild(label(labelText));
      var sel = el(
        'select',
        'border:1px solid #DDD4C2;background:#FDFBF7;border-radius:8px;padding:8px 10px;' +
          'font:400 13px ' + SANS + ';width:100%;color:#1B1915',
      );
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (String(o.value) === String(current)) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = function () {
        onPick(sel.value);
      };
      wrap.appendChild(sel);
      return wrap;
    }

    var cadence = it.cadence || 'Monthly';
    body.appendChild(
      picker(
        'How often',
        (opts.cadences || ['Monthly']).map(function (c) {
          return { value: c, label: c };
        }),
        cadence,
        function (v) {
          cadence = v;
        },
      ),
    );

    var categoryId = it.categoryId || '';
    body.appendChild(
      picker(
        'Category',
        [{ value: '', label: 'Uncategorised' }].concat(
          (opts.categories || []).map(function (c) {
            return { value: c.id, label: c.group ? c.group + ' · ' + c.label : c.label };
          }),
        ),
        categoryId,
        function (v) {
          categoryId = v;
        },
      ),
    );

    var accountId = it.accountId || '';
    body.appendChild(
      picker(
        'Account',
        [{ value: '', label: 'No account' }].concat(
          (opts.accounts || []).map(function (a) {
            return { value: a.id, label: a.label };
          }),
        ),
        accountId,
        function (v) {
          accountId = v;
        },
      ),
    );

    var memberId = it.memberId || '';
    body.appendChild(
      picker(
        'Whose',
        (opts.members || []).map(function (m) {
          return { value: m.id, label: m.name };
        }),
        memberId,
        function (v) {
          memberId = v;
        },
      ),
    );

    box.appendChild(body);

    var error = el('div', 'font:400 12px ' + SANS + ';color:#A6412B;margin-top:10px');
    error.style.display = 'none';
    box.appendChild(error);

    function fail(text, input) {
      error.textContent = text;
      error.style.display = 'block';
      if (input) input.focus();
    }

    var foot = el('div', 'display:flex;gap:8px;align-items:center;margin-top:16px');

    // Creating something has nothing to delete yet, and a Delete button on an
    // empty form invites exactly one kind of mistake.
    if (!opts.hideDelete) {
      var del = button('Delete', 'danger');
      del.onclick = function () {
        hide();
        opts.onDelete();
      };
      foot.appendChild(del);
    }
    foot.appendChild(el('div', 'flex:1'));

    var cancel = button('Cancel');
    cancel.onclick = hide;
    var save = button('Save', 'primary');
    save.onclick = function () {
      var text = name.input.value.trim();
      var value = Number(String(amount.input.value).replace(/[^0-9.]/g, ''));
      var dayNum = Math.round(Number(day.input.value));

      if (!text) return fail('Give it a name.', name.input);
      if (!isFinite(value) || value <= 0) return fail('The amount needs to be a number above zero.', amount.input);
      if (!isFinite(dayNum) || dayNum < 1 || dayNum > 31) return fail('The day has to be between 1 and 31.', day.input);

      hide();
      opts.onSave({
        label: text,
        // Stored signed, decided by the direction buttons — so a stray minus
        // typed into the amount box cannot contradict them.
        amount: kind === 'income' ? Math.abs(value) : -Math.abs(value),
        day: dayNum,
        cadence: cadence,
        categoryId: categoryId || null,
        accountId: accountId || null,
        memberId: memberId || null,
        kind: kind,
      });
    };
    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);

    scrim().appendChild(box);
    name.input.focus();
  }

  // -------------------------------------------------------------------------
  // Editing a transaction
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts
   *   tx          {merchant, amount, date, categoryId, accountId, memberId, note}
   *   categories  [{id,label,group}]
   *   accounts    [{id,label}]
   *   members     [{id,name}]
   *   onSave(patch)
   *   onDelete()
   */
  function transaction(opts) {
    var tx = opts.tx || {};

    var box = card(470);
    box.style.maxHeight = 'min(86vh, 820px)';
    box.style.display = 'grid';
    box.style.gridTemplateRows = 'auto 1fr auto auto';

    box.appendChild(heading('Edit entry', 24));

    var body = el('div', 'display:grid;gap:13px;overflow-y:auto;padding-right:4px;align-content:start');

    // --- money in or out ------------------------------------------------------
    // The stored amount is signed. Editing it as a positive figure plus a
    // direction keeps a typed minus from quietly contradicting the buttons,
    // the same way the recurring editor does it.
    var kind = Number(tx.amount) > 0 ? 'income' : 'bill';
    var kindWrap = el('div', 'display:grid;gap:6px');
    kindWrap.appendChild(label('Direction'));
    var kindRow = el('div', 'display:flex;gap:7px');
    var kindBtns = [];

    function paintKind() {
      kindBtns.forEach(function (x) {
        var on = x.v === kind;
        x.node.style.background = on ? '#17150F' : '#EFE9DE';
        x.node.style.color = on ? '#FDFBF7' : '#1B1915';
        x.node.style.borderColor = on ? '#17150F' : '#D8CEB8';
      });
    }

    [['bill', 'Money out'], ['income', 'Money in']].forEach(function (pair) {
      var b = button(pair[1]);
      b.style.padding = '6px 13px';
      b.onclick = function () {
        kind = pair[0];
        paintKind();
      };
      kindBtns.push({ node: b, v: pair[0] });
      kindRow.appendChild(b);
    });
    paintKind();
    kindWrap.appendChild(kindRow);
    body.appendChild(kindWrap);

    var amount = field('Amount', 'A positive figure — the direction is set above.');
    amount.input.value = Math.abs(Number(tx.amount) || 0);
    amount.input.inputMode = 'decimal';
    body.appendChild(amount.wrap);

    var name = field(kind === 'income' ? 'Where it came from' : 'Where it went');
    name.input.value = String(tx.merchant || '');
    name.input.maxLength = 60;
    body.appendChild(name.wrap);

    // The merchant label follows the direction, so the field does not keep
    // calling a salary a shop once the direction is flipped.
    var nameLabel = name.wrap.firstChild;
    kindBtns.forEach(function (x) {
      var prev = x.node.onclick;
      x.node.onclick = function () {
        prev();
        nameLabel.textContent = kind === 'income' ? 'Where it came from' : 'Where it went';
      };
    });

    var date = field('Date it happened');
    date.input.type = 'date';
    date.input.value = String(tx.date || '');
    body.appendChild(date.wrap);

    function picker(labelText, options, current, onPick) {
      var wrap = el('div', 'display:grid;gap:6px');
      wrap.appendChild(label(labelText));
      var sel = el(
        'select',
        'border:1px solid #DDD4C2;background:#FDFBF7;border-radius:8px;padding:8px 10px;' +
          'font:400 13px ' + SANS + ';width:100%;color:#1B1915',
      );
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (String(o.value) === String(current)) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = function () {
        onPick(sel.value);
      };
      wrap.appendChild(sel);
      return wrap;
    }

    var categoryId = tx.categoryId || '';
    body.appendChild(
      picker(
        'Category',
        [{ value: '', label: 'Uncategorised' }].concat(
          (opts.categories || []).map(function (c) {
            return { value: c.id, label: c.group ? c.group + ' · ' + c.label : c.label };
          }),
        ),
        categoryId,
        function (v) {
          categoryId = v;
        },
      ),
    );

    var accountId = tx.accountId || '';
    body.appendChild(
      picker(
        'Account',
        [{ value: '', label: 'No account' }].concat(
          (opts.accounts || []).map(function (a) {
            return { value: a.id, label: a.label };
          }),
        ),
        accountId,
        function (v) {
          accountId = v;
        },
      ),
    );

    var memberId = tx.memberId || '';
    body.appendChild(
      picker(
        'Whose',
        (opts.members || []).map(function (m) {
          return { value: m.id, label: m.name };
        }),
        memberId,
        function (v) {
          memberId = v;
        },
      ),
    );

    box.appendChild(body);

    var error = el('div', 'font:400 12px ' + SANS + ';color:#A6412B;margin-top:10px');
    error.style.display = 'none';
    box.appendChild(error);

    function fail(text, input) {
      error.textContent = text;
      error.style.display = 'block';
      if (input) input.focus();
    }

    var foot = el('div', 'display:flex;gap:8px;align-items:center;margin-top:16px');

    var del = button('Delete', 'danger');
    del.onclick = function () {
      hide();
      opts.onDelete();
    };
    foot.appendChild(del);
    foot.appendChild(el('div', 'flex:1'));

    var cancel = button('Cancel');
    cancel.onclick = hide;

    var save = button('Save', 'primary');
    save.onclick = function () {
      var text = name.input.value.trim();
      var value = Number(String(amount.input.value).replace(/[^0-9.]/g, ''));
      var when = String(date.input.value || '').trim();

      if (!text) return fail('Give it a name.', name.input);
      if (!isFinite(value) || value <= 0) return fail('The amount needs to be a number above zero.', amount.input);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(when)) return fail('Pick a date.', date.input);

      hide();
      opts.onSave({
        merchant: text,
        amount: kind === 'income' ? Math.abs(value) : -Math.abs(value),
        date: when,
        categoryId: categoryId || null,
        accountId: accountId || null,
        memberId: memberId || null,
      });
    };
    foot.appendChild(cancel);
    foot.appendChild(save);
    box.appendChild(foot);

    scrim().appendChild(box);
    name.input.focus();
  }

  window.__hhUI = {
    status: status,
    message: message,
    profile: profile,
    sharing: sharing,
    assistant: assistant,
    categories: categories,
    settings: settings,
    recurring: recurring,
    transaction: transaction,
    hide: hide,
  };
})();
