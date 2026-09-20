/* node edit-server.mjs [dir] [port]      — e.g. node edit-server.mjs trips/italy-2026 8814
 *
 * A static server that also makes the page's own text editable in the browser and writes
 * every edit straight back into the .html file, so the result is a normal git diff.
 *
 * How it stays a *small* diff rather than a rewritten file: the served bytes are not the
 * file. On each GET the HTML is parsed, every editable region is given a data-ed="N", and
 * the editor script is appended. The file on disk never sees either. On save the file is
 * re-parsed from scratch and only that region's inner byte range is spliced, so
 * indentation, comments and the <style> block are untouched.
 *
 * A REGION is the element that owns a run of prose — the whole callout, not the <b> inside
 * it. Anything with loose text of its own is taken whole however big it is, because
 * splitting it would leave that text with no element to edit it in; everything else is
 * descended into until a piece is small enough to be one field. Dynamic subtrees are left
 * out: trip.js writes the weather, the FX box, the flight rows, the restaurant list and the
 * comment boards into the DOM after load, and a region containing one would save trip.js's
 * output into the file.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

export { parse, regions, skipped, hash, norm };

const ROOT = resolve(process.argv[2] || 'trips/italy-2026');
const PORT = Number(process.argv[3] || 8814);
/* Below this, a container is one field. Above it, we look inside for smaller pieces —
   unless it owns loose text, which outranks the limit. */
const LIMIT = 600;

/* --- the parser ------------------------------------------------------------
   Just enough HTML to find element boundaries by byte offset. The one input it has
   to survive is this repo's own: a <link href="data:image/svg+xml,<svg ...>"> in the
   head, which is why attribute values are matched quote-aware rather than [^>]*. */
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/([a-zA-Z][-\w]*)[^>]*>|<([a-zA-Z][-\w]*)((?:'[^']*'|"[^"]*"|[^>'"])*)>/g;
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'textarea']);

/* Not editable and not looked inside. nav is the side rail — left alone so it keeps
   navigating while the rest of the page is being edited. The rest is everything trip.js
   generates: its content is not in the file, so writing it back would put it there. */
const SKIP_TAG = new Set(['head', 'nav', 'script', 'style', 'svg', 'template', 'video', 'iframe', 'noscript']);

/* Narrow on purpose: these name the generated BOX, not the card around it. #weather is a
   card whose heading is written in the file and whose inner wx-* boxes are not; #flighttbl
   is a table whose headers are in the file and whose .fstat cells are not. Skipping the
   outer element in either case would put that heading beyond editing.

   Matched as whole class/id tokens, never as substrings: `\bfstat\b` also matches
   id="fstat-src", and that is a paragraph of ordinary prose sitting under the table. */
const SKIP_NAME = new Set('talk links-board board-form prev-track rest-list fx fx-src fstat packlist'.split(' '));

/* Never a region itself, but everything inside stays editable. html/body/main are document
   scaffolding — a short page would otherwise make the whole body one field — and <figure>
   has a slide counter appended into it at runtime. */
const NEVER_REGION = new Set(['html', 'body', 'main', 'figure']);

/* Fine as a region, never *inside* one. trip.js flips <details open> when a view is shown;
   that attribute rides on the element's own opening tag, which is outside the bytes a
   region saves — so a <details> may be a field, but a field may not contain one. Without
   that distinction every collapsed note on this page lost its prose to its own <b> tags. */
const NEVER_INSIDE = new Set(['details', 'figure']);

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

function parse(html) {
  const lower = html.toLowerCase();
  const root = { tag: '#root', attrs: '', start: 0, children: [], inner: [0, html.length], outEnd: html.length };
  const stack = [root];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(html))) {
    const [, closing, opening, attrs] = m;
    if (closing) {
      const tag = closing.toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag !== tag) continue;
        while (stack.length > i) {
          const node = stack.pop();
          node.inner[1] = m.index;
          node.outEnd = m.index + m[0].length;
        }
        break;
      }
    } else if (opening) {
      const tag = opening.toLowerCase();
      const end = m.index + m[0].length;
      if (RAW.has(tag)) {                       // skip the element's text wholesale
        const close = lower.indexOf('</' + tag, end);
        TOKEN.lastIndex = close < 0 ? html.length : close;
        continue;
      }
      const node = { tag, attrs, start: m.index, openEnd: end, inner: [end, end], outEnd: end, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!VOID.has(tag) && !/\/\s*$/.test(attrs)) { node.inner[1] = html.length; stack.push(node); }
    }
  }
  return root;
}

function skipped(n) {
  if (SKIP_TAG.has(n.tag)) return true;
  const names = [/\bid="([^"]*)"/, /\bclass="([^"]*)"/].map((re) => (re.exec(n.attrs) || ['', ''])[1]).join(' ');
  return names.split(/\s+/).some((t) => t && (SKIP_NAME.has(t) || t.startsWith('wx-')));
}

/* Two things every HTML parser does that the file did not ask for: a raw & in an href comes
   back as &amp;, and bare <tr> rows come back wrapped in a <tbody> that was never written.
   Both are the same markup, so neither the round-trip check nor the write-time match may
   count them as a difference — and on the way back to disk the <tbody> is dropped again
   unless the file already used one. */
const norm = (s) => s.replace(/&amp;/g, '&').replace(/<\/?tbody\s*>/gi, '');
const asFileHadIt = (html, orig) => (/<tbody/i.test(orig) ? html : html.replace(/<\/?tbody\s*>/gi, ''));
const textIn = (html, a, b) => html.slice(a, b).replace(/<[^>]*>/g, '');

/* Text sitting directly in this element rather than inside one of its children. An element
   that has any is always taken whole: descending past it would leave that text unreachable,
   which is exactly what made <b> its own field and its sentence uneditable. */
function ownsText(node, html) {
  let at = node.inner[0];
  for (const c of node.children) {
    if (/\S/.test(textIn(html, at, c.start))) return true;
    at = c.outEnd;
  }
  return /\S/.test(textIn(html, at, node.inner[1]));
}

/* Anything generated or stateful ANYWHERE below this element. It has to be the whole
   subtree, not just the children: a small card holding a weather box two levels down is
   still a card that would write trip.js's output into the file if taken whole. */
const hazard = (n) => n.children.some((c) => skipped(c) || NEVER_INSIDE.has(c.tag) || hazard(c));

/* Document order, and non-nested: a region is never looked inside, so editing within one
   cannot change how many there are. That is what keeps N meaning the same thing between
   the GET and the save.

   Safety outranks reach: an element that owns loose text AND hides a generated subtree is
   descended into rather than taken whole, which can leave that text with no field. The
   test asserts the page has no such case; if one ever appears it fails loudly there rather
   than corrupting the file here. */
function regions(node, html, out = []) {
  for (const c of node.children) {
    if (skipped(c)) continue;
    if (!/\S/.test(textIn(html, c.inner[0], c.inner[1]))) continue;   // nothing to edit in here
    const tooBig = !ownsText(c, html) && c.inner[1] - c.inner[0] > LIMIT;
    if (NEVER_REGION.has(c.tag) || hazard(c) || tooBig) { regions(c, html, out); continue; }
    out.push(c);
  }
  return out;
}

const CLIENT = await readFile(new URL('./edit-client.js', import.meta.url), 'utf8');

function inject(html) {
  const found = regions(parse(html), html);
  let out = html;
  for (let i = found.length - 1; i >= 0; i--) {      // back to front: earlier offsets stay valid
    const r = found[i];
    const mark = ` data-ed="${i}" data-ed-h="${hash(norm(html.slice(r.inner[0], r.inner[1])))}"`;
    out = out.slice(0, r.openEnd - 1) + mark + out.slice(r.openEnd - 1);
  }
  const end = out.lastIndexOf('</body>');
  const tag = `<script>\n${CLIENT}\n</script>\n`;
  return end < 0 ? out + tag : out.slice(0, end) + tag + out.slice(end);
}

/* --- serving ---------------------------------------------------------------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.md': 'text/plain', '.py': 'text/plain' };

/* The URL path a browser asks for -> a file inside ROOT, or null if it escapes. */
function toFile(urlPath) {
  let rel = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, rel);
  return file === ROOT || file.startsWith(ROOT + sep) ? file : null;
}

const body = (req) => new Promise((ok, no) => {
  let s = ''; req.on('data', (c) => { s += c; if (s.length > 4e6) no(new Error('too big')); });
  req.on('end', () => ok(s)); req.on('error', no);
});

/* `orig` is what the browser was given for this region and has not changed. Writing is
   allowed only where the file still says exactly that, so an edit can never land on the
   wrong region — if the numbering has shifted under us, the region is looked up by its
   content instead, and a save is refused outright rather than guessed at. */
async function save({ file: urlPath, n, orig, html }) {
  const file = toFile(urlPath);
  if (!file || extname(file) !== '.html') throw new Error('not an editable file');
  const src = await readFile(file, 'utf8');
  const found = regions(parse(src), src);
  const inner = (r) => src.slice(r.inner[0], r.inner[1]);

  let target = found[n] && norm(inner(found[n])) === norm(orig) ? found[n] : null;
  if (!target) {
    const same = found.filter((r) => norm(inner(r)) === norm(orig));
    if (same.length !== 1) { const e = new Error('the page moved under this edit — reloading'); e.stale = true; throw e; }
    target = same[0];
  }
  await writeFile(file, src.slice(0, target.inner[0]) + asFileHadIt(html, orig) + src.slice(target.inner[1]));
  return file;
}

if (import.meta.main) createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/__save') {
      const file = await save(JSON.parse(await body(req)));
      console.log('saved', file.slice(ROOT.length + 1));
      return res.writeHead(204).end();
    }
    const file = toFile(req.url);
    if (!file) return res.writeHead(403).end('outside root');
    const ext = extname(file);
    const data = await readFile(file);
    /* no-store everywhere: the page ships a service worker, and a cached copy of a file
       you are editing is the one failure mode that looks like the editor being broken. */
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(ext === '.html' ? inject(data.toString('utf8')) : data);
  } catch (err) {
    const code = err.stale ? 409 : err.code === 'ENOENT' ? 404 : 500;
    console.error(code === 404 ? '404 ' + req.url : err.message || err);
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(String(err.message || err));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`editing ${ROOT}\n  http://localhost:${PORT}/`));
