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
    ├── albania-2026.csv       ← original raw planning draft (day table)
    └── presentation/          ← family slide deck (reveal.js, Hebrew RTL)
        ├── index.html         ← ★ source of truth for the deck. Edit here!
        ├── styles.css
        └── assets/            ← location photos (Wikimedia Commons CC) + YouTube thumbnail
```

## Publishing (GitHub Pages)

- **Trip page URL:** `https://liorsol.github.io/liorsol/trips/albania-2026/`
- **Presentation URL:** `https://liorsol.github.io/liorsol/trips/albania-2026/presentation/`
- Old URL `.../albania-2026.html` at repo root is a redirect stub — keep it.
- After editing `trips/albania-2026/index.html`: commit + push (ask the user before pushing unless they explicitly requested it).

## Dynamic data (Firebase)

This page has its own reserved DB key, `albania2026`, for any dynamic/shared data it ends up
needing — full rules, DB URL and access-model reasoning are in the
[README](../../README.md#firebase-realtime-database-dynamic-data-sync). No feature writes here
yet. **Privacy still applies** (see the section above) — that path is public and
unauthenticated like the rest of this repo, so never put personal/private data in it.

## HTML structure (technical)

Single HTML file, SPA, inline CSS+JS. Only external dependency: Google Fonts (Suez One, Assistant, Heebo).

- Each section = `div.view` with `id="view-XXX"`. Navigation via elements with `data-view="XXX"`.
- Existing views: `home, north, tirana, drive, south, food, info, checklist, mine`.
- **Adding an attraction:** duplicate a `.card` in the relevant view. Structure: title → `.tags` (group tags) → `.meta` (incl. `.pr` for price) → description → `.why` (recommendation) or `.alt` (alternative) → `.links` (official site + map).
- Map links: `https://www.google.com/maps/search/?api=1&query=NAME+LOCATION`
- Group tags (for splitting up): `t-beach` sea & chill · `t-cult` culture · `t-adv` adventure & teens · `t-grand` "נגיש" accessible & relaxed (CSS class kept as `t-grand`; label renamed from "סבא-סבתא" — covers strollers too, less offensive) · `t-all` everyone.
- The hash update is wrapped in try/catch (sandboxed-iframe fix) — do not remove.
- Print: all views open under `@media print`.
- Top of the file has a large HANDOFF comment with the full research — **update it when material decisions change**.

## Trip data

- **Flights (rescheduled, Aug 2026):** outbound TLV 20:30 → TIA 22:25 (13.8) · return TIA 19:55 → TLV 23:40 (22.8). The return moved from 10:30 to 19:55, so **22.8 is a near-full day in Albania** and the airport deadline is ~17:25 (2.5h before), not 08:00.
- **Extended family ~20 people**, 5 families: Solomon (2 parents + girls 7, 10) · grandparents · family (2 + baby 1.5) · family (2 + girls 6, 3, 1) · family (2 + girls 8, 12, 14, 17).
- **Lodging:**
  - **Night of 13.8 (arrival) — near the airport (Rinas), NOT the villa.** Correction (June 2026, from the user): the Durrës villa starts only on **14.8** (second night), so the landing night everyone sleeps near Tirana airport. Each of the 5 families books its own — must have **free parking + 24h shuttle** because landing is 22:25 and some car-hire desks close 23:00–24:00. Candidates: **Airport Garden Hotel** (~50 m / 5-min walk, Booking 8.7) · **Hotel Airport Tirana** (4★, in front of terminal, free 24h shuttle, pool) · **Best Western Premier Ark** (4★ premium) · **Nerium Garden Inn** (Booking 9.6, shuttle by arrangement) · **Airport Holiday Hotel** (budget). Solomon-family August nightly ranges (verify on Booking): Airport Holiday ~€45–65 · Hotel Airport Tirana ~€60–90 · BW Ark ~€70–120 · Airport Garden ~€80–110 · Nerium ~€90–130.
  - **Villa Maxhaku, Shëngjergj (Shën Gjergj), Tirana County** (everyone), **check-in 14.8**, checkout 19.8 (**5 nights**, confirmed by user) — [Booking link](https://www.booking.com/hotel/al/villa-maxhaku.he.html). **The base moved (Aug 2026, user):** it was a villa on the Durrës coast; it is now a mountain village ~37 km / ~1 h north-east of Tirana. This is a structural change, not a rename — the old base sold "shallow Adriatic sea at the doorstep for the toddlers", and the new one sells mountain air, quiet and a private pool, with the beach becoming a planned day trip. Note: booking.com is blocked by this environment's network policy (curl and WebFetch both get 403), so property details came from a single listing aggregator (PickleTrip, which mirrors Booking) and are **unverified** — sleeps ~20, 8 bathrooms, ~500 m², pool, parking, EV charger, terrace. **Bedroom count and guest rating could not be found anywhere** — confirm with the host before assigning rooms for 20 people. The aggregator's "1 bedroom" figure is a scraping artefact, not real.
  - Asters hotel in Ksamil, checkout 21.8 — [Booking link](https://www.booking.com/hotel/al/asters.en-gb.html) · **night of 21.8 not yet booked** — decided: low budget, not city center; near airport (Rinas) or up to ~30 min away if morning mountain view (Krujë candidates: Hotel Panorama Kruje, Rooms Emiliano, Vila Taga). Must be at the airport ~17:25 (2.5h before the 19:55 flight) — the whole morning and afternoon of 22.8 are free.
- **Car (Solomon):** OK Mobility, Hyundai Venue (Compact, 5 seats). Whole family needs 4–5 cars.
- **Events:** grandma's birthday (14.8, Friday dinner) · Daniel's birthday (18.8) · combined anniversaries party + adults-only quiz 🔞.
- **Gluten:** some family members are sensitive — every restaurant recommendation must address gluten (dedicated `food` view).

## Day-by-day skeleton

| Date | Day | Plan |
|---|---|---|
| 13.8 | Thu | Landing 22:25 → sleep near airport (Rinas) — villa only from 14.8 |
| 14.8 | Fri | Collect cars → Tirana + **big supermarket run** → check in to the villa (Shëngjergj) · grandma's birthday dinner |
| 15.8 | Sat | Mt. Dajti (cable car) |
| 16.8 | Sun | Lake Shkodra / nearer alternative (Kruja, water park) |
| 17.8 | Mon | Berat |
| 18.8 | Tue | Lake Bovilla (**road needs checking — gravel final stretch**) · Daniel's birthday evening |
| 19.8 | Wed | Drive south Shëngjergj→Ksamil (full travel day, ~1 h longer than from Durrës) |
| 20.8 | Thu | Ksamil: Butrint + beaches + Lëkurësi |
| 21.8 | Fri | North (Blue Eye + Gjirokastër optional) → sleep near airport |
| 22.8 | Sat | Free last day (Krujë / Tirana / Durrës beach) → at airport ~17:25 → flight 19:55 |

## Open questions (as of June 2026)

1. Driving appetite — shorten/drop Shkodra?
2. How many cars does the whole family actually have?
3. "Adults-only" folklore evening — who stays with the kids?
4. Night of 21.8 — choose near-airport (Airport Garden 4.7 / Hotel Airport Tirana 4.4 / Airport Holiday 4.3) vs. Krujë mountain-view budget option, then book.
5. Night of 13.8 (arrival) — each family picks an airport hotel and books (see Lodging). Note (June 2026): Airport Garden showed **no availability** for 13→14.8 — likely the booking calendar isn't open ~14 months out, not sold out; recheck closer or contact directly. Strong backup: **Side Airport Hotel** (steps from terminal, family rooms, family-run shuttle, 9.4).

### Resolved (August 2026)

- **Flights rescheduled** (see Trip data): return moved 10:30 → 19:55. The 21.8 "go north and sleep near the airport" plan still stands (Ksamil checkout is 21.8 regardless), and it now buys a genuinely free 22.8 instead of a 04:00 start. Krujë as the 21.8 option got stronger — a whole morning at the castle/bazaar before a ~25–30 min drive to the airport.
- **Villa swapped and the northern base moved** — Durrës coast → Villa Maxhaku in the Shëngjergj mountains (see Trip data). All "from Durrës" drive times in the star-trip catalogue were recomputed from the new base, and the day skeleton, hero subtitle, nav label and section titles were rewritten off Durrës. Three consequences worth re-checking with the user: **(a)** there is no beach at the base any more — Durrës beach is now a ~1:40–2 h day trip; **(b)** the 19.8 drive south to Ksamil starts ~1 h further inland (~5–6 h); **(c)** **Bovilla (the 18.8 plan) got worse, not better** — it is on a different axis (~1:30–2 h via Tirana, not a mountain shortcut) and its last 6–8 km are gravel/potholes reported as unsuitable for a compact car, which is exactly what the family rented.

Drive times: only Shëngjergj↔Tirana centre (~37–40 km, ~55–70 min, over the Qafë Priskë pass) is directly sourced. Everything else in the catalogue is a composite of that leg plus a sourced Tirana→destination leg — flagged as estimates per the repo convention. Also added to the page: the Shëngjergj waterfall (~30 m, ~1.5–2 km walk, ~15–20 min each way, no fee found), Bujtina Tomadhe agrotourism (15 horses + 3 ponies, farm restaurant, in the village), and a note on the Qafë Priskë road (paved but winding; avoid after dark). Not found despite searching: any supermarket, pharmacy or petrol station in the village (pop. ~1,377), mobile reception data, and any thermal springs — the last appears genuinely not to exist locally.

### Resolved (June 2026)

- **Villa starts 14.8, not 13.8** (user correction) → landing night (13.8) is near the airport; each family books its own (parking + 24h shuttle, since landing 22:25 and car desks may close 23:00–24:00).
- Last-night budget: **low, not city center** (Tirana urban option dropped); up to ~30 min from airport OK if mountain view.

## Media resources — top picks (found June 2026)

The family presentation (`presentation/` — reveal.js, Hebrew RTL, photos + music) is published on GitHub Pages. Background music is "Zjerm" (Shkodra Elektronike, Albania's Eurovision 2025 entry), bundled as `presentation/assets/zjerm.m4a` — pre-trimmed to the 0:05–3:03 segment with fade in/out so the native `loop` restarts cleanly (user's decision to bundle; commercial track, so if a takedown ever arrives just swap the file). Useful sources found while building it:

**Hebrew YouTube videos on Albania** (for the family, verified June 2026):
- טיול מאורגן לאלבניה ומקדוניה (ערוץ מסעות) — best general intro: https://www.youtube.com/watch?v=9v9QZthrdes
- המדריך הראשוני לאלבניה — חופשה וקולינריה (Short): https://www.youtube.com/shorts/aRGPtXcT_gE
- אגם קומאן ונהר שאלה — צפון אלבניה: https://www.youtube.com/watch?v=eBJuYbuCTS0
- אלבניה במבט מרחפן (מסע אחר): https://www.masa.co.il/video/אלבניה-חופשה-בדרך-שלך/

**Free-to-use location photos:** Wikimedia Commons has good CC photos of every destination on the itinerary (Ksamil, Berat, Gjirokastër, Blue Eye, Skanderbeg Sq., Durrës amphitheatre, Kruja, Llogara, Dajti, Butrint, Bovilla, Himarë, Vlora). Note: Commons rate-limits bulk downloads — space requests a few seconds apart and use a descriptive User-Agent.

**Albanian music (free/legal):** Internet Archive's George Blood 78rpm collection (search `collection:georgeblood AND albanian`, ~25 records) — historic recordings incl. Tefta Tashko-Koço (Albania's most famous classic singer; "Për një ditë kur del goca në pazar" is an upbeat crowd-pleaser) and traditional *valle* dance tunes. Wikimedia Commons also has "Kido Na Ballkone" (traditional song, CC BY-SA).

## Content principles (from the research)

- Don't cram Berat + folklore evening into one day — split them.
- A "lazy day at the villa" is a legitimate option.
- No ~4-hour drive on flight morning — on 21.8 go north and sleep near the airport.
- Ksamil in August: parking nearly impossible after 09:00.
- Swimming at the Blue Eye is forbidden (~10°C).
- Cash is king — many attractions are cash-only.
- Every attraction is tagged by group so the family can split up on no-consensus days.
