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

## Hotlinked, not bundled — and why

Two things on the page load from someone else's server, which means they do **not**
work offline and can break without warning:

| Where | What | Why not bundled |
|---|---|---|
| The 8 day cards in `#days` | one preview image each, from the CDN behind `research-chatgpt.md` | Signed, expiring URLs on a CDN we don't control. `trip.js` deletes the whole `<figure>` when one fails, so the card degrades to its previous layout rather than showing a broken image. |
| The arrival card in `#arrival` | the published Terminal 3 map | `ontheworldmap.com` publishes it under its own copyright — bundling it would redistribute it from this repo. The caption tells the family to screenshot it before the flight, since it will not be there at 02:00 with no signal. |

If either becomes a problem, the fix is the same: put the file in this folder, add it to
`CORE` in `sw.js`, credit it in the table above, and bump `V`.
