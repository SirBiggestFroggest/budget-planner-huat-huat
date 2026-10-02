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

  var SWATCHES = ['#4F6E9A', '#B0542C', '#3F5A6E', '#6E8F5A', '#8A5A7A', '#A88A2E', '#7A7468', '#C9A24A'];

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
  // The assistant
  // -------------------------------------------------------------------------

  /**
   * @param {object} opts
   *   unsorted               count of uncategorised entries
   *   onAsk(question)        -> Promise<string>
   *   onSummarise()          -> Promise<string>
   *   onCategorise(progress) -> Promise<{done, seen}>
   */
  function assistant(opts) {
    var box = card(520);
    box.appendChild(heading('Ask about your money', 25));
    box.appendChild(
      el(
        'div',
        'color:#57534A;margin-bottom:16px',
        'It reads a summary of this month, never your whole ledger, and never anything you marked private.',
      ),
    );

    var out = el(
      'div',
      'min-height:88px;max-height:300px;overflow:auto;border:1px solid #E8E1D2;border-radius:10px;' +
        'padding:14px;background:#FDFBF7;font:400 14px/1.65 ' + SANS + ';color:#1B1915;white-space:pre-wrap',
    );
    out.textContent = 'Ask a question, or use one of the buttons below.';
    box.appendChild(out);

    function busy(text) {
      out.style.color = '#7A7468';
      out.textContent = text;
    }
    function answer(text) {
      out.style.color = '#1B1915';
      out.textContent = text;
    }
    function failed(err) {
      out.style.color = '#A6412B';
      out.textContent = (err && err.message) || String(err);
    }

    // --- ask ----------------------------------------------------------------
    var askRow = el('div', 'display:flex;gap:8px;margin-top:12px;align-items:flex-start');
    var q = field('');
    q.wrap.style.flex = '1';
    q.input.placeholder = 'e.g. what did we spend on eating out?';
    askRow.appendChild(q.wrap);

    var go = button('Ask', 'primary');
    async function doAsk() {
      var question = q.input.value.trim();
      if (!question) return;
      go.disabled = true;
      busy('Thinking…');
      try {
        answer(await opts.onAsk(question));
      } catch (err) {
        failed(err);
      }
      go.disabled = false;
    }
    go.onclick = doAsk;
    q.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doAsk();
    });
    askRow.appendChild(go);
    box.appendChild(askRow);

    // --- the other two ------------------------------------------------------
    var tools = el('div', 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap');

    var sum = button('Summarise this month');
    sum.onclick = async function () {
      sum.disabled = true;
      busy('Reading the month…');
      try {
        answer(await opts.onSummarise());
      } catch (err) {
        failed(err);
      }
      sum.disabled = false;
    };
    tools.appendChild(sum);

    var cat = button(opts.unsorted ? 'Sort ' + opts.unsorted + ' uncategorised' : 'Nothing to sort');
    cat.disabled = !opts.unsorted;
    cat.onclick = async function () {
      cat.disabled = true;
      busy('Sorting…');
      try {
        var res = await opts.onCategorise(function (done, total) {
          busy('Sorting ' + done + ' of ' + total + '…');
        });
        answer(
          res.done
            ? 'Categorised ' + res.done + ' of ' + res.seen + ' entries. Check them on the Transactions screen.'
            : 'Nothing could be matched confidently — they are still waiting for you.',
        );
      } catch (err) {
        failed(err);
      }
    };
    tools.appendChild(cat);
    box.appendChild(tools);

    var foot = el('div', 'display:flex;justify-content:flex-end;margin-top:16px');
    var close = button('Close');
    close.onclick = hide;
    foot.appendChild(close);
    box.appendChild(foot);

    scrim().appendChild(box);
    q.input.focus();
  }

  window.__hhUI = {
    status: status,
    message: message,
    profile: profile,
    sharing: sharing,
    assistant: assistant,
    hide: hide,
  };
})();
