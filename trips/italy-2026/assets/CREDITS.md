# Media credits

The two airport photos and the hero still are **bundled** rather than hotlinked,
because the service worker precaches them: the airport board is a picture you look at
while standing in FCO at 02:00, which is exactly when a hotlink is least likely to load.

| File | Source | Author | Licence |
|---|---|---|---|
| `hero-umbria.jpg` | [File:DerutaPanorama2.jpg](https://commons.wikimedia.org/wiki/File:DerutaPanorama2.jpg) — Deruta seen across the Tiber valley, the trip's base town | LigaDue | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `hero-umbria.mp4` | Supplied by the site owner (Sep 2026) — a generated drone-style pull-back over an Umbrian hill town | — | owner-supplied, no third-party rights claimed |
| `fco-t3-arrivals-board.jpg` | [File:Terminal 3 Map in Fiumicino Airport.01.jpg](https://commons.wikimedia.org/wiki/File:Terminal_3_Map_in_Fiumicino_Airport.01.jpg) — the ADR wayfinding board on T3 **arrivals**, ground level | CAPTAIN RAJU | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |

The two Commons photos are downscaled and re-encoded (quality 72/80, progressive) from
the originals; no other edit. CC BY-SA requires attribution and share-alike, which the
page footer carries — **keep it there if you touch the footer.**

`hero-umbria.mp4` was re-encoded from the supplied 10 s / 10.4 MB clip: half the frames
(24 → 12 fps), no audio track, CRF 31, and the forward pass followed by its own reverse
so it turns around instead of cutting. 1280×720, 238 frames, 19.8 s, 2.1 MB. The exact
command is in [`CLAUDE.md`](../CLAUDE.md#the-hero-clip).

## The 51 day-card shots — in the assets repo (Sep 2026)

They live at **`liorsol.github.io/assets/italy-2026/prev/`**
([liorsol/assets](https://github.com/liorsol/assets)), not in this folder. That repo is
published by GitHub Pages on the same host as this site, so they are **same-origin** in
production and the service worker precaches them like any local file — the README there
records what each of Releases, LFS, Cloudflare Pages and R2 broke, all measured.

The 8 day-card strips in `#days` were hotlinked from `images.openai.com` until Sep 2026,
when they were pulled down and re-encoded. Named `<card>-<n>.webp` after the card
they belong to (`orvieto-1` … `rest-9`), re-encoded from the originals: `-auto-orient`,
longest side fitted to **1100×825 (shrink only — nine were already smaller and were left
alone)**, EXIF stripped, WebP quality 76. 21 MB → **5.1 MB**. At the size the strip actually
renders them (max 940 CSS px, `object-fit:cover` on a 16:7 box) this is indistinguishable
from the originals; it was checked side by side before the quality was chosen.

They are listed in **`EXTRA`, not `CORE`** — see the comment in [`sw.js`](../sw.js).

`hero-umbria.mp4` moved there too. The two FCO photos and `hero-umbria.jpg` did **not**: they
are in the strict `CORE` precache, and the airport board is the picture you look at standing in
Fiumicino at 02:00 with no data. They stay in this folder, on this origin.

> **⚠️ Provenance is not established, and this is the weak point.** They came out of a
> ChatGPT research report, not from a named source, so there is no licence for any of
> them. Hosting a copy in a public repo is a bigger claim than hotlinking was. Two carry
> a photographer's mark burnt into the frame — **`trasimeno-2` ("Photo Minoletti Cesare")**
> and **`trasimeno-3` ("©Allarremviaggio")** — which makes them identifiable work by named
> photographers, and they are the two to drop first if this is ever challenged. Others
> appear to be generated rather than photographed (`marmore-3` has butterflies composited
> over the falls), so the strip is **illustrative, not documentary** — do not treat a shot
> as evidence of what a place looks like. The marks were left visible on purpose: cropping
> a credit out would be worse than showing it.

## Hotlinked, not bundled — and why

One thing on the page still loads from someone else's server, which means it does **not**
work offline and can break without warning:

| Where | What | Why not bundled |
|---|---|---|
| The arrival card in `#arrival` | the published Terminal 3 map | `ontheworldmap.com` publishes it under its own copyright — bundling it would redistribute it from this repo. The caption tells the family to screenshot it before the flight, since it will not be there at 02:00 with no signal. |

If it becomes a problem, the fix is the same one the day-card shots already took: put the
file in this folder, add it to `sw.js` (`CORE` if the offline page depends on it, `EXTRA`
if it is decorative), credit it in the table above, and bump `V`.
