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
├── map.html               ← 46 verified pins + the restaurants, one Leaflet/OSM map
├── restaurants.json       ← ★ read by BOTH index.html and map.html
├── sw.js                  ← thin SW stub: V + TILES + CORE, then imports ../sw-core.js
│                            **Bump `V` on every content change — and on every sw-core.js change**
├── check-links.py         ← `python3 check-links.py` — the structural test, see below
├── manifest.webmanifest   ← PWA manifest (installable, RTL, Hebrew)
├── icons/                 ← generated from the 🇮🇹 emoji, same method as Albania's
├── vendor/                ← leaflet 1.9.4, copied byte-identical from trips/albania-2026/vendor/
├── assets/                ← the hero + the three airport images · CREDITS.md
├── research-gemini.md     ← raw Gemini report (source doc)
└── research-chatgpt.md    ← raw ChatGPT report (source doc)
```

Root: `italy-2026.html` is a redirect stub — keep it. `.claude/launch.json` has an `italy` entry
on port 8812.

**URLs:** page `https://liorsol.github.io/liorsol/trips/italy-2026/` · map `.../map.html`

`research-chatgpt.md` hotlinks ~50 `images.openai.com` URLs that will rot. Left verbatim on
purpose — it is a source document, not content, and the same convention as Albania's
`research-gemini.md`.

## `check-links.py` — run it after touching index.html, map.html or restaurants.json

Every failure it catches is **silent**. A `#map/p:` link whose pin does not exist simply does
nothing when tapped; a pin whose `v` is stale opens a blank view; a `data-topic` that is not a
real view name writes to a DB path the rules reject with a 401. Eleven checks: view names against
the DB rules' `/^[a-z]{2,12}$/`, card→pin and pin→card both ways, every internal `#hash`, every
`data-view`, every card having an `id` *and* an `.anchor`, a comment board on every non-map view,
and the restaurant ids/coordinates. Mutation-checked — a broken pin link and a removed board were
both confirmed to fail it.

Current state: **47 cards, 10 views, 9 boards, 60 map pins (46 hard-coded + 14 restaurants), all cross-links resolve.**

The other check is `node ../sw-core.test.js`, which covers both trips' workers — see the
[root README](../../README.md#the-trip-pages-tripsalbania-2026-tripsitaly-2026).

## Dynamic data (Firebase) — `italy2026`, live since Sep 2026

The page uses the reserved key **`italy2026`**. The complete rules document — `albania2026`'s
block duplicated under the new name — is in the
[README](../../README.md#firebase-realtime-database-dynamic-data-sync), and **the user published
it on 5 Sep 2026.**

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
- **The hero photo is bundled, not hotlinked** (`assets/hero-umbria.jpg`, Deruta across the Tiber
  valley, CC BY-SA 4.0). Albania hotlinks its hero; here the image is in the SW's `CORE`, so it
  survives offline. The gradient is still the last background layer if it ever 404s.
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
   look, and it is on the diagram as a `P` marker for exactly that reason.
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

`assets/CREDITS.md` has the licences. Three airport images, all in the SW's `CORE` rather than
lazy — this is a picture you look at while standing in FCO at 02:00 with a dead eSIM, the one
moment on this trip when "it will load" is the wrong assumption. ~748 KB of assets total.

- **`fco-t3-shuttle.svg` — authored here, not a crop.** ADR's terminal maps are copyrighted, so
  they were used as *sources* and the diagram was drawn from scratch. It is deliberately almost
  text-free: two floor bands, the numbered doors with 4 highlighted in both, the minivan, the
  escalator arrow, and the `P` fallback marker. The prose lives in the HTML `<ol class="steps">`
  instead. **Two bugs were found and fixed in the browser, don't reintroduce them:**
  - **In an RTL `<text>`, `text-anchor="end"` anchors the LOGICAL end — the LEFT visual edge.**
    Anchoring the Hebrew band titles at `x=852` with `end` pushed them clean off the right of the
    canvas. For RTL text whose *right* edge should sit at `x`, the anchor is **`start`**.
  - The frontage `<rect>` originally ran the full width, so the strip left of door 7 read as an
    unlabelled eighth door. It now hugs the doors.
  - The caption says the diagram is schematic — door *counts* and the escalator position are
    sourced, the *spacing* is not. Keep that sentence; it is what makes the drawing honest.
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

1. **Does the minivan seat nine?** The room booking for 8 is settled and correct (see Trip data);
   the vehicle is the part that does not follow from it. One phone call.
2. **Which rental company, and what does the contract say about a 02:30 return?** Everything about
   the last night hangs on it: whether an out-of-hours return is permitted at all, whether there is
   a fee, which Multipiano to drive to, and where that company's key box is. Also: **are both
   drivers on the contract?** A second driver is cheap from home and expensive at the desk.
3. **Is the Deruta booking actually made**, and **is the pool open and heated in late September?**
   Half the "come back in the afternoon" logic depends on the pool. Also ask for the quiet hours
   and, if possible, a later check-out on 29.9 — two extra hours that morning is worth more than
   any attraction added to the last day.
4. **The day-use room for 29.9** is not booked. It is the load-bearing piece of the last day.
5. **Advance bookings not yet made:** the Deruta ceramics workshop · the rope park and Nera
   rafting (**and the minimum age/height for the 3-year-old, asked with the real ages, not "is it
   suitable for children"**) · Perugina's allergen answer · Orvieto Underground's English tour
   times.

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
