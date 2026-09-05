/* All of the trip page's behaviour. Lives outside index.html so the HTML file is
   trip content only — and so the service worker can cache the two separately.
   Load order matters: this file is loaded with `defer`, so the DOM is ready. */

(function(){
  /* Routing: #view  or  #view/card-id  or  just #card-id.
     Navigation goes through location.hash, so every move is a real history
     entry and Back/Forward work — including back out of a deep link. */

  var views = {};   // 'north' -> element
  var cards = {};   // 'dajti' -> view name
  document.querySelectorAll('.view').forEach(function(v){
    var name = v.id.replace('view-','');
    views[name] = v;
    v.querySelectorAll('[id]').forEach(function(el){ cards[el.id] = name; });
  });

  function parse(h){
    h = (h || '').replace(/^#/, '');
    if(!h) return {view:'home'};
    var p = h.split('/');
    if(views[p[0]]) return {view:p[0], anchor:p[1]};
    if(cards[h])    return {view:cards[h], anchor:h};   // bare #dajti still resolves
    return {view:'home'};
  }

  /* Scroll memory: we own it, the browser doesn't. Every link click stamps the
     CURRENT history entry with the scroll position, so Back lands exactly where
     the link was pressed — including Back from map.html, which is a real page
     load and so also arrives through this path. */
  try{ history.scrollRestoration = 'manual'; }catch(e){}
  function stamp(){ try{ history.replaceState({y:window.scrollY}, ''); }catch(e){} }
  document.addEventListener('click', function(e){
    if(e.target.closest && e.target.closest('a,[data-view]')) stamp();
  }, true);
  window.addEventListener('pagehide', stamp);       // leaving to map.html by any route

  var flashed = null, frame = document.querySelector('.mapframe');
  function show(view, anchor, restoreY){
    Object.keys(views).forEach(function(n){ views[n].classList.toggle('active', n === view); });
    document.querySelectorAll('nav a[data-view]').forEach(function(a){ a.classList.toggle('on', a.dataset.view === view); });

    if(flashed){ flashed.classList.remove('flash'); flashed = null; }

    /* Mid-page embeds (the restaurant map) load the first time their view opens. */
    if(views[view]) views[view].querySelectorAll('iframe[data-src]').forEach(function(f){
      if(!f.getAttribute('src')) f.setAttribute('src', f.dataset.src);
    });

    if(view === 'map'){          // #map/<category> → map.html#<category>, loaded on first visit
      var src = 'map.html' + (anchor ? '#' + anchor : '');
      if(frame.getAttribute('src') !== src) frame.setAttribute('src', src);
      window.scrollTo({top:0, behavior:'instant'});
      return;
    }

    var el = anchor && document.getElementById(anchor);
    if(el){
      el.querySelectorAll('details').forEach(function(d){ d.open = true; });
      el.classList.add('flash'); flashed = el;
    }
    if(typeof restoreY === 'number'){        // going back — the remembered spot wins
      window.scrollTo({top:restoreY, behavior:'instant'});   // 'instant' beats html{scroll-behavior:smooth}
    } else if(el){
      el.scrollIntoView({behavior:'smooth', block:'start'});
    } else {
      window.scrollTo({top:0, behavior:'smooth'});
    }
  }

  function render(){
    var r = parse(location.hash);
    var st = history.state;
    show(r.view, r.anchor, st && typeof st.y === 'number' ? st.y : undefined);
  }

  document.querySelectorAll('[data-view]').forEach(function(el){
    el.addEventListener('click', function(e){
      e.preventDefault();
      var target = el.dataset.view;
      try{
        if(location.hash.replace(/^#/,'') !== target){ location.hash = target; return; }
      }catch(err){ /* sandboxed iframe (about:srcdoc) blocks history — fall through */ }
      show(target);
    });
  });

  window.addEventListener('hashchange', render);
  render();

  /* Side menu: a fixed rail on desktop, a drawer under 900px. */
  var nav = document.getElementById('nav'), tog = document.querySelector('.navtoggle');
  function drawer(open){ nav.classList.toggle('open', open); tog.setAttribute('aria-expanded', open); }
  tog.addEventListener('click', function(){ drawer(!nav.classList.contains('open')); });
  document.querySelector('.navscrim').addEventListener('click', function(){ drawer(false); });
  nav.addEventListener('click', function(e){ if(e.target.closest('a,.brand')) drawer(false); });

  /* Details-gated embeds (the eSIM usage widget): load only once opened, unlike the
     map's iframe[data-src] above which loads as soon as its view opens. This one calls
     a live API on load, so opening the info tab must not fire that request by itself. */
  document.querySelectorAll('details > iframe[data-embed-src]').forEach(function(f){
    f.closest('details').addEventListener('toggle', function(){
      if(this.open && !f.getAttribute('src')) f.setAttribute('src', f.dataset.embedSrc);
    });
  });

  // print = everything open
  window.addEventListener('beforeprint', function(){
    document.querySelectorAll('details').forEach(function(d){ d.open = true; });
  });
})();

/* ============================================================
   Weather — Open-Meteo forecast, no key, CORS-open, one request for all three
   places. Each trip day is shown for the place we sleep that night, so the
   four Umbrian nights read Deruta and the last day reads Fiumicino.

   `elevation` is passed explicitly for the same reason it is on the Albania
   page: Deruta sits on a ridge at ~215 m above the Tiber valley, and letting
   the API pick the cell's mean height hands back the valley floor instead.
   Late September is the shoulder season here — the daily range is wide, and
   whether the pool is usable is decided by the actual number, not the month.

   The forecast horizon is ~16 days, so this card is empty most of the year
   and fills itself as the trip comes into range. Outside that window it falls
   back to Perugia, the region's reference city. Any failure leaves the card
   hidden — a trip page must never show a stale temperature, which is also why
   the service worker never caches this request.
   ============================================================ */
(function(){
  var card = document.getElementById('weather');
  if(!card || !window.fetch) return;

  var SPOTS = {
    perugia:   {n:'פרוג׳ה',   lat:43.1122, lng:12.3888, el:493},
    deruta:    {n:'דרוטה',     lat:42.9836, lng:12.4211, el:215},
    fiumicino: {n:'פיומיצ׳ינו', lat:41.7714, lng:12.2367, el:3}
  };
  /* where we are meant to be, night by night — mirrors the agenda view.
     The 25th reads Deruta: the night before it is two hours in the dark at
     Fiumicino, and the daytime of the 25th is the drive up and the first
     afternoon at the house. */
  var PLAN = {
    '2026-09-25':'deruta',    '2026-09-26':'deruta',
    '2026-09-27':'deruta',    '2026-09-28':'deruta',
    '2026-09-29':'fiumicino', '2026-09-30':'fiumicino'
  };
  var keys = Object.keys(SPOTS);
  function field(f){ return keys.map(function(k){ return SPOTS[k][f]; }).join(','); }

  /* WMO weather codes → one glyph. Coarse on purpose: the useful signal in
     August is "sun, cloud, or rain", not the drizzle sub-type. */
  function icon(c){
    if(c === 0) return '☀️';
    if(c <= 2)  return '🌤️';
    if(c === 3) return '☁️';
    if(c <= 48) return '🌫️';
    if(c <= 57) return '🌦️';
    if(c <= 67) return '🌧️';
    if(c <= 77) return '❄️';
    if(c <= 82) return '🌧️';
    return '⛈️';
  }
  function round(t){ return Math.round(t) + '°'; }

  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + field('lat') +
    '&longitude=' + field('lng') + '&elevation=' + field('el') +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max' +
    '&timezone=Europe%2FRome&forecast_days=16';

  fetch(url).then(function(r){
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(res){
    var daily = {};
    keys.forEach(function(k, i){ daily[k] = (res[i] || {}).daily; });
    if(!daily.perugia || !daily.perugia.time.length) return;

    var today = daily.perugia.time[0], days = [], sub;
    /* Prefer the trip days that the forecast actually reaches. */
    Object.keys(PLAN).sort().forEach(function(date){
      var key = PLAN[date], d = daily[key], i = d ? d.time.indexOf(date) : -1;
      if(i < 0) return;
      days.push({date:date, spot:SPOTS[key].n, i:d.weather_code[i],
                 hi:d.temperature_2m_max[i], lo:d.temperature_2m_min[i],
                 rain:(d.precipitation_probability_max || [])[i]});
    });
    if(days.length){
      sub = 'התחזית לימי הטיול, כל יום לפי המקום שבו אמורים להיות.';
    } else {                         // trip out of range → the default, Perugia
      var d = daily.perugia;
      for(var i = 0; i < Math.min(5, d.time.length); i++){
        days.push({date:d.time[i], spot:SPOTS.perugia.n, i:d.weather_code[i],
                   hi:d.temperature_2m_max[i], lo:d.temperature_2m_min[i],
                   rain:(d.precipitation_probability_max || [])[i]});
      }
      sub = 'הטיול עדיין רחוק מכדי תחזית — בינתיים מזג האוויר בפרוג׳ה.';
    }

    var box = document.getElementById('wx-days');
    days.forEach(function(x){
      var parts = x.date.split('-');
      var el = document.createElement('div');
      el.className = 'wx-day' + (x.date === today ? ' now' : '');
      [['d', parts[2] + '.' + Number(parts[1])], ['i', icon(x.i)],
       ['t', round(x.hi) + ' / ' + round(x.lo)],
       ['w', x.spot + (typeof x.rain === 'number' ? ' · ' + x.rain + '% גשם' : '')]].forEach(function(pair){
        var s = document.createElement('div');
        s.className = pair[0]; s.textContent = pair[1]; el.appendChild(s);
      });
      box.appendChild(el);
    });
    document.getElementById('wx-sub').textContent = sub;
    card.style.display = '';
  }).catch(function(){});           // no forecast is better than a wrong one
})();

/* ============================================================
   Exchange rate for the כסף card. open.er-api.com is keyless and CORS-open.
   Italy is the euro, so unlike the Albania page there is no third currency to
   cross — one EUR-based response answers the only question the family has,
   which is what a price on a menu costs in shekels.
   Indicative only — a card issuer's conversion or an ATM will not match it.
   ============================================================ */
(function(){
  var box = document.getElementById('fx');
  if(!box || !window.fetch) return;

  fetch('https://open.er-api.com/v6/latest/EUR').then(function(r){
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    var ils = d && d.rates && d.rates.ILS;
    if(!ils) return;
    [['€1', '₪' + ils.toFixed(2)],
     ['€10', '₪' + (10 * ils).toFixed(0)],
     ['€50', '₪' + (50 * ils).toFixed(0)],
     ['₪100', '€' + (100 / ils).toFixed(0)]].forEach(function(pair){
      var s = document.createElement('span');
      s.textContent = pair[0] + ' ≈ ' + pair[1];
      box.appendChild(s);
    });
    var src = document.getElementById('fx-src');
    src.textContent = 'שער לפי open.er-api.com, עודכן ' +
      new Date(d.time_last_update_unix * 1000).toLocaleDateString('he-IL') +
      ' · אינדיקטיבי בלבד — בכרטיס אשראי ובכספומט השער יהיה פחות טוב.';
    box.style.display = ''; src.style.display = '';
  }).catch(function(){});
})();

/* ============================================================
   Restaurants — rendered from restaurants.json, which map.html reads too,
   so a place is added or corrected in exactly one file. Built with
   textContent + a scheme check on every href: the file is ours, but it is
   also the one place where a stray character would otherwise become markup.
   ============================================================ */
(function(){
  var CITY = {deruta:'דרוטה וסביבתה', perugia:'פרוג׳ה', assisi:'אסיזי וספלו',
              todi:'טודי', orvieto:'אורבייטו', terni:'טרני והוואלנרינה',
              trasimeno:'אגם טרסימנו', tuscany:'טוסקנה', gubbio:'גובּיו',
              fiumicino:'פיומיצ׳ינו ורומא'};
  var box = document.getElementById('rest-list');
  if(!box) return;

  function el(tag, cls, txt){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(txt) n.textContent = txt;
    return n;
  }
  function link(href, cls, txt, title){
    var n = el('a', cls, txt);
    n.href = href;
    if(title) n.title = title;
    if(/^https?:/i.test(href)){ n.target = '_blank'; n.rel = 'noopener'; }
    return n;
  }

  function row(r){
    var d = el('div', 'rest'), h = el('div');
    h.appendChild(el('b', null, r.name));
    if(r.gf) h.appendChild(el('span', 'gfb g' + r.gf, 'GF'));
    var facts = [r.type, r.score ? '⭐ ' + r.score : '', r.hours].filter(Boolean).join(' · ');
    if(facts) h.appendChild(el('span', 'rmeta', ' — ' + facts));
    d.appendChild(h);
    if(r.full && r.full !== r.name) d.appendChild(el('div', 'rmeta', r.full));
    if(r.note) d.appendChild(el('div', 'rnote', r.note));

    var links = el('div', 'links');
    if(/^https?:/i.test(r.gmaps || '')) links.appendChild(link(r.gmaps, 'map', 'מפה / ניווט ↖'));
    links.appendChild(link('#map/p:' + r.id, 'map onmap', '🗺️', r.name + ' — במפה שלנו'));
    if(r.phone) links.appendChild(link('tel:' + r.phone.replace(/\s/g, ''), null, '☎ ' + r.phone));
    if(/^https?:/i.test(r.web || '')) links.appendChild(link(r.web, null, 'אתר ↖'));
    d.appendChild(links);
    return d;
  }

  /* 'no-cache' = always revalidate. Without it the browser's heuristic HTTP cache
     will happily serve yesterday's list after the file is corrected. Offline is
     unaffected: the service worker answers from its own cache before this matters. */
  fetch('restaurants.json', {cache:'no-cache'}).then(function(res){ return res.json(); }).then(function(list){
    box.textContent = '';
    box.className = '';
    Object.keys(CITY).forEach(function(city){
      var here = list.filter(function(r){ return r.city === city; });
      if(!here.length) return;
      var head = el('div', 'meta');
      head.style.marginTop = '14px';
      head.appendChild(el('b', null, CITY[city]));
      head.appendChild(el('span', null, here.length === 1 ? 'מקום אחד' : here.length + ' מקומות'));
      box.appendChild(head);
      here.forEach(function(r){ box.appendChild(row(r)); });
    });
  }).catch(function(){
    /* The list is a static file next to this page, and the service worker keeps a
       copy — if it still fails, the page is being opened straight off disk. */
    box.textContent = 'לא הצלחנו לטעון את רשימת המסעדות. ';
    box.appendChild(link('https://github.com/liorsol/liorsol/blob/main/trips/italy-2026/restaurants.json',
                         null, 'הרשימה המלאה ↖'));
  });
})();

/* ============================================================
   Shared boards — comments per view + a links board.
   Storage: Firebase RTDB, path `italy2026` (see repo README).

   Real nested JSON, one node per entry:

     italy2026/comments/<view>/<id> = {n, t, d}
     italy2026/links/<id>           = {n, u, t, d}

   <id> is `<ts36>_<rnd4>`. The DB rules validate each field's type and
   length server-side and reject unknown fields, so the shapes below and
   the published rules must be changed together.

   OFFLINE: the page is installable and is meant to work on a phone with no
   reception, so the boards keep their own two stores in localStorage — a copy
   of the last successful read, and a queue of writes that have not landed yet.
   The service worker deliberately does not touch these requests: a cache
   pretending a write succeeded would lose comments.

   SECURITY: that path is public, unauthenticated and world-writable.
   Everything read back is untrusted input from the internet:
   render with textContent only, and re-check every stored URL's scheme
   before it reaches an href — the rules check it too, but this page must
   not depend on that being the only gate.
   ============================================================ */
(function(){
  var DB   = 'https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app/italy2026';
  var IDRE = /^[a-z0-9]{1,10}_[a-z0-9]{4}$/;    // must match the DB rules
  var LIM  = {name:24, text:800, title:100, url:500};
  var CACHE = 'italy2026_cache';              // last good read, for offline
  var QUEUE = 'italy2026_queue';              // writes waiting for a network

  var boards = [].slice.call(document.querySelectorAll('.talk'));
  var linksEl = document.getElementById('links');
  if(!boards.length && !linksEl) return;

  function newId(){
    var id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    return IDRE.test(id) ? id : null;
  }
  function clip(s, n){ return String(s == null ? '' : s).trim().slice(0, n); }

  /* Only http(s) may ever reach an href. Blocks javascript:, data:, etc. */
  function safeUrl(raw){
    var s = clip(raw, LIM.url);
    if(!s) return null;
    if(!/^https?:\/\//i.test(s)) s = 'https://' + s;
    if(s.length > LIM.url) return null;
    try{
      var u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
    }catch(e){ return null; }
  }
  function when(ms){
    var d = new Date(ms);
    return isNaN(d) ? '' : d.toLocaleDateString('he-IL', {day:'numeric', month:'short'}) +
           ' · ' + d.toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'});
  }

  /* A comment that contains a link should *be* a link (family request, Aug 2026).
     Same rule as the links board: the text is untrusted, so every candidate goes
     through safeUrl() and anything that isn't http(s) stays literal text. */
  var URLRE = /(?:https?:\/\/|www\.)[^\s]+/gi;
  function linkify(text){
    var frag = document.createDocumentFragment(), last = 0, m;
    URLRE.lastIndex = 0;
    while((m = URLRE.exec(text))){
      /* Trailing punctuation belongs to the sentence, not to the URL. */
      var raw = m[0].replace(/[.,;:!?'")\]}»…]+$/, '');
      var href = raw && safeUrl(raw);
      if(!href) continue;                                    // not a URL → leave as text
      if(m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.className = 'lnk'; a.href = href;
      a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
      a.textContent = raw;                                   // untrusted → textContent
      frag.appendChild(a);
      last = URLRE.lastIndex = m.index + raw.length;
    }
    if(last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  var STORE = 'italy2026_name';
  function savedName(){ try{ return localStorage.getItem(STORE) || ''; }catch(e){ return ''; } }
  /* All 11 boards are built once at load, so remembering the name in storage only
     helps the *next* visit. Push it into the sibling boards' inputs too, or you
     retype it on every board in the same session. */
  function rememberName(v){
    try{ localStorage.setItem(STORE, v); }catch(e){}
    document.querySelectorAll('.board-form .who').forEach(function(i){ i.value = v; });
  }

  /* --- offline stores -------------------------------------------- */
  function readJson(key, fallback){
    try{ return JSON.parse(localStorage.getItem(key)) || fallback; }catch(e){ return fallback; }
  }
  function writeJson(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}   // full/private mode: skip
  }
  function queue(){ var q = readJson(QUEUE, []); return Array.isArray(q) ? q : []; }

  /* Show the queued writes as if they had landed, so a comment written in the
     mountains is visible immediately and stays visible across reloads. `_p`
     marks them pending and never leaves this copy — writes send `op.b`. */
  function overlay(data){
    var q = queue();
    if(!q.length) return data;
    var copy = JSON.parse(JSON.stringify(data));
    q.forEach(function(op){
      var parts = op.p.split('/'), node = copy, k;
      while(parts.length > 1){
        k = parts.shift();
        if(!node[k] || typeof node[k] !== 'object') node[k] = {};
        node = node[k];
      }
      k = parts[0];
      if(op.m === 'DELETE'){ delete node[k]; return; }
      var rec = {_p:1};
      Object.keys(op.b).forEach(function(f){ rec[f] = op.b[f]; });
      node[k] = rec;
    });
    return copy;
  }

  /* --- transport ------------------------------------------------ */
  var pending = null;      // all boards share one GET per refresh
  var stale = false;       // last read came from the offline copy
  function loadAll(force){
    if(pending && !force) return pending;
    pending = fetch(DB + '.json', {cache:'no-store'}).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(raw){
      raw = raw || {};
      writeJson(CACHE, raw);
      stale = false;
      return raw;
    }).catch(function(err){
      var copy = readJson(CACHE, null);
      if(!copy) throw err;         // nothing was ever read on this device
      stale = true;
      return copy;
    });
    return pending;
  }

  /* 401 = the DB rules are older than this page, the one error a reload never fixes.
     A rejected promise from fetch() itself is a dead network, which is recoverable. */
  function send(op){
    var init = op.m === 'DELETE' ? {method:'DELETE'} : {method:'PUT', body:JSON.stringify(op.b)};
    return fetch(DB + '/' + op.p + '.json', init).then(function(r){
      if(r.status === 401) throw new Error('rules');
      if(!r.ok) throw new Error('HTTP ' + r.status);
    }, function(){ throw new Error('net'); });
  }
  /* Try now, fall back to the queue. Resolves 'sent' or 'queued'; only a
     permanent rejection (rules, 4xx) reaches the caller as an error. */
  function submit(op){
    if(navigator.onLine === false){ enqueue(op); return Promise.resolve('queued'); }
    return send(op).then(function(){ return 'sent'; }, function(err){
      if(err && err.message === 'net'){ enqueue(op); return 'queued'; }
      throw err;
    });
  }
  function enqueue(op){ var q = queue(); q.push(op); writeJson(QUEUE, q); }

  var flushing = false;
  /* Drain the queue oldest-first, in order: a comment's PUT must precede its
     DELETE. Stops at the first network failure and keeps the rest; drops an op
     the server rejects for good, because retrying it forever would block
     everything behind it. Resolves true if the queue moved. */
  function flush(){
    if(flushing) return Promise.resolve(false);
    flushing = true;
    var moved = false;
    function shift(){ writeJson(QUEUE, queue().slice(1)); moved = true; }
    function step(){
      var q = queue();
      if(!q.length) return Promise.resolve();
      return send(q[0]).then(function(){ shift(); return step(); }, function(err){
        if(err && err.message === 'net') return;    // still offline — try again later
        shift(); return step();
      });
    }
    return step().then(function(){ flushing = false; return moved; },
                       function(){ flushing = false; return moved; });
  }

  function failMsg(err){
    if(err && err.message === 'rules') return 'הכתיבה נחסמה — כללי ה-DB צריכים עדכון';
    return 'הפעולה נכשלה — נסו שוב';
  }
  function okMsg(how, sent, queued){ return how === 'queued' ? queued : sent; }

  /* Turn a stored node into a record, dropping anything malformed. */
  function rows(node, extra){
    var out = [];
    Object.keys(node || {}).forEach(function(id){
      var r = node[id];
      if(!r || typeof r !== 'object') return;                 // ignore junk
      if(typeof r.d !== 'number') return;
      out.push({id:id, n:clip(r.n, LIM.name), t:clip(r.t, extra === 'link' ? LIM.title : LIM.text),
                u:r.u, d:r.d, p:!!r._p});
    });
    return out;
  }

  /* --- shared chrome -------------------------------------------- */
  function build(el, opts){
    el.innerHTML = '';
    var h = document.createElement('h3'); h.textContent = opts.heading; el.appendChild(h);
    var sub = document.createElement('p'); sub.className = 'board-sub';
    sub.textContent = opts.sub; el.appendChild(sub);

    var warn = document.createElement('div'); warn.className = 'board-warn';
    warn.textContent = '⚠️ הלוח הזה ציבורי ופתוח — כל מי שיש לו את הקישור לעמוד יכול לקרוא, ' +
      'לכתוב ולמחוק. אל תכתבו כאן פרטים אישיים: מספרי הזמנה, טלפונים, כתובות, דרכונים או פרטי תשלום.';
    el.appendChild(warn);

    var form = document.createElement('form'); form.className = 'board-form'; form.noValidate = true;
    var row = document.createElement('div'); row.className = 'row';
    var who = document.createElement('input');
    who.className = 'who'; who.maxLength = LIM.name; who.placeholder = 'השם שלך (לא חובה)';
    who.value = savedName(); who.setAttribute('aria-label', 'שם');
    row.appendChild(who);
    form.appendChild(row);
    var extraEl = opts.extra(row, form);

    var foot = document.createElement('div'); foot.className = 'foot';
    var send = document.createElement('button');
    send.type = 'submit'; send.className = 'btn'; send.textContent = opts.submit;
    var msg = document.createElement('span'); msg.className = 'board-msg';
    var count = document.createElement('span'); count.className = 'board-count';
    foot.appendChild(send); foot.appendChild(msg); foot.appendChild(count);
    form.appendChild(foot);
    el.appendChild(form);

    var list = document.createElement('ul'); list.className = 'board-list'; el.appendChild(list);
    return {form:form, who:who, send:send, msg:msg, count:count, list:list, extraEl:extraEl};
  }
  function say(ui, text, kind){
    ui.msg.textContent = text; ui.msg.className = 'board-msg' + (kind ? ' ' + kind : '');
    if(kind === 'ok') setTimeout(function(){ if(ui.msg.textContent === text) ui.msg.textContent = ''; }, 2500);
  }
  function empty(ui, text){
    ui.list.innerHTML = '';
    var p = document.createElement('p'); p.className = 'board-empty';
    p.textContent = text; ui.list.appendChild(p);
  }
  /* One place to say "n items", plus the offline caveat when the numbers came
     from the device rather than the DB. */
  function counted(ui, n, one, many){
    ui.count.textContent = (n ? (n === 1 ? one : n + ' ' + many) : '') +
      (stale ? (n ? ' · ' : '') + 'מוצג מהמכשיר — אין רשת' : '');
  }
  function entry(rec, onDelete){
    var li = document.createElement('li');
    if(rec.p) li.className = 'pend';
    var head = document.createElement('div'); head.className = 'head';
    var w = document.createElement('span'); w.className = 'who';
    w.textContent = rec.n || 'אנונימי';                        // untrusted → textContent
    var t = document.createElement('span'); t.className = 'when';
    t.textContent = when(rec.d) + (rec.p ? ' · ⏳ ממתין לשליחה' : '');
    var x = document.createElement('button');
    x.className = 'del'; x.type = 'button'; x.textContent = '✕';
    x.title = 'מחיקה'; x.setAttribute('aria-label', 'מחיקה');
    x.addEventListener('click', onDelete);
    head.appendChild(w); head.appendChild(t); head.appendChild(x);
    li.appendChild(head);
    return li;
  }

  var refreshers = [];      // every board, so a completed sync updates all of them

  /* --- comments -------------------------------------------------- */
  function initTalk(el){
    var view = el.dataset.topic;
    var ui = build(el, {
      heading: '💬 ' + el.getAttribute('aria-label'),
      sub: 'מקום להערות, שאלות והצעות על הסעיף הזה. משותף לכל מי שנכנס לעמוד. אפשר להוסיף גם בלי רשת — זה יישלח כשהחיבור יחזור.',
      submit: 'שליחה',
      extra: function(row, form){
        var ta = document.createElement('textarea');
        ta.maxLength = LIM.text; ta.placeholder = 'ההערה שלך…';
        ta.setAttribute('aria-label', 'הערה');
        form.appendChild(ta);
        return ta;
      }
    });
    var ta = ui.extraEl;

    function render(all){
      var mine = rows(((all.comments || {})[view]) || {})
                   .sort(function(a, b){ return a.d - b.d; });
      ui.list.innerHTML = '';
      counted(ui, mine.length, 'הערה אחת', 'הערות');
      if(!mine.length){ empty(ui, 'אין עדיין הערות על הסעיף הזה.'); return; }
      mine.forEach(function(rec){
        var li = entry(rec, function(){
          if(!confirm('למחוק את ההערה?')) return;
          submit({p:'comments/' + view + '/' + rec.id, m:'DELETE'})
            .then(function(){ return refresh(true); })
            .catch(function(err){ say(ui, failMsg(err), 'err'); });
        });
        var b = document.createElement('div'); b.className = 'body';
        b.appendChild(linkify(rec.t));            // untrusted → textContent + safeUrl
        li.appendChild(b); ui.list.appendChild(li);
      });
    }
    function refresh(force){
      return loadAll(force).then(function(all){ render(overlay(all)); }).catch(function(){
        empty(ui, 'לא הצלחנו לטעון את ההערות (בעיית רשת?). נסו לרענן.');
      });
    }
    ui.form.addEventListener('submit', function(e){
      e.preventDefault();
      var text = clip(ta.value, LIM.text);
      if(!text){ say(ui, 'צריך לכתוב משהו', 'err'); return; }
      var id = newId();
      if(!id){ say(ui, 'שגיאה פנימית', 'err'); return; }
      var nm = clip(ui.who.value, LIM.name); rememberName(nm);
      ui.send.disabled = true; say(ui, 'שולח…');
      submit({p:'comments/' + view + '/' + id, m:'PUT', b:{n:nm, t:text, d:Date.now()}}).then(function(how){
        ta.value = '';
        say(ui, okMsg(how, 'נשלח ✓', 'נשמר במכשיר — יישלח כשתהיה רשת ⏳'), 'ok');
        return refresh(true);
      }).catch(function(err){
        say(ui, failMsg(err), 'err');
      }).then(function(){ ui.send.disabled = false; });
    });
    refreshers.push(refresh);
    refresh();
  }

  /* --- links board ----------------------------------------------- */
  function initLinks(el){
    var url, title;
    var ui = build(el, {
      heading: '🔗 קישורים שימושיים',
      sub: 'מדריכים, סרטונים, כתבות או כל דבר שכדאי שכולם יראו. משותף לכל מי שנכנס לעמוד.',
      submit: 'הוספת קישור',
      extra: function(row){
        url = document.createElement('input');
        url.className = 'grow'; url.maxLength = LIM.url; url.type = 'text';
        url.placeholder = 'כתובת הקישור (https://…)';
        url.setAttribute('aria-label', 'כתובת');
        title = document.createElement('input');
        title.className = 'grow'; title.maxLength = LIM.title;
        title.placeholder = 'על מה זה? (לא חובה)';
        title.setAttribute('aria-label', 'תיאור');
        row.appendChild(url); row.appendChild(title);
      }
    });
    function render(all){
      var mine = rows(all.links || {}, 'link')
                   .sort(function(a, b){ return b.d - a.d; });
      ui.list.innerHTML = '';
      counted(ui, mine.length, 'קישור אחד', 'קישורים');
      if(!mine.length){ empty(ui, 'אין עדיין קישורים. הוסיפו את הראשון.'); return; }
      var shown = 0;
      mine.forEach(function(rec){
        var href = safeUrl(rec.u);     // re-validate: stored value is untrusted
        if(!href) return;              // silently drop anything not http(s)
        shown++;
        var li = entry(rec, function(){
          if(!confirm('למחוק את הקישור?')) return;
          submit({p:'links/' + rec.id, m:'DELETE'})
            .then(function(){ return refresh(true); })
            .catch(function(err){ say(ui, failMsg(err), 'err'); });
        });
        var a = document.createElement('a');
        a.className = 'lnk'; a.href = href;
        a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
        a.textContent = rec.t || href;                          // untrusted → textContent
        li.appendChild(a);
        var sub = document.createElement('div');
        sub.className = 'when'; sub.textContent = href;
        li.appendChild(sub);
        ui.list.appendChild(li);
      });
      if(!shown) empty(ui, 'אין עדיין קישורים. הוסיפו את הראשון.');
    }
    function refresh(force){
      return loadAll(force).then(function(all){ render(overlay(all)); }).catch(function(){
        empty(ui, 'לא הצלחנו לטעון את הקישורים (בעיית רשת?). נסו לרענן.');
      });
    }
    ui.form.addEventListener('submit', function(e){
      e.preventDefault();
      var href = safeUrl(url.value);
      if(!href){ say(ui, 'כתובת לא תקינה — צריך קישור http/https', 'err'); return; }
      var id = newId();
      if(!id){ say(ui, 'שגיאה פנימית', 'err'); return; }
      var nm = clip(ui.who.value, LIM.name); rememberName(nm);
      ui.send.disabled = true; say(ui, 'שומר…');
      submit({p:'links/' + id, m:'PUT', b:{n:nm, u:href, t:clip(title.value, LIM.title), d:Date.now()}})
        .then(function(how){
          url.value = ''; title.value = '';
          say(ui, okMsg(how, 'נוסף ✓', 'נשמר במכשיר — יישלח כשתהיה רשת ⏳'), 'ok');
          return refresh(true);
        }).catch(function(err){
          say(ui, failMsg(err), 'err');
        }).then(function(){ ui.send.disabled = false; });
    });
    refreshers.push(refresh);
    refresh();
  }

  boards.forEach(initTalk);
  if(linksEl) initLinks(linksEl);

  /* Sync: on load and whenever the connection comes back. Re-render only if the
     queue actually moved, so a quiet flush costs nothing. */
  function sync(){
    flush().then(function(moved){
      if(moved) refreshers.forEach(function(r){ r(true); });
    });
  }
  window.addEventListener('online', sync);
  if(queue().length) sync();
})();

/* ============================================================
   Installable + offline (user's request, Aug 2026): the family adds the page to
   the phone's home screen before the flight and it works in Shëngjergj, on the
   southern roads and at the villa, where reception is unverified at best.
   Registered last and failure is silent — no worker means a normal web page.
   ============================================================ */
if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}
