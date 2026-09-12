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
  const self = {
    tagName: tag,
    children: [],
    className: '',
    textContent: '',
    disabled: false,
    value: '',
    dataset: {},
    handlers: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
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

  // <main> and the five panel sections inside it, in the markup's order. The shell detaches and
  // reattaches those sections AS A SET when it puts the sign-in card up on a cold signed-out
  // load, and it hands the views the bodies nested inside them -- so a stub whose <main> has no
  // children cannot show the thing that matters, which is that the sections come back with
  // their subtrees intact.
  const main = get('.shell__main');
  for (const id of ['tariff', 'controls', 'history', 'account', 'comments']) {
    const section = node('section');
    section.className = 'panel';
    const body = get('#' + id);
    body.className = 'panel__body';
    section.append(body);
    main.append(section);
  }

  // The header's two spans live inside `.updated` in the real markup.
  const updated = get('.updated');
  const abs = node('span');
  abs.className = 'updated__abs';
  const age = node('span');
  age.className = 'updated__age';
  updated.append(abs, age);

  return { get, registry };
}
