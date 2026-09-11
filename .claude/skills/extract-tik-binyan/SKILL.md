---
name: extract-tik-binyan
description: Download a full building-permit file (תיק בניין) — including the approved, stamped permit plans (גרמושקה) — from an Israeli municipality's Complot engineering site (`<city>.complot.co.il`). Use when asked to fetch a building file, permit plans, Form 4, or a "גרמושקה מאושרת" for a specific address in a city running the Complot/xpa engineering portal. Also trigger on Hebrew requests using phrases like תיק בניין, גרמושקה, גרמושקה מאושרת, היתר בניה, תוכנית היתר, טופס 4, or "תוריד לי את תיק הבניין" for an address, even without the word "Complot" — most Israeli municipal engineering sites run this same platform.
---

# Extract תיק בניין (building permit file) from a Complot municipal site

## בעברית (Hebrew)

המשימה הזו — משיכת **תיק בניין** מלא, כולל ה**גרמושקה המאושרת** (תוכניות
ההיתר החתומות בחותמת הוועדה, לא רק טופס ההיתר), מאתר הנדסי עירוני שרץ על
פלטפורמת קומפלוט (`<עיר>.complot.co.il`). זה מתאים גם כשלא כתוב "קומפלוט"
במפורש — רוב האתרים ההנדסיים העירוניים בישראל (יבנה ועוד) רצים על אותה
פלטפורמה, מזוהה לפי מבנה ה-URL וכתובת ה-backend
`handasi.complot.co.il/magicscripts/mgrqispi.dll`.

תהליך העבודה (ר' פירוט מלא באנגלית בהמשך הקובץ ובקבצי ה-references):
1. גילוי ה-endpoints של השרת עם דפדפן אמיתי (Playwright) פעם אחת.
2. משיכת כל המסמכים עם `curl` פשוט, פענוח הפניית ה-`ShowPhoto`, ווידוא
   שהתקבלה הגרמושקה המאושרת (מרובת עמודים, גיליונות ענק) ולא רק טופס ההיתר
   בן 1-2 העמודים.

מונחים מרכזיים: **תיק בניין** = building file, **גוש/חלקה/מגרש** = the parcel
identifiers, **בקשה להיתר** = permit request, **גרמושקה** = the plan set
(garmushka), **חותמת הוועדה** = the committee's approval stamp — בלי חותמת
זה תשריט להגשה, לא היתר מאושר.

כשהבקשה של המשתמש הגיעה בעברית, כתוב את הדוח/README הסופי בעברית (עם שמות
השדות הטכניים כפי שהם מופיעים באתר — גוש, חלקה, מגרש, מספר תיק, מספר היתר
וכו'), כדי שיהיה תואם למקור ולקריאה נוחה למשתמש.

## What this is

Many Israeli municipalities (Yavne, and others) run their public engineering
portal on the Complot/xpa platform: `https://<city>.complot.co.il/`. It's an
old ASP.NET-ish site glued onto WordPress, with the actual data served from a
separate backend host `https://handasi.complot.co.il/` via a CGI dispatcher
(`magicscripts/mgrqispi.dll`) and a `.asmx` web service for autocomplete. The
public-facing page is JS-rendered (hash routing, `$.getScript` injected
fragments) so plain `curl` on the page URL gets you nothing — but once you
know the backend endpoints, plain `curl` works great for the actual downloads.

## Workflow

1. **Discover the backend endpoints** with a real browser (Playwright) once,
   by watching network traffic while clicking through the site's own
   building-file search. See [references/discovery.md](references/discovery.md)
   for the exact script, the endpoint table (search, tik detail, per-request
   document list, etc.), and platform-specific gotchas.
2. **Pull every document** with plain `curl` against those endpoints, resolve
   the `ShowPhoto` JS-redirect trick to get the real PDF URLs, and verify you
   actually got the *approved, stamped* plan set and not just the 1-2 page
   permit form. See
   [references/download-and-verify.md](references/download-and-verify.md)
   for the curl recipes, rate-limiting etiquette, the approval-stamp check
   (page count / page size / committee stamp crop), and the report format.

Read both reference files before starting — the discovery step's output
(endpoint URLs, tik/request numbers) feeds directly into the download step.

## Key things to keep in mind throughout

- No auth/session/CSRF was needed for Yavne's public read-only lookups. If a
  target city's portal instead demands login or shows a captcha, stop and
  tell the user — don't try to work around it.
- Be a polite single requester: one request at a time, ~1.5s delay between
  downloads, no parallelism against a small municipal server.
- The bare permit/Form 4 PDF (1-2 pages) is not the plan set — the plan set
  is the multi-page, huge-page-size ("תוכנית היתר"/"תכנית היתר") document.
  Don't stop at the first PDF you find.
- Cross-check gush/helka against a second source (municipal GIS or govmap)
  before trusting a single tik number — addresses in new neighborhoods can
  map to more than one legacy parcel.
