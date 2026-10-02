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

  window.__hhUI = { status: status, message: message, profile: profile, hide: hide };
})();
