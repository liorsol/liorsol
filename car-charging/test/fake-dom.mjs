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
        if (kid.tagName === '#fragment') self.children.push(...kid.children);
        else self.children.push(kid);
      }
    },
    appendChild(kid) {
      self.append(kid);
      return kid;
    },
    remove() {
      self.removed = true;
    },
    replaceChildren(...kids) {
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

  globalThis.document = {
    createElement: node,
    createDocumentFragment: () => node('#fragment'),
    createTextNode: (value) => {
      const n = node('#text');
      n.textContent = String(value);
      return n;
    },
    getElementById: (id) => get('#' + id),
    querySelector: (sel) => get(sel, sel === '#refresh' ? 'button' : 'div'),
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

  return { get, registry, navigate };
}
