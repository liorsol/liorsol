# Discovery: finding the backend endpoints

## Step 1 — reconnaissance with a real browser (Playwright)

`curl` on `https://<city>.complot.co.il/` works for the static page shell but
the search results and document links are injected via AJAX/JS. Use a real
browser once to discover the backend calls, then switch to `curl` for bulk
downloads.

```bash
mkdir -p tik-binyan-work/{raw,report}
cd tik-binyan-work
npm init -y >/dev/null && npm i playwright@latest
npx playwright install chromium
```

Write a small Playwright script that opens the building-file search page
(look for a nav link containing "איתור תיק בניין") and logs every response
whose URL matches `complot\.co\.il/ws|asmx|ashx|magicscripts|mgrqispi`:

```js
const {chromium} = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:1400,height:1200}, locale:'he-IL'});
  p.on('response', async r => {
    const u = r.url();
    if (/complot\.co\.il\/ws|asmx|ashx|magicscripts|mgrqispi/i.test(u)) {
      let t=''; try{t=await r.text()}catch{}
      let pd=''; try{pd=r.request().postData()||''}catch{}
      console.log('RESP', r.status(), r.request().method(), u, '\n POST:', pd.slice(0,300), '\n BODY:', t.slice(0,1500));
    }
  });
  await p.goto('https://<city>.complot.co.il/איתור-תיק-בניין/', {waitUntil:'networkidle'});
  await p.click('#optAddress');
  await p.fill('#BuildingStreet', '<street name>');
  await p.waitForTimeout(1200);
  await p.click('text=/^<street name>$/');   // pick the jQuery-UI autocomplete match
  await p.fill('#BuildingHouseNum', '<house number>');
  await p.click('#btnShow');
  await p.waitForTimeout(4000);
  console.log(await p.$eval('table', t => t.outerHTML));   // results table with tik numbers
  await b.close();
})();
```

This reveals the pattern for building-file search results:

```
https://handasi.complot.co.il/magicscripts/mgrqispi.dll?appname=cixpa&prgname=GetTikimByAddress&siteid=<SITE_ID>&c=<CITY_CODE>&s=<STREET_CODE>&h=<HOUSE_NUM>&l=true&arguments=siteid,c,s,h,l
```

`siteid` is per-municipality (Yavne = 87). `c` is the city code from
`GetYeshuvim`, `s` the street code from `GetStreets` (both `.asmx` calls you'll
see fire automatically when the address radio button is selected — read the
street code straight off the autocomplete's chosen value, no need to call the
web service yourself).

Repeat the click-through once (click a tik number row, click into a request
row, click "ארכיב מסמכים") while watching network traffic to discover the
rest of the `prgname=` values. All of them hang off the same dispatcher and a
shared `xpaBaseURL`/`getSiteId()` pattern — grep the site's own JS for the
full list instead of guessing:

```bash
curl -s https://handasi.complot.co.il/handasi2016/Scripts/wp/site.min.js \
  | grep -oE '\{0\}[A-Za-z]+&siteid[^"]*'
```

## Endpoint table (found this way for Yavne, siteid=87)

| prgname | args | what it returns |
|---|---|---|
| `GetTikimByAddress` | `siteid,c,s,h,l` | building-file search results table (HTML fragment) |
| `GetTikFile` | `siteid,t` | full building-file detail page: gush/helka, requests, plans, archive docs |
| `GetTikDocs` | `siteid,t` | "ארכיב מסמכים" document list for a tik |
| `GetBakashaDocs` | `siteid,b` | document list for one permit request (בקשה) — **this is where the permit + plan PDFs are** |
| `GetGilyonDrishot` / `BkDecisionLetter` | `siteid,t,m,r` | committee decision letter for a request |
| `GetHelkaZchuiot` | `siteid,g,h,op` | gush/helka rights info |
| `ShowPhoto` | `siteid,ec,en,bn,m` | redirect page to the actual scanned-document URL (see download.md) |
| `GetDocumentIFN` | `siteid,guid` | alternate document-by-guid redirect |
| `GetTabaDocs` | `siteid,n` | plan (תב"ע) documents |
| `GetPikuachDocs` | `siteid,p` | inspection (פיקוח) documents |
| `GetMeetingDocs` | `siteid,v,m` | committee meeting minutes documents |

All of these are plain `GET` to
`https://handasi.complot.co.il/magicscripts/mgrqispi.dll?appname=cixpa&prgname=<NAME>&siteid=<ID>&...&arguments=<comma-separated-arg-names>`
and return an HTML fragment — no auth, no session, no captcha (at least for
Yavne). `curl` alone is enough from here on — see `download.md`.

## Gotchas specific to this platform family

- The public site is WordPress + a legacy Complot fragment injected via
  `$.getScript`; view-source on the page itself tells you almost nothing —
  always drive it with Playwright once to catch the actual AJAX calls.
- `site.min.js` (and `Scripts/Complot/Building/*.js`) is unminified enough to
  `grep` straight out of it for every `prgname=` string and every
  `xpaBaseURL`-based function — cheaper than reverse-engineering by network
  tape alone.
- No auth/session/CSRF was needed for Yavne's public read-only lookups. If a
  target city's portal instead demands login or shows a captcha, stop and
  tell the user — don't try to work around it.
- File names on the archive host carry no semantic meaning (`05150006.pdf`) —
  always keep the document's Hebrew "name"/"subject"/"date" metadata from the
  listing page alongside the download, e.g. in the filename or a manifest
  JSON, or you'll lose track of what's what.
