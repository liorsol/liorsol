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
  var current = 'home';

  /* Hero clips need re-asserting, they do not just run. Two reasons, both real:
     every `.view` is `display:none` while the document is parsed — `.active` lands
     only once this deferred file runs — and Safari will not autoplay a video that
     was hidden at that moment; and switching views hides the clip again, which
     pauses it with nothing to resume it. So entering a view (re)starts its clip.
     `play()` rejects under iOS Low Power Mode and data-saver: that is what the
     still background layer is for, so the rejection is swallowed, not logged. */
  function playClips(view){
    if(!views[view]) return;
    views[view].querySelectorAll('video[autoplay]').forEach(function(v){
      if(!v.paused) return;
      var p = v.play();
      if(p && p.catch) p.catch(function(){});
    });
  }

  function show(view, anchor, restoreY){
    current = view;
    Object.keys(views).forEach(function(n){ views[n].classList.toggle('active', n === view); });
    document.querySelectorAll('nav a[data-view]').forEach(function(a){ a.classList.toggle('on', a.dataset.view === view); });
    playClips(view);

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

  /* Returning to the tab, or back-navigating in from the bfcache, can leave a clip
     paused with no event of its own — so re-assert it there too. */
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) playClips(current); });
  window.addEventListener('pageshow', function(){ playClips(current); });

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

  /* print = everything open, and then back exactly as it was.
     CSS cannot reveal a closed <details> — the `open` attribute is the only switch —
     so this stays JS. It matters more since the note boxes in the day cards became
     <details> themselves (user's request, Sep 2026): without this, printing the page
     would drop most of the warnings on it. `afterprint` restores the previous state so
     printing does not silently expand the page the family is still reading, and
     `matchMedia('print')` covers Safari, which fires neither event reliably. */
  var wasOpen = null;
  function printOpen(){
    if(wasOpen) return;                                     // already open for this print
    wasOpen = [].map.call(document.querySelectorAll('details'), function(d){
      var before = d.open; d.open = true; return [d, before];
    });
  }
  function printRestore(){
    if(!wasOpen) return;
    wasOpen.forEach(function(pair){ pair[0].open = pair[1]; });
    wasOpen = null;
  }
  window.addEventListener('beforeprint', printOpen);
  window.addEventListener('afterprint', printRestore);
  if(window.matchMedia){
    var pmq = window.matchMedia('print');
    var onPrint = function(e){ (e.matches ? printOpen : printRestore)(); };
    if(pmq.addEventListener) pmq.addEventListener('change', onPrint);
    else if(pmq.addListener) pmq.addListener(onPrint);     // Safari < 14
  }
})();

/* ============================================================
   Day-card galleries: every card in the "bank of trip days" carries the shots of
   that place from research-chatgpt.md — 5 to 9 each, 51 in all — as a strip you
   swipe sideways. They are hotlinked from that doc's CDN, which is not ours: the
   URLs are signed and will eventually stop resolving, so a failed shot is removed
   from the strip and the last failure takes the whole <figure> with it. The card
   then falls back to the layout it had before there were previews. Never a
   broken-image icon on a page the family reads at a motorway services.

   The bundled way is better and is what to do if these ever go dark: save the
   images into assets/, add them to the SW's CORE, credit them in CREDITS.md.
   ============================================================ */
(function(){
  /* This file is deferred, so an image can have failed before its listener was
     attached: a complete image with no intrinsic width is a load that failed. */
  function onFail(img, fn){
    img.addEventListener('error', fn);
    if(img.complete && !img.naturalWidth) fn();
  }

  /* One card, the whole set of shots of that place, swiped sideways (user's request,
     Sep 2026: "swipe left right with swipe animation, and all images should be cached
     on load"). The gesture is the browser's own — a flex strip with `scroll-snap-type:
     x mandatory` — so the animation, the momentum and the rubber-banding are native
     and cost no JS. This code only keeps the counter honest, drops dead shots, and
     lends a mouse the same gesture. Two rules that hold it together:
       - the figure starts `hidden` and is revealed once an image has really arrived,
         so a dead CDN leaves no empty frame — the card looks as it did before;
       - every shot carries a real `src` and is fetched on load. That is also what gets
         them cached: sw-core.js stores cross-origin images as opaque responses (verified
         in-browser: `opaque status=0` in the version cache), so swiping keeps working
         with no reception. Note the very first visit fetches them before the worker is
         controlling the page, so it is the second visit that fills that cache; the
         browser's own HTTP cache covers the gap. */
  document.querySelectorAll('figure.prev').forEach(function(fig){
    var track = fig.querySelector('.prev-track');
    var shots = [].slice.call(track.querySelectorAll('img'));
    if(!shots.length){ fig.remove(); return; }

    var count = document.createElement('span');
    count.className = 'prev-count';
    fig.appendChild(count);

    /* Circular, in both directions and by both gestures (user's request, Sep 2026) — and
       the seam has to animate exactly like every other step, so it must not be a jump.
       A scroll container cannot scroll past its own ends, so the strip carries a copy of
       the last shot before the first one and a copy of the first after the last:

           [N] 1 2 … N [1]
            ▲           ▲     clones — reached by an utterly ordinary one-slide swipe

       Crossing the seam is therefore the browser's own glide, identical to any other.
       Once the strip comes to rest on a clone, scrollLeft is moved to the real slide
       carrying that same picture: the swap cannot be seen, because the two frames show
       the same thing. Nothing about the gesture, the momentum or the snapping changes. */
    var head = null, tail = null;
    function loop(){
      if(head) head.remove();
      if(tail) tail.remove();
      head = tail = null;
      /* Without a ResizeObserver there is no way to hear when the strip finally has a
         width, and the loop would open parked on the wrong shot (see `park` below). Those
         browsers keep the plain strip instead: it stops at both ends, and that is all. */
      if(shots.length < 2 || !window.ResizeObserver) return;
      head = shots[shots.length - 1].cloneNode();
      tail = shots[0].cloneNode();
      [head, tail].forEach(function(c){ c.alt = ''; c.setAttribute('aria-hidden', 'true'); });
      track.insertBefore(head, shots[0]);
      track.appendChild(tail);
    }

    /* The strip is the source of truth for "which shot" — read it, never track it in a
       variable, or a native swipe and the counter drift apart. With the clones in place
       slot 0 *is* shot N and slot N+1 *is* shot 1, so the reading is taken modulo N. */
    function tally(){
      var w = Math.max(1, track.clientWidth), n = shots.length;
      var slot = Math.max(0, Math.round(track.scrollLeft / w));
      var at = n < 2 ? 0 : ((slot - 1) % n + n) % n;
      count.textContent = (at + 1) + ' / ' + n;
      count.hidden = n < 2;
    }
    function reveal(){ fig.hidden = false; tally(); }
    function drop(img){
      var i = shots.indexOf(img);
      if(i < 0) return;                   // a clone — its original is dropping itself
      shots.splice(i, 1);
      img.remove();                       // and with it the slide, so the strip closes up
      if(!shots.length){ fig.remove(); return; }
      loop();                             // a clone may have been of the shot that just died
      tally();
    }
    loop();
    shots.slice().forEach(function(img){
      img.addEventListener('load', reveal);
      img.addEventListener('error', function(){ drop(img); });
      /* Deferred file: an image may have finished — or failed — before these listeners
         existed. A complete image with no intrinsic width is a load that failed. */
      if(img.complete){ if(img.naturalWidth) reveal(); else drop(img); }
    });

    /* Resting on a clone means the seam was just crossed: swap to the real slide showing
       the same picture. Rest is "no scroll event for 120ms" — `scrollend` would say it
       exactly, but it only reached Baseline in December 2025 and an iPhone two iOS
       versions back does not have it. 120ms is past the end of iOS momentum and short
       enough to land before a second swipe. */
    var rest = null;
    function settled(){
      var w = track.clientWidth;
      if(!head || !w) return;
      var slot = Math.round(track.scrollLeft / w);
      if(slot === 0) track.scrollLeft = shots.length * w;          // clone of the last → the last
      else if(slot === shots.length + 1) track.scrollLeft = w;     // clone of the first → the first
    }
    track.addEventListener('scroll', function(){
      tally();
      clearTimeout(rest);
      rest = setTimeout(settled, 120);
    }, {passive:true});

    /* Slot 1 is the real first shot, and parking there needs a width the strip does not
       have yet: the figure starts `hidden`, and its whole view is `display:none` until
       the router opens it. A ResizeObserver hears both, and the rotation after them. A
       strip sitting at 0 is either brand new or was reset when its view went away — it is
       never a resting place, since resting on the head clone teleports off it — so a 0 is
       exactly the signal to park it on the first shot. */
    if(window.ResizeObserver) new ResizeObserver(function(){
      var w = track.clientWidth;
      if(!w) return;
      if(head && !track.scrollLeft) track.scrollLeft = w;
      tally();
    }).observe(track);
    tally();

    /* Touch and trackpad already swipe this natively. A mouse cannot, so it gets the
       same gesture by dragging. Snapping is switched off for the duration, or every
       pointermove would fight it back to the current slide. */
    var from = null, dragged = false;
    track.addEventListener('pointerdown', function(e){
      if(e.pointerType !== 'mouse' || shots.length < 2) return;
      from = {x:e.clientX, left:track.scrollLeft};
      dragged = false;
      track.classList.add('drag');
      track.setPointerCapture(e.pointerId);
    });
    track.addEventListener('pointermove', function(e){
      if(!from) return;
      e.preventDefault();
      if(Math.abs(e.clientX - from.x) > 6) dragged = true;
      track.scrollLeft = from.left - (e.clientX - from.x);
    });
    function settle(){
      if(!from) return;
      from = null;
      var w = Math.max(1, track.clientWidth);
      track.scrollTo({left: Math.round(track.scrollLeft / w) * w, behavior:'smooth'});
      /* Keep snapping off until that smooth scroll has landed — restoring `mandatory`
         mid-animation cancels it and the strip jumps instead of gliding. */
      setTimeout(function(){ track.classList.remove('drag'); }, 400);
    }
    track.addEventListener('pointerup', settle);
    track.addEventListener('pointercancel', settle);

    /* Tap or click advances one slide — the seam included, with no special case, because
       to this handler the seam is just another slide. A touch swipe never reaches here:
       the browser suppresses the click once the gesture scrolled. A mouse drag does end
       in one, and is filtered by `dragged`. */
    track.addEventListener('click', function(){
      if(dragged){ dragged = false; return; }
      if(shots.length < 2) return;
      var w = Math.max(1, track.clientWidth);
      track.scrollTo({left: (Math.round(track.scrollLeft / w) + 1) * w, behavior:'smooth'});
    });
  });

  /* The arrival card's Terminal 3 map is hotlinked as well — it is published by
     someone else and bundling it would redistribute it (assets/CREDITS.md). It is
     also the one picture somebody may be hunting for at 02:00 in FCO, so a failure
     leaves a way to reach it instead of silence or a broken-image icon. */
  document.querySelectorAll('figure.shot img.net').forEach(function(img){
    onFail(img, function(){
      if(!img.parentNode) return;
      var p = document.createElement('p'); p.className = 'netfail';
      p.appendChild(document.createTextNode('המפה לא נטענה — היא נטענת מהאינטרנט. '));
      var a = document.createElement('a');
      a.href = img.dataset.source || img.src;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'לפתוח אותה באתר המקור ↖';
      p.appendChild(a);
      img.replaceWith(p);
    });
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
    fiumicino: {n:'פיומיצ׳ינו', lat:41.7714, lng:12.2367, el:3},
    /* Rome city centre (user's request, Sep 2026). NOT the same reading as
       Fiumicino: the airport is on the coast and Rome sits 25 km inland, which
       in late September is regularly a 2–4° difference and a different rain
       probability. The last day is spent in the city, not at the airport, so
       both are worth having. Same one request — Open-Meteo takes a
       comma-separated list of coordinates and returns an array. */
    roma:      {n:'רומא',      lat:41.9028, lng:12.4964, el:21}
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

    function paint(box, list){
      list.forEach(function(x){
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
    }
    paint(document.getElementById('wx-days'), days);

    /* Rome, over exactly the dates the first strip ended up showing — so the two
       rows line up whether we are inside the trip window or on the Perugia
       fallback. Its own failure is silent: the main strip is already painted. */
    var rd = daily.roma, rbox = document.getElementById('wx-roma-days'), roma = [];
    if(rd) days.forEach(function(x){
      var i = rd.time.indexOf(x.date);
      if(i < 0) return;
      roma.push({date:x.date, spot:SPOTS.roma.n, i:rd.weather_code[i],
                 hi:rd.temperature_2m_max[i], lo:rd.temperature_2m_min[i],
                 rain:(rd.precipitation_probability_max || [])[i]});
    });
    if(roma.length){
      paint(rbox, roma);
      document.getElementById('wx-roma').style.display = '';
    }

    document.getElementById('wx-sub').textContent = sub;
    card.style.display = '';
  }).catch(function(){});           // no forecast is better than a wrong one
})();

/* ============================================================
   Live flight status (user's request, Sep 2026) — the flights table in #home.

   SOURCE: the Israel Airports Authority's own flight board, published as an open
   dataset on data.gov.il (CKAN `datastore_search`). It was picked over every
   commercial flight API for one reason that overrides all the others: it is the
   only candidate that is **CORS-open AND key-free**.

     $ curl -sI -H 'Origin: https://liorsol.github.io' 'https://data.gov.il/api/3/...'
     HTTP/1.1 200 OK
     Access-Control-Allow-Origin: *

   Everything else fails one of the two. OpenSky pins ACAO to its own origin;
   adsb.lol and adsb.fi send no ACAO at all; FlightAware's AeroAPI sends none.
   AviationStack and AeroDataBox do allow the browser — but both need a key, and
   **this repo is public**, so the key would ship in plain sight in a file anyone
   can read. Neither vendor's free key is referrer-locked, so it is a bearer
   credential and a stranger drains the quota. adr.it (Fiumicino's own board)
   answers 403 from CloudFront and Wizz Air publishes nothing. No proxy is
   possible either — GitHub Pages is static, there is no server to put one on.

   WHAT IT COVERS, AND WHAT IT DOES NOT. It is Ben Gurion's board, so it knows
   our three legs from the TLV end only: the 24.9 departure, and the two
   arrivals back. There is no free CORS-open Fiumicino source, so the FCO gate
   and the FCO belt are simply not available — what does come through is the
   delay, because an arrival's CHPTOL already reflects a late departure from
   Rome. The FlightAware link in each row is the answer for everything else,
   and it is rendered unconditionally rather than as an error state.

   THE HORIZON IS ~3 DAYS, AND THAT IS THE FEATURE'S REAL SHAPE. Measured on
   13.9.2026, the dataset held today−1 … today+3 and the last day was partial.
   So for most of the time this page exists the answer is legitimately "no row
   yet", and the trip is weeks out. That is a NORMAL state, not a failure:
   the row keeps its scheduled times and says so. Three states, no spinner that
   spins forever:
     · no row / offline / throw → the static scheduled time stands, muted label
     · row found                → status chip + the actual/estimated time + terminal
     · always                   → the FlightAware deep-link
   `sw-core.js`'s `live()` refuses to cache this host for the same reason it
   refuses the weather: a stale flight status is worse than none.

   One request per distinct flight number, not per row — 6041 is flown on both
   return dates, so two fetches cover three rows. `CHSTOL` is matched by date
   because the dataset holds one row per flight number per day; taking
   records[0] would show a random day's status.

   UNTRUSTED INPUT: every value below is written with `textContent`. The Hebrew
   status string is the publisher's own `CHRMINH`, so there is nothing to
   translate and nothing to interpolate into markup.
   ============================================================ */
(function(){
  var tbl = document.getElementById('flighttbl');
  if(!tbl || !window.fetch) return;
  var rows = [].slice.call(tbl.querySelectorAll('tr[data-fl]'));
  if(!rows.length) return;

  var API = 'https://data.gov.il/api/3/action/datastore_search' +
            '?resource_id=e83f763b-b7d7-479e-b172-ae981ddc6de5&limit=60&filters=';

  /* CHRMINE is the stable machine value; CHRMINH is the publisher's Hebrew.
     Prefer the Hebrew, fall back to the English, and colour off the English so
     a wording change upstream cannot silently turn a cancellation green. */
  function tone(code){
    var c = String(code || '').toUpperCase();
    if(c === 'CANCELED' || c === 'CANCELLED') return 'bad';
    if(c === 'DELAYED') return 'warn';
    if(c === 'LANDED' || c === 'FINAL' || c === 'DEPARTED') return 'done';
    return 'ok';                                   // ON TIME, NOT FINAL, LANDING
  }
  function hhmm(s){                                 // "2026-09-24T21:55:00" → "21:55"
    var m = /T(\d{2}:\d{2})/.exec(s || '');
    return m ? m[1] : '';
  }

  function paint(row, rec){
    var cell = row.querySelector('.fstat');
    if(!cell) return;
    cell.textContent = '';

    if(!rec){                                       // the normal state, most of the year
      var q = document.createElement('span');
      q.className = 'fchip sched';
      q.textContent = 'לפי לוח הזמנים';
      cell.appendChild(q);
      return;
    }
    var chip = document.createElement('span');
    chip.className = 'fchip ' + tone(rec.CHRMINE);
    chip.textContent = rec.CHRMINH || rec.CHRMINE || '—';
    cell.appendChild(chip);

    /* The actual/estimated time, but only when it differs from the scheduled one
       — repeating an unchanged time adds a number and no information. */
    var sched = hhmm(rec.CHSTOL), real = hhmm(rec.CHPTOL);
    if(real && real !== sched){
      var t = document.createElement('div');
      t.className = 'fnow';
      t.textContent = 'בפועל ' + real;
      cell.appendChild(t);
    }
    if(rec.CHTERM){
      var term = document.createElement('div');
      term.className = 'fterm';
      term.textContent = 'טרמינל ' + rec.CHTERM + ' בנתב״ג';
      cell.appendChild(term);
    }
  }

  /* Group the rows by flight number so each number is fetched once.
     Take the LAST digit run, not "every digit": the carrier code contains one of its
     own, so stripping non-digits from "W4 6044" yields "46044" and every lookup
     silently finds nothing. `CHFLTN` in the dataset is the bare number. */
  var byNum = {};
  rows.forEach(function(r){
    var m = /(\d+)\s*$/.exec(r.dataset.fl || '');
    if(!m) return;
    (byNum[m[1]] = byNum[m[1]] || []).push(r);
  });

  Object.keys(byNum).forEach(function(num){
    var mine = byNum[num];
    fetch(API + encodeURIComponent(JSON.stringify({CHOPER:'W4', CHFLTN:num})),
          {cache:'no-store'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(res){
        var recs = ((res || {}).result || {}).records || [];
        mine.forEach(function(row){
          /* Match on BOTH the date and the direction: 6041 appears as an arrival
             here, and a same-numbered departure would otherwise match first. */
          var want = row.dataset.date, dir = row.dataset.to === 'TLV' ? 'A' : 'D';
          paint(row, recs.filter(function(x){
            return String(x.CHSTOL || '').slice(0, 10) === want && x.CHAORD === dir;
          })[0] || null);
        });
      })
      .catch(function(){ mine.forEach(function(row){ paint(row, null); }); });
  });
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
   Shared boards — a comments board on every view + a links board.
   Storage: Firebase RTDB, path `italy2026` (see repo README).

   Real nested JSON, one node per entry:

     italy2026/comments/<view>/<id> = {n, t, d, a?}
     italy2026/links/<id>           = {n, u, t, d}
     italy2026/esims/<id>           = {n, i, u?, d, a?}

   <id> is `<ts36>_<rnd4>`. The DB rules validate each field's type and
   length server-side and reject unknown fields, so the shapes below and
   the published rules must be changed together.

   ONE CONVERSATION, EVERY BOARD (user's request, Sep 2026): a comment is
   still written against the view it was posted from — that is what `<view>`
   is for, and the chip on each row says which — but every board renders
   *all* of them, in one chronological thread. A note left on `north` used to
   be invisible to anyone who never scrolled that far.

   eSIM TRACKERS (user's request, Sep 2026): `esims` is the trip's own copy of the
   /esim-usage/ dashboard — a live data bar per eSIM — except the list is editable
   from the page instead of hard-coded. `i` (the ICCID) is what the usage API is
   keyed on; the numbers themselves are never stored.
   Trip-scoped by the path it lives under, nothing else — there is no flag to
   get wrong. It is shaped like a link but it archives like a comment, so the
   two behaviours below are shared by both rather than written twice.

   DELETING IS ARCHIVING (same request): ✕ writes `a` = epoch ms instead of
   removing the node, and the row moves behind the 🗄️ toggle. Nothing the
   family can press destroys a comment; removal is the fold-into-the-page
   pass (curl or the console). The rules back that up — a comment node may
   only be DELETEd once it carries `a`. See the README.

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
  var ICCIDRE = /^[0-9]{18,22}$/;              // must match the DB rules; rows() uses it
  var LIM  = {name:24, text:800, title:100, url:500};
  var CACHE = 'italy2026_cache';              // last good read, for offline
  var QUEUE = 'italy2026_queue';              // writes waiting for a network

  var boards = [].slice.call(document.querySelectorAll('.talk'));
  var linksEl = document.getElementById('links');
  var esimsEl = document.getElementById('esims');
  if(!boards.length && !linksEl && !esimsEl) return;

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

  /* Every board shows every comment, so each row needs to say which section it
     belongs to — in the nav's own wording ("טירנה", not "tirana"). A view with no
     nav entry, or a stale one left in the DB, falls back to its raw key; that key
     is stored data, so it is clipped and rendered as text like everything else. */
  var LABELS = {};
  document.querySelectorAll('nav a[data-view]').forEach(function(a){
    LABELS[a.dataset.view] = a.textContent.trim();
  });
  function label(view){ return LABELS[view] || clip(view, LIM.name); }

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
     mountains is visible immediately and stays visible across reloads — and so an
     archive done with no reception hides the row at once. `_p` marks them pending
     and never leaves this copy — writes send `op.b`. PUT replaces the node, PATCH
     merges into it (a null field clears it), exactly like the DB's own semantics. */
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
      var rec = (op.m === 'PATCH' && node[k] && typeof node[k] === 'object') ? node[k] : {};
      Object.keys(op.b).forEach(function(f){
        if(op.b[f] === null) delete rec[f]; else rec[f] = op.b[f];
      });
      rec._p = 1;
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
    var init = op.m === 'DELETE' ? {method:'DELETE'} : {method:op.m, body:JSON.stringify(op.b)};
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
  /* Drain the queue oldest-first, in order: a comment's PUT must precede the PATCH
     that archives it. Stops at the first network failure and keeps the rest; drops
     an op the server rejects for good, because retrying it forever would block
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

  /* Turn a stored node into a record, dropping anything malformed. `a` is the
     archive stamp: present = removed from the board, kept in the DB. */
  function rows(node, extra){
    var out = [];
    Object.keys(node || {}).forEach(function(id){
      var r = node[id];
      if(!r || typeof r !== 'object') return;                 // ignore junk
      if(typeof r.d !== 'number') return;
      var rec = {id:id, n:clip(r.n, LIM.name), t:clip(r.t, extra === 'link' ? LIM.title : LIM.text),
                 u:r.u, i:(typeof r.i === 'string' && ICCIDRE.test(r.i)) ? r.i : '',
                 d:r.d, a:(typeof r.a === 'number' && r.a > 0) ? r.a : 0, p:!!r._p};
      /* The eSIM board's derived plan fields. All of them came back from esim.dog
         through the proxy, but they have sat in a world-writable node since, so they
         are clipped and rendered as text like every other stored value. */
      if(extra === 'esim'){
        rec.c = clip(r.c, 40); rec.pl = clip(r.p, 40); rec.v = clip(r.v, 40);
        rec.w = clip(r.w, 60); rec.s = clip(r.s, 60); rec.g = clip(r.g, 40);
        rec.t = (typeof r.t === 'number' && r.t > 0) ? r.t : 0;
      }
      out.push(rec);
    });
    return out;
  }

  /* Every comment on the page, from every view, oldest first — one thread that
     reads the same on all 11 boards. `v` is the view it was written on. */
  function allComments(data){
    var out = [], node = (data && data.comments) || {};
    Object.keys(node).forEach(function(view){
      if(!node[view] || typeof node[view] !== 'object') return;
      rows(node[view]).forEach(function(rec){ rec.v = view; out.push(rec); });
    });
    return out.sort(function(a, b){ return a.d - b.d; });
  }

  /* --- shared chrome -------------------------------------------- */
  function build(el, opts){
    el.innerHTML = '';
    /* `bare` boards sit directly under a card that already carries the heading, the
       explanation and the public-board warning — printing them again just pushes the
       form off the screen. The warning is not being dropped, only not said twice. */
    if(!opts.bare){
      var h = document.createElement('h3'); h.textContent = opts.heading; el.appendChild(h);
      var sub = document.createElement('p'); sub.className = 'board-sub';
      sub.textContent = opts.sub; el.appendChild(sub);

      var warn = document.createElement('div'); warn.className = 'board-warn';
      warn.textContent = '⚠️ הלוח הזה ציבורי ופתוח — כל מי שיש לו את הקישור לעמוד יכול לקרוא, ' +
        'לכתוב ולמחוק. אל תכתבו כאן פרטים אישיים: מספרי הזמנה, טלפונים, כתובות, דרכונים או פרטי תשלום.';
      el.appendChild(warn);
    }

    var form = document.createElement('form'); form.className = 'board-form'; form.noValidate = true;
    var row = document.createElement('div'); row.className = 'row';
    /* The eSIM board's first field names the *holder*, not the author — and
       rememberName() pushes the remembered name into every `.who` on the page, so
       that board must not own one. It supplies its own field from extra(). */
    var who = null;
    if(!opts.noWho){
      who = document.createElement('input');
      who.className = 'who'; who.maxLength = LIM.name; who.placeholder = 'השם שלך (לא חובה)';
      who.value = savedName(); who.setAttribute('aria-label', 'שם');
      row.appendChild(who);
    }
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
    return {form:form, who:who, send:send, msg:msg, count:count, foot:foot, list:list, extraEl:extraEl};
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
  /* One place to say "n items", plus the archive tally and the offline caveat when
     the numbers came from the device rather than the DB. */
  function counted(ui, n, one, many, extra){
    var parts = [];
    if(n) parts.push(n === 1 ? one : n + ' ' + many);
    if(extra) parts.push(extra);
    if(stale) parts.push('מוצג מהמכשיר — אין רשת');
    ui.count.textContent = parts.join(' · ');
  }
  /* One list row. `act` is the single button on the right: ✕ archive, ↺ restore,
     ✕ delete on the links board — every caller passes exactly one. */
  function entry(rec, act, chip){
    var li = document.createElement('li');
    var cls = [];
    if(rec.p) cls.push('pend');
    if(rec.a) cls.push('arch');
    if(chip && chip.own) cls.push('own');
    li.className = cls.join(' ');
    var head = document.createElement('div'); head.className = 'head';
    var w = document.createElement('span'); w.className = 'who';
    w.textContent = rec.n || 'אנונימי';                        // untrusted → textContent
    var t = document.createElement('span'); t.className = 'when';
    t.textContent = when(rec.d) + (rec.p ? ' · ⏳ ממתין לשליחה' : '');
    head.appendChild(w); head.appendChild(t);
    if(chip){
      var c = document.createElement('span'); c.className = 'chip';
      c.textContent = chip.text;                               // stored view key → textContent
      head.appendChild(c);
    }
    if(rec.a){
      var ar = document.createElement('span'); ar.className = 'chip archived';
      ar.textContent = '🗄️ הוסר · ' + when(rec.a);
      head.appendChild(ar);
    }
    var x = document.createElement('button');
    x.className = 'del'; x.type = 'button'; x.textContent = act.icon;
    x.title = act.title; x.setAttribute('aria-label', act.title);
    x.addEventListener('click', act.run);
    head.appendChild(x);
    li.appendChild(head);
    return li;
  }

  var refreshers = [];      // every board, so one write updates all of them

  /* A write lands on a board other than the one it was made from — every board
     shows every comment — so re-read once and re-render the lot. */
  function refreshAll(){
    loadAll(true);
    return Promise.all(refreshers.map(function(r){ return r(); }));
  }

  /* ✕ archives and ↺ restores. Identical on the comments board and the eSIM
     board — one PATCH writing the stamp, one writing `a:null` to clear it — so a
     caller supplies only the node's path. The record itself is never touched, and
     the DB rules refuse a DELETE on a node that does not already carry `a`. */
  function archiver(ui, pathOf, ask){
    function patch(stamping, ok){
      return function(rec){
        return function(){
          if(stamping && !confirm(ask)) return;    // restoring needs no confirmation
          submit({p:pathOf(rec), m:'PATCH', b:{a:stamping ? Date.now() : null}})
            .then(function(how){
              say(ui, okMsg(how, ok, 'נשמר במכשיר — יישלח כשתהיה רשת ⏳'), 'ok');
              return refreshAll();
            })
            .catch(function(err){ say(ui, failMsg(err), 'err'); });
        };
      };
    }
    return {archive: patch(true,  'הועבר לארכיון ✓'),
            restore: patch(false, 'הוחזר ללוח ✓')};
  }

  /* The 🗄️ toggle that reveals archived rows in place, struck through, each with
     ↺. Hidden while nothing is archived; flipping it re-renders data already in
     hand rather than re-reading. */
  function archToggle(ui, showTxt, hideTxt, rerender){
    var on = false;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn ghost arch-toggle'; btn.hidden = true;
    btn.addEventListener('click', function(){ on = !on; rerender(); });
    ui.foot.appendChild(btn);
    return {
      showing: function(){ return on; },
      sync: function(n){
        btn.hidden = !n;
        btn.textContent = (on ? hideTxt : showTxt) + ' (' + n + ')';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
  }

  /* --- comments -------------------------------------------------- */
  function initTalk(el){
    var view = el.dataset.topic;
    /* The HTML's aria-label ("הערות על הצפון") described a board that only held its own
       section's notes. Every board now holds the whole thread, so name the region for what
       still makes it distinct: the section a comment written here is filed under. */
    el.setAttribute('aria-label', 'הערות — כל הסעיפים · כתיבה לסעיף ' + label(view));
    var ui = build(el, {
      heading: '💬 הערות — כל הסעיפים',
      sub: 'כל ההערות מכל חלקי העמוד מופיעות כאן, לפי סדר הכתיבה, עם תווית הסעיף שאליו נכתבו. ' +
           'מה שתכתבו כאן ישויך ל"' + label(view) + '". ' +
           'הלוח משותף לכל מי שנכנס לעמוד; אפשר לכתוב גם בלי רשת — זה יישלח כשהחיבור יחזור.',
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

    /* Archived comments are hidden, not gone — shown in place, struck through,
       each with ↺ to bring it back. `a:null` clears just that field. */
    var arch = archToggle(ui, '🗄️ הצגת הערות שהוסרו', '🗄️ הסתרת הערות שהוסרו', refresh);
    var act = archiver(ui, function(rec){ return 'comments/' + rec.v + '/' + rec.id; },
                       'להסיר את ההערה מהלוח? היא תישמר בארכיון ותמיד אפשר להחזיר אותה.');

    function render(all){
      var list = allComments(all);
      var live = list.filter(function(rec){ return !rec.a; });
      var archived = list.length - live.length;
      var shown = arch.showing() ? list : live;

      ui.list.innerHTML = '';
      counted(ui, live.length, 'הערה אחת', 'הערות', archived ? archived + ' בארכיון' : '');
      arch.sync(archived);

      if(!shown.length){
        empty(ui, archived ? 'כל ההערות הועברו לארכיון. הכפתור שמעל מציג אותן.'
                           : 'אין עדיין הערות. כתבו את הראשונה.');
        return;
      }
      shown.forEach(function(rec){
        var li = entry(rec, rec.a ? {icon:'↺', title:'החזרה ללוח', run:act.restore(rec)}
                                  : {icon:'✕', title:'הסרה לארכיון', run:act.archive(rec)},
                       {text:label(rec.v), own:rec.v === view});
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
        return refreshAll();
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
        var li = entry(rec, {icon:'✕', title:'מחיקה', run:function(){
          if(!confirm('למחוק את הקישור?')) return;
          submit({p:'links/' + rec.id, m:'DELETE'})
            .then(function(){ return refreshAll(); })
            .catch(function(err){ say(ui, failMsg(err), 'err'); });
        }});
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
          return refreshAll();
        }).catch(function(err){
          say(ui, failMsg(err), 'err');
        }).then(function(){ ui.send.disabled = false; });
    });
    refreshers.push(refresh);
    refresh();
  }

  /* --- eSIM trackers ---------------------------------------------- */
  /* The trip's own copy of the family eSIM dashboard at /esim-usage/, with the
     same capability set: a live data bar per eSIM, the details behind a toggle,
     and esim.dog's own troubleshooting links. The difference is that this list is
     not hard-coded — anyone can add an eSIM from the page and it is stored in the
     DB under this trip, and removing one archives rather than deletes.

     WHAT IS STORED vs WHAT IS FETCHED. Only three things are worth keeping:
     `n` the holder, `i` the ICCID, `u` the esim.dog order link (optional). Every
     number on screen — used, total, remaining, status, expiry, last update — comes
     back from the usage API keyed by ICCID, so storing any of it would just be a
     copy that goes stale. The ICCID is the only field that must be right: it is
     what the API is queried with, and an eSIM without one still lists but cannot
     show usage.

     ONE REQUEST FOR THE WHOLE BOARD. The API takes an `iccidList`, so all the live
     rows go in a single POST rather than one per row, exactly as /esim-usage/ does.
     That also means one `providerCode` covers the batch — see PROVIDER below.

     THE PROXY IS NOT OPTIONAL. esim.dog's usage function is POST-only and sends no
     CORS headers, so the browser cannot call it directly; everything goes through
     the Cloudflare Worker in /esim-usage/proxy.js. That worker also decides which
     ICCIDs may be looked up at all — an unknown one answers 403, which this renders
     as "not recognised by the proxy" rather than as a network error, because the
     two need different fixes. */
  var USAGE  = 'https://esim-usage-proxy.xlllsss.workers.dev';
  var LOOKUP = USAGE + '/lookup?url=';   // order link → ICCID + plan, secrets stripped worker-side
  /* Every eSIM the family has bought so far is on esim.dog's provider 4. A mixed
     set cannot be asked for in one batched call, so if a future eSIM is on another
     provider this constant has to become a stored field rather than quietly
     returning another provider's numbers. */
  var PROVIDER = 4;
  var GB = 1024 * 1024 * 1024;
  function gb(b){ return (b / GB).toFixed(2) + ' GB'; }
  function pctOf(used, total){ return total > 0 ? Math.min(100, used / total * 100) : 0; }

  function initEsims(el){
    var holder, url;
    var usage = {};            // iccid -> record from the API
    var usageMsg = '';         // one status line for the whole board
    var busy = false;

    var ui = build(el, {
      noWho: true,
      /* No heading, sub or warning: the card directly above this board already says
         all three, and repeating them put four paragraphs between the page title and
         the one input anyone came here to use. */
      bare: true,
      submit: 'הוספת eSIM',
      extra: function(row){
        holder = document.createElement('input');
        holder.className = 'holder'; holder.maxLength = LIM.name;
        holder.placeholder = 'שם המחזיק';
        holder.setAttribute('aria-label', 'שם המחזיק');
        url = document.createElement('input');
        url.className = 'grow'; url.maxLength = LIM.url; url.type = 'text';
        url.placeholder = 'קישור ההזמנה מ-esim.dog';
        url.setAttribute('aria-label', 'קישור ההזמנה');
        row.appendChild(holder); row.appendChild(url);
      }
    });

    /* The toggle only needs a repaint of data already in hand — passing `refresh`
       here would re-read the DB for a purely local show/hide. */
    var arch = archToggle(ui, '🗄️ הצגת eSIM שהוסרו', '🗄️ הסתרת eSIM שהוסרו', paint);
    var act = archiver(ui, function(rec){ return 'esims/' + rec.id; },
                       'להסיר את ה-eSIM מהרשימה? הוא יישמר בארכיון ותמיד אפשר להחזיר אותו.');

    var refreshBtn = document.createElement('button');
    refreshBtn.type = 'button'; refreshBtn.className = 'btn ghost refresh';
    refreshBtn.textContent = '↻ רענון הנתונים';
    refreshBtn.addEventListener('click', function(){ loadUsage(true); });
    ui.foot.appendChild(refreshBtn);

    /* One POST for every live ICCID on the board. A 403 here is the proxy's
       allowlist, not a dead network, and it is the likeliest thing to go wrong
       after someone adds an eSIM — so it gets its own message. */
    function loadUsage(force){
      var ids = Object.keys(pendingIccids);
      if(!ids.length){ usageMsg = ''; return Promise.resolve(); }
      if(busy && !force) return Promise.resolve();
      busy = true; usageMsg = 'טוען…'; paint();
      return fetch(USAGE, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({iccidList: ids, providerCode: PROVIDER})
      }).then(function(r){
        return r.json().catch(function(){ throw new Error('HTTP ' + r.status); })
          .then(function(j){
            if(r.status === 403) throw new Error('allowlist');
            if(!r.ok || !j.success) throw new Error(j.error || 'HTTP ' + r.status);
            return j.usage || [];
          });
      }).then(function(list){
        list.forEach(function(u){ if(u && u.iccid) usage[u.iccid] = u; });
        usageMsg = 'עודכן ' + new Date().toLocaleTimeString('he-IL', {hour:'2-digit', minute:'2-digit'}) +
                   ' · esim.dog מעדכן כל 2–3 שעות';
      }).catch(function(err){
        usageMsg = err && err.message === 'allowlist'
          ? 'ה-proxy לא מכיר את אחד ה-ICCID האלה — צריך לעדכן אותו'
          : 'לא הצלחנו לטעון נתוני שימוש (בעיית רשת?)';
      }).then(function(){ busy = false; paint(); });
    }

    var pendingIccids = {};    // the live rows' ICCIDs, rebuilt on every render
    var lastData = null;       // so paint() can redraw without re-reading the DB

    function row(rec){
      var li = entry(rec, rec.a ? {icon:'↺', title:'החזרה לרשימה', run:act.restore(rec)}
                                : {icon:'✕', title:'הסרה לארכיון', run:act.archive(rec)});
      var u = rec.i && usage[rec.i];
      if(busy && rec.i) li.className += ' busy';

      var use = document.createElement('div'); use.className = 'use';
      var big = document.createElement('span'); big.className = 'big';
      var of  = document.createElement('span'); of.className = 'of';
      var st  = document.createElement('span'); st.className = 'st';
      if(u){
        big.textContent = gb(u.dataUsage);
        of.textContent  = 'מתוך ' + gb(u.totalData);
        st.textContent  = u.status || '';
      }else{
        big.textContent = '—';
        of.textContent  = rec.i ? 'אין עדיין נתונים' : 'ללא ICCID — אי אפשר למדוד שימוש';
      }
      use.appendChild(big); use.appendChild(of); use.appendChild(st);
      li.appendChild(use);

      var track = document.createElement('div'); track.className = 'track';
      var fill  = document.createElement('div');
      var p = u ? pctOf(u.dataUsage, u.totalData) : 0;
      fill.className = 'fill' + (!u ? ' idle' : p >= 90 ? ' hot' : p >= 75 ? ' warn' : '');
      fill.style.width = (u ? p : 100) + '%';
      track.appendChild(fill); li.appendChild(track);

      var under = document.createElement('div'); under.className = 'under';
      var l = document.createElement('span'), r = document.createElement('span');
      if(u){
        l.textContent = p.toFixed(1) + '% נוצלו';
        r.textContent = gb(u.remainingData) + ' נותרו' +
          (u.expiryDate ? ' · תקף עד ' + new Date(u.expiryDate).toLocaleDateString('he-IL') : '');
      }
      under.appendChild(l); under.appendChild(r); li.appendChild(under);

      var det = document.createElement('details'); det.className = 'sim';
      var sum = document.createElement('summary'); sum.textContent = 'פרטי ה-eSIM ועזרה';
      det.appendChild(sum);
      var dl = document.createElement('dl'); dl.className = 'fields';
      function field(k, v, mono){
        if(!v) return;
        var dt=document.createElement('dt'); dt.textContent=k;
        var dd=document.createElement('dd'); dd.textContent=v;       // untrusted → textContent
        if(mono) dd.className='mono';
        dl.appendChild(dt); dl.appendChild(dd);
      }
      field('ICCID', rec.i || '—', true);
      field('מדינה', rec.c);
      field('חבילה', rec.pl);
      field('כיסוי', rec.v);
      field('רשתות', rec.w);
      field('SM-DP+', rec.s, true);
      field('APN', rec.g, true);
      if(rec.t) field('נרכש', new Date(rec.t).toLocaleDateString('he-IL', {year:'numeric', month:'short', day:'numeric'}));
      if(u){
        field('סטטוס', u.status);
        field('נותרו', gb(u.remainingData));
        if(u.expiryDate)     field('תקף עד', new Date(u.expiryDate).toLocaleString('he-IL'));
        if(u.lastUpdateTime) field('עודכן אחרון', new Date(u.lastUpdateTime).toLocaleString('he-IL'));
      }
      det.appendChild(dl);

      var links = document.createElement('div'); links.className = 'simlinks';
      function lnk(href, text){
        var a=document.createElement('a'); a.href=href; a.target='_blank';
        a.rel='noopener noreferrer'; a.textContent=text; links.appendChild(a);
      }
      var href = rec.u && safeUrl(rec.u);        // re-validate: stored value is untrusted
      if(href) lnk(href, '↗ דף ההזמנה ב-esim.dog');
      lnk('https://esim.dog/installation-instructions', '📱 התקנה');
      /* esim.dog prefills its troubleshooting forms from these, and we now know them
         per eSIM rather than having to hard-code one plan's values. */
      lnk('https://esim.dog/cannot-activate-esim?country=' + encodeURIComponent(rec.c || '') +
          '&smdp=' + encodeURIComponent(rec.s || ''), '⚠️ לא מצליח להפעיל');
      lnk('https://esim.dog/internet-not-working?apn=' + encodeURIComponent(rec.g || '') +
          '&smdp=' + encodeURIComponent(rec.s || '') +
          '&country=' + encodeURIComponent(rec.c || ''), '🌐 אין אינטרנט');
      det.appendChild(links);
      li.appendChild(det);
      return li;
    }

    function paint(){
      if(!lastData) return;
      var list = rows(lastData.esims || {}, 'esim').sort(function(a, b){ return b.d - a.d; });
      var live = list.filter(function(rec){ return !rec.a; });
      var archived = list.length - live.length;
      var shown = arch.showing() ? list : live;

      pendingIccids = {};
      live.forEach(function(rec){ if(rec.i) pendingIccids[rec.i] = 1; });

      ui.list.innerHTML = '';
      counted(ui, live.length, 'eSIM אחד', 'eSIM',
              [archived ? archived + ' בארכיון' : '', usageMsg].filter(Boolean).join(' · '));
      arch.sync(archived);
      refreshBtn.hidden = !Object.keys(pendingIccids).length;
      refreshBtn.disabled = busy;

      if(!shown.length){
        empty(ui, archived && !arch.showing()
                ? 'כל ה-eSIM הועברו לארכיון. הכפתור שמעל מציג אותם.'
                : 'אין עדיין eSIM ברשימה. הוסיפו את הראשון.');
        return;
      }
      shown.forEach(function(rec){ ui.list.appendChild(row(rec)); });
    }

    function render(all){
      lastData = all;
      paint();
      loadUsage();               // no-op when nothing on the board has an ICCID
    }
    /* Same contract as the other two boards: refreshAll() forces a fresh read and
       then calls every refresher with no argument, so this must go back through
       loadAll() rather than repainting what it already had — otherwise a newly
       added eSIM is written correctly and simply never appears. */
    function refresh(force){
      return loadAll(force).then(function(all){ render(overlay(all)); }).catch(function(){
        empty(ui, 'לא הצלחנו לטעון את רשימת ה-eSIM (בעיית רשת?). נסו לרענן.');
      });
    }
    /* The link is the only thing worth typing. esim.dog can resolve it to the ICCID
       and the whole plan, so the form asks for a name and a URL and the proxy fills in
       the rest — nobody has to dig a 19-digit number out of their phone settings, and
       a mistyped digit cannot silently point a row at someone else's eSIM.
       The lookup deliberately runs BEFORE the write: a row with no ICCID would list
       but never show usage, which looks like a bug rather than a bad link. */
    ui.form.addEventListener('submit', function(e){
      e.preventDefault();
      var nm = clip(holder.value, LIM.name);
      if(!nm){ say(ui, 'צריך לכתוב שם מחזיק', 'err'); return; }
      var href = safeUrl(url.value);
      if(!href){ say(ui, 'כתובת לא תקינה — העתיקו את קישור ההזמנה מ-esim.dog', 'err'); return; }
      var id = newId();
      if(!id){ say(ui, 'שגיאה פנימית', 'err'); return; }
      ui.send.disabled = true; say(ui, 'מאתר את ה-eSIM…');
      fetch(LOOKUP + encodeURIComponent(href)).then(function(r){
        return r.json().catch(function(){ throw new Error('bad'); }).then(function(j){
          if(!r.ok || !j.success) throw new Error(r.status === 400 ? 'link' : 'bad');
          return j;
        });
      }).then(function(j){
        if(!ICCIDRE.test(j.iccid || '')) throw new Error('bad');
        var body = {n:nm, u:href, i:j.iccid, d:Date.now()};
        /* Only what came back, and only if it came back — an empty string would fail
           `$other`-style length rules for no benefit and clutter the details panel. */
        if(j.country)  body.c = clip(j.country, 40);
        if(j.plan)     body.p = clip(j.plan + (j.validity ? ' · ' + j.validity + ' ימים' : ''), 40);
        if(j.coverage) body.v = clip(j.coverage, 40);
        if(j.networks) body.w = clip(j.networks, 60);
        if(j.smdp)     body.s = clip(j.smdp, 60);
        if(j.apn)      body.g = clip(j.apn, 40);
        var t = j.purchased && new Date(j.purchased).getTime();
        if(t && !isNaN(t)) body.t = t;
        return submit({p:'esims/' + id, m:'PUT', b:body});
      }).then(function(how){
        holder.value = ''; url.value = '';
        say(ui, okMsg(how, 'נוסף ✓', 'נשמר במכשיר — יישלח כשתהיה רשת ⏳'), 'ok');
        return refreshAll();
      }).catch(function(err){
        say(ui, err && err.message === 'link'
              ? 'הקישור אינו קישור הזמנה של esim.dog'
              : err && err.message === 'bad'
              ? 'לא הצלחנו לשלוף את פרטי ה-eSIM מהקישור'
              : failMsg(err), 'err');
      }).then(function(){ ui.send.disabled = false; });
    });
    refreshers.push(refresh);
    refresh();
  }

  boards.forEach(initTalk);
  if(linksEl) initLinks(linksEl);
  if(esimsEl) initEsims(esimsEl);

  /* Sync: on load and whenever the connection comes back. Re-render only if the
     queue actually moved, so a quiet flush costs nothing. */
  function sync(){
    flush().then(function(moved){
      if(moved) refreshAll();
    });
  }
  window.addEventListener('online', sync);
  if(queue().length) sync();
})();

/* ============================================================
   The packing list, tickable (user's request, Sep 2026, left on the checklist board).

   State is per device, in localStorage, and deliberately NOT on the shared board: "I
   already packed the passports" is a fact about one suitcase, not about the trip, and
   two families syncing each other's packing would be noise. It follows that a ticked
   box does not survive clearing site data — which is the right trade for a list whose
   whole life is the week before the flight.

   The boxes are injected here rather than written into index.html so the list still
   reads as a list with no JS, and so the keys live in one place: `data-k` on each item,
   fixed strings that do not change when the wording does. Rewording an item keeps its
   tick; only editing its data-k loses it.
   ============================================================ */
(function(){
  var lists = [].slice.call(document.querySelectorAll('ul.packlist'));
  if(!lists.length) return;

  var KEY = 'italy2026:pack', state = {};
  try{ state = JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ state = {}; }
  function save(){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} }  // private mode: skip

  var boxes = [];
  lists.forEach(function(ul){
    [].forEach.call(ul.querySelectorAll('li[data-k]'), function(li){
      var k = li.dataset.k;
      /* The text moves into its own span so the strike-through lands on the words and
         not on the checkbox next to them. */
      var tick = document.createElement('span');
      tick.className = 'tick';
      while(li.firstChild) tick.appendChild(li.firstChild);

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!state[k];
      box.setAttribute('aria-label', 'ארוז: ' + tick.textContent.replace(/\s+/g, ' ').trim());
      li.appendChild(box);                       // first child = the start edge, i.e. the right
      li.appendChild(tick);
      li.classList.toggle('on', box.checked);
      boxes.push(box);

      box.addEventListener('change', function(){
        if(box.checked) state[k] = 1; else delete state[k];
        li.classList.toggle('on', box.checked);
        save();
        tally();
      });
      /* Tapping the row is the gesture on a phone, but a link inside it must still open. */
      tick.addEventListener('click', function(e){
        if(e.target.closest('a')) return;
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change'));
      });
    });
  });

  var card = lists[0].closest('.card') || lists[0].parentNode;
  var bar = document.createElement('div');
  bar.className = 'packbar';
  bar.innerHTML = '<span class="count"></span><span class="meter"><i></i></span>' +
                  '<button type="button">לנקות הכל</button>';
  var head = card.querySelector('h3');
  head ? head.insertAdjacentElement('afterend', bar) : card.insertBefore(bar, card.firstChild);

  var count = bar.querySelector('.count'), meter = bar.querySelector('.meter i'),
      clear = bar.querySelector('button');

  function tally(){
    var done = boxes.filter(function(b){ return b.checked; }).length;
    count.textContent = done === boxes.length ? '✅ הכל ארוז' : done + ' מתוך ' + boxes.length + ' ארוז';
    meter.style.width = (boxes.length ? done / boxes.length * 100 : 0) + '%';
    clear.hidden = !done;
  }
  clear.addEventListener('click', function(){
    if(!confirm('לנקות את כל הסימונים ברשימת האריזה?')) return;
    boxes.forEach(function(b){
      if(!b.checked) return;
      b.checked = false;
      b.dispatchEvent(new Event('change'));
    });
  });
  tally();
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

/* ============================================================
   esim.dog's runner mini-game, ported from /esim-usage/ for the #esim view.
   Their sprites, their rules: 10 pts/sec, 1000 to win, and the same death and
   victory sequences. Two changes only — the on-canvas text is Hebrew like the rest
   of this page, and the loop idles while the view is closed.
   ============================================================ */
// Runner clone of the esim.dog mini-game: their sprites, 10 pts/sec, 1000 to win.
// The death/win sequences are copied from their bundle: on a hit, the dog keeps
// falling under gravity while just the obstacle it hit plays its own break-frame
// animation (everything else on screen freezes); once it lands, GAME OVER shows.
// Winning freezes the run and bounces the dog over a gold tint until reset.
(() => {
  const c = document.getElementById('game');
  if (!c) return;                       // the game lives on one view; other pages have no canvas
  const x = c.getContext('2d');
  const GROUND = 20, DOG = 72, FLOOR = c.height - GROUND - DOG, WIN = 1000;
  const hint = document.getElementById('gameHint');
  const sheet = (file, frames) => { const i = new Image(); i.src = 'https://esim.dog/mini-game/' + file; i.frames = frames; return i; };
  const run = sheet('running_dog_mascot.png', 6), die = sheet('dying_dog_mascot.png', 4);
  // Same obstacle art, scales and frame counts as the original.
  const OBS = {
    box1:    { w: 28 * 1.8, h: 28 * 1.8, dir: 'Box1', n: 5 },
    box2:    { w: 32 * 1.6, h: 32 * 1.6, dir: 'Box2', n: 3 },
    capsule: { w: 50 * 1.2, h: 48 * 1.2, dir: 'Capsule', n: 4 },
  };
  const TYPES = Object.keys(OBS);
  for (const t of TYPES) {
    OBS[t].img = Array.from({ length: OBS[t].n }, (_, k) => {
      const im = new Image(); im.src = `https://esim.dog/mini-game/obstacles/${OBS[t].dir}/${k + 1}.png`; return im;
    });
  }
  let s, last;

  const reset = () => { s = {
    y: FLOOR, v: 0, obs: [], speed: 300, t: 0, spawn: 0, ground: 0,
    dead: 0, over: false, won: false, deathFrame: 0, deathTimer: 0, hit: null, wonT: 0,
  }; };
  reset();
  window.__game = () => s; // ponytail: the only way to check the loop without pixel-reading a tainted canvas

  function jump() {
    if (s.won) return;
    if (s.over) { reset(); return; }
    if (s.dead) return; // mid-death animation: input is ignored, same as the original
    if (s.y >= FLOOR) s.v = -650;
  }
  c.addEventListener('mousedown', e => { e.preventDefault(); jump(); });
  c.addEventListener('touchstart', e => { e.preventDefault(); jump(); }, { passive: false });
  addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
  });

  function dieStep(dt) {
    if (s.y < FLOOR) {
      s.v += 1800 * dt; s.y += s.v * dt;
      if (s.y > FLOOR) { s.y = FLOOR; s.v = 0; }
    }
    s.deathTimer += dt;
    if (s.deathTimer >= 0.15) { s.deathFrame = Math.min(s.deathFrame + 1, die.frames - 1); s.deathTimer = 0; }
    if (s.hit) {
      s.hit.hitTimer += dt;
      const maxFrame = OBS[s.hit.type].n - 1;
      if (s.hit.hitTimer >= 0.05 && s.hit.hitFrame < maxFrame) { s.hit.hitFrame++; s.hit.hitTimer = 0; }
    }
    if (s.y >= FLOOR && s.deathFrame >= die.frames - 1) s.over = true;
  }

  function step(dt) {
    if (s.won) { s.wonT += dt; s.ground = (s.ground + s.speed * 0.3 * dt) % 20; return; }
    if (s.dead) { dieStep(dt); return; }
    s.t += dt;
    s.ground = (s.ground + s.speed * dt) % 20;
    s.v += 1800 * dt; s.y += s.v * dt;
    if (s.y > FLOOR) { s.y = FLOOR; s.v = 0; }
    s.obs.forEach(o => o.x -= s.speed * dt);
    s.obs = s.obs.filter(o => o.x > -80);
    if (s.t - s.spawn > Math.max(0.55, 1 - (s.speed - 300) / 1500) + Math.random() * 0.6) {
      const type = TYPES[Math.floor(Math.random() * TYPES.length)];
      s.obs.push({ x: c.width, w: OBS[type].w, h: OBS[type].h, type });
      s.spawn = s.t;
    }
    if (s.speed < 600) s.speed += 5 * dt;
    const dog = { x: 62, y: s.y + 15, w: DOG - 30, h: DOG - 20 };
    for (const o of s.obs) {
      if (dog.x < o.x + o.w * 0.8 && dog.x + dog.w > o.x + o.w * 0.2 &&
          dog.y + dog.h > c.height - GROUND - o.h) {
        s.dead = 1; s.deathFrame = 0; s.deathTimer = 0;
        o.hitFrame = 0; o.hitTimer = 0; s.hit = o;
        return;
      }
    }
    if (Math.floor(s.t * 10) >= WIN) {
      s.won = true; s.wonT = 0;
      hint.textContent = '🏆 ניצחתם! קוד ההנחה מחכה בדף ההזמנה ב-esim.dog';
    }
  }

  const ready = img => img && img.complete && img.naturalWidth > 0;

  function draw() {
    const score = Math.floor(s.t * 10);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);

    x.fillStyle = '#535353';
    x.fillRect(0, c.height - GROUND, c.width, 2);
    for (let i = -s.ground; i < c.width; i += 20) x.fillRect(i, c.height - GROUND + 5, 6, 2);

    for (const o of s.obs) {
      const spec = o.type && OBS[o.type];
      const frame = o === s.hit ? o.hitFrame : 0;
      const img = spec && spec.img[frame];
      if (ready(img)) x.drawImage(img, o.x, c.height - GROUND - o.h, o.w, o.h);
      else { x.fillStyle = '#a855f7'; x.fillRect(o.x, c.height - GROUND - o.h, o.w, o.h); }
    }

    let dogImg, frame, drawY = s.y;
    if (s.won) {
      dogImg = run; frame = Math.floor(s.wonT * 12) % run.frames;
      drawY = s.y - 5 * Math.sin(4 * s.wonT); // the original's victory bounce
    } else if (s.dead) {
      dogImg = die; frame = s.deathFrame;
    } else {
      dogImg = run; frame = Math.floor(s.t * 12) % run.frames;
    }
    if (ready(dogImg)) x.drawImage(dogImg, 48 * frame, 0, 48, 48, 50, drawY, DOG, DOG);
    else { x.fillStyle = '#8b5cf6'; x.fillRect(50, drawY + 10, 62, 52); }

    x.fillStyle = '#535353'; x.font = 'bold 14px monospace'; x.textAlign = 'right';
    x.fillText(String(score).padStart(5, '0'), c.width - 10, 24);
    x.textAlign = 'center';
    if (s.won) {
      x.fillStyle = 'rgba(255, 215, 0, 0.2)'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#e3a300'; x.font = "bold 22px Heebo, sans-serif";
      x.fillText('ניצחתם!', c.width / 2, c.height / 2 - 20);
      x.fillStyle = '#535353'; x.font = "bold 14px Heebo, sans-serif";
      x.fillText('ניקוד: ' + score, c.width / 2, c.height / 2 + 8);
      x.fillStyle = '#0891b2'; x.font = "12px Heebo, sans-serif";
      x.fillText('10% הנחה — בדף ההזמנה ב-esim.dog', c.width / 2, c.height / 2 + 30);
    } else if (s.over) {
      x.fillStyle = 'rgba(0, 0, 0, 0.3)'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#535353';
      x.font = "bold 20px Heebo, sans-serif"; x.fillText('נגמר המשחק', c.width / 2, c.height / 2 - 20);
      x.font = "14px Heebo, sans-serif";
      x.fillText('ניקוד: ' + score, c.width / 2, c.height / 2 + 10);
      x.fillText('לחצו כדי לנסות שוב', c.width / 2, c.height / 2 + 35);
    } else if (s.t === 0) {
      x.font = "bold 14px Heebo, sans-serif";
      x.fillText('לחצו או הקישו רווח כדי להתחיל', c.width / 2, c.height / 2 - 20);
      x.fillText('להגיע ל-' + WIN + ' נקודות כדי לנצח', c.width / 2, c.height / 2 + 5);
    }
  }

  /* A canvas redrawn 60 times a second on a phone in the Umbrian hills, for a view
     nobody has open, is battery spent on nothing. `.view` is display:none unless it
     is the active one, so offsetParent is the cheapest honest "is anyone looking".

     `&& !document.hidden` was here and is deliberately GONE. It looked like free
     extra thrift and was worse than useless: browsers already stop firing rAF for a
     hidden document, so it bought nothing — and in an embedded webview that keeps
     firing rAF while reporting `document.hidden === true`, it suppressed every frame
     and left a permanently blank canvas. Observed, not theorised.

     Nothing needs resetting on the way back either: dt is clamped to 50 ms below, so
     the gap cannot be replayed however long the view stayed shut. (An explicit
     `last = 0` was tried for that and removed — the clamp made it a no-op, which the
     mutation check proved by passing with the line gone.) */
  const visible = () => c.offsetParent !== null;
  requestAnimationFrame(function loop(now) {
    if (!visible()) { requestAnimationFrame(loop); return; }
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0; last = now;
    if (s.v || s.y < FLOOR || s.obs.length || s.t || s.dead || s.won) step(dt);
    draw();
    requestAnimationFrame(loop);
  });
})();
