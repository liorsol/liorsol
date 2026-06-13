# Project: Family Weekend in Jerusalem · June 19–20, 2026

## Working rules (mandatory)

- **Discussion with the user — in English.** **All HTML content and family-facing output — in Hebrew.** Commit messages in English.
- The page is RTL (`dir="rtl" lang="he"`).
- Prices, opening hours and Shabbat times are 2026 estimates — whenever adding new info, note that it should be verified closer to the trip date. Tell families to **phone sit-down restaurants the morning of** to confirm Shabbat opening + safe gluten-free.

## 🔒 Privacy — this repo is PUBLIC

Served publicly via GitHub Pages. **Never add personal/private data to this repo**, even if asked casually — stop and warn instead. This includes:

- Booking references / confirmation/order numbers
- Personal discount/coupon codes tied to a booking
- Passport/ID numbers, full birth dates
- Phone numbers, home addresses, email addresses
- Payment details, invoices, prices paid for specific bookings

The source booking emails contained an order number, personal coupon codes (for the City of David tours/zipline) and a campsite phone — these were **deliberately stripped** from `index.html` and from the scrubbed `JERUSALEM-TRIP-PLAN.md`. The page tells families to "use the discount codes from your booking email at checkout." The raw, unscrubbed `.md` files stay on the user's local machine only.

If a private detail is ever needed on the page, link to a **login-protected location** (e.g., restricted Google Drive) and verify it isn't "anyone with the link" before adding.

## Repo structure

```
liorsol/  (github.com/liorsol/liorsol — public, GitHub Pages from root of main)
├── jerusalem-2026.html         ← redirect stub to trips/jerusalem-2026/ — do not delete
└── trips/jerusalem-2026/       ← everything trip-related lives here
    ├── CLAUDE.md               ← this file (canonical project context)
    ├── index.html              ← ★ source of truth — the trip page. Edit here!
    ├── JERUSALEM-TRIP-PLAN.md  ← the full English plan (scrubbed of private data)
    ├── KIDS-TRIVIA-AND-STORIES-HE.md   ← Hebrew kids' trivia + stories (source for the טריוויה view)
    ├── KIDS-MEDIA-PODCASTS-VIDEOS-HE.md ← Hebrew car podcasts + pre-trip videos (source for the מדיה view)
    └── assets/                 ← CC-licensed location photos (Wikimedia Commons) + credits.json
```

## Publishing (GitHub Pages)

- **Trip page URL:** `https://liorsol.github.io/liorsol/trips/jerusalem-2026/`
- After editing `index.html`: commit + push (ask the user before pushing unless they explicitly requested it).

## HTML structure (technical)

Single self-contained HTML file, SPA, inline CSS+JS. External deps: Google Fonts (Suez One, Heebo, Assistant, Frank Ruhl Libre) and **Leaflet** (CDN) for the map.

- Each section = `div.view` with `id="view-XXX"`. Navigation via `nav a.tab[data-view="XXX"]` + hash routing. The hash update is wrapped in try/catch (sandboxed-iframe fix) — keep it.
- Views: `home, friday, saturday, food, info, trivia, media, map`.
- **Theme:** Jerusalem golden hour — stone-gold → desert-night. Color vars at top of `<style>`.
- **Group tags** (Saturday filtering): `t-hist` היסטוריה ועתיקות · `t-nature` טבע ומים · `t-fun` כיף לילדים · `t-chill` רגוע ונגיש · `t-route` בדרך הביתה (מערב) · `t-all` כולם.
- **Interactive bits:** countdown to 2026-06-19 08:00 IDT; live Asia/Jerusalem clock; playable trivia game (6 rounds, per-team scoring, Web-Audio sound FX, confetti); Leaflet map (`PLACES` array, color-coded by day); tag filters; localStorage checklists (`jlm-pre`, `jlm-pack`); image lightbox; scroll-reveal.
- **Sound** is Web-Audio-generated (no audio files, no copyright); default muted, toggle in nav.
- **Images:** local CC files in `assets/`. Credits hardcoded in the `CREDITS` array in JS **and** in `assets/credits.json`. Every credited image is shown somewhere on the page.

## Trip facts (the constraints that drive everything)

- **Dates:** arrive Fri 19 June 2026 (morning) → leave Sat 20 June 2026 (evening). 1 night.
- **Families:** Solomon (2 adults + kids 7, 10) · Tzameret-Iger (2 adults + kids 9, 6, 3* — booking lists youngest as 4; confirm). 9 people. Two cars.
- **Stay:** 2 family caravans (lodging only) at קמפינג יער השלום (Peace Forest, City of David area, SE Jerusalem). Free on-site parking. Check-in Fri 13:00–~17:00 (none on Shabbat); checkout Motzaei Shabbat to ~21:30. No dogs/smoking. ✅ BBQ allowed (dedicated grill stations — verified on City of David site).
- **Shabbat 19–20 June 2026** (Parashat חוקת): candle lighting **Fri 19:07**, ends **Sat ~20:30**.
- **City of David:** Fri 08:00–14:00 (last tunnel entry ~12:30), **closed Shabbat** → all City-of-David activity must be Friday morning.
- **Celiac/gluten-free** is a hard requirement (one child). Dedicated food view; BBQ is the easiest controlled GF meal; buy GF supplies at גלולס before Shabbat (closed Sat).
- **Home direction:** WEST on Route 1 (Tel Aviv / coast) → on-the-way-home stops are west of Jerusalem (עין חמד / קיף צובא / פארק איילון–קנדה).

## Content principles (verified June 2026)

- Validate every recommendation's Saturday/Shabbat availability before adding it. The user's rule: "for every finding, double-check its availability."
- The free First Station → Old City shuttle is **suspended** — families drive.
- Mini Israel is **closed Shabbat** — excluded.
- Kosher GF spots (בן עמי etc.) close Fri ~15:00 → Sat ~20:30; the reliably Shabbat-open options are First Station, German Colony cafés, and Old City (Arab) restaurants.
- Old City works on Shabbat because the Arab market is open (Jaffa Gate → Tower of David → souk → Western Wall → lunch at First Station).

## Open items (verify closer to the trip)

1. Youngest child's age (3 vs 4) — affects free-ticket/age-gated activities.
2. Karta parking operation on Shabbat (Old City option).
3. Bloomfield Science Museum summer Saturday hours.
4. Kif Tzuba: confirm the specific Saturday is open to the public + book online.
