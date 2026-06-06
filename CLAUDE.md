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
├── CLAUDE.md                  ← this file (canonical project context)
├── albania-2026.html          ← redirect stub to trips/albania-2026/ — do not delete
├── index.html                 ← UNRELATED project (savings calculator) — do not touch
├── restaurants.html, app.js, style.css, rest_combined.json ← UNRELATED — do not touch
└── trips/albania-2026/
    ├── index.html             ← ★ source of truth — the trip page. Edit here!
    └── albania-2026.csv       ← original raw planning draft (day table)
```

## Publishing (GitHub Pages)

- **Trip page URL:** `https://liorsol.github.io/liorsol/trips/albania-2026/`
- Old URL `.../albania-2026.html` at repo root is a redirect stub — keep it.
- After editing `trips/albania-2026/index.html`: commit + push (ask the user before pushing unless they explicitly requested it).

## HTML structure (technical)

Single HTML file, SPA, inline CSS+JS. Only external dependency: Google Fonts (Suez One, Assistant, Heebo).

- Each section = `div.view` with `id="view-XXX"`. Navigation via elements with `data-view="XXX"`.
- Existing views: `home, north, tirana, drive, south, food, info, mine`.
- **Adding an attraction:** duplicate a `.card` in the relevant view. Structure: title → `.tags` (group tags) → `.meta` (incl. `.pr` for price) → description → `.why` (recommendation) or `.alt` (alternative) → `.links` (official site + map).
- Map links: `https://www.google.com/maps/search/?api=1&query=NAME+LOCATION`
- Group tags (for splitting up): `t-beach` sea & chill · `t-cult` culture · `t-adv` adventure & teens · `t-grand` grandparents-friendly · `t-all` everyone.
- The hash update is wrapped in try/catch (sandboxed-iframe fix) — do not remove.
- Print: all views open under `@media print`.
- Top of the file has a large HANDOFF comment with the full research — **update it when material decisions change**.

## Trip data

- **Flights:** land Tirana 13.8 at 22:25 · depart 22.8 at 10:30.
- **Extended family ~20 people**, 5 families: Solomon (2 parents + girls 7, 10) · grandparents · family (2 + baby 1.5) · family (2 + girls 6, 3, 1) · family (2 + girls 8, 12, 14, 17).
- **Lodging:** villa in Durrës (everyone), checkout 19.8 · hotel in Ksamil, checkout 21.8 · **night of 21.8 not yet booked** — recommendation: near the airport (Rinas).
- **Car (Solomon):** OK Mobility, Hyundai Venue (Compact, 5 seats). Whole family needs 4–5 cars.
- **Events:** grandma's birthday (14.8, Friday dinner) · Daniel's birthday (18.8) · combined anniversaries party + adults-only quiz 🔞.
- **Gluten:** some family members are sensitive — every restaurant recommendation must address gluten (dedicated `food` view).

## Day-by-day skeleton

| Date | Day | Plan |
|---|---|---|
| 13.8 | Thu | Landing 22:25 |
| 14.8 | Fri | Tirana + shopping · grandma's birthday dinner |
| 15.8 | Sat | Mt. Dajti (cable car) |
| 16.8 | Sun | Lake Shkodra / nearer alternative (Kruja, water park) |
| 17.8 | Mon | Berat |
| 18.8 | Tue | Lake Bovilla · Daniel's birthday evening |
| 19.8 | Wed | Drive south Durrës→Ksamil (full travel day) |
| 20.8 | Thu | Ksamil: Butrint + beaches + Lëkurësi |
| 21.8 | Fri | North (Blue Eye + Gjirokastër optional) → sleep near airport |
| 22.8 | Sat | Flight 10:30 |

## Open questions (as of June 2026)

1. Is the Durrës villa booked from 13.8 or 14.8? (affects the first night)
2. Budget for the last night's lodging and restaurants.
3. Driving appetite — shorten/drop Shkodra?
4. How many cars does the whole family actually have?
5. "Adults-only" folklore evening — who stays with the kids?
6. Night of 21.8 — not booked (candidates: Airport Garden 4.7 / Hotel Airport Tirana 4.4 / Airport Holiday 4.3).

## Content principles (from the research)

- Don't cram Berat + folklore evening into one day — split them.
- A "lazy day at the villa" is a legitimate option.
- No ~4-hour drive on flight morning — on 21.8 go north and sleep near the airport.
- Ksamil in August: parking nearly impossible after 09:00.
- Swimming at the Blue Eye is forbidden (~10°C).
- Cash is king — many attractions are cash-only.
- Every attraction is tagged by group so the family can split up on no-consensus days.
