#!/usr/bin/env python3
"""python3 check-links.py  —  the page's only structural test.

Every failure this catches is a SILENT one: a `#map/p:` link whose pin does not
exist just does nothing when tapped, a pin whose `v` is stale opens a blank view,
and a comment board whose `data-topic` is not a real view name writes to a DB path
the published rules reject with a 401. None of them look broken on screen.

Run it after touching index.html, map.html or restaurants.json.
"""
import re, json, sys, urllib.parse, pathlib

here = pathlib.Path(__file__).parent
idx  = (here / 'index.html').read_text(encoding='utf-8')
mp   = (here / 'map.html').read_text(encoding='utf-8')
rest = json.loads((here / 'restaurants.json').read_text(encoding='utf-8'))

views = set(re.findall(r'id="view-([a-z]+)"', idx))
ids   = set(re.findall(r'\sid="([A-Za-z0-9_-]+)"', idx))
fails = []

def check(label, bad, extra=''):
    print(f'{label:<34} {"✅" if not bad else "❌ " + str(sorted(bad))}{extra}')
    if bad: fails.append(label)

# The DB rules validate $view against /^[a-z]{2,12}$/ server-side, so a view named
# with a digit or a dash gets a 401 on every comment rather than a review comment.
check('view names match the DB rules', [v for v in views if not re.fullmatch(r'[a-z]{2,12}', v)],
      f'   ({len(views)} views)')

pin_q = set(re.findall(r"q:'([^']+)'", mp)) | {r['id'] for r in rest}
pin_v = set(re.findall(r"v:'([^']+)'", mp)) | {r.get('view', 'food/restaurants') for r in rest}

page_q = {urllib.parse.unquote(m) for m in re.findall(r'#map/p:([^"\']+)', idx)}
check('card → pin  (#map/p:Q)', page_q - pin_q, f'   ({len(page_q)} links)')

check('pin → card  (pin v)',
      [v for v in pin_v
       if v.split('/')[0] not in views
       or (len(v.split('/')) > 1 and v.split('/')[1] not in ids)],
      f'   ({len(pin_v)} targets)')

hrefs = set(re.findall(r'href="#([^"]+)"', idx))
check('internal #hash links',
      [h for h in hrefs if not h.startswith('map')
       and ((h.split('/')[0] in views and len(h.split('/')) > 1 and h.split('/')[1] not in ids)
            or (h.split('/')[0] not in views and h.split('/')[0] not in ids))],
      f'   ({len(hrefs)} links)')

check('data-view targets', set(re.findall(r'data-view="([a-z]+)"', idx)) - views)

# A card with no id and no .anchor is the only unlinkable thing on a page whose
# whole point is that every card is addressable.
cards  = re.findall(r'<div class="card"([^>]*)>(.{0,400})', idx, re.S)
check('every card has an id', [c[0][:40] for c in cards if 'id="' not in c[0]], f'   ({len(cards)} cards)')
check('every card has an .anchor',
      [re.search(r'id="([^"]+)"', a).group(1) for a, b in cards
       if 'id="' in a and 'class="anchor"' not in b])

topics = re.findall(r'class="talk" data-topic="([a-z]+)"', idx)
check('a board on every non-map view', views - set(topics) - {'map'}, f'   ({len(topics)} boards)')
check('every board topic is its view', set(topics) - views)

ids_json = [r['id'] for r in rest]
check('restaurant ids unique', {i for i in ids_json if ids_json.count(i) > 1}, f'   ({len(rest)} entries)')
check('restaurant coordinates sane',
      [r['id'] for r in rest if not (35 < r['lat'] < 48 and 6 < r['lng'] < 20)])

print('\n' + ('❌ ' + str(len(fails)) + ' check(s) failed' if fails else '✅ all structural checks passed'))
sys.exit(1 if fails else 0)
