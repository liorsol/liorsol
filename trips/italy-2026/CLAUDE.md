# Project: Family Trip to Umbria & Rome · September 25–30, 2026

**Two families, 8–9 people, two hire cars, one base in Deruta.** Built Sep 2026 by merging two
research reports (Gemini and ChatGPT) the user commissioned, then independently verifying
everything that went on the page. Structurally a clone of [`trips/albania-2026/`](../albania-2026/) —
same SPA shape, same offline PWA, same shared boards, same editorial rules. **Read the Albania
[`CLAUDE.md`](../albania-2026/CLAUDE.md) too**: everything there about the service worker's `V`
bump, the boards' offline queue, the untrusted-input security rules, the RTL arrow convention and
the `<details>` progressive-disclosure rule applies here verbatim and is not repeated.

## Working rules (mandatory)

- **Discussion with the user — in English.** **All HTML content and family-facing output — in
  Hebrew.** Commit messages in English.
- The HTML is RTL (`dir="rtl" lang="he"`).
- Prices, opening hours and drive times are 2025/26 estimates — whenever adding new info, note
  that it should be verified closer to the trip date.
- **This trip is ~3 weeks out at the time of writing.** Unlike Albania, "verify closer to the
  date" here means *now*. Several cards say so explicitly; keep those markers.

## 🔒 Privacy — this repo is PUBLIC

The full rule is in the [Albania `CLAUDE.md`](../albania-2026/CLAUDE.md#-privacy--this-repo-is-public)
and applies unchanged. What was actually decided for *this* page, so it is not re-litigated:

| On the page | Why it is allowed |
|---|---|
| The €40 / €20 shuttle fares | A published service tariff, and the family has to carry the cash. Not a payment detail, and it identifies nobody. |
| `+39 393 910 9572` and the other Parking Blu numbers | A **company switchboard published on `parkingblu.it`**. The privacy rule's "phone numbers" means the family's, not a business's. It is also the one number that has to work at 02:00 in an airport. |
| Wizz Air flight numbers and the FCO times | Schedule data, true for everyone on the flight. |
| `8.6 from 90 reviews` | A public Booking rating. |

**Deliberately NOT on the page:** the property's own direct phone number. It is not published
anywhere — Booking says it arrives in the booking confirmation — so the page tells the family to
take it off their confirmation and save it, rather than reproducing a private booking document.
The TLV departure time and the Israeli landing time are also marked `‡` as *derived from flight
duration, not from the ticket*, because the ticket was not supplied and inventing a schedule the
family plans around would be worse than flagging it.

Never add: booking references, passenger names, seat numbers, the confirmation email, or a
screenshot of any of them.

## Repo structure

```
trips/italy-2026/
├── CLAUDE.md              ← this file (canonical project context)
├── index.html             ← ★ source of truth — the trip page (content + CSS). Edit here!
├── trip.js                ← all behaviour: routing, weather, FX, restaurants, boards
├── map.html               ← 48 verified pins + the restaurants, one Leaflet/OSM map
├── restaurants.json       ← ★ read by BOTH index.html and map.html
├── sw.js                  ← thin SW stub: V + TILES + CORE, then imports ../sw-core.js
│                            **Bump `V` on every content change — and on every sw-core.js change**
├── check-links.py         ← `python3 check-links.py` — the structural test, see below
├── manifest.webmanifest   ← PWA manifest (installable, RTL, Hebrew)
├── icons/                 ← generated from the 🇮🇹 emoji, same method as Albania's
├── vendor/                ← leaflet 1.9.4, copied byte-identical from trips/albania-2026/vendor/
├── assets/                ← the hero still + hero clip + two airport photos · CREDITS.md
├── research-gemini.md     ← raw Gemini report (source doc)
└── research-chatgpt.md    ← raw ChatGPT report (source doc)
```

Root: `italy-2026.html` is a redirect stub — keep it. `.claude/launch.json` has an `italy` entry
on port 8812.

**URLs:** page `https://liorsol.github.io/liorsol/trips/italy-2026/` · map `.../map.html`

`research-chatgpt.md` hotlinks ~50 `images.openai.com` URLs that will rot. Left verbatim on
purpose — it is a source document, not content, and the same convention as Albania's
`research-gemini.md`. **Eight of those URLs are now also on the page** as the day-card previews
(Sep 2026, user's request) — see "Day-card previews" below, including why they are hotlinked
rather than bundled and how the page survives them rotting.

## `check-links.py` — run it after touching index.html, map.html or restaurants.json

Every failure it catches is **silent**. A `#map/p:` link whose pin does not exist simply does
nothing when tapped; a pin whose `v` is stale opens a blank view; a `data-topic` that is not a
real view name writes to a DB path the rules reject with a 401. Eleven checks: view names against
the DB rules' `/^[a-z]{2,12}$/`, card→pin and pin→card both ways, every internal `#hash`, every
`data-view`, every card having an `id` *and* an `.anchor`, a comment board on every non-map view,
and the restaurant ids/coordinates. Mutation-checked — a broken pin link and a removed board were
both confirmed to fail it.

Current state: **48 cards, 11 views, 10 boards, 64 map pins (48 hard-coded + 16 restaurants), all cross-links resolve.**

The other check is `node ../sw-core.test.js`, which covers both trips' workers — see the
[root README](../../README.md#the-trip-pages-tripsalbania-2026-tripsitaly-2026).

## Dynamic data (Firebase) — `italy2026`, live since Sep 2026

The page uses the reserved key **`italy2026`**. The complete rules document — `albania2026`'s
block duplicated under the new name — is in the
[README](../../README.md#firebase-realtime-database-dynamic-data-sync), and **the user published
it on 5 Sep 2026.**

> **The rules moved again the same month, and were republished on 5 Sep 2026.** Comments gained
> `a` (the archive stamp) and `.write` moved onto `comments/$view/$id` to guard deletes — see
> [One thread, and deleting archives](../albania-2026/CLAUDE.md#one-thread-and-deleting-archives-users-request-sep-2026)
> in the Albania `CLAUDE.md`, which is canonical for the boards and applies here verbatim: every
> board renders every comment with a chip naming the view it was written on, and ✕ archives
> instead of deleting. The live-DB check sequence is in the
> [README](../../README.md#firebase-realtime-database-dynamic-data-sync); a 401 on ✕
> (`הכתיבה נחסמה — כללי ה-DB צריכים עדכון`) is the one symptom of the published rules having
> drifted from the document there.

Verified against the live DB the same day, with the test rows deleted afterwards:

| check | result |
|---|---|
| `GET italy2026.json` | **200** |
| valid comment `PUT` | **200** |
| comment carrying an unknown field | **401** — `$other:false` is enforcing |
| link with a `javascript:` URL | **401** — the scheme validation is enforcing |
| valid link `PUT`, then `DELETE` both | **200 / 200**, DB back to `null` |

So the boards work, and the rules are the real per-field ones rather than a permissive
placeholder. **Everything in the Albania `CLAUDE.md` about untrusted input still applies**: that
path is world-writable, so stored values render with `textContent` only and every stored URL's
scheme is re-checked at render time rather than trusting the rules to be the only gate.

The rules block is byte-identical to `albania2026`'s rather than being folded into a `$trip`
wildcard. That was deliberate: publishing replaces the entire document, so a restructure is a live
change to the Albania page's boards, which a family is actively using, in exchange for saving 28
lines. **Duplicate the block again for the next trip.**

## The eSIM tracker (`#esim`, Sep 2026) — and the third DB path

The user's request: an eSIM page in the trip menu, adding a tracker by **holder name + link**,
stored in the DB and scoped to this trip, where **removing archives rather than deletes** and an
archived one can be brought back.

**Trip scope is the path.** `italy2026/esims/<id>` — no flag, nothing to set, nothing to get
wrong, and the next trip's key gets its own. The shape is `{n: holder, u: tracker_url, d, a?}`.

**Neither existing path could hold it, and that is worth not re-deriving:**

| | why not |
|---|---|
| `links` | `$other:{".validate":false}` rejects an `a` field — confirmed live, `PATCH {"a":…}` → **401** — so it cannot archive; and its `.write:true` sits on `links`, so entries are always hard-deletable. The user asked for the exact opposite. |
| `comments/esim/` | Same `$other` rule, so no `u` field. And it is **the node this view's own comment board writes to** — they would collide with nothing left to tell them apart. |

So `esims` copies the comments path's delete guard verbatim: `.write` on `esims/$id`, reading
`newData.exists() || data.child('a').exists()`. **Do not lift `.write` onto `esims`** — rules
cascade and a deeper rule can only grant, never revoke, so that silently defeats the guard. It
is the same trap the comments path already documents.

**In `trip.js` the archive behaviour is shared, not copied a third time.** `archiver(ui, pathOf,
ask)` and `archToggle(ui, show, hide, rerender)` were lifted out of `initTalk` when this board
was added; `initTalk` and `initEsims` are both callers, and the only thing either supplies is
the node's path. `build()` gained `noWho: true` for the same reason the eSIM board needs it:
its first field names the **holder**, and `rememberName()` pushes the remembered author name
into every `.who` input on the page — so that board must not own one.

**⚠️ The stored URL is a credential.** An esim.dog order URL carries a Stripe
`payment_intent`/`session_id` and opens the order page *including the activation QR*. The path
is world-readable. This is the same exposure `esim-usage/index.html` already accepts for the
four hard-coded order links, and the card on the page says so in Hebrew. The privacy table
above still holds: this is the family's own eSIM, added by the family, and nobody else's.

## The hero clip

`assets/hero-umbria.mp4` — a drone-style pull-back over an Umbrian hill town, **supplied by the
user** (Sep 2026) as a 10 s / 10.4 MB / 24 fps H.264 file, with two instructions: make it smaller
by dropping frames, and make it play **forward → reverse → forward**, not cut back to the start.

**It is one file, not a JS effect.** Browsers do not support a negative `playbackRate`, so a
"boomerang" driven from JS means stepping `currentTime` by hand every frame — jerky, and it
burns battery on the phone this page is built for. The turnaround is baked into the file
instead, and the element stays a plain `autoplay muted loop playsinline` video.

```bash
ffmpeg -i gemini_generated_video.mp4 \
  -filter_complex "[0:v]fps=12,split[a][b];\
                   [b]reverse,trim=start_frame=1:end_frame=119,setpts=PTS-STARTPTS[r];\
                   [a][r]concat=n=2:v=1[v]" \
  -map "[v]" -an -r 12 -fps_mode cfr -c:v libx264 -profile:v high -level 4.0 \
  -crf 31 -preset slow -pix_fmt yuv420p -movflags +faststart assets/hero-umbria.mp4
```

- `fps=12` halves the frames — the camera drifts slowly, so it reads as smooth. **`-r 12
  -fps_mode cfr` is not optional:** without it the muxer re-inflates the stream to 25 fps by
  duplicating frames, and the file is bigger than the original for no visible gain. That
  actually happened on the first attempt.
- `trim=start_frame=1:end_frame=119` drops **both** duplicate frames at the joins — the reversed
  segment would otherwise repeat the last forward frame at the turnaround and the first one at
  the loop point, showing as a twitch twice per cycle. Forward 120 + reversed 118 = **238 frames,
  19.83 s at 12 fps**. Verified frame-by-frame: 119≠120 at the turn, and frame 237 is one motion
  step from frame 0, so the `loop` is seamless in both directions.
- `-an` drops the audio: the element is `muted` and `aria-hidden`, so the track was 128 kb/s of
  nothing.
- **10.4 MB → 2.1 MB** at the same 1280×720, and twice as long. CRF 31 is well above the usual
  23, and it holds up because the clip lives under a `rgba(30,45,32,.3→.66)` scrim.

### It did not play, and the cause was a rule added right here (Sep 2026)

The user reported the clip dead on this page while Albania's played, and asked what the
difference was. **There was exactly one, and it was self-inflicted:** this page carried
`@media (prefers-reduced-motion:reduce){ header.hero video{display:none} }` and Albania did not.
On any phone with iOS **Settings → Accessibility → Motion → Reduce Motion** switched on, that rule
hid the clip — it kept playing, invisibly, behind a `display:none`. Demonstrated in the browser
before removing it: with `prefers-reduced-motion: reduce`, Italy's video reported
`display=none, height=0` while Albania's reported `display=block, height=337`.

**Do not re-add it.** If reduced motion is ever honoured here it belongs on *both* trips, and it
should freeze the clip on a frame rather than remove it, so the hero still looks deliberate.

The file was never the problem, and neither was the markup: `ftyp/moov/free/mdat` (faststart),
H.264 High, yuv420p — and the only differences from Albania's clip are 12 fps vs 24, no audio
track vs a 128 kb/s AAC one, and 19.8 s vs 10 s. None of those can stop a browser playing an mp4.

Two further fixes went in while hunting this, both real, both in shared code, so **both trips
have them** (details in the
[Albania `CLAUDE.md`](../albania-2026/CLAUDE.md#the-hero-clip-needs-js-to-keep-running-sep-2026)):

1. **`trip.js` re-asserts playback.** Every `.view` is `display:none` while the document is parsed
   (`.active` lands only once the deferred file runs) and Safari will not autoplay a video that
   was hidden then; switching views hides it again, which *pauses* it with nothing to resume it.
   `show()` calls `playClips(view)`, and `visibilitychange`/`pageshow` cover a tab return or a
   bfcache back-navigation.
2. **`sw-core.js` no longer intercepts media** (`media(req)`, next to `live(url)`): a cached full
   200 was being handed back for a byte-range request, which Safari reads as a broken stream.

**Not in the SW's `CORE`.** A strict precache fails the whole install if one entry fails, and 2.1
MB is a lot to bet the offline shell on. The still underneath is already the fallback layer, and
the clip is picked up by the runtime cache when the browser asks for it whole rather than as a
range (`sw-core.js` refuses to `put()` a 206). Same arrangement as Albania's clip.

**Verifying it in a browser here is not possible:** the Chromium bundled with Playwright is built
without H.264 (`canPlayType('video/mp4; codecs="avc1.640028"')` → `""`), so *both* trips' clips
fail with `MEDIA_ERR_SRC_NOT_SUPPORTED` under it. The page wiring was checked by serving a WebM
re-encode of the same frames under the mp4's URL; the mp4 itself was checked with ffmpeg.

## The packing list ticks (`ul.packlist`, Sep 2026)

`🧳 מה להביא` is checkable. The boxes are injected by `trip.js`, not written into
`index.html`, so the list still reads as a list with no JS — and the state lives in
**`localStorage` under `italy2026:pack`, deliberately NOT on the shared board.** "I already
packed the passports" is a fact about one suitcase, not about the trip; syncing it between
two families would be noise. The cost, accepted: a tick does not survive clearing site data,
and does not follow you to another device.

Each `<li>` carries a fixed `data-k` — `doc-passports`, `wear-layers`, … — because the keys
must outlive the wording. **Rewording an item keeps its tick; changing its `data-k` loses
it.** Never key these off the text.

`packlist` is also in `edit-server.mjs`'s skip list: the injected checkboxes are generated
DOM, and a browser edit of that list would otherwise write them into the file. The trade is
that these items are edited in the file rather than in the browser editor.

## Day-card galleries (`figure.prev`)

Each of the 8 day cards in `#days` that has a matching section in `research-chatgpt.md` carries
**all of that section's shots** — 5 to 9 each, 51 in total — as a strip you **swipe sideways**
(user's request, Sep 2026: *"swipe left right with swipe animation, and all images should be
cached on load"*). The mapping is
`orvieto←1, marmore←2, assisi←3, perugia←4, adventure←5, trasimeno←6, tuscany←7, rest←8`;
**`gubbio` has none** because that day came from the Gemini report, not the ChatGPT one.

**The gesture is the browser's, not ours.** A flex strip inside `overflow-x:auto` with
`scroll-snap-type:x mandatory` and `scroll-snap-stop:always` gives native momentum, rubber-banding
and snap animation on every touch device, for no JS and no library. `trip.js` only keeps the
counter in step, removes dead shots, and lends a **mouse** the same gesture (pointer drag, with
snapping switched off for the duration or every `pointermove` fights it back). There are **no
arrow buttons** — they were replaced on request.

- **`direction:ltr` on the track, in an RTL page, on purpose.** It is a sequence of pictures, not
  text, and LTR keeps `scrollLeft` positive and increasing on every engine — RTL horizontal
  scrolling does not agree across browsers, and the counter would read backwards. Same reason the
  `2 / 6` pill is pinned with a physical `left`.
- **The strip is the source of truth for "which shot".** `tally()` derives the index from
  `scrollLeft / clientWidth` on every scroll event; nothing tracks it in a variable, or a native
  swipe and the counter drift apart.
- **All 51 shots carry a real `src` and are fetched on load** — that is what "cached on load"
  means here, and it is verified: `sw-core.js` stores cross-origin images as **opaque** responses
  (checked in-browser against a second local origin: `opaque status=0` sitting in the version
  cache), so the strip keeps swiping with no reception. Caveats worth knowing: the *first* visit
  fetches them before the worker controls the page, so it is the second visit that fills that
  cache, and a `V` bump throws them away and re-downloads.
- **The `<figure>` ships `hidden`** and is revealed once a shot has really arrived. A shot that
  errors is spliced out of the strip and the counter follows; the last one failing takes the
  figure with it. A dead CDN therefore leaves **no empty frame and no broken-image icon** — the
  card renders exactly as it did before galleries existed.
- `referrerpolicy="no-referrer"` is the best guess against a hotlink referer check. Unverified.

**They are hotlinked from `images.openai.com`, and that is a compromise, not the plan.** That host
is unreachable from the environment this was built in, so the images could not be inspected,
downscaled or bundled — and the URLs are signed and expiring, exactly as the note on
`research-chatgpt.md` above already warned. **If they turn out to be dead (or wrong — nobody here
has seen them):** the durable fix is to save the images into `assets/`, add them to `CORE`, and
credit them, which is also what `assets/CREDITS.md` says. Do not spend time hunting for
replacement URLs on the same CDN.

## What differs from the Albania page (and why)

- **Palette re-skinned, variable NAMES kept.** `--sea` is now cypress green `#2f5d3a`, `--sand`
  is travertine, `--terra` terracotta, `--gold` wheat. The names are Albania's on purpose — the
  class vocabulary and `trip.js` are shared, so only values changed. Don't "fix" `--sea` to
  `--green`; it would fork the CSS for nothing.
- **Group-tag classes reused, labels changed.** `t-beach` is now 🏊 מים ורוגע (pool/lake/river,
  not sea), `t-grand` is 🧘 נגיש ונינוח. Same CSS, Italy-appropriate meanings.
- **The FX card lost its third currency.** Italy is the euro, so the only question is what a menu
  price is in shekels — four EUR/ILS pairs instead of Albania's EUR/ALL/ILS cross.
- **Weather gained a rain column.** Late September is shoulder season and the daily rain
  probability is what decides whether a day is a pool day or a hill-town day. Three spots
  (Perugia, Deruta, Fiumicino); Perugia is the out-of-range fallback. `elevation` is still passed
  explicitly — Deruta sits ~215 m above the Tiber valley.
- **The hero is a clip over a bundled still** (Sep 2026). `assets/hero-umbria.mp4` plays over
  `assets/hero-umbria.jpg` (Deruta across the Tiber valley, CC BY-SA 4.0) exactly the way
  Albania's `moving_image.mp4` sits over its hero — same CSS shape, same z-order. Albania
  *hotlinks* its still; here it is in the SW's `CORE`, so the fallback layer survives offline
  even though the clip does not. The gradient is still the last background layer if both fail.
  See "The hero clip" below.
- **No presentation deck and no eSIM embed.** Neither was asked for. If a deck is ever wanted,
  Albania's `presentation/` is the pattern.

## The one thing this page exists to get right: the 02:00 arrival

The user supplied the confirmed booking facts; everything around them was verified.

**Confirmed by the user (from the property):**
- Il Nido dei Merli, [booking.com/hotel/it/il-nido-dei-merli](https://www.booking.com/hotel/it/il-nido-dei-merli.html) — **2 apartments on the same level**, night of 25.9
- Shuttle **25.9 ~02:00, 8 people, from the airport, €40**
- Shuttle **25.9 08:00, 2 people, back to the airport for the hire cars, €20**
- *"Once arrived please call us. The meeting point will be at the DEPARTURE level, terminal 3, in
  front of door number 4. There you'll find our minivan with the logo PARKING BLU."*

**Verified independently, and what it changed:**

1. **The property is run by Parking Blu itself** (trading name of Cobra Car Service Srl, P.IVA
   05688151009, `parkingblu.it`). That is why the minivan carries that logo — it is not a
   third-party transfer. Their published numbers are on the page as the fallback:
   `+39 393 910 9572` (also WhatsApp), `+39 06 9970 5998`, `+39 06 6508 0252`,
   `informazioni@parkingblu.it`.
2. **✅ SETTLED 5 Sep 2026 — the family reached the owner: check-in happens inside the shuttle,
   and they go straight to the rooms.** That closes the two biggest worries in this section at
   once: the official 12:00–23:00 check-in window no longer matters, and neither does which of the
   two addresses the apartments are at, because the driver takes them there. The page now says so
   and keeps only the practical residue — have passports and a credit card to hand in the van, and
   keep both addresses saved in case a taxi is ever needed. **Don't reinstate the old "confirm the
   arrival time in writing" warning; it is answered.**
3. **The property has two addresses, 7 km apart, on opposite sides of the airport.** Still true,
   still worth having both in a phone, but no longer blocking. Booking's
   header says **Via delle Ombrine 58** (which is Parking Blu's *registered office*); Booking's
   fine print says **"Check-in at Via delle Pinne 74"** (which is their Fiumicino car park, in the
   Focene frazione). Booking's own auto-generated blurb — "Focene Beach is about a 17-minute walk"
   — only fits Via delle Pinne. **The apartments are probably at Via delle Pinne 74, but this is
   an inference.** Both are pinned on the map with the ambiguity spelled out, and the page tells
   the family to get written confirmation. It matters because a taxi fallback at 02:00 needs the
   right one.
4. **The walk is trivial, and that was the single most useful finding.** T3 is arrivals on the
   *ground* floor and departures on the *first* floor, and **ADR's own T3 maps mark an escalator
   up to Departures immediately outside Arrivals Entrance 4** — with the matching down-escalator
   on the departures kerb between Entrances 4 and 5. So: exit arrivals at Entrance 4 → escalator →
   you are metres from departures door 4. One to two minutes. The page says this explicitly,
   because "go up a level and find door 4" sounds like a trek otherwise.
5. **T3 departures has seven numbered entrances (1–7); T3 arrivals has six (1–6).** Entrance 1 is
   at the Terminal 1 end. Read off the ADR maps directly.
6. **⚠️ Door 4 is NOT the airport's official pick-up point** — ADR marks that between Entrances 1
   and 2. Door 4 is the host's private arrangement. That makes Entrance 1/2 the second place to
   look, and the page says so in the `<details>` under the steps.
7. **A TLV arrival should land at T3**, since T3 is the extra-Schengen terminal — the structural
   evidence is that the official T3 arrivals map has a passport-control icon and the T1 map does
   not. This is an inference from ADR's maps, not an explicit ADR statement about Wizz Air, and
   secondary sources disagree with each other. T1 and T3 are joined by a pedestrian walkway
   (~420 m, ~10 min), so the page treats a T1 arrival as a nuisance, not a crisis, and says the
   boarding pass is the final answer.
8. ~~Check-in is officially 12:00–23:00 and needs advance notice.~~ **Superseded — see 2.** The
   check-out is still **10:00**, and the morning shuttle leaves at 08:00, so packing happens the
   night before.
9. **9 apartments, each max 4 guests**, kitchenette, A/C, balcony, free parking, lift, washing
   machine, 24h front desk + private check-in, free cot for 0–3. Rating 8.6 from 90 Booking
   reviews. **Two units × 4 = exactly 8 — so 9 people does not fit**, which is why the headcount
   question is on the page.
10. Distances measured, not guessed: T3 → Via delle Pinne **7.3 km / ~10 min** · T3 → Via delle
   Ombrine 3.7 km / ~6 min · property → Deruta **~190 km / ~2:15–2:25**.

### The images, and why they are precached

`assets/CREDITS.md` has the licences. The two airport photos are in the SW's `CORE` rather than
lazy — this is a picture you look at while standing in FCO at 02:00 with a dead eSIM, the one
moment on this trip when "it will load" is the wrong assumption. ~750 KB precached.

- **The terminal map is a published one, hotlinked — the hand-drawn `fco-t3-shuttle.svg` is
  gone** (user's call, Sep 2026: *"use map from the net, not create something yourself"*). The
  SVG was drawn from scratch precisely *because* ADR's terminal maps are copyrighted, and that
  same reasoning is why its replacement is **not bundled**: the page points at
  `ontheworldmap.com`'s published T3 map and credits it, rather than redistributing someone
  else's map from this repo. Consequences, all deliberate:
  - **It does not work offline**, which is the one thing the rest of this card is built around.
    The caption therefore tells the family in bold to screenshot it before the flight, and
    `trip.js` replaces a failed load with a link to the source page (`figure.shot img.net`) so
    the answer at 02:00 is "open this", never a broken-image icon.
  - If it ever needs to work offline, the fix is to get permission or find an openly licensed
    map, put the file in `assets/`, add it to `CORE`, credit it, bump `V`.
  - The SVG's two RTL-SVG bugs are documented in git history (`git show 0b16716^:trips/italy-2026/assets/fco-t3-shuttle.svg`)
    if a diagram is ever drawn here again: in an RTL `<text>`, `text-anchor="end"` anchors the
    *logical* end, i.e. the LEFT visual edge — use `start` for text whose right edge sits at `x`.
- **`fco-departures-kerb-night.jpg`** — the lucky find: FCO's departures kerb **at night**,
  covered viaduct, terminal frontage lit, taxi rank, and **a white minivan stopped at the kerb**.
  **Public domain** (User:Mattes, 2009). Caveat carried in the caption: it is not identified as
  Terminal 3 and it is old, so it is for recognising the *environment*, not for finding a door.
- **`fco-t3-arrivals-board.jpg`** — a photo of ADR's real wayfinding board, CC BY-SA 4.0
  (CAPTAIN RAJU). It shows the **arrivals** ground level, exits 1–6. The caption says so loudly,
  because using it to look for the shuttle would send you to the wrong floor.
- **A Commons photo of the actual T3 departures entrance doors does not exist.** Searched by
  keyword, by full enumeration of the Fiumicino terminal categories, and by geosearch at 1500 m
  around the T3 kerb — the geosearch returns ~100 files, all aircraft spotting. Don't re-search it.

### Commons download gotcha

`upload.wikimedia.org/.../thumb/<hash>/<file>/<N>px-<file>` **400s on an arbitrary N** —
"Use thumbnail sizes listed on https://w.wiki/GHai". Use a standard width (320/640/800/1024/1280/1920)
or take `thumburl` straight from the API. Send a descriptive User-Agent with a contact.

## Trip data

- **Flights — Wizz Air, and both ends are the middle of the night.** This is what shapes the whole
  plan.

  | | Outbound | Return |
  |---|---|---|
  | | `W4 6044` TLV **21:00 ‡** → FCO **00:45**, Fri 25.9 | `W4 6041` FCO **05:30** → TLV **~09:15 ‡**, Wed 30.9 |

  ‡ = derived from flight duration, **not from the ticket** — flagged as such on the page.
- **The party is 9, and the bookings say 8 on purpose** (user, 5 Sep 2026). 4 adults + 5 children;
  the 3-year-old sleeps in her parents' bed, and — the actual reason — **most places don't even
  appear in search results when you ask for a room for 5**, so they search for rooms that fit 4.
  That reasoning is sound for a *room*. It is **not** sound for a *vehicle*, which is the one place
  the page now flags: nine bodies need nine seats, and Italian law requires a restraint for a child
  under 150 cm even on a ten-minute ride, so a minivan booked for 8 may simply be an 8-seater. That
  is now the only open question on the home view. **Don't re-open the room question — it is
  decided.**
- **One child is coeliac and one has a peanut allergy.** This is a first-class constraint, not a
  footnote — it drives the whole `food` view.
- **Lodging:** night of 25.9 Il Nido dei Merli (✅ booked) · **25→29.9 Country House Le Case
  Coloniche, Deruta** (`43.000718, 12.421984`, from the property's own site and corroborated by
  OSM 10 m away). The Deruta booking is *per the research documents* — **the user has not
  confirmed it**, so the agenda marks it "verify the booking exists".
- **Cars:** two, from FCO, collected 25.9 morning, returned 30.9 **02:30**. **Which company is
  unknown**, and that is open question #2 — the out-of-hours key-box procedure, whether a 02:30
  return is even permitted, and which of Multipiano A/B/C to drive to all depend on it.
- **The four middle days are deliberately unplanned.** Nine fully-worked day options in the `days`
  view; the family picks each evening. This was ChatGPT's framing and it is the better one — see
  below.

## Day-by-day skeleton

| Date | Day | Plan |
|---|---|---|
| 25.9 | Fri | Land **00:45** → minivan **02:00** → 2 apartments → shuttle **08:00** for 2 → cars → drive to Deruta (~2 h, big shop on the way) → pool. **Not a touring day.** |
| 26.9 | Sat | Pick from the `days` bank |
| 27.9 | Sun | Pick from the `days` bank |
| 28.9 | Mon | Pick from the `days` bank · ⚠️ **Sglù is closed on Mondays** |
| 29.9 | Tue | Check out **11:00** → a middle day → **day-use room** → Parco Leonardo → FCO |
| 30.9 | Wed | Cars back **02:30** → T3 → fly **05:30** |

## How the two reports were merged

Both were good and they disagreed usefully. What the page took from each:

**From ChatGPT (the better framing):**
- **A bank of day options chosen each evening, instead of five fixed days.** The agenda says
  outright why: after a night with four hours' sleep and five children, tomorrow's weather and
  energy are better information than anything decidable from home. Don't "finish" the plan by
  assigning the days.
- **⭐ The day-use hotel room for the 15½-hour last day.** This is the single best idea in either
  document and Gemini does not have it. It reframes the last day from "what do we fill the time
  with" into three separable problems — where the children shower and sleep, where the luggage is,
  and what to do — and solves all three. The page marks it as the thing worth spending money on.
- **"Don't mark a restaurant as safe."** Its refusal to label anything coeliac-safe on the
  strength of a menu line is exactly right and is now the page's stated rule.
- The Italian phrasing distinctions (`celiaco` not `senza glutine`; `arachidi` not `noci`).

**From Gemini (the better inventory):**
- The nine-option catalogue itself, including **Orvieto, Gubbio's open cage-car funivia, and
  Bomarzo**, none of which ChatGPT has.
- **Parco Leonardo as the answer to 22:00–00:30** — an indoor, air-conditioned mall seven minutes
  from the terminal beats a departures hall. Combined with ChatGPT's day-use room, that is the
  recommended last day.
- The out-of-hours **key-box** return mechanics.
- The seasonal warning that Italian summer water parks close mid-September, which is what pushed
  the adventure day to the rope park rather than a water park.

**Where they conflicted, and the call made:**
- **Deruta → Montepulciano: Gemini ~1:15, ChatGPT ~1:45–2:00.** Not reconciled — the page carries
  **~1:20–1:45** and tells the family to check Maps on the day, because the difference is the
  difference between a long day and too long a day. Don't quietly pick one.
- Gemini's first night was a hotel at FCO; ChatGPT's was the same. **Both are obsolete** — the
  user has since booked Il Nido dei Merli with shuttles, which is strictly better and is what the
  `arrival` view describes. The old hotel comparison tables were dropped entirely rather than kept
  as alternatives.
- Gemini pairs Montepulciano with **Cortona**, ChatGPT with **Pienza**. The page offers Pienza as
  the itinerary and Cortona as the shorter-day swap, since Cortona is closer to Deruta.

## What was verified, and what is still an estimate

**Coordinates — 46 pins, method mandated.** Forward lookup via Overpass (exact OSM feature
geometry, much better than Nominatim for car parks, terminals and cable-car stations), then
**Nominatim `/reverse?zoom=14` on every one** to confirm the municipality. That reverse check is
what catches the catastrophic class of error, and it caught two:

- **Torgiano** — OSM's `place=village` node is **684 m east of the centro storico**, out past the
  edge of town. The pin is the townhall, `43.025599, 12.433985`.
- **Castiglione del Lago** — same trap, OSM's `place=town` node is **696 m west of the townhall**.
  The pin is Piazza Mazzini, `43.126831, 12.050843`.

Don't reintroduce either by "simplifying" to the obvious node. Other findings worth keeping:

- **Marmore has two separate entrances**, Belvedere **Superiore** (~372 m elevation) and
  **Inferiore** (~220 m). 767 m apart straight-line but on different roads at different levels —
  decide which one before driving, or the water-release window is spent driving between them.
- **The FCO rental return is three buildings, not one.** Desks in Office Tower 2; cars in
  Multipiano **A** (Avis/Hertz/Maggiore), **B** (Europcar/Sixt/Drivalia/Goldcar), **C**
  (Locauto/Sicily by Car/Rent4u), ~180 m apart. One pin cannot represent it — the map pin is the
  complex centre, ±150 m, and says so.
- **Parco Leonardo was renamed "The Wow Side"** (2023). Searching the old name on a map now
  returns the *railway station* or the *neighbourhood*, both wrong for a mall pin.
- **Il Nido dei Merli is not in OSM at all** (Overpass over the whole Rome/Fiumicino box for
  `name~"Merli"` returns only a Leroy Merlin). Both pins are street-level, ±150 m, flagged.
- Approximate and flagged in their own `note`: UmbriaActivity Park (±300 m, wooded park),
  Lago di Piediluco (lake centroid), Orvieto Underground (±70 m), the Fiumicino promenade
  (~1 km linear feature), the Bagnoregio car parks (a cluster, not one lot).
- Python's `urllib` fails TLS on this machine (Cisco ZTA interception) — use `curl` with a
  descriptive User-Agent, and space Nominatim calls ~1.6 s apart.

**Coeliac provision — the highest-value research on the page.**

- **⚠️ AIC's accredited-venue directory is members-only.** `celiachia.it`'s search demands a
  `codice socio`; there is no public API (the WordPress REST namespaces were enumerated — only the
  food *Prontuario* and a member-code gate exist), `aicfoodntw.it` does not resolve, and AIC
  explicitly disclaims every third-party list. **So there is no way to publish a current
  accredited list here, and the page does not pretend to.** What it does instead is tell the family
  to buy **AIC Mobile WELCOME, €3.99 for 15 days**, which is the visitor tier that unlocks the real
  network plus a supermarket barcode scanner — and to screenshot the Perugia/Deruta venues before
  flying. That is the actionable answer.
- **⭐ Sglù, Ellera di Corciano — wholly gluten-free premises.** Bakery, pastry, lunch bistro,
  evening takeaway pizzeria and a GF mini-market, all under one roof, ~20 km / 25 min from Deruta.
  This is the Italy equivalent of Albania's Panja and the single highest-value find: when the whole
  site is gluten-free, cross-contamination is not a question. It appears in **AIC Umbria's own**
  list of specialist shops. **Closed Mondays** — which matters, because Monday 28.9 is a trip day.
  Second branch in Bastia Umbra (closed Sun+Mon).
- **In Deruta itself:** Gala Supermercato (Via dell'Arte 18, <1 km), Conad (Via Tiberina 44b,
  ~2 km), **Farmacia Perelli** (Via dell'Arte 14/16, `+39 075 971 1193`), and *La Bottega
  dell'Altro Sapore* (Via Tiberina Sud 249 — from a **2015** AIC Umbria post, so flagged
  "verify it still trades").
- **By law every Italian pharmacy must order GF products on a coeliac's request** — AIC Umbria
  states this verbatim. A pharmacy is a real fallback, not a long shot.
- **Esselunga does not operate in Umbria** and no Carrefour was found within 16 km of Deruta.
  Don't send anyone looking.
- **Dish-level findings that changed the page:** all three Umbrian pastas (*strangozzi*, and its
  Terni name *ciriole*/*manfricoli*, plus *umbricelli*) are wheat and **eggless**; no GF version
  of *torta al testo* was found anywhere in Umbria, and the second problem is that it bakes on a
  **shared flour-dusted stone**; *porchetta* meat is naturally GF but the roll and the flour-strewn
  counter are the trap; AIC says a shared slicer is **not** a risk **except where bread is handled
  beside it** — which is exactly a *norcineria*; *prosciutto crudo* is one of AIC's five
  always-permitted cured meats and **Prosciutto di Norcia's sealing paste uses rice flour**;
  dextrose in Umbrian sausage is maize-derived and gluten-free, but **wheat starch, even
  "modified", is not**; fresh truffle is safe but **prepared truffle sauces are an at-risk
  category** (verified exception: Urbani Tartufi, which is in Scheggino, labels its sauces GF);
  Castelluccio lentils are safe if sorted and rinsed, but lentil *soup* is an at-risk category.
- **The page quotes AIC's own six published traveller phrases verbatim** rather than a home-made
  translation, because an Italian waiter recognises the register. Phrase 5 is the load-bearing one
  — it is the one that forbids reusing pasta water and frying oil.
- **A nuance not to lose:** a dedicated oven and a dedicated gelato tub are mandatory for
  AIC venues only in **Emilia-Romagna, Lombardia and Piemonte — not Umbria**. In Umbria a
  shared-oven GF pizza is compliant under procedure, so a dedicated oven has to be asked for.
- **Peanuts:** the legal wording in Reg. (EU) 1169/2011 Annex II is *"Arachidi e prodotti a base di
  arachidi"*, which is why the page insists on **arachidi** — `noci` means walnuts/tree nuts and
  `noccioline` is colloquial. Tree nuts are a separate Annex II category, and **mortadella
  sometimes contains pistachio**. No source suggests Umbrian salumi typically contain peanuts.

**Still estimates, and marked as such on the page:** every drive time except FCO→property and
property→Deruta; all attraction prices; the Marmore water-release timetable (the page links the
operator's own page instead of quoting a schedule); Città della Domenica's late-September opening
days; the Isola Maggiore boat season; the Gubbio funivia's hours; Parco Leonardo's Tuesday closing
time; and every restaurant's hours.

**Not found despite searching:** the property's direct phone number · any published price for its
shuttle · any Parking Blu statement of where at FCO its shuttles meet passengers (the door-4
instruction is the host's own and is published nowhere) · an official ADR statement of the
departures kerb's overnight opening hours · any Orvieto venue in AIC-sourced material · a GF
*torta al testo*.

## Findings that broke the plan, and must not be quietly undone

These came out of verification, not from either research report. Every one of them contradicts
something the reports asserted, and each is on the page with its consequence spelled out.

### The flight leaves a day earlier than the reports imply
**W4 6044 departs TLV on Thursday 24 September at ~21:55** and lands FCO 00:45 on Friday the
25th. Both reports write "25.9" for the outbound, which is the *arrival*. The page leads with
this as a warning. Also confirmed: **ADR's own carrier directory puts WIZZ AIR MALTA (W4) at
Terminal 3** — that upgrades what was an inference from the terminal maps to a sourced fact
(sanity check: the same table gives Ryanair T1, so it discriminates). And a date risk worth
keeping: **Sukkot 2026 is 26–30 September**, so both legs sit in the peak Israeli holiday week,
exactly when Wizz retimes flights.

### 02:30 is a hard airport fact, not a guess
**Wizz publishes FCO as a named exception to its own standard: bag drop opens 180 minutes and
closes 60 minutes before departure** — so **02:30 to 04:30** for the 05:30. Arriving before
02:30 buys nothing. Online check-in closes 3 hours before, i.e. 03:00. And **Israeli passports
cannot skip the desk** — Wizz requires non-EU travel documents to be checked and the boarding
card stamped at a counter, cabin-bags-only or not.

### The day-use hotel idea — ChatGPT's best idea — only half works
This was the merge's centrepiece and it needed correcting rather than deleting. **Nothing in the
Fiumicino area sells a rest slot that runs past 22:00.** HelloSky's Air Rooms *inside* FCO close
at 22:00. QC Termeroma runs to 23:00 but **bans under-14s outright**. Every other FCO-area slot
is daytime (Hotel Academy 11:00–19:00 €69, Best Western 10:00–18:00 €127 with a pool, Isola
Sacra, Riviera, Mercure). Hilton is connected to the terminal by a covered walkway but **Hilton's
brand policy forbids extending a day-use into the night**.

**So the page recommends the only late window that exists anywhere in Rome: Holiday Inn Rome EUR
Parco dei Medici, 17:00–23:30, from €93**, ~30 minutes from FCO and on the road in from the
north. That collapses the unhoused 22:00→02:30 gap to nothing. Don't "simplify" this back to a
near-airport hotel; the whole point is the closing time.

### Parco Leonardo closes far earlier than Gemini's plan assumed
It was **rebranded "The Wow Side"** in 2023 (`parcoleonardo.it` is a dead Plesk page; searching
the old name on a map returns the railway station or the neighbourhood). Real hours, identical
every day: **shops 10:00–21:00, restaurants 22:00, Playland 22:30** — and its own site
contradicts itself with 23:30 in two places, so 22:30 is the working number. **From 22:00 access
narrows to one entrance.** Gemini's "20:00 to 00:30 at the mall" cannot happen. Bowling appears
to be gone entirely (the word is absent from the whole new site, including a 132-tenant list).

### Two attractions the reports built days around are out of service
- **Orvieto's funicular has been closed since 9 June 2026**, no reopening date as of the
  operator's last statement. There is a replacement shuttle bus, but the better answer — and what
  the page now recommends — is **Campo della Fiera car park plus its own lift, which runs
  05:00–02:00**, a far wider window than the shuttle's 07:30–20:30.
- **The Castiglione del Lago → Isola Maggiore boat has been suspended since 31 August 2026**
  ("grave crisi idrica"). The replacement routes via Tuoro Navaccia, and **no timetable is
  published at all for 28–29 September.** Also lake-wide since 29 July 2026: **unfolded pushchairs
  are banned from boarding.** The page reframes that day around the Rocca instead, which is the
  better attraction anyway.
- Bonus: **Cortona's escalators have been out of service since 28 August 2026** with no reopening
  date — which matters because it turns Cortona into a walk up with a 3-year-old.

### Four of the reports' restaurants are closed or do not exist
This is why the restaurant list was verified one by one rather than transcribed:
- **Osteria Il Borghetto, Deruta — permanently closed.** Gemini's top Deruta pick.
- **Osteria del Duca, Gubbio — does not exist.** Almost certainly a conflation with *Locanda* del
  Duca, which is in the JSON as an explicitly unverified lead.
- **Pani e Vini, Perugia — does not exist.** The real "Dispensa Pani e Vini" is in Lombardy,
  ~400 km away.
- **Panificio Bontempi — existence not independently confirmable.** The one page with a full
  record is machine-generated; its hours and prices were deliberately not adopted.
- And a location error: **Trattoria del Cacciatore is in Borgo Cerreto, comune di Cerreto di
  Spoleto — not Scheggino**, ~12 km further up the Valnerina, so it is not "next to the rope
  park".

The page names all five removals in the food view, so nobody navigates to them.

### The pool is probably shut
The property frames it as summer-only ("piscina in estate, camino acceso in inverno") and never
publishes a month range or whether it is heated. Other Umbrian agriturismi publish closures of
**7–15 September** — a fortnight before arrival. The page says this plainly rather than promising
a pool, because half the "come back in the afternoon" logic rests on it.

### Two coordinates OSM gets wrong
Kept from the coordinate pass because they will resurface: OSM's `place` nodes for **Torgiano**
(684 m east) and **Castiglione del Lago** (696 m west) both sit outside the actual centro storico.
Use the townhall / Piazza Mazzini values in `map.html`.

### Verified numbers that replaced estimates
The measured drive times are materially longer than both reports claimed for four of the top
destinations — **Orvieto 66 min not 55, Marmore 65 not 50, Scheggino 64 not 45, Gubbio 65 not
50** — while Perugia (18) and Assisi (31) are closer than written. The ranking table carries a
warning saying so, because it changes what fits in a day. Also now sourced rather than guessed:
Marmore's actual 14–30 September release windows (and that **weekends get 11:00–13:00 plus
15:00–18:00** against weekdays' 15:00–16:00, which is a reason to do it on a weekend); Città
della Domenica's green/orange day system and its **Tuesday closure**; UmbriaActivity Park being
**public-access only on Sat/Sun**; **Pangea rafting's minimum age of 3** (good news — it was
flagged as a probable exclusion) and **Saturday 26th already sold out**; Bomarzo at **€15/€9,
09:00–19:00 fixed, and not pram-passable**; Ostia Antica **closed Mondays, under-18s free**;
Perugina **closed Sundays**; the Deruta museum ceramics workshop at **€10, 1.5 h, firing and
shipping included**.

### The ZTL card is the highest-value thing on the info view
Neither report mentions ZTL at all, and it is the classic expensive tourist mistake. Per-town
active hours are now on the page for all eleven towns in the plan. Non-obvious findings worth
keeping: **Perugia's is inverted** (entry *permitted* 13:00–24:00 on weekdays), **Montepulciano,
Pienza and Castiglione del Lago run 24 h/day** through 30 September, **Montepulciano has exit
cameras too and no EV exemption**, **Assisi publishes no fixed hours at all** (a per-period
ordinance PDF that someone must read in mid-September), and **fines are capped at one per
calendar day per ZTL** with **30% off if paid within 5 days of receipt** — and a foreign address
can be served for **up to 360 days**. Plus the cheapest single saving in the trip: **exit the A1
at Orte, not Valdichiana — €4.90 vs €13.30 per car, ~€34 over the trip for two cars**, then the
toll-free E45 runs past Deruta.

### Legally required and nobody knows it
**An anti-abandonment alarm device is compulsory for a child under 4** (art. 172 c.1-bis, in
force since 2018, fines since March 2020) — it applies to the 3-year-old, the obligation is on
the *driver* not the vehicle, there is no rental or foreign-vehicle exemption, and **no
homologation is required for the device**, so a €20 pressure pad satisfies it. Also: the car-seat
threshold is **height 150 cm, not age 12**; **R44/03 and R44/04 remain legal to use** (the
2023/24 change was to *sale*), while R44/01 and /02 are not; and **an IDP is required by Italian
law** for a non-EU licence, with Avis demanding one outright even though Hertz exempts Israel.

### Health facts an Israeli family needs and won't assume
**EHIC does not apply** — every consultation, scan or admission is billed privately at full cost,
which is what makes the insurance load-bearing rather than advisable. **EpiPen is not marketed in
Italy**; the devices sold there are Fastjekt, Jext and Chenpen, **all prescription-only**, so
there is no over-the-counter rescue. And **children's paracetamol syrup is SOP-classified** —
no prescription but pharmacy-only, not sold in supermarkets — which is the argument for bringing
familiar concentrations from home. Reassuring counterweight, from two controlled studies:
**casual and airborne peanut exposure does not produce systemic reactions**; it is a hands,
surfaces and utensils problem. Nearest A&E: **Ospedale Santa Maria della Misericordia, Perugia**,
+39 075 5781, ~12 km — the regional tertiary centre and where a child in anaphylaxis should go.

### The one genuine Italian peanut vector
**Peanut frying oil.** *Olio di semi di arachide* is a mainstream recommended frying oil in Italy,
and **EU law grants it no refining exemption** — unlike refined soybean oil, which Annex II
exempts explicitly. Food Allergy Italia tells restaurants outright to avoid it for allergic
diners. So the question that matters is *"In che olio friggete?"*, and the page says so. Also
kept: **use *arachidi*, never *noci* (walnuts/tree nuts), *noccioline* (colloquial, and it sounds
like *nocciola*) or *frutta secca* (which Treccani defines to include dried fruit and omits
peanuts entirely)**. And the legal ceiling: Italian law lets a venue discharge its allergen duty
with **a sign pointing to staff**, so the law guarantees an answer about intentional ingredients
and **nothing about cross-contact**.

### Perugina cannot be cleared, only decided
Its entire published allergen policy is "declare allergies at booking and at entry". No allergen
list for the tasting exists. What *is* published: **Baci are 26% hazelnut with a "may contain
other tree nuts" warning**, and the San Sisto plant declares **hazelnuts and almonds in use plus
refined peanut oil**. So for a child avoiding tree nuts the tasting is unsafe as published; for
peanut specifically it is **unverified, not cleared**. The page's recommendation is concrete: get
a written answer first, then do the tour, decline the tasting, and buy sealed labelled product
from the shop.

### Events nobody researched
Late September is peak festival season in Umbria, and **no national holiday or patron-saint day
falls in the window**, so nothing is closed. But: **I Giochi de le Porte, Gualdo Tadino, 25–27
September** — ~1,000 costumed participants, historical procession, crossbow and sling contests —
is the single best child-suited event available in the window and is now on the page as an
option. Against it: **2026 is the 800th anniversary of St Francis's death and Assisi is the focus
of national celebrations culminating 4 October**, so the final week of September there will be
abnormally crowded; and the **Cronoscalata della Castellana hillclimb closes the SR 79 bis into
Orvieto 07:00–19:00 on 25–27 September**, which is a reason to shift Orvieto to Monday the 28th.

## Open questions

**Four of the six closed in the Sep 2026 comments pass — see "The comments pass" below.** What
is left:

1. **Child seats: none are booked.** The Goldcar confirmation lists "Baby seat" as an unpurchased
   extra, and Italian law wants a restraint for every child under 150 cm. Five children, two cars,
   zero seats. This is now the most urgent item on the page and it is item 1 in `#open`.
2. **Only one driver is on the booking.** "Add driver" is an unpurchased extra too. Cheap from
   home, expensive at the desk, and it applies to each family's booking separately.
3. **Does FCO have an out-of-hours key box, and where?** Goldcar's T&Cs describe the procedure
   but say it exists "in certain stations" and never say whether FCO is one, nor where the box
   is. This cannot be resolved from a desk — it needs the call to +39 050 807 5174. It now
   matters **twice**, on two different nights.
4. **Two day-use rooms, not one** — 28.9 for the family flying on the 29th, 29.9 for the other.
   Neither is booked. Still the load-bearing piece of the last day.
5. **Does the minivan seat nine?** Unchanged, and still about the *property's shuttle* — the hire
   cars are answered (2 × 5 seats). The card now says so explicitly, because the two were being
   confused.
6. **Advance bookings not yet made:** the Deruta ceramics workshop · the rope park and Nera
   rafting (**and the minimum age/height for the 3-year-old, asked with the real ages, not "is it
   suitable for children"**) · Perugina's allergen answer · Orvieto Underground's English tour
   times.

## The 02:30 car return — and a method error that cost three passes

### ⚠️ Read this before touching the subject again

An earlier pass concluded **"no Goldcar station on earth can take a 02:30 return"** from a
`businessType: "AFTER"` field in their station JSON: FCO has no such window, and every station
that does has one running 23:01–23:59. **That inference was wrong, and the user caught it.**

Goldcar's own help pages say the opposite:

> **FAQ 39:** *"The vehicle can be returned to **most of our offices at any time** by simply
> depositing the keys inside a key drop box. In the case of offices with **reduced opening
> hours**, you can only select the return times during which there is Goldcar staff at these
> offices."*
> https://www.goldcarhelp.com/en/faqs/39-can-i-book-a-vehicle-and-return-it-out-of-the-office-opening-hours

> **FAQ 290:** *"In **some** Goldcar stations, you can return the vehicle outside the station's
> opening hours **against payment of an additional fee**. You accept, when taking out this
> option, that the agent carries out the return inspection in your absence."*
> https://www.goldcarhelp.com/en/faqs/290-can-i-book-a-vehicle-and-return-it-out-of-the-office-opening-hours

**So a key drop box is the DEFAULT, and reduced-hours stations are the exception.** The `AFTER`
field almost certainly governs which return times the **booking engine offers**, not whether a
physical box exists.

**The same error was made about Europcar** — called a documented "no" for 02:30 by the same
method. **The user has personally returned a Europcar out of hours into a key box.** Two wrong
calls from one bad inference. A follow-up found Europcar publishes an *Automated Key Collection
Service* page and **nothing suggesting they structurally exclude a 02:30 return**; the lived
experience stands.

🔒 **The rule this leaves behind: the absence of a field in structured data is not evidence of
absence in the world.** Structured data is good for confirming a positive (Autovia's `keybox`
field genuinely discriminates, 38 true / 20 false of 58) and bad for proving a negative. When a
vendor's own prose contradicts an inference drawn from their JSON, **the prose wins** — and when
a user's first-hand experience contradicts either, **the experience wins.**

### Where it actually stands — FCO HAS a key depot

**✅ Verified from Goldcar's own FCO office page:** *"A secure key depot is available outside
office hours."* — https://www.goldcar.es/us/offices/goldcar-rome-fiumicino-airport-office/
**So FCO is one of the "most offices" with a box, not a reduced-hours exception.** Not "replace
the booking".

**What is genuinely unknown is now only two things:** where the box physically is (published
nowhere), and what an out-of-hours return costs.

⚠️ **On the fee — the earlier reading was right and should not be re-litigated:** the Italy
Tariff Guide's *"Service outside opening hours (where available) — 40 € per rental"* line
**describes collection only** (*"It is possible to collect the reserved vehicle… outside normal
office hours"*), and the guide has **no return-side equivalent**. FAQ 290 confirms a fee exists
but **no document anywhere prices it**. **Don't assume €40.**

**And there is no way to add it online:** no such field in the booking engine, and **FAQ 329
confirms a Key'n Go booking cannot be modified, only cancelled**. So it is arranged directly with
the station — which is why the page says to email now rather than assume it resolves on the night.
**fco@goldcar.com** (preferred over phone for the paper trail; `+39 050 807 5174` on the booking
is the Italy call centre, the station is **+39 06 65 048 104**).

Three things to ask, all on the page: where the box physically is · what an out-of-hours return
costs · **whether it must be selected in advance** — FAQ 290's "when taking out this option"
implies it is opt-in, and **Key'n Go bookings cannot be modified, only cancelled**, so that
answer matters. Ask for **both nights, 29.9 and 30.9.**

**Free cancellation runs to 23 Sep 09:00** (48 h before pick-up), €50 after — so there is time to
ask before deciding. ⚠️ **The "Cancellation guarantee due to unforeseen circumstances" in the
Key'n Go pack has no found substance**: it appears only as a marketing bullet on the page for a
*different* pack, is undefined there, and those words appear nowhere in the FCO T&Cs.

**If the answer is no,** the fallback stays **Enterprise / Locauto** — documented €0 out-of-hours
return with a named box position (*"nel parcheggio, a sinistra della porta della cabina per il
check-in"*), a written liability end, and a 07:00 opening. The full comparison table is on the
card. **Avis also publishes a staffed desk, Building A level 2, 23:30–06:30** — if real and open
to non-members, that hands the car to a human and ends the agreement on the spot, killing the
liability tail entirely. Worth one call (+39 06 6501 1531), which also settles an undated banner
claiming Avis FCO moves from Multipiano B4 to E2.

### Still true regardless of company

The FCO contract: **the rental does not end when the keys go in the box** — the car stays put
until the station opens and inspects it, so ~5 hours of unattended car still contractually
theirs. **~5 independent reports** (Murcia, Mallorca, Malpensa, Bergamo, 2021–2026) of a box
return followed by a disputed damage or "late return" charge — none at FCO, but consistent.
Photograph everything, including the box with the key in it, timestamped.

**✅ The address conflict is resolved:** the station sheet giving **Via Portuense, 2.7 km
off-airport** carries embedded metadata dating it to **April 2014** — it is stale. **Multipiano B
level 4, as printed on the confirmation, is correct**, and matches every booking platform. (Their
office page also mentions *Torre Uffici 2* — that is the counter building, not the Key'n Go
kiosk.)

### The travelators — nothing to do with any rental company

**ADR's FAQ confirms the Easy Parking multi-storeys are open H24 with 24/7 staffed assistance**,
so driving in at 02:30 is fine. The **05:01–24:00 travelator window is from a secondary source
(Telepass), NOT ADR's own page** — the page is marked accordingly, and whether the tunnel is open
and lit at 02:30 **could not be verified**. Nine people and two cars of luggage from level 4 to
T3. **True for every company in the building.** ADR: +39 06 8898 1981.

## Marmore: the afternoon window is the decision (user, Sep 2026)

**Settled — do not re-open it.** The 11:00–13:00 release was investigated and rejected by the
user: **leaving early enough with five children after a four-hour night is not realistic**, and
even if it were, **the lever is the pick-up queue, not the opening hour** — six independent
reports describe 1–3.5 hour queues at FCO, and a collection finishing at 09:30 lands back on the
afternoon plan anyway. The page states this as a decision that was examined, not an oversight.

**What the family did instead, and it is the right set of moves:** the airport shuttle is booked
for **08:00** (so they arrive *before* the 09:00 collection, not after), they **registered for
Key'n Go**, and their **documents were validated in advance**. That is precisely the combination
aimed at the queue. ⚠️ **But Italy still requires physical document verification at the counter
even with Key'n Go** — it buys a fast lane, not a bypass — so the page says to join the queue on
arrival rather than after getting organised.

## Car seats — the family brings their own (user, Sep 2026)

Not rented. **Boosters for most of the children, one full seat for one of them** — which is much
easier than it first looked: backless boosters are essentially cushions, so the boot (~3 cases
per car, the binding number) only really loses the one full seat. Plan which car that seat rides
in at home.

What the page checks instead of "order seats": the orange label must read **R44/04 or R129** —
R44/01 and /02 are illegal in Italy, not merely discouraged — heights measured rather than
guessed against the **150 cm** threshold, and **Wizz Air's treatment of a car seat marked
UNVERIFIED** because wizzair.com is unreachable from this environment (one pushchair per child
is free; a car seat is not confirmed to be).

⚠️ **A claim was put on the page and then corrected**: "in Italy a backless booster is only
allowed from 125 cm". That is the **R129 standard's own type-approval limit**, not an Italian
rule — an **R44/04** booster is approved by weight from 15 kg and carries no such limit, and
R44/04 is still legal here. The page now says **the label on the seat decides** and flags that
the exact Italian wording could not be verified from an official source (poliziadistato 404s;
the ACI article page did not render its text). **Verify before repeating either version.**

## Lunch at Marmore — and why the page's picnic advice was reversed

**`Favorito dal 1945 Bistrò`, SS Valnerina 209, Collestatte Piano** — `42.5638626, 12.7274643`,
+39 348 878 7002, ~2.3 km / 4 min from Belvedere Inferiore.

**The whole kitchen is gluten-free and lactose-free** — not a GF menu inside a mixed kitchen.
Opened March 2025 by Francesco Favorito, a known Italian GF pastry maker. **Every day
08:00–22:00, continuous, no weekly closing day** — which is the fact that actually decided it:
it works unchanged for *both* the 15:00 plan and the 11:00 one, where nearly every other
candidate in the valley shuts its kitchen at 14:00–15:00. €20–30 pp, 4.7 from 115 reviews,
17 of them tagged "celiac".

**The page's old "picnic from home, and not a discussion" line is gone.** That reasoning was
sound *while the assumption held that nothing near Marmore could safely feed a coeliac child*.
It doesn't any more. A picnic now buys allergen control that is available at a table, and costs
a 30–45 minute Terni supermarket detour on the one day with no slack, by people who have had
four hours' sleep. **What replaced it: book the restaurant, and carry a small GF emergency bag**
— covers "they can't seat nine" and "she won't eat it" for the price of one bag and zero minutes.

**Inside the park: nothing is published about allergens by anyone** — not the park, not any
kiosk. Fine for the other eight; **the coeliac child should not eat inside the gates.** That part
of the old advice stands and is kept.

⚠️ **Peanut is unresolved and must stay that way on the page.** No venue in the area publishes
anything. Worse for this one specifically: a GF kitchen leans on nut flours, and this one
advertises almond pesto and pistachio mortadella. **Tree nuts are not peanuts**, but the
conversation has to happen explicitly, at booking and again at the table. The page says so twice.

**AIC's directory is member-gated** — the national `Alimentazione Fuori Casa` search needs a
membership code, and AIC Umbria's own Terni page just redirects to it. **Don't send anyone there
expecting a list.** And the chavruta point, which is on the page: **a 100% GF kitchen beats an
AIC-accredited mixed one** for this child, because the failure mode AIC accreditation manages —
cross-contact — does not exist when there is no gluten in the building. AIC Umbria will answer
by email (info@celiachiaumbria.it) if the badge is wanted anyway.

**Backup: `Osteria La Cascata`**, SS Valnerina 46, `42.555188, 12.7095499`, +39 0744 080993 —
500 m from the car park, **Friday 12:00–15:30 continuous**, the longest Friday lunch window found.
Makes **no GF claim**, so the coeliac child eats from the bag there. Closed Tue/Wed/Thu, an odd
pattern that can signal seasonal operation — phone-check it.

**Fastest: `La cascata dei sapori`**, Via della Cascata 42, +39 349 109 0231 — walkable from the
car park, 09:00–23:00, €10–20, takeaway. Not for the coeliac child.

### Two ghosts, and the lesson from the earlier bad pass

**`Trattoria del Buongusto` (Marmore) is permanently closed** and its domain no longer resolves —
yet it is *still* the top "gluten-free near Marmore" recommendation on several travel blogs,
**including ones citing its GF menu**. That is almost certainly one of the four non-existent
restaurants an earlier pass on this project put on the page. **`Trattoria Foco` next door shows
closed all seven days.** Both are named on the page so nobody re-adds them.

Every venue now on the page was confirmed from a live listing with current reviews and/or its own
domain. **Keep doing that.** The entry that most looks like a trap — a celebrity chef's
gluten-free bistro 1.5 km from the car park — is the best-evidenced one in the set.

### Also recorded

The **booking phone script** is on the Marmore card in Italian and Hebrew, with the three
questions that need explicit answers (nine covers at 13:15 · can we eat in 45 minutes · peanuts
in the kitchen). **The full waiter scripts already existed** in the food view — AIC's own official
coeliac wording in `#food/gf` and the correct `arachidi` phrasing in `#food/peanut` — so the card
links to them rather than duplicating a weaker free translation.

**Autogrill is genuinely in AIC's network** (270+ sites, packaged GF plus frozen GF meals
reheated in a dedicated microwave — nothing cooked on site, which is what makes it safe). **But
"270+" is not "all", and Feronia and Flaminia specifically could not be verified.** Fine as an
opportunistic snack; not a plan for a coeliac child at 06:00.

**The official falls site is `cascatadellemarmore.info`, not `.it`** — the `.it` domain was
returning 502 throughout. The page already links to `.info`; keep it that way.

## The comments pass (Sep 2026) — what the family asked for on the boards, and what was done

Eleven comments were read off the live boards, acted on, and then deleted from the DB. **Deleting
them was the user's instruction, and the record of what they said lives here instead** — the table
below is now the only copy. `italy2026/comments` is `null`.

**Deleting one takes two calls, not one, and this is the guard working:**

```bash
curl -XDELETE "$DB/italy2026/comments/home/$ID.json"          # 401 — refused while live
curl -XPATCH -d '{"a":1757000001000}' "$DB/.../$ID.json"      # 200 — archive it first
curl -XDELETE "$DB/.../$ID.json"                              # 200 — now it goes
```

`".write": "newData.exists() || data.child('a').exists()"` is exactly that rule. **A 200 on the
first call would mean the published rules had drifted** — a permissive `.write` cascading over
the per-id guard. Ten archive-then-delete pairs all returned 200/200 on 13.9.2026, so **the
enforcement check the [README](../../README.md#firebase-realtime-database-dynamic-data-sync) says
has not been re-run since 5 Sep has now effectively been re-run against `italy2026`, and the
published rules are the real ones.**

| Board | Comment | What happened |
|---|---|---|
| `agenda` | Le Case Coloniche replied: GF breakfast + GF in the restaurant, both apartments on the **ground floor**, close together, same level, fridge, **pool is working** | `#house` lost the "the pool is probably closed" warning and gained the five answers. The agenda and the checklist now say the Deruta booking is confirmed. |
| `agenda` | map filter shows irrelevant pins; two lodgings but more pins; the check-in pin is not relevant; maybe a sub-filter per day plan | See "Map filters" below — the biggest single change in this pass. |
| `arrival` | "test 2" | Junk. Deleted. |
| `arrival` | the "which of the two addresses" part is not relevant — remove | Removed from `#lodging1` and `#open`, and the second Il Nido pin was deleted from the map. |
| `days` | Marmore on day one, straight from the first hotel; plan the departure around the water release; upper or lower car park? | The whole Friday plan — see "Marmore on the first day" below. |
| `days` | make the note boxes collapse and open on a tap | All 15 `.note` boxes in the days view are now `<details class="note">`. See below. |
| `home` | remove the "an Israeli passport can't skip the desk" part — obvious, and we have suitcases anyway | Removed. |
| `home` | the page zooms and loses horizontal balance; it also zooms on focusing a text field; the page should have a fixed width | Two separate causes, two fixes — see below. |
| `home` | the "what's still open" box is one long line; it should be bullets, one per line | `.note .qlist`, and the same treatment given to the other run-on box (the four non-existent restaurants). |
| `home` | add a Rome forecast to the weather | A second `.wx-days` strip for Rome city centre over the same dates. |

### The zoom fix — and what it is NOT

`user-scalable=no` was **not** used and must not be: iOS Safari has ignored it since iOS 10, and
it breaks pinch-zoom for anyone who needs it. The two real causes:

1. **Focus zoom** is caused by an input under 16px, full stop. `.board-form input/textarea` was
   `15px`; it is `16px`. **Do not lower it.**
2. **Horizontal pan** comes from something wider than the viewport making the whole document
   pannable. `html,body{overflow-x:clip; max-width:100%}` stops it at the root. `clip` rather
   than `hidden`: `hidden` on `html` turns it into a scroll container and kills `position:sticky`
   and smooth scrolling inside it. Verified in-browser: `scrollWidth - clientWidth === 0`.

### Collapsible note boxes

`<div class="note"><div class="nh">…` became `<details class="note"><summary class="nh">…` — the
native element, no JS, so keyboard focus, in-page find and print all keep working. Scope is
**the days view only** (15 boxes). The blocking notes elsewhere stay open by the same rule the
Albania page uses for the Bovilla gravel road: `#first-thing` carries a comment saying so, and
the split-return warning in `#flights` is the same kind of thing. **Don't collapse those.**

Print needed a real fix: CSS cannot reveal a closed `<details>`, so `trip.js` opens them all on
`beforeprint` and **restores the previous state on `afterprint`** — the old handler only opened
them and left the page expanded afterwards. `matchMedia('print')` covers Safari, which fires
neither event reliably.

## The second comments pass (Sep 2026) — three comments, same deal as the first

Read off the live boards, acted on, then archive-then-deleted. **The table below is again the only
copy**, and `italy2026/comments` is `null`. The two-call delete guard behaved exactly as the first
pass documents it — `DELETE` 401 while live, `PATCH {"a":…}` 200, `DELETE` 200 — so the published
rules are still the real per-field ones.

| Board | Comment | What happened |
|---|---|---|
| `home` | The map filter misbehaves: main הכל should clear/show everything *including* the day filter · the second-level הכל is redundant and should be the ימים button, which should clear/show all days and doesn't · הכל should go grey when only part is selected · each day should be a slightly different shade, light→dark · the filter buttons should resize so there is no scrolling — "the main filter does it, but misses" | See "The second pass" under [Map filters](#map-filters--air-split-out-and-a-second-level-under-). **Took two rounds** — the first fixed the symptoms and left `shown.days` in place, so ⭐ still went grey instead of white when its last day was unchecked. The follow-up ("clicking ימים should add/remove all day filters and change to white; same manually; same for הכל") is what forced deriving the category from its days. |
| `days` | `״>״` shows up in all sorts of places, it shouldn't | **13 × `</details>>`** — a stray `>` left behind by the `.note` → `<details>` conversion of the previous pass. Removed. See below. |
| `info` | ZTL — `accessibilitacentristorici.it` centralises this; put links to the relevant maps | Seven of the twelve table rows gained a direct map link, and a note says which five are missing and why. See below. |

### The `>` — and what it says about that kind of edit

`<div class="note">…</div>` became `<details class="note">…</details>`, and the closing half was
done with a replacement that appended rather than replaced: **13 of the 15 boxes ended `</details>>`.**
The browser dropped the unmatched `>` into the text node after the element, so it rendered as a
literal `>` under thirteen note boxes and broke nothing — no console error, no failing check.
**`check-links.py` cannot see this class of bug and was not extended to**: it checks structure, not
stray text. The check that does catch it is a text-node scan for `>` outside tags, which is worth
re-running after any bulk tag rewrite:

```python
# every visible text node containing a '>' — should be zero
from html.parser import HTMLParser   # see the pass's scratch script; 4 lines of handle_data
```

### The ZTL map links

`accessibilitacentristorici.it/ztl/<regione>/<comune>/mappa` — a third-party portal that puts each
comune's ZTL on a Google map **with the camera gates (`varchi`) and the car parks on it**, which is
exactly the thing the page's table could only describe in words. All seven verified live.

| On the portal | Not on it |
|---|---|
| Perugia, Orvieto, Todi, Gubbio, Terni (Umbria) · Cortona, Montepulciano (Toscana) | **Assisi** — the most complicated ZTL of the trip, and the portal does not have it, so the page's existing instruction to read the comune's own ordinance PDF stands and must not be softened · Pienza · Castiglione del Lago · Deruta and Spello, which legitimately have no camera ZTL |

⚠️ **The missing towns return HTTP 200, not 404** — a ~39 KB soft-404 shell versus ~320 KB for a
real page. **Never add a link here from the URL pattern alone**; fetch it and check the `<title>`
reads `ZTL <town>: Mappa, Orari, Telecamere, Parcheggi`.

The note under the table says in Hebrew that the portal is a third party whose hours can lag a new
ordinance, that **the table's own hours are the verified ones**, and that the sign on the ground
beats both. Keep that framing — the link is for the map, not for the hours.

## Live flight status (`#flighttbl`) — and why it is the IAA's open data

The flights table gained a status column, filled from **data.gov.il's CKAN `datastore_search`**
(resource `e83f763b-b7d7-479e-b172-ae981ddc6de5`, the Israel Airports Authority's own board).

**It won on one criterion that overrides everything else: CORS-open AND key-free.** Verified:

```
$ curl -sI -H 'Origin: https://liorsol.github.io' 'https://data.gov.il/api/3/action/...'
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
```

Everything else fails one of the two, and it was all actually tested: OpenSky pins ACAO to its
own origin · adsb.lol and adsb.fi send no ACAO at all · airplanes.live 403s · FlightAware AeroAPI
sends no ACAO · adr.it (Fiumicino's own board) 403s from CloudFront · Wizz Air publishes nothing.
AviationStack and AeroDataBox *do* allow the browser — and are still unusable, because
**this repo is public and neither vendor's key is referrer- or domain-locked**. RapidAPI's own
docs say the key is account-wide. A key in this repo is a key anyone can spend. There is no
proxy option either: GitHub Pages is static. **Do not "improve" this by adding a keyed API.**

**The ~3-day horizon is the feature's real shape, not a bug.** Measured 13.9.2026: the dataset
held today−1 … today+3, last day partial. So the resting state is "no row", which the UI renders
as a muted `לפי לוח הזמנים` chip — an answer, not a spinner and not an error. Three states:
no row / offline / throw → scheduled times stand · row → chip + actual time + terminal ·
always → the FlightAware deep-link (`/live/flight/WZZ6044`), which is what covers the FCO gate
and belt, since **no free CORS-open Fiumicino source exists**.

Two traps, both hit for real while building this:

- **`"W4 6044".replace(/\D/g,'')` is `"46044"`, not `"6044"`** — the carrier code has a digit in
  it. Every lookup silently found nothing. Take the last digit run: `/(\d+)\s*$/`.
- **Match on date AND direction.** The dataset holds one row per flight number per day, and
  `6041` is an arrival here; `records[0]` is a random day.

`sw-core.js`'s `live()` now also refuses to cache `data.gov.il`, for the same reason it refuses
the weather.

**A real finding fell out of it:** the IAA's board says, consistently across every date it holds,
that **W4 6044 departs TLV from Terminal 1 and W4 6041 arrives at Terminal 3**. The page's
"sources disagree about the Tel Aviv terminal" note is gone. It also shows **6044 departing at
19:40 on some days and 21:55 on others**, so the weekly pattern varies — the page now warns
against trusting its own printed departure time.

## The return splits: one family flies 29.9, the other 30.9

Same flight number `W4 6041`, same 05:30, **one day apart** (user, Sep 2026). This is structural,
not a detail, and it is threaded through `#flights`, `#view-last`, the agenda timeline and the
checklist:

- **Two day-use rooms** — 28.9 and 29.9.
- **Two car returns**, nights of 28→29 and 29→30, both ~02:30, both out of hours.
- **The last common night is 27→28.9**; the family flying on the 29th leaves Deruta on the
  evening of 28.9.
- `#view-last` is written around the 29→30 axis and now opens with a note saying everything on
  it happens a day earlier for the other family. **Don't duplicate the whole view** — it would
  rot in two places.

Weekdays, since they are easy to get wrong: 24.9 Thu · 25.9 Fri · 26.9 Sat · 27.9 Sun ·
28.9 Mon · 29.9 Tue · 30.9 Wed.

## Cars: Goldcar, and the Key'n Go kiosk is not in the terminal

From the family's own confirmation + the attached FCO T&Cs. **Both families booked Goldcar; only
one booking was seen here**, and the page says so.

- **Key'n Go kiosk: Parking B, Level 4.** From T3 — exit arrivals, turn **left**, lift near the
  *Semplicemente Roma* café to level 2, then signs to Parking B, level 4. From T1 — turn right,
  signs to Rent a Car, lift on the right at the information desk. Station phone
  +39 050 807 5174, GPS 41.795320, 12.253714.
- Pick-up **25.9 09:00** (the earlier OLCI email said 07:00; the confirmation and the validation
  email both say 09:00, and the contract is written against 09:00). Held **6 hours**.
- Return booked **30.9 08:30** — six hours *after* the flight leaves. Returning at 02:30 is an
  early return into a closed station, which is why the key-box question is open.
- **Group E automatic, Seat Arona or similar, 5 seats, 5 doors, boot ~3 cases.** Two cars = ten
  seats, so **the "where does the ninth sit" question is closed**; the binding number is now the
  **boot**, six cases for nine people.
- Full/Full fuel · Super Relax included, so the deposit is **€100** (vs up to €950) plus a
  separate, unpublished fuel hold · **Italy only** · 29-minute late tolerance.
- **VISA/MasterCard credit card, physical, in the main driver's name.** No debit, Amex, Diners
  or cash — and Goldcar reserves the right to refuse the car with no refund.
- **Not stated anywhere:** station opening hours, the fuel-hold amount, the excess, the mileage
  allowance, and whether FCO has out-of-hours return.

🔒 **The booking reference, the driver's name, the QR link and the My Bookings password that were
in that email are NOT on the page and must never be.** The privacy rule at the top of this file
covers exactly this. The page carries the station, the procedure, the times and the car — facts
about a public service — and nothing that identifies the booking.

## Map filters — `air` split out, and a second level under ⭐

The `lodging` chip covered five pins for two lodgings, which is what the user noticed.

- **New `air` category** for the airport terminal and the car-return complex. They are not places
  anyone sleeps.
- **The second Il Nido pin is deleted.** It existed only for the two-address ambiguity, which is
  closed; the survivor is no longer titled "the check-in address".
- **A second chip row, `#subfilters`, one chip per day plan**, visible only while ⭐ itself is on.
  It is derived from data already present — a day pin's `v` field names its card — so a new pin
  needs no filter wiring. `DAY_PLANS` supplies only the short labels. `#p:<q>` and `#<plan>` both
  narrow ⭐ to the one plan, which is what makes a per-day link from the trip page useful.

Two bugs found and fixed while doing it, both worth knowing:

- **`LANE_KEYS` cannot be a snapshot.** `addPlaces()` creates lanes, and it runs inside `init()`,
  after module scope. A lane created there was never drawn — one pin silently vanished.
  `lane()` maintains the list instead.
- **A day pin's plan is not always its card.** The Perugina pin belongs to the Perugia day but
  links to the peanut-allergy card, because that is what its reader needs. It carries an explicit
  `plan:'perugia'`, and `planOf()` prefers that over `v`.

⚠️ **`check-links.py` greps `v:'…'` out of map.html.** A comment containing a literal example in
that shape fails the `pin → card` check. Describe the field in prose instead.

### The second pass (Sep 2026) — three-state chips, and ⭐ became the sub-row's הכל

The sub-row shipped above works, but the two rows did not know about each other. The user's
comment is in the table below; four separate things were wrong, and three of them were the same
bug wearing different clothes — **"is everything on?" was answered from the category row alone,
ignoring the day row underneath it.**

- **⚠️ `shown.days` no longer exists, and must not come back.** ⭐ had *two* pieces of state — the
  category flag and the eight days — and they could disagree. Tapping ⭐ off left all eight days
  set; unchecking all eight by hand left the category set. Two identical-looking maps, two
  internal states, and the ⭐ chip coloured white one way and grey the other. It took a second
  round of "the filter still isn't right" to see that the two rows were the same control.
  `catOn('days')` is now `dayCount() > 0`, derived, and a derived value cannot disagree with
  itself. `setAll(v)` sets the days to `v` **in both directions** for the same reason.
- **`allOn()` is the single answer to "is everything on?"**, and the title, the הכל chip and the
  ⭐ chip all read it. Before: six chips on with ⭐ narrowed to one day made הכל look fully-on, so
  tapping it *hid the map* instead of restoring it, and the title claimed all 64 places while 60
  were drawn.
- **Both summary chips are plain select-all / clear-all**, on one rule: *anything showing → clear
  it; nothing showing → bring it all back.* Partly-selected clears, so one tap always empties and
  the next always fills. The sub-row's own הכל chip is **deleted** — it was a second control for
  a state its parent chip should have been showing.
- **Grey (`.some`) is a real third state on both** — ⭐ greys when its days are partial, הכל greys
  when anything at all is partial, days included. White means genuinely nothing.

⚠️ **The ⭐ sub-row is always on screen — it does not hide when no day is selected.** It used to
hide whenever ⭐ was off, which read as tidy right up until ⭐ off *became* "no days selected".
The user's own description of the workflow settles it: **"remove all, then choose only those I
want to see."** A picker that vanishes the moment you clear it vanishes at the one moment it is
needed. `sub.hidden` is gone, and so is the `hidden` attribute in the markup.

> Noted in passing, because the next person to reach for `hidden` on one of these rows will hit
> it: it never worked. An author `display:flex` beats the UA sheet's `[hidden]{display:none}` at
> any specificity, so every "hide" left the row on screen with its chips still tabbable. A
> `.filters[hidden]{display:none}` rule fixes it — it is not in the file, because nothing sets
> `hidden` any more and dead CSS rots.

### The `<h1>` is static

`🗺️ מפת המסלול`, and `render()` does not touch it (user's request, Sep 2026). It used to be a
live readout — *"🗺️ 59 מקומות · 6 קטגוריות"*, *"📍 מפלי מרמורה"*, *"כל 64 המקומות בתכנית"* — which
meant **the one element above the map changed length on every tap**, wrapping to two lines and
back, shoving the map down and up under the finger doing the tapping. The chips already say what
is selected, each in a fixed place. Measured: `.bar` is 63 px through every state now.

`visible`, `only` and the per-render `fitChips()` went with it — nothing reflows above the map
any more, so there is nothing to re-measure on a toggle. `fitChips()` still runs on load and on
`resize`. **If the header ever becomes dynamic again, `fitChips()` has to come back into
`render()`.**
- **Each day plan has its own shade**, `hsl(137 26% …)` from 50% down to 29%, derived from
  `DAY_KEYS` so adding a plan re-spaces the ramp. Chips *and* pins wear it. One hue on purpose:
  eight unrelated colours would have broken the chip↔pin key that the chips exist to be.

**The sub-row scrolled, and `fitRow` was not the culprit** — it had already run out of levels. Two
CSS rules were:

1. `.filters.sub button{padding:.28em .6em}` and `.filters.hide-tx button{padding:.34em .5em}`
   have **equal specificity**, and `.sub` came later, so the sub-row never got the tight padding
   it was falling back to. It is `.filters.sub:not(.hide-tx) button` now. **Do not re-order these
   two rules instead — `:not()` is what states the intent.**
2. The `⭐ לפי יום` caption is a fixed ~70px that never hid. `.filters.hide-tx .lbl{display:none}`.
   Safe precisely because ⭐ sits directly above it and now means what the caption said.

Verified in-browser at 375px: both rows `scrollWidth - clientWidth === 0`, and all six toggle
paths plus `#marmore` / `#days` / `#food` / no-hash re-checked.

## Marmore on the first day (user's decision, Sep 2026)

The family chose to do the falls on **Friday 25.9, on the drive from the airport**, and asked
for the parking question and the release times settled. All of it was verified against
`cascatadellemarmore.info` (read 13.9.2026, the site serves a table headed **ANNO 2026**).

**The three answers:**

1. **The release window is 15:00–16:00, and it is the only one reachable.** Friday is a
   *feriale*: park 10:00–18:00, water **11:00–13:00 and 15:00–16:00**. (The page previously said
   the weekday park closed at 17:00 — wrong for the 14–30 Sept band. Fixed.) The morning slot
   cannot be made: Goldcar pick-up is 09:00, so the convoy leaves Fiumicino ~11:00 and arrives
   ~13:30. **A siren precedes the release and the flow ramps over a few minutes** — the page says
   be at the viewpoint at 14:45, not 15:00.
2. **Park at Belvedere Inferiore, both cars, and stay there.** The decisive fact is that
   **the shuttle does not run in September 2026** — the official calendar lists its exact 2026
   dates (April, May, June, July, August; September has none). So "park at one, walk to the
   other" has **no return leg**, and the only foot link is Sentiero 1: 600+ irregular steps and
   ~150 m of climb, which the site itself calls *difficoltoso*. The lower side is also the only
   one with a flat route to a good view; the site says Sentiero 5 at the upper belvedere
   *"non consente una buona vista della Cascata"*.
3. **The walk is the flat paved path to Piazzale Byron** — 300–400 m, no steps, **pushchair-able**,
   mist rather than a soaking. Sentiero 4 is the optional bolt-on for whoever wants height.
   Skipped and said so: Sentiero 2 (soaks you, and there is a 75-minute drive after), the
   **Balcone degli Innamorati** (guided-only, limited numbers, steps, straight under the water —
   and its availability on 25.9 could not be verified; the webshop is a session-gated SPA),
   Sentiero 1 and Sentiero 6.

**⚠️ The "Friday gives one hour vs five" line was wrong, and the user caught it.** The honest
numbers, re-fetched from the official page on 13.9.2026 and pasted here so nobody re-derives them:

```
DAL 14 AL 30 SETTEMBRE          (the band containing 25 Sep)
  APERTURA PARCO   Feriali 10.00-18.00   ·  Sab/Dom 10.00-19.00
  RILASCIO ACQUA   Feriali 11.00-13.00 + 15.00-16.00
                   Sab/Dom 11.00-13.00 + 15.00-18.00
OTTOBRE                          (NOT our dates)
  APERTURA PARCO   Feriali 10.00-17.00
```

**Friday's total is 3 hours, not 1. The weekend's is 5, not 5-vs-1.** The gap is two hours, not
four. The "one hour" figure was the *reachable* afternoon window being compared against the
weekend *total* — two different quantities. Fixed on the page.

**And the old page's "park 10:00–17:00 on weekdays" was October's row, not September's.** That is
an easy row to grab off that table; the September 14–30 weekday closing time is **18:00**.

**What actually constrains the day is the car, not the schedule.** With the 09:00 Goldcar
pick-up the convoy leaves Fiumicino ~11:00 and reaches Marmore ~13:30, so the 11:00–13:00 window
has closed and only 15:00–16:00 is left. **If the pick-up can be moved earlier the morning window
opens and is the better plan** — arrive 10:35, at Byron by 11:20, 1h40 of water, away at 13:00,
Deruta by 14:15 with the whole afternoon free. Both timelines are on the card. This is live:
the family may be amending the booking anyway over the out-of-hours return, and the desk's actual
opening hour is being checked.

**An hour at the falls is enough**, and the card now says so. For the flat Byron route plus a
wander, 60 minutes at full flow is the right length and about the maximum a jet-lagged 3-year-old
will give. The extra weekend hours are slack, not need. The weekend-return suggestion stays on
the card as an option, not as a correction to the family's decision.

**Other facts now on the card, all from the official site:** tickets €12 / €10 (5–9 and 70+) /
free 0–4, **6 gate accesses per ticket** (so the optional upper-belvedere stop costs no extra
entry), and the **€6-per-child family rate that is sold at the desk only, never online** — which
is why the card says buy at the *cassa*. Blue-line parking €2/h, €10/day, payable 10:00–20:00;
the P1/P2 online packages are July–August only.

**The supermarket moved.** It used to be "somewhere on the drive up". It is now **Conad
Superstore, Via Tiberina 44B, Deruta — 1.15 km and 3 minutes from the house, Fri 08:30–20:00**,
done in the evening by two adults with an empty car, rather than by nine tired people with a
trolley of chilled food in two already-loaded cars. (There is a second, smaller Conad on Via
Foscolo in Deruta that shuts 13:00–16:30 — the card says which one is not it.)

**Latest departure from Marmore: 16:30 comfortable, 17:15 absolute** (park shuts 18:00, sunset
19:03). Plan B, if they are two hours late, is **not** to pay €90 to look at a trickle — drive
straight to Deruta and do Marmore properly at the weekend.

Three new map pins came with it — Piazzale Fatati (the car park), Piazzale Byron (the viewpoint),
and the Conad — and the two belvedere pins got the **official entrance coordinates**, which
differ from the ones that were there by 100–500 m. Lake Piediluco stays pinned but its note now
says it has no place in the Friday plan.

**Unverified and marked as such on the page:** the Balcone's availability on the date, Goldcar's
station hours, the Conad's hours (aggregator), and every trail length — secondary sources
disagree by up to ±30%, which is why the recommended route is described as "the flat paved path"
rather than by a number.

## Content principles

Albania's [content principles](../albania-2026/CLAUDE.md#content-principles) apply verbatim and
were followed here: present tense only and no change-history on the page, no boosterish labels,
high-level by default with detail inside `<details>`, delete rather than demote, and prefer the
accessibility unlock over the attraction. Two that came up specifically on this page:

- **The obsolete first-night hotel comparisons were deleted, not demoted.** Both research reports
  spend a table each on FCO hotels; the booking supersedes them, so they are gone from the page
  and recorded here instead.
- **Where the sources conflict, the page says so and names the cost.** The Montepulciano drive
  time and the 8-vs-9 headcount are both on the page as live questions rather than being resolved
  into a confident number. That is the same rule as Albania's `≈` mark on restaurant hours: show
  the sourcing tier rather than launder it.
