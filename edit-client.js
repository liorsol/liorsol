/* Injected into every page edit-server.mjs serves. Never written to the file.
   Each [data-ed] element is one editable region; its innerHTML goes back to the server,
   which splices those exact bytes into the .html on disk. */
(function () {
  'use strict';

  /* These pages are installable PWAs. A registered worker answers from its own cache and
     hands back the copy of the file you edited ten seconds ago, which looks exactly like
     the editor silently failing. Unregister it for the dev origin and drop its caches. */
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
  }
  if (window.caches) caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); });

  /* Formatting must come out as <b>/<i>/<u>, not <span style="font-weight:bold">, or every
     bolded word would drag a style attribute into the file. Document-wide, and it has to be
     set before the first edit. */
  try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* default is already false */ }

  /* Must stay identical to norm() in edit-server.mjs, which explains why: the parser hands
     back &amp; for a raw & and wraps bare <tr> in a <tbody> the file never wrote. Neither is
     an edit, and counting them as one takes the field out of the editor for good. */
  var norm = function (s) { return s.replace(/&amp;/g, '&').replace(/<\/?tbody\s*>/gi, ''); };

  var hash = function (s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return (h >>> 0).toString(36);
  };

  /* This script is inline at the end of <body>; trip.js is deferred, so it has not run yet
     and the DOM here is still exactly the bytes the server sent. A region whose innerHTML
     does not re-serialise to those bytes would be rewritten wholesale the first time it was
     saved, so it is taken out of the editor instead of quietly churning the file. */
  var els = [], drift = [];
  [].forEach.call(document.querySelectorAll('[data-ed]'), function (el) {
    if (hash(norm(el.innerHTML)) === el.dataset.edH) { el.dataset.edOrig = el.innerHTML; els.push(el); }
    else drift.push(el);
  });
  if (drift.length) console.warn('[edit] not editable, would not round-trip:', drift);

  /* Only a list gets the browser's own Enter, where it cleanly closes one <li> and opens
     the next. Everywhere else it is a <br>.

     Not a matter of taste: in a card whose text is loose rather than wrapped in <p>, the
     native Enter opens a paragraph mid-sentence and leaves the rest of the card inside it
     — `נ<p>חיתה ב-...` — which is both wrong on screen and wrong in the file. A <br> is
     what "new line" means here, and it is the one thing that cannot go wrong. */
  var LIST_HOST = /^(UL|OL)$/;

  var on = localStorage.getItem('ed') !== '0';
  var timers = new WeakMap();
  var dirty = new Set();

  var css = document.createElement('style');
  css.textContent =
    '.ed-on [data-ed]:hover{outline:1px dashed rgba(193,97,60,.55); outline-offset:3px}' +
    '.ed-on [data-ed]:focus{outline:2px solid #c1613c; outline-offset:3px; background:rgba(217,161,58,.10)}' +
    '#ed-bar{position:fixed; inset-block-end:14px; left:14px; z-index:9999; display:flex; gap:8px; align-items:center;' +
    'font:600 13px/1 Assistant,system-ui,sans-serif; direction:rtl}' +
    '#ed-bar button{font:inherit; cursor:pointer; border:0; border-radius:999px; padding:9px 14px; color:#fff;' +
    'background:#1e3f27; box-shadow:0 6px 18px -8px rgba(0,0,0,.6)}' +
    '#ed-bar button[aria-pressed="false"]{background:#6b6b6b}' +
    '#ed-msg{border-radius:999px; padding:9px 12px; background:#fffdf7; color:#26302a; border:1px solid #e2d9c4;' +
    'opacity:0; transition:opacity .2s}' +
    '#ed-msg.show{opacity:1} #ed-msg.bad{background:#a12b1c; color:#fff; border-color:#a12b1c; opacity:1}' +
    '#ed-tools{position:fixed; z-index:10000; display:none; gap:2px; padding:4px; border-radius:10px;' +
    'background:#1e3f27; box-shadow:0 8px 24px -10px rgba(0,0,0,.7)}' +
    '#ed-tools.show{display:flex}' +
    '#ed-tools button{width:32px; height:32px; border:0; border-radius:7px; background:transparent; color:#fff;' +
    'font:16px/1 Georgia,serif; cursor:pointer}' +
    '#ed-tools button:hover{background:rgba(255,255,255,.18)}';
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.id = 'ed-bar';
  bar.innerHTML = '<button type="button"></button><span id="ed-msg"></span>';
  document.body.appendChild(bar);
  var btn = bar.firstChild, msg = bar.lastChild, hideMsg;

  function flash(text, bad) {
    msg.textContent = text;
    msg.className = bad ? 'bad' : 'show';
    clearTimeout(hideMsg);
    if (!bad) hideMsg = setTimeout(function () { msg.className = ''; }, 1400);
  }

  function payload(el) {
    return JSON.stringify({ file: location.pathname, n: +el.dataset.ed, orig: el.dataset.edOrig, html: el.innerHTML });
  }

  function save(el) {
    clearTimeout(timers.get(el));
    if (!el.__typed || el.dataset.edGenerated || el.innerHTML === el.dataset.edOrig) { dirty.delete(el); return; }
    var sent = el.innerHTML;
    dirty.add(el);
    fetch('/__save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload(el) })
      .then(function (r) {
        if (r.ok) { el.dataset.edOrig = sent; dirty.delete(el); flash('נשמר ✓'); return; }
        /* 409: the file's regions no longer line up with this page — anything typed since
           has already been written, so a reload is the honest way back in sync. */
        if (r.status === 409) { flash('הדף השתנה — טוען מחדש', true); return setTimeout(function () { location.reload(); }, 1200); }
        return r.text().then(function (t) { flash('לא נשמר: ' + t, true); });
      })
      .catch(function (e) { flash('לא נשמר: ' + e.message, true); });
  }

  els.forEach(function (el) {
    el.spellcheck = false;
    /* The generic form of the skip list, and the one that makes this safe to point at a
       page whose generated areas nobody has enumerated yet: if a field no longer matches
       what the server sent, and the user has not typed in it, then the page's own JS
       filled it — its content is not in the file, and saving would put it there. Checked
       at focus, before any keystroke can muddy the comparison. */
    el.addEventListener('focus', function () {
      if (el.__typed || el.innerHTML === el.dataset.edOrig) return;
      el.contentEditable = 'false';
      el.dataset.edGenerated = '1';
      flash('לא ניתן לעריכה — התוכן נוצר בדפדפן, לא בקובץ', true);
      console.warn('[edit] field filled by the page after load, not editable:', el);
    });
    /* Only what the user actually typed in is ever written back. trip.js keeps mutating the
       page after load — opening <details>, filling the weather, revealing a figure — and
       without this a blur alone could commit one of those mutations to the file. */
    el.addEventListener('input', function () {
      el.__typed = true;
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(function () { save(el); }, 700));
    });
    el.addEventListener('blur', function () { save(el); });
    if (!LIST_HOST.test(el.tagName)) {
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        if (!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br>');
      });
    }
    /* Bound explicitly rather than left to the browser: ⌘B / ⌘I / ⌘U are swallowed before
       they reach the page in some hosts, and a formatting shortcut that silently does
       nothing is worse than no shortcut. The toolbar below is the visible way in. */
    el.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      var cmd = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
      if (!cmd) return;
      e.preventDefault();
      document.execCommand(cmd);
      el.__typed = true;
      save(el);
    });
    /* Paste as text: a paste from a browser carries its source's markup with it. */
    el.addEventListener('paste', function (e) {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
    });
  });

  /* --- the formatting toolbar, shown while text is selected inside a field ----- */
  var tools = document.createElement('div');
  tools.id = 'ed-tools';
  tools.innerHTML = '<button type="button" data-cmd="bold" title="מודגש"><b>B</b></button>' +
    '<button type="button" data-cmd="italic" title="נטוי"><i>I</i></button>' +
    '<button type="button" data-cmd="underline" title="קו תחתון"><u>U</u></button>' +
    '<button type="button" data-cmd="removeFormat" title="ניקוי עיצוב">✕</button>';
  document.body.appendChild(tools);

  /* mousedown, not click: the default would blur the field and collapse the selection
     before the command could apply to it. */
  tools.addEventListener('mousedown', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    var host = document.activeElement && document.activeElement.closest('[data-ed]');
    document.execCommand(b.dataset.cmd);
    if (host) { host.__typed = true; save(host); }
  });

  document.addEventListener('selectionchange', function () {
    var sel = getSelection();
    var host = sel.rangeCount && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    host = host && host.closest && host.closest('[data-ed]');
    if (!on || sel.isCollapsed || !host || host.contentEditable !== 'true') { tools.classList.remove('show'); return; }
    var box = sel.getRangeAt(0).getBoundingClientRect();
    tools.style.top = Math.max(8, box.top - 44) + 'px';
    tools.style.left = Math.max(8, Math.min(box.left + box.width / 2 - 82, innerWidth - 172)) + 'px';
    tools.classList.add('show');
  });

  /* Content links are SPA links — trip.js navigates on click, which in edit mode fights
     with placing the caret. Suppress them here (capture, so it never reaches trip.js) and
     leave the side rail alone: that is how you move between views while editing.
     Alt+click follows a link anyway. */
  document.addEventListener('click', function (e) {
    if (!on || e.altKey || !e.target.closest) return;
    if (e.target.closest('[data-ed]') && e.target.closest('[data-view], a[href]')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* Anything still inside its 700ms debounce when the tab goes away. */
  addEventListener('pagehide', function () {
    dirty.forEach(function (el) { navigator.sendBeacon('/__save', new Blob([payload(el)], { type: 'application/json' })); });
  });

  function apply() {
    document.body.classList.toggle('ed-on', on);
    els.forEach(function (el) { el.contentEditable = on ? 'true' : 'false'; });
    btn.textContent = on ? '✏️ עריכה פעילה' : '✏️ עריכה כבויה';
    btn.setAttribute('aria-pressed', String(on));
    localStorage.setItem('ed', on ? '1' : '0');
  }
  btn.addEventListener('click', function () { on = !on; apply(); });
  apply();
  console.log('[edit] ' + els.length + ' editable regions' + (drift.length ? ', ' + drift.length + ' skipped' : ''));
})();
