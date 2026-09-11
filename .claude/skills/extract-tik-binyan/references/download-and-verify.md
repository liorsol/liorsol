# Downloading and verifying the permit set

Assumes you already have the endpoint list from `discovery.md`.

## Step 2 — pull the tik and every request's document list

```bash
B="https://handasi.complot.co.il/magicscripts/mgrqispi.dll?appname=cixpa&prgname="
SITE=87
curl -s "${B}GetTikFile&siteid=$SITE&t=$TIK&arguments=siteid,t" -o "raw/tik_$TIK.html"
# parse out request numbers (javascript:getRequest(NNNN) links), then:
for r in $REQUEST_NUMBERS; do
  curl -s "${B}GetBakashaDocs&siteid=$SITE&b=$r&arguments=siteid,b" -o "raw/bakashadocs_$r.html"
  sleep 1.5   # be a polite single requester, no parallel hammering
done
curl -s "${B}GetTikDocs&siteid=$SITE&t=$TIK&arguments=siteid,t" -o "raw/tikdocs_$TIK.html"
```

Each result HTML has rows like:

```html
<td>תוכנית היתר</td><td>תכנית היתר</td><td>21/01/2021</td>
<a onclick="disableDocButton(this)" href="javascript:showArchiveFile(2,20090053,0,7)">...
```

or sometimes a direct absolute link straight to
`https://archive.gis-net.co.il/Yavne/Pirsumim/...pdf` (skip the ShowPhoto hop
for those). Parse with a small regex/BeautifulSoup pass pairing each `<tr>`'s
visible cells (document name / subject / date) with either:

- a direct `https://archive.gis-net.co.il/...` URL, or
- a `showArchiveFile(ec, en, bn, m)` call → build
  `${B}ShowPhoto&siteid=$SITE&ec=$ec&en=$en&bn=$bn&m=$m&arguments=siteid,ec,en,bn,m`

## Step 3 — resolve ShowPhoto redirects and download

`ShowPhoto` doesn't redirect via HTTP — it returns an HTML page with
`window.location.href = "<real archive URL>"` (a UX nicety for browsers,
useless for curl). Fetch it, regex out that URL, then `curl -sL` the real
one:

```bash
python3 - <<'EOF'
import re, subprocess, time
html = open('raw/showphoto_resp.html', encoding='utf-8').read()
real_url = re.search(r'window\.location\.href\s*=\s*"([^"]+)"', html).group(1)
subprocess.run(['curl','-sL','--max-time','300','-o','raw/out.pdf', real_url])
time.sleep(1.5)
EOF
```

Real archive URLs look like `https://archive.gis-net.co.il/Yavne/files/srika_binyan/<dir>/<tik>/<num>.pdf`
or `.../m9/archiv/IB/<n>/<num>.PDF` — these are the actual scanned permit
plan sheets, often 20-50 MB (they're huge-format architectural sheets scanned
at high res, sometimes 8000+ pt wide).

Some rows 404 with a small (~350 byte) "לא ניתן למצוא את המסמך המבוקש" HTML
page instead of a PDF — check `content-type`/file size after download and
flag those as "not found" rather than silently treating them as data.

**Rate limiting**: this is a small municipal server. One request at a time,
~1.5s delay between downloads, no parallelism. It has held up fine to
sequential single-threaded curl for ~30 files.

## Step 4 — verify you actually got the approved, stamped permit set

The bare "תוכנית היתר"/"תכנית היתר" PDF is what you want — it's the plotted
architectural sheet set (site plan, floor plans, elevations, sections),
usually 1 line item per permit request but sometimes duplicated (an older low-res
scan and a newer high-res reprint of the same sheets — keep both, page counts
should match, prefer the larger file size / more recent date as canonical).
The "היתר"/"טופס 4" documents are just the 1-2 page administrative
forms/stamps, NOT the plans — don't stop there.

Check what you got:

```bash
pdfinfo file.pdf | grep -E '^Pages|^Page size'   # multi-page, huge page size (>3000pt wide) = plan set
```

Render pages to check for the committee's approval stamp
(חוק התכנון והבניה / ועדה מקומית לתכנון ובניה, with the plan number, meeting
number, date, and signatures of "מזכיר הועדה" and "מהנדס הועדה"):

```bash
pdftoppm -r 12 -png file.pdf overview   # cheap low-res whole-page overview first
# then zoom the corner where the stamp usually sits, at high res:
pdftoppm -r 200 -f 1 -l 1 -x <crop_x> -y <crop_y> -W <w> -H <h> -png file.pdf stamp_crop
```

A page without that stamp is an unapproved submission sketch, not an approved
permit — flag it explicitly rather than presenting it as the final approved
set. Ink/signature detection can be automated (rough heuristic): load the PNG
with PIL/numpy, flag cells where blue/purple channel exceeds red+green by a
margin — signatures and rubber-stamp ink are typically blue or purple against
a black-line drawing.

Cross-check the gush/helka/מגרש reported in `GetTikFile` against a second
independent source (municipal GIS at `https://v5.gis-net.co.il/v5/<city>`, or
`govmap.gov.il`) before trusting a single tik number — new-neighborhood
addresses sometimes map to more than one legacy gush/helka, and a street
number can appear across more than one tik (e.g. a shared building envelope
serving addresses on both sides).

## Step 5 — report format

For the calling task, produce:
- `report/README.md`: gush/helka/מגרש, tik number(s), a table of every
  request (number, date, applicant, permit number/date), a table of every
  file downloaded (source, page count, what's inside), and an explicit
  approval-stamp checklist per required sheet type (site plan, floor plans
  per level, roof, 4 elevations, ≥2 sections, מקלט/ממ"ד detail, signatures).
  State plainly what's missing and why (not scanned / needs login / error).
- Merge only the approved, stamped sheets into one deliverable PDF; keep raw
  downloads until the user confirms they're done with them, then delete —
  these are 20-40MB scans per sheet and add up fast (a single Tik can be
  300+ MB).
