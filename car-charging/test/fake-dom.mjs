// A DOM small enough to read in one sitting.
//
// Everything the page's modules actually touch and nothing else, so a view or the shell itself
// can be RENDERED in `node --test` and asserted on. The alternative is a grep over source text,
// and a grep cannot tell which row a handler picked or which of two strings a panel painted --
// which is exactly the class of defect these tests exist for.
//
// Not a browser: no layout, no CSS, no event dispatch. Handlers are recorded so a test can call
// one directly, which is a click for every purpose that matters here. Anything this file cannot
// answer honestly belongs in the browser pass, not in a stub that fakes an answer.

function adopt(parent, kid) {
  parent.children.push(kid);
  kid.parentNode = parent;
  kid.attached = true;
}

function detach(kid) {
  const parent = kid.parentNode;
  if (!parent) return;
  const at = parent.children.indexOf(kid);
  if (at >= 0) parent.children.splice(at, 1);
  kid.parentNode = null;
}

export function node(tag) {
  // `classes` and `attrs` are kept SEPARATE from `className`, which stays the thing the
  // querySelector stubs below match on. A view's static class ("panel__body") is written once
  // through `className`; a state class ("is-active", "is-busy") only ever arrives through
  // classList, and the router's state is the only reason either is readable at all. Merging
  // the two would change what querySelector finds mid-test, which is not what any of these
  // tests is about.
  const classes = new Set();
  const attrs = {};
  const self = {
    tagName: tag,
    children: [],
    // Parentage, because three things need it and none of them can be faked around:
    //   · `replaceWith` is a swap INSIDE a parent, and the SVG theme replaces the tariff band
    //     with a dial that way. Without it that theme could not be exercised here at all;
    //   · a detached node is one `document.getElementById` returns null for, which is the
    //     signed-out hash change app.js used to throw on;
    //   · `remove()` on a node that is still in a list has to leave the list.
    parentNode: null,
    // "has been in a tree at some point". A node that was never appended anywhere is not
    // detached, it is simply free-standing — a distinction getElementById below depends on.
    attached: false,
    className: '',
    textContent: '',
    disabled: false,
    hidden: false,
    value: '',
    dataset: {},
    handlers: {},
    classes,
    attrs,
    style: { setProperty() {} },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => (on ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
    getAttribute(name) {
      return name in attrs ? attrs[name] : null;
    },
    removeAttribute(name) {
      delete attrs[name];
    },
    querySelector: (sel) => all(self).find((n) => n.className.split(' ').includes(sel.replace('.', ''))) || null,
    querySelectorAll: (sel) => all(self).filter((n) => n.className.split(' ').includes(sel.replace('.', ''))),
    matches: () => false,
    addEventListener(type, fn) {
      self.handlers[type] = fn;
    },
    append(...kids) {
      for (const kid of kids) {
        if (kid.tagName === '#fragment') for (const grandkid of kid.children) adopt(self, grandkid);
        else adopt(self, kid);
      }
    },
    appendChild(kid) {
      self.append(kid);
      return kid;
    },
    remove() {
      self.removed = true;
      detach(self);
    },
    // The browser's own: swap this node for the given ones, in place, inside its parent. A node
    // with no parent has nothing to be replaced in and the call is a no-op rather than a throw.
    replaceWith(...kids) {
      const parent = self.parentNode;
      if (!parent) return;
      const at = parent.children.indexOf(self);
      if (at < 0) return;
      parent.children.splice(at, 1, ...kids);
      self.parentNode = null;
      for (const kid of kids) {
        kid.parentNode = parent;
        kid.attached = true;
      }
    },
    replaceChildren(...kids) {
      for (const old of self.children) if (old.parentNode === self) old.parentNode = null;
      self.children = [];
      self.append(...kids);
    },
    get firstChild() {
      return self.children[0] || null;
    },
    get childNodes() {
      return self.children;
    },
  };
  return self;
}

/** Every descendant, depth first. */
export function all(el) {
  return el.children.flatMap((child) => [child, ...all(child)]);
}

/** All text in the subtree, joined — what a reader would see, minus the layout. */
export const text = (el) => all(el).map((n) => n.textContent).filter(Boolean).join(' ');

/** A button by its label. */
export const button = (el, label) =>
  all(el).find((n) => n.tagName === 'button' && n.textContent === label);

/** Everything painted with one class. */
export const byClass = (el, className) => all(el).filter((n) => n.className === className);

/**
 * Install a document that serves the given ids and selectors, each a node created on demand
 * and kept, so `getElementById('tariff')` twice is the same element the page kept too.
 */
export function installDocument() {
  const registry = new Map();
  const get = (key, tag) => {
    if (!registry.has(key)) registry.set(key, node(tag || 'div'));
    return registry.get(key);
  };

  // <head> and <html>. theme.js appends one <link> per theme it has ever worn and stamps the
  // chosen slug on `documentElement.dataset.theme`, so both have to be real nodes a test can
  // count children on -- that count IS the assertion that a switch reuses a sheet instead of
  // refetching one.
  const head = node('head');
  const documentElement = node('html');

  globalThis.document = {
    createElement: node,
    // Namespaced creation, for the one theme that draws in SVG. The namespace is recorded and
    // otherwise ignored: nothing here lays out or paints, and what the tests need to read off an
    // SVG node is its tag, its attributes and its text. Note that a real SVG element's
    // `className` is a read-only SVGAnimatedString, which is why that theme sets `class` through
    // setAttribute — so these nodes carry it in `attrs`, not in `className`.
    createElementNS: (ns, tag) => {
      const created = node(tag);
      created.namespaceURI = ns;
      return created;
    },
    createDocumentFragment: () => node('#fragment'),
    createTextNode: (value) => {
      const n = node('#text');
      n.textContent = String(value);
      return n;
    },
    head,
    documentElement,
    // A node that has been taken OUT of the tree is not one this can find, exactly as in a
    // browser. That is not a detail: signed out cold, app.js detaches all seven `.view` sections
    // from <main>, and any hash change then asks for one of them by id -- a bookmarked
    // `#/history`, a Back press. It used to get an element here and null in the product, which
    // is how an uncaught TypeError shipped. A node that was never in a tree at all is a
    // different thing and is still served: that is just a registry entry the markup would have.
    getElementById: (id) => {
      const found = registry.get('#' + id);
      if (found && found.attached && found.parentNode === null) return null;
      return found || get('#' + id);
    },
    querySelector: (sel) => get(sel, sel === '#refresh' ? 'button' : 'div'),
    // Only theme.js calls this, and only to adopt the `classic` <link> the real markup ships.
    // There is no markup here, so it finds none and theme.js creates its own -- which is the
    // same code path a second theme takes and is therefore the one worth exercising.
    querySelectorAll: () => [],
  };

  get('#refresh', 'button');
  get('#navtoggle', 'button');

  // <main>, the four `.view` sections inside it, and the five panels nested inside those, in
  // the markup's nesting and order. The shell detaches and reattaches the VIEWS as a set when
  // it puts the sign-in card up on a cold signed-out load, and it hands the view modules the
  // panel bodies nested two deep -- so a stub whose <main> has no children cannot show the
  // thing that matters, which is that the sections come back with their subtrees intact.
  const main = get('.shell__main');
  const LAYOUT = {
    status: ['tariff', 'controls'],
    history: ['history'],
    invoices: ['account'],
    comments: ['comments'],
    sessions: ['sessions'],
    contact: ['contact'],
  };
  for (const [view, ids] of Object.entries(LAYOUT)) {
    const section = get('#view-' + view, 'section');
    section.className = 'view';
    for (const id of ids) {
      const panel = node('section');
      panel.className = 'panel';
      const body = get('#' + id);
      body.className = 'panel__body';
      panel.append(body);
      section.append(panel);
    }
    main.append(section);
    get('#nav-' + view, 'a');
  }

  // The header's two spans live inside `.updated` in the real markup.
  const updated = get('.updated');
  const abs = node('span');
  abs.className = 'updated__abs';
  const age = node('span');
  age.className = 'updated__age';
  updated.append(abs, age);

  // ── the hash router's two globals ──
  //
  // The menu is plain `<a href="#name">`, so the browser is the router: a press changes
  // location.hash and fires hashchange, and app.js only listens. `navigate()` below is that
  // pair, which is a menu press for every purpose these tests care about -- including the
  // one they exist for, which is that a press makes no request.
  const listeners = {};
  globalThis.location = { hash: '' };
  globalThis.window = {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    scrollTo() {},
  };

  const navigate = (hash) => {
    globalThis.location.hash = hash;
    listeners.hashchange?.();
  };

  return { get, registry, navigate, head, documentElement };
}

/**
 * A localStorage stand-in. `mode` is 'ok' (a working store), 'absent' (no global at all, which
 * is what a `node --test` process has by default) or 'hostile' (every access THROWS, which is
 * what a private window and a browser set to block site data actually do -- the throw is on the
 * property access, not on the call, so a guard has to wrap the whole expression).
 */
export function installStorage(mode) {
  if (mode === 'absent') {
    delete globalThis.localStorage;
    return null;
  }
  if (mode === 'hostile') {
    globalThis.localStorage = {
      get getItem() { throw new DOMException('blocked', 'SecurityError'); },
      get setItem() { throw new DOMException('blocked', 'SecurityError'); },
    };
    return null;
  }
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  return store;
}
