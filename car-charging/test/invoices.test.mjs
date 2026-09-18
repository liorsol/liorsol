// Run: node --test car-charging/test/invoices.test.mjs
//
// The billed-period card, and the one defect it has now shipped twice in different clothes:
// rendering a shape nobody had captured. The first version was written before any period had
// closed, against five invented field names; the private half's whitelist was inventing the same
// names, so the first real bill arrived with every field dropped and the panel rendered a row of
// em dashes. The owner reported the bill as MISSING. It had been on the screen for nine days.
//
// So these tests are not about layout. They pin the two things that failure taught:
//
//   1. the names this view reads are the names the private half sends -- asserted against a
//      fixture whose keys were copied off a live body, not off this file;
//   2. no figure on this card is arithmetic of ours. The tempting one is the total (sum the
//      sessions in the window) and it is the one that must never appear: it would print a number
//      this dashboard computed beside a status the operator issued, in the one place the owner
//      goes to find out what they were actually charged.
//
// Plus the third rule this panel carries: the invoice DOCUMENT is the operator's. The page links
// to the PDF they issued and never renders one of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDocument, all, text } from './fake-dom.mjs';

installDocument();

const { render } = await import('../views/account.js');

// Keys copied from a live `/api/invoices` body, values rounded to keep somebody's real bill out
// of a public repository. The SHAPE is the contract; the numbers are not.
const INVOICE = {
  periodId: 1000001,
  status: 'Success',
  fromDate: '2026-07-31T21:00:00',
  toDate: '2026-08-31T21:00:00',
  accountFromDate: '2026-08-01T00:00:00',
  accountToDate: '2026-09-01T00:00:00',
  paidAt: '2026-09-09T02:46:11.508',
  created: '2026-09-09T02:46:11.508',
  currency: 'ILS',
  totalIncVat: 60,
  totalExcVat: 50,
  vat: 10,
  vatRate: 18,
  feesExcVat: 20,
  energyExcVat: 30,
  publicEnergyExcVat: 0,
  discount: 0,
  energyKwh: 40,
  publicEnergyKwh: 0,
  receiptUrl: 'https://example.invalid/receipt.pdf',
  receiptNumber: 'RN-0001',
};

const CHARGER = {
  ocppConnected: true,
  connectors: [{ connectorId: 1, status: 'Available', canCharge: true, updated: '2026-09-18T11:32:35.907' }],
};

function mount(invoices) {
  const el = document.createElement('div');
  render(el, { state: { charger: CHARGER }, invoices }, { reload: () => {} });
  return el;
}

const links = (el) => all(el).filter((n) => n.tagName === 'a');

// ── the shape ───────────────────────────────────────────────────────────────

test('every figure the card shows came out of the payload under the name the payload uses', () => {
  const el = mount({ invoices: [INVOICE] });
  const painted = text(el);

  // The operator's total, exactly as sent. 50 + 20 + 10 is 80 and is what re-adding the parts
  // would print; the bill says 60 and the bill is what this panel exists to report.
  assert.match(painted, /\b60\b/, 'the operator’s own total is not on the card');
  assert.doesNotMatch(painted, /\b80\b/, 'the card re-added the parts instead of printing the total it was sent');

  assert.match(painted, /40/, 'the energy figure is missing');
  assert.match(painted, /30/, 'the energy cost is missing');
  assert.match(painted, /20/, 'the standing charge is missing -- it is why the total is not the energy cost');
  assert.match(painted, /RN-0001/, 'the operator’s document number is missing');
  assert.match(painted, /18%/, 'the VAT rate is missing');
});

test('a payload carrying none of those names renders no figures rather than a grid of dashes', () => {
  // Exactly the old, guessed shape. It must not produce a card full of em dashes again.
  const el = mount({ invoices: [{ periodId: 7, status: 'Success', fromDate: '2026-08-01T00:00:00' }] });
  const tiles = all(el).filter((n) => n.className === 'stat');
  assert.equal(tiles.length, 0, 'a row with no money in it still drew money tiles');
  // The period and the status are real and are still shown: the card degrades, it does not vanish.
  assert.match(text(el), /Success/);
});

test('nothing on this card is computed from the session list', () => {
  const source = readFileSync(new URL('../views/account.js', import.meta.url), 'utf8')
    .replace(/\/\*(?:(?!\*\/)[\s\S])*\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  // The view must never read the session array at all: that is the only raw material a
  // reconstructed total could be built from.
  assert.doesNotMatch(source, /\.sessions\b/, 'the invoice view started reading the session list');
  assert.doesNotMatch(source, /totalPaymentCost/, 'a per-session cost field reached the invoice view');
});

// ── the document ────────────────────────────────────────────────────────────

test('the invoice is a link to the operator’s PDF, opened in its own tab', () => {
  const el = mount({ invoices: [INVOICE] });
  const pdf = links(el).find((a) => a.href === INVOICE.receiptUrl);
  assert.ok(pdf, 'no link to the receipt URL the payload carried');
  assert.equal(pdf.target, '_blank', 'the PDF would replace the dashboard instead of opening beside it');
  assert.equal(pdf.rel, 'noopener noreferrer');
  assert.match(pdf.textContent, /PDF/, 'the control does not say what it opens');
});

test('a period with no document offers no button at all', () => {
  const { receiptUrl, ...noDoc } = INVOICE;       // eslint-disable-line no-unused-vars
  const el = mount({ invoices: [noDoc] });
  assert.equal(links(el).length, 0, 'a control that cannot work was rendered anyway');
  assert.match(text(el), /לא צורפה חשבונית/, 'nothing said why there is no download');
});

test('a receipt URL that is not https is refused rather than linked', () => {
  for (const bad of ['javascript:alert(1)', 'http://example.invalid/r.pdf', '', null, 42]) {
    const el = mount({ invoices: [{ ...INVOICE, receiptUrl: bad }] });
    assert.equal(links(el).length, 0, `a ${JSON.stringify(bad)} receipt URL was turned into a link`);
  }
});

test('the view never renders an invoice of its own', () => {
  const source = readFileSync(new URL('../views/account.js', import.meta.url), 'utf8');
  // No PDF generation, no blob, no data: URL, no print sheet. The document on this screen is one
  // the operator issued; anything this page produced would look official and answer to nobody.
  for (const banned of ['createObjectURL', 'Blob(', 'data:application/pdf', 'window.print']) {
    assert.ok(!source.includes(banned), `views/account.js reaches for ${banned}`);
  }
});

// ── the states around it ────────────────────────────────────────────────────

test('no closed period is a quiet empty state, not an error', () => {
  const el = mount({ invoices: [] });
  assert.equal(all(el).filter((n) => n.className === 'empty empty--error').length, 0);
  assert.match(text(el), /עדיין לא חויב דבר/);
});

test('a route that never succeeded is an error, and says refresh', () => {
  const el = mount(null);
  assert.ok(all(el).some((n) => n.className === 'empty empty--error'), 'a failed load rendered as a quiet state');
  assert.match(text(el), /רענון/);
});

test('several periods render several cards, newest first as sent', () => {
  const older = { ...INVOICE, periodId: 1000000, receiptNumber: 'RN-0000', totalIncVat: 55 };
  const el = mount({ invoices: [INVOICE, older] });
  const painted = text(el);
  assert.ok(painted.indexOf('RN-0001') < painted.indexOf('RN-0000'), 'the view reordered the operator’s list');
  assert.equal(links(el).length, 2, 'one document link per period');
});
