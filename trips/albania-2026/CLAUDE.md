# Project: Family Trip to Albania · August 13–22, 2026

## Working rules (mandatory)

- **Discussion with the user — in English.** **All HTML content and family-facing output — in Hebrew.** Commit messages in English.
- The HTML is RTL (`dir="rtl" lang="he"`).
- Prices, opening hours and drive times are 2025/26 estimates — whenever adding new info, note that it should be verified closer to the trip date.

## 🔒 Privacy — this repo is PUBLIC

This repo is served publicly via GitHub Pages. **Never add personal/private data to this repo**, even if asked casually — stop and warn instead. This includes:

- Booking references / confirmation numbers (flights, car hire, hotels, villa)
- Passport numbers, ID numbers, full birth dates
- Phone numbers, home addresses, email addresses
- Payment details, invoices, prices paid for specific bookings
- Documents, tickets, or screenshots of any of the above

If the user wants the trip page to reference such details (e.g., car-hire confirmation, flight details): the actual document must live in a **login-protected location (e.g., Google Drive with restricted sharing)**, and the repo may only contain the **link** to it. Before adding such a link, verify with the user that the target is access-restricted (not "anyone with the link").

## Repo structure

```
liorsol/  (github.com/liorsol/liorsol — public, GitHub Pages from root of main)
├── albania-2026.html          ← redirect stub to trips/albania-2026/ — do not delete
├── index.html                 ← UNRELATED — repo file browser (site home) — do not touch
├── savings-calculator.html    ← UNRELATED project (savings calculator) — do not touch
├── restaurants.html, app.js, style.css, rest_combined.json ← UNRELATED — do not touch
└── trips/albania-2026/        ← everything trip-related lives here
    ├── CLAUDE.md              ← this file (canonical project context)
    ├── index.html             ← ★ source of truth — the trip page. Edit here!
    ├── map.html               ← all locations from the plan on one Leaflet/OSM map, grouped by category (no API key)
    ├── albania-2026.csv       ← original raw planning draft (day table)
    ├── research-gemini.md      ← raw Gemini research report (source doc, broken citations — see below)
    └── presentation/          ← family slide deck (reveal.js, Hebrew RTL)
        ├── index.html         ← ★ source of truth for the deck. Edit here!
        ├── styles.css
        └── assets/            ← location photos (Wikimedia Commons CC) + YouTube thumbnail
```

## Publishing (GitHub Pages)

- **Trip page URL:** `https://liorsol.github.io/liorsol/trips/albania-2026/`
- **Map page URL:** `https://liorsol.github.io/liorsol/trips/albania-2026/map.html`
- **Presentation URL:** `https://liorsol.github.io/liorsol/trips/albania-2026/presentation/`
- Old URL `.../albania-2026.html` at repo root is a redirect stub — keep it.
- After editing `trips/albania-2026/index.html`: commit + push (ask the user before pushing unless they explicitly requested it).

## Dynamic data (Firebase)

The page uses its reserved DB key, `albania2026` — DB URL, rules and access-model reasoning
are in the [README](../../README.md#firebase-realtime-database-dynamic-data-sync).
**Privacy still applies** (see the section above): that path is public, unauthenticated and
**world-writable**, so never put personal/private data in it. The page shows a warning saying
exactly that above every input box — keep it.

Two features write there (built Aug 2026, on the user's request):

1. **Comments — one board per view.** `<section class="talk" data-topic="VIEW">` sits at the
   bottom of all 10 views; the JS builds the form and list.
2. **A links board** in the practical-info view: `<section class="links-board" id="links">`.

### Storage schema

Real nested JSON, one node per entry:

```
albania2026/
  comments/<view>/<id>   {n: name, t: text,  d: epoch_ms}
  links/<id>             {n: name, u: url, t: title, d: epoch_ms}
```

`<view>` is the SPA view name; `<id>` is `Date.now().toString(36) + '_' + 4 random base36`
(13 chars today, and the timestamp stays 8 chars until 2059).

**The rules and this shape must change together.** The rules validate per field — type,
length, required children, and `$other: false` rejecting unknown keys — so adding a field to
an entry without publishing new rules gets a **401 Permission denied**, not a silent drop.
The page turns that 401 into a specific message ("הכתיבה נחסמה — כללי ה-DB צריכים עדכון")
rather than a generic failure, because it is the one error that a page reload will never fix.
The full rules document lives in the [README](../../README.md#firebase-realtime-database-dynamic-data-sync).

Reads are one shared `GET albania2026.json` for the whole page (all 11 boards slice it
client-side — don't reintroduce a fetch per board). Writes `PUT` the entry node, deletes
`DELETE` it.

*History: entries were originally one flat key holding a JSON string, because the first
version of the rules allowed only bool/number/string per key. The rules were widened to
proper nested objects in Aug 2026 and the two links that existed by then were migrated —
`l_<id>` became `links/<id>` with the original name and timestamp preserved.*

**Two dead legacy keys remain at the root** (`l_msjia2rm_x6k6`, `l_msjiciov_e3yr`). The new
rules grant `.write` only under `comments` and `links`, so a root-level key is readable but
**not deletable over REST** — `DELETE` returns 401. They are harmless: the page reads only
`comments` and `links`, so they never render. To actually remove them, delete the two nodes
in the Firebase console. (The alternative is a rule permitting deletion of string-valued root
keys only — `"$legacy": {".write": "data.isString() && !newData.exists()"}` — which cannot
touch `comments`/`links` because those are objects, and becomes inert once no root string
exists. Not published; the console is simpler for two nodes.)

**Lesson for the next schema change:** grant `.write` where the data *currently* lives, not
only where it is moving to, or the old data strands. Migrate before tightening, or widen
temporarily.

### Reading the boards back (the point of the feature)

The user's plan is to collect family input here, then fold it into the static page:

```bash
curl -s "https://liorsol-github-default-rtdb.europe-west1.firebasedatabase.app/albania2026.json" > /tmp/boards.json
python3 - /tmp/boards.json <<'EOF'
import sys, json, datetime as dt
d = json.load(open(sys.argv[1])) or {}
rows  = [("comment", v, i, r) for v, ids in (d.get("comments") or {}).items() for i, r in ids.items()]
rows += [("link", "-", i, r) for i, r in (d.get("links") or {}).items()]
for kind, view, i, r in sorted(rows, key=lambda x: x[3].get("d", 0)):
    when = dt.datetime.fromtimestamp(r.get("d", 0) / 1000).strftime("%Y-%m-%d %H:%M")
    path = "comments/%s/%s" % (view, i) if kind == "comment" else "links/%s" % i
    print("[%s/%s] %s  %s: %s %s" % (kind, view, when, r.get("n") or "anon",
                                     r.get("t", ""), r.get("u", "")))
    print("    delete: %s" % path)
EOF
```

After folding an entry into the page, delete it so the board doesn't accumulate stale notes:
`curl -X DELETE ".../albania2026/comments/<view>/<id>.json"`.

### Security — non-negotiable

Anyone can write anything to that path, so **everything read back is untrusted input from the
internet.**

- Render **only** with `textContent`. Never `innerHTML` for stored values. (The five
  `innerHTML` uses in the page are all `= ''` clears — keep it that way.)
- **Re-validate every URL at render time**, not just on submit: `new URL()` and accept only
  `http:`/`https:`. Anything else is dropped silently. This blocks `javascript:` and `data:`.
- Links get `rel="noopener noreferrer nofollow"` and `target="_blank"`.
- Mirror the DB rules client-side before each write (key shape, serialized length < 2000) so
  a rejected write is a clear message and not a silent 400.

Verified end to end in-browser: `<img src=x onerror=…>` in a name and a comment rendered as
literal text with no element created and no handler fired; `javascript:` URLs were rejected;
a bare domain was upgraded to `https://`; post → list → delete round-tripped against the real
DB, and the test rows were removed afterwards.

## HTML structure (technical)

Single HTML file, SPA, inline CSS+JS. Only external dependency: Google Fonts (Suez One, Assistant, Heebo).

- Each section = `div.view` with `id="view-XXX"`. Navigation via elements with `data-view="XXX"`.
- Existing views: `home, north, tirana, drive, south, last, food, info, checklist, mine`.
- **Progressive disclosure is the page's core rule (user's explicit request, Aug 2026).** A card shows only the high-level layer by default: title → `.tags` → `.meta` (drive time, hours, `.pr` price, `.done` for booked) → one `.gist` paragraph. **Everything else goes inside `<details><summary>…</summary>`** — the why, the caveats, the accessibility notes, the `.links`. Write the `<summary>` as a concrete promise of what's inside ("איך מפצלים את היום בין הגילאים"), never a generic "פרטים".
- Exception: a genuinely blocking warning (`.note.warn`) stays outside `<details>` — e.g. the Bovilla gravel road, the Vila Zeus shuttle.
- `beforeprint` opens every `<details>` (JS), and `@media print` hides the summaries.
- Map links: `https://www.google.com/maps/search/?api=1&query=NAME+LOCATION`
- Group tags (for splitting up): `t-beach` sea & chill · `t-cult` culture · `t-adv` adventure & teens · `t-grand` "נגיש" accessible & relaxed (CSS class kept as `t-grand`; label renamed from "סבא-סבתא" — covers strollers too, less offensive) · `t-all` everyone.
- The hash update is wrapped in try/catch (sandboxed-iframe fix) — do not remove.
- **No HANDOFF comment.** It used to duplicate this file at the top of `index.html`; it was deleted (Aug 2026). **This file is the only canonical context** — don't re-add a research dump to the HTML.

### Deep links (user's explicit request, Aug 2026)

**Every card is addressable and every navigation is a real history entry.** The URL scheme:

| URL | Resolves to |
|---|---|
| `#north` | the view |
| `#north/dajti` | the view, scrolled to that card, with its `<details>` forced open and a highlight flash |
| `#dajti` | same — a bare card id resolves to its containing view |
| `#anything-unknown` | falls back to `home` |

- Every `.card` carries a unique `id` and a `<a class="anchor" href="#view/id">🔗</a>` inside its `<h3>`, so right-click → "copy link address" works natively.
- Routing goes through `location.hash` (**not** `history.replaceState`) — that is what makes Back/Forward work. The `hashchange` listener is the single render path. Don't "optimise" this back to `replaceState`.
- **When adding a card, give it an id and an `.anchor`** or it becomes the only unlinkable thing on the page.
- Verified working: deep link → nav away → Back returns to the deep link with the card still open.

### Per-section maps

`map.html#<category>` shows only that category and fits bounds to it; no hash = all 58 pins. Categories: `lodging, north, tirana, drive, south, food`. Each view's region banner carries a `.viewmap` link to its own slice, `map.html` has filter chips, and the home view has a full-width `.mapbanner` (the plain nav link was too easy to miss).

### RTL arrow convention (non-obvious — gets it wrong every time otherwise)

`→` (U+2192) and `←` (U+2190) have **Bidi_Mirrored = No**, so they never flip in RTL — they render exactly as authored. Therefore, in Hebrew text:

| Meaning | Character | Example |
|---|---|---|
| "leads to / then / next" (follows reading direction) | **`←`** | `נחיתה 22:25 ← Hotel Vila Zeus` |
| "back / return" (against reading direction) | **`→`** | `<a class="back">→ חזרה לבית</a>` |
| Date range | **`–`** en dash, not an arrow | `13–14.8` |
| "opens in a new tab" (sits at the left end of RTL text) | **`↖`** not `↗` | `מפה ↖` |
| `<details>` disclosure marker | `◂` closed, `▾` open | in CSS, not markup |

Verify with `python3 -c "import unicodedata as u; print(u.mirrored('→'))"` before assuming a glyph flips.

## Trip data

- **Flights (rescheduled, Aug 2026):** outbound TLV 20:30 → TIA 22:25 (13.8) · return TIA 19:55 → TLV 23:40 (22.8). The return moved from 10:30 to 19:55, so **22.8 is a near-full day in Albania** and the airport deadline is **17:00**.
- **Extended family ~20 people**, 5 families: Solomon (2 parents + girls 7, 10) · grandparents · family (2 + baby 1.5) · family (2 + girls 6, 3, 1) · family (2 + girls 8, 12, 14, 17).
- **Lodging:**
  - **Night of 13.8 (arrival) — ✅ BOOKED: `Hotel Vila Zeus`, Rinas** (told by the user, Aug 2026). The villa starts only on **14.8**, so the landing night is near the airport. Verified facts: 4★, **~1 km / ~12-min walk from the terminal** (the hotel's own site says 3,281 ft — a search snippet claiming 0.2 mi is wrong), **free private parking**, **24h front desk**, coffee shop + bar (not a full restaurant), no pool, Booking ~7.4 from ~1,900 reviews. Largest room listed is a **Superior Double, 50 m², sleeps 4** with sofa bed — no dedicated family rooms.
    **Two open flags on it:** (a) it does **not** advertise a fixed 24/7 shuttle — the site lists none and reviews describe a transfer arranged with staff (some say it was free). That breaks the original "must have 24h shuttle" criterion, and landing is 22:25 — the page tells the family to confirm a pickup in writing beforehand. (b) confirm the booked room is the 50 m² Superior if 4 people are in it.
    **Unresolved:** whether this booking covers all 5 families or only the Solomons — ask the user; the page is worded to work either way.
    Backups kept on the page: **Hotel Airport Tirana** (4★, in front of terminal, free 24/7 shuttle, pool) · **Side Airport Hotel** (steps from terminal, family rooms, 9.4) · **Best Western Premier Ark** (4★ premium) · **Airport Holiday Hotel** (budget).
  - **Villa Maxhaku, Shëngjergj (Shën Gjergj), Tirana County** (everyone), **check-in 14.8**, checkout 19.8 (**5 nights**, confirmed by user) — [Booking link](https://www.booking.com/hotel/al/villa-maxhaku.he.html). **The base moved (Aug 2026, user):** it was a villa on the Durrës coast; it is now a mountain village ~37 km / ~1 h north-east of Tirana. This is a structural change, not a rename — the old base sold "shallow Adriatic sea at the doorstep for the toddlers", and the new one sells mountain air, quiet and a private pool, with the beach becoming a planned day trip. Note: booking.com is blocked by this environment's network policy (curl and WebFetch both get 403), so property details came from a single listing aggregator (PickleTrip, which mirrors Booking) and are **unverified** — sleeps ~20, 8 bathrooms, ~500 m², pool, parking, EV charger, terrace. **Bedroom count and guest rating could not be found anywhere** — confirm with the host before assigning rooms for 20 people. The aggregator's "1 bedroom" figure is a scraping artefact, not real.
  - Asters hotel in Ksamil — **the Solomons check out 21.8; the other families stay a second night and check out 22.8** (see the 22.8 split below) — [Booking link](https://www.booking.com/hotel/al/asters.en-gb.html) · **Solomons’ night of 21.8 not yet booked** — decided: low budget, not city center; near airport (Rinas) or up to ~30 min away if morning mountain view (Krujë candidates: Hotel Panorama Kruje, Rooms Emiliano, Vila Taga). Must be at the airport **17:00** — for the Solomons the whole morning and afternoon of 22.8 are free.
- **Car (Solomon):** OK Mobility, Hyundai Venue (Compact, 5 seats). Whole family needs 4–5 cars.
- **Events:** grandma's birthday (14.8, Friday dinner) · Daniel's birthday (18.8) · combined anniversaries party + adults-only quiz 🔞.
- **Gluten:** some family members are sensitive — every restaurant recommendation must address gluten (dedicated `food` view).

## Day-by-day skeleton

| Date | Day | Plan |
|---|---|---|
| 13.8 | Thu | Landing 22:25 → Hotel Vila Zeus, Rinas — villa only from 14.8 |
| 14.8 | Fri | Collect cars → Tirana + **big supermarket run (incl. Panja GF bakery)** → check in to the villa (Shëngjergj) · grandma's birthday dinner |
| 15.8 | Sat | **Villa day** (fixed by the user, Aug 2026) — no driving |
| 16.8 | Sun | **Mt. Dajti** (fixed by the user) — cable car + Adventure Park (ropes, age 5+, cable car included in entry) |
| 17.8 | Mon | **TBD** — open, choose from the catalogue |
| 18.8 | Tue | **TBD** — open · Daniel's birthday evening, so prefer the shorter of the two days or a no-drive day |
| 19.8 | Wed | Drive south Shëngjergj→Ksamil. **Inland route recommended** (~5–5.5 h) over coastal/Llogara (~5.5–8 h, switchbacks + August beach traffic → motion sickness). Stops: Petrelë castle/zipline, Tepelenë "Uji i Ftohtë"; coastal alt: **Kuzum Baba** above Vlorë |
| 20.8 | Thu | Ksamil: Butrint (theatre is near the entrance, flat) + beaches + Lëkurësi at sunset |
| 21.8 | Fri | **The family splits here.** Solomons check out and go north: Blue Eye (**electric cart ~200 ALL** — skips the 1.5–2 km walk) + Gjirokastër → sleep near the airport. Everyone else stays a **second night in Ksamil** |
| 22.8 | Sat | **Two separate tracks** → both at the terminal by **17:00**, flight 19:55 |

### The 22.8 split (user, Aug 2026) — the trip's tightest day

- **Solomons** sleep near the airport on 21.8, so 22.8 is a genuinely free day: Krujë (25–30 min) / Tirana (~25) / Durrës beach (~40), ideally ending with lunch at **Uka Farm** (15–20 min from TIA, book ahead) before returning the cars.
- **Everyone else** checks out of Ksamil on 22.8 and drives the whole way: **~5–5.5 h net inland, 6.5–7 h realistically in August**, against a 17:00 deadline. That means **leaving Ksamil ~07:30 and taking one planned stop, not two** — Blue Eye *or* Gjirokastër. The page says this plainly; don't soften it.
- Worth raising with them: leaving Ksamil on 21.8 afternoon instead would buy a calm last day for the cost of half a beach day.
- **Airport deadline is 17:00** (~3 h before the 19:55 flight), not 17:25 — updated everywhere.

## Open questions

1. **Does the Vila Zeus booking cover all 5 families or only the Solomons?** The page is worded to work either way — pin this down.
2. **17.8 and 18.8** — both open. Page recommends Berat on 17.8 (the long day, early in the week) and something close on 18.8 for Daniel's birthday evening. EQUOS and Huqi both need advance booking for ~20 and have **no verified prices or hours**.
3. **Night of 21.8 (Solomons)** — near-airport (Airport Garden 4.7 / Hotel Airport Tirana 4.4 / Airport Holiday 4.3) vs. Krujë (mountain view + bazaar + a full 22.8 morning there). Decider: if Krujë gets used on 17/18.8, don't repeat it → near-airport wins.
4. **Bovilla** — check the unpaved final stretch with the villa host, or switch to a 4×4 shuttle / drop it.
5. How many cars does the family actually have, and how many are automatic?
6. "Adults-only" folklore evening — who stays with the kids?
7. **Villa Maxhaku's exact pin** — corrected to 41.3376, 20.0955 (Vërri, Shëngjergj) but from a **single** Booking-derived geocode. Ask the host for a pin.

## Map coordinates (validated Aug 2026)

All 58 pins in `map.html` were checked against OpenStreetMap / Wikidata / Wikipedia. **46 were wrong by >300 m and were corrected.** Lessons worth keeping:

- **Never enter a coordinate from memory.** The originals were, and the failure rate was ~75%. Three were in the *wrong municipality*: Villa Maxhaku and Bujtina Tomadhe sat in Bashkia Elbasan / Bërzhitë instead of Shëngjergj, and the **Blue Eye was on the Riviera coast at Lukovë, 15 km from the actual spring**. Osum Canyon was 15 km off (at Bogovë), the Shëngjergj waterfall 10 km, Bunk'Art 1 3.7 km (in Kamëz).
- **Verify with reverse-geocoding, not just forward search** — `nominatim.openstreetmap.org/reverse?lat=&lon=&format=json&zoom=14` returns the municipality, which is what catches the catastrophic errors. Forward search alone happily returns a same-named place elsewhere.
- **A naive OSM/Nominatim lookup is not enough for businesses with branches or generic names.** Era resolved to the wrong branch (Era Vila, not Era Blloku); "Berat Viewing Platform" resolved to Sunrise Point, 102 m from the real platform.
- Pins still flagged in their own `note` as approximate/unverified: Villa Maxhaku (single source), Salad Farm (**may be permanently closed**), Vlorë promenade (a ~4 km linear feature).
- Python's `urllib` fails TLS on this machine (Cisco ZTA interception) — use `curl` with a descriptive User-Agent, and space Nominatim calls ~1.5 s apart.

Facts that came out of the validation and changed the page:
- **Mirror Beach (Pasqyrat) is not in Ksamil** — it is ~4 km north, between Ksamil and Sarandë. It needs a car; it was listed as if it were a Ksamil town beach.
- **Berat Viewing Platform has a purpose-built wheelchair ramp** (OSM `note=ramp:wheelchair=yes`) — combined with driving up to the castle gate, that makes Berat genuinely workable for the grandparents.
- **Of the Sarandë restaurants, only Centrali is on the promenade.** Sophra is 2.6 km out on the Butrint road (but has its own parking and a sea-view terrace — actually better for a group of 20); Fishbar is ~450 m inland.
- **Vila Zeus is ~400 m from the terminal in a straight line**, ~1 km on foot around the perimeter.

## Sourcing notes (what is and isn't verified)

Drive times: only Shëngjergj↔Tirana centre (~37–40 km, ~55–70 min, over the Qafë Priskë pass) is directly sourced. Everything else in the catalogue is a composite of that leg plus a sourced Tirana→destination leg — flagged as estimates per the repo convention. Not found despite searching: any supermarket, pharmacy or petrol station in Shëngjergj (pop. ~1,377), mobile reception data, and any local thermal springs (the last appears genuinely not to exist there).

**Second research pass (Aug 2026) — what was accepted and what was thrown out.** The user supplied a Gemini deep-research report — kept verbatim at [`research-gemini.md`](research-gemini.md) — plus a list of Google Maps pins. Everything below was independently re-verified before it went on the page; **the report's own footnote numbering is broken** (claims about Villa Maxhaku cite Reddit threads about Bovilla; the Blue Eye golf cart cites an Expedia page for Hotel Panorama Krujë), so nothing was taken from it on trust.

Accepted after independent verification:
- **Panja** (Rr. Mihal Duri, Tirana) — Albania's only 100% dedicated gluten-free/lactose-free bakery. The single highest-value find for this family; tied to the 14.8 Tirana shopping run.
- **Berat: drive up to the castle gate, free parking outside and inside the walls.** The biggest accessibility unlock in the whole report — it makes Berat viable for grandparents.
- **Petrelë Castle** (free entry, restaurant/café inside, ~12 km from Tirana on the inland axis) + **Zipline Albania** (~1,250 m, age 10+, 35–125 kg, ~€15–25) — note only the 12/14/17-year-olds and adults clear the age limit.
- **EQUOS Resort, Mullet** (~10.5 km SE of Tirana): riding school ~24 horses + water park + pool + restaurant. Only option found that gives horses *and* water in one venue — the strongest 16.8 candidate. No prices/hours verified.
- **Agroturizm Huqi**, Radë/Manëz (agroturizem.gov.al + own site): lake-side working farm, animals, fishing, ~250-seat restaurant, wooden cabins.
- **Kuzum Baba**, Vlorë: hilltop Bektashi tekke, best viewpoint in the city, restaurant with terrace *and* a playground — a better coastal-route lunch stop than fighting for parking on the promenade.
- **Uka Farm**, Laknas: organic farm + winery, ~15–20 min from TIA. Set menu, must book ahead for 20 — good for 14.8 or 22.8.
- **Dajti Adventure Park**: age 5+, May–Oct, cable car included in entry (~€12–20 depending on source/age).
- **Tavë Kosi is a gluten trap** (flour roux thickens the yogurt sauce) — correct and worth having.
- **Belsh Lake**: flat lakeside promenade + cafés, good mid-route stretch stop for the Berat day. (No "pagoda" found — that detail from the report is unconfirmed; the statues are at Lake Seferan.)
- **Tepelenë "Uji i Ftohtë"** roadside spring restaurants — plausible, **not verified**; flagged as such on the page.

Rejected or downgraded:
- The report's blanket "coastal route NOT RECOMMENDED" was kept as an argument (motion sickness + August beach traffic), not as a verdict — but its 6.5–7.5 h figure is inside the range the page already carried, so no number changed.
- Its Hotel Panorama Krujë pricing (€450–600/night for 5 rooms) contradicts the ~€30 the page already had. Not propagated; page says "verify".
- Its Villa Maxhaku "verification" adds nothing the page didn't already flag as unverified.
- Grand Panevino / Marini / Grill Zone — thin sourcing, low marginal value over what's listed. Skipped.
- Of the user's Google Maps pins, these were already on the page under their English names: Lëkurësi, Butrint park, Pyramid, House of Leaves, Krujë. Newly added: Petrelë, Berat Viewing Platform, Et'hem Bej mosque, Orthodox Cathedral of the Resurrection, Kuzum Baba, EQUOS, Dajti Adventure Park. Butrint Ancient Theatre folded into the Butrint card (it sits near the entrance, on flat ground — useful for anyone skipping the acropolis climb).

## Media resources — top picks (found June 2026)

The family presentation (`presentation/` — reveal.js, Hebrew RTL, photos + music) is published on GitHub Pages. Background music is "Zjerm" (Shkodra Elektronike, Albania's Eurovision 2025 entry), bundled as `presentation/assets/zjerm.m4a` — pre-trimmed to the 0:05–3:03 segment with fade in/out so the native `loop` restarts cleanly (user's decision to bundle; commercial track, so if a takedown ever arrives just swap the file). Useful sources found while building it:

**Hebrew YouTube videos on Albania** (for the family, verified June 2026):
- טיול מאורגן לאלבניה ומקדוניה (ערוץ מסעות) — best general intro: https://www.youtube.com/watch?v=9v9QZthrdes
- המדריך הראשוני לאלבניה — חופשה וקולינריה (Short): https://www.youtube.com/shorts/aRGPtXcT_gE
- אגם קומאן ונהר שאלה — צפון אלבניה: https://www.youtube.com/watch?v=eBJuYbuCTS0
- אלבניה במבט מרחפן (מסע אחר): https://www.masa.co.il/video/אלבניה-חופשה-בדרך-שלך/

**Free-to-use location photos:** Wikimedia Commons has good CC photos of every destination on the itinerary (Ksamil, Berat, Gjirokastër, Blue Eye, Skanderbeg Sq., Durrës amphitheatre, Kruja, Llogara, Dajti, Butrint, Bovilla, Himarë, Vlora). Note: Commons rate-limits bulk downloads — space requests a few seconds apart and use a descriptive User-Agent.

**Albanian music (free/legal):** Internet Archive's George Blood 78rpm collection (search `collection:georgeblood AND albanian`, ~25 records) — historic recordings incl. Tefta Tashko-Koço (Albania's most famous classic singer; "Për një ditë kur del goca në pazar" is an upbeat crowd-pleaser) and traditional *valle* dance tunes. Wikimedia Commons also has "Kido Na Ballkone" (traditional song, CC BY-SA).

## Content principles

**Editorial rules the user set explicitly (Aug 2026) — these override the instinct to be helpful by adding:**

1. **Present tense only. No change-history on the page.** Never write "this used to be Durrës", "the flight was moved", "this got longer than before". The reader wants the plan as it stands, not its diff. History belongs in this file and in git.
2. **No boosterish labels.** "האטרקציה שבפתח הדלת", "קלף מנצח", "שווה מאוד", "חוויה מנצחת" — all cut. State the fact that makes it worth doing (distance, price, what's actually there, who it suits) and let the reader conclude.
3. **High-level by default, detail on demand.** See the `<details>` rule under HTML structure. If a paragraph isn't needed to decide *whether* to go, it belongs inside the disclosure.
4. **If it's not relevant, delete it** — don't park it in a smaller font.

Planning principles that still hold:

- Don't cram Berat + folklore evening into one day — split them.
- A day at the villa is a legitimate option, not a fallback.
- No ~4-hour drive on flight morning — on 21.8 go north and sleep near the airport.
- Ksamil in August: parking nearly impossible after 09:00.
- Swimming at the Blue Eye is forbidden (~10°C).
- Cash is king — many attractions are cash-only.
- Every attraction is tagged by group so the family can split up on no-consensus days.
- Prefer the accessibility unlock over the attraction: "drive up to the castle gate", "take the electric cart", "stay in the lower bazaar" are what make a site work for 20 people spanning age 1 to 70s.
