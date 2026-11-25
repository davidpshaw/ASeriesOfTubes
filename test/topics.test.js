// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the content in public/topics.js so a typo in a new topic fails CI
// instead of breaking the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, GROUPS } from '../public/topics.js';

const ids = Object.keys(TOPICS);
const KINDS = new Set(['p', 'e', 'x', 'l']);
const ICONS = new Set(['laptop', 'server', 'book', 'globe', 'drawers', 'doc', 'seal', 'hood', 'bank']);
// Every abbreviation must be spelled out at its first use in each topic, e.g. "Domain Name System (DNS)".
const ACRONYMS = {
  ACK: 'acknowledge', ACME: 'Automatic Certificate Management Environment', ASLR: 'address space layout randomization',
  BGP: 'Border Gateway Protocol', CA: 'Certificate Authority', CDN: 'content delivery network', CSS: 'Cascading Style Sheets',
  DNS: 'Domain Name System', DNSSEC: 'Domain Name System Security Extensions', ECH: 'Encrypted Client Hello',
  FIN: 'finish', HSTS: 'HTTP Strict Transport Security', HTML: 'Hypertext Markup Language', HTTP: 'Hypertext Transfer Protocol',
  HTTPS: 'Hypertext Transfer Protocol Secure', IP: 'Internet Protocol', ISP: 'Internet service provider',
  MITM: 'man-in-the-middle', NAT: 'network address translation', OS: 'operating system', SNI: 'Server Name Indication',
  SSH: 'Secure Shell', SSL: 'Secure Sockets Layer', SYN: 'synchronize', TCP: 'Transmission Control Protocol',
  TLD: 'top-level domain', TLS: 'Transport Layer Security', TTL: 'time to live', UDP: 'User Datagram Protocol',
  URL: 'Uniform Resource Locator', VPN: 'virtual private network',
};
const plain = (html) => html.replace(/<[^>]+>/g, '');
// The words a reader meets, in order: title, blurb, each step's title and caption, then the closing card.
const chainText = (c) => (c ? c.cards.flatMap((k) => [k.name, ...k.checks.map((x) => x[0])]) : []);
const readingText = (t) => [t.title, t.blurb, ...(t.steps ?? []).flatMap((s) => [s.t, plain(s.d), ...chainText(s.chain)]),
  ...(t.plan ?? []), ...(t.deeper ?? []).map(([, why]) => why), t.note ?? ''].join('\n');
const linksIn = (html) => [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);

test('topic ids are simple slugs', () => {
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);
});

test('every topic is in exactly one group, and groups name only real topics', () => {
  const grouped = GROUPS.flatMap(([, list]) => list);
  for (const id of grouped) assert.ok(TOPICS[id], `GROUPS lists unknown topic "${id}"`);
  for (const id of ids) {
    assert.equal(grouped.filter((g) => g === id).length, 1, `topic "${id}" must appear in exactly one group`);
  }
});

test('every topic has a title, blurb and valid "go deeper" links', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    assert.ok(t.title && t.blurb, `${id}: title and blurb are required`);
    for (const [target, why] of t.deeper ?? []) {
      assert.ok(TOPICS[target], `${id}: deeper links to unknown topic "${target}"`);
      assert.ok(why, `${id}: deeper link to "${target}" needs a reason`);
      assert.notEqual(target, id, `${id}: links to itself`);
    }
  }
});

test('planned topics have an outline', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    if (t.steps) continue;
    assert.ok(Array.isArray(t.plan) && t.plan.length, `${id}: a topic without steps needs a plan`);
  }
});

test('animated topics are well formed', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    if (!t.steps) continue;
    const actors = new Set();
    for (const a of t.actors) {
      assert.ok(!actors.has(a.id), `${id}: duplicate actor "${a.id}"`);
      actors.add(a.id);
      assert.ok(a.l, `${id}/${a.id}: label required`);
      assert.ok(ICONS.has(a.icon), `${id}/${a.id}: icon must be one of ${[...ICONS].join(', ')}`);
      for (const k of ['x', 'y']) assert.ok(a[k] >= 0 && a[k] <= 100, `${id}/${a.id}: ${k} must be 0–100`);
    }
    for (const [a, b] of t.links ?? []) assert.ok(actors.has(a) && actors.has(b), `${id}: link ${a}–${b} names an unknown actor`);
    assert.ok(t.steps.length > 0, `${id}: needs steps`);
    t.steps.forEach((s, i) => {
      const where = `${id} step ${i + 1}`;
      assert.ok(s.t && s.d, `${where}: title (t) and narration (d) are required`);
      for (const m of s.m ?? []) {
        const [from, to, label, kind = 'p', inside] = m;
        if (inside !== undefined) assert.equal(typeof inside, 'string', `${where}: packet contents must be text`);
        assert.ok(actors.has(from) && actors.has(to), `${where}: message ${from}→${to} names an unknown actor`);
        assert.notEqual(from, to, `${where}: message to itself`);
        assert.ok(label, `${where}: message needs a label`);
        assert.ok(KINDS.has(kind), `${where}: unknown message kind "${kind}"`);
      }
      if (s.zoom !== undefined) {
        assert.ok(TOPICS[s.zoom], `${where}: zooms into unknown topic "${s.zoom}"`);
        assert.notEqual(s.zoom, id, `${where}: zooms into itself`);
      }
      for (const a of s.on ?? []) assert.ok(actors.has(a), `${where}: "on" names unknown actor "${a}"`);
      for (const a of Object.keys(s.b ?? {})) assert.ok(actors.has(a), `${where}: badge on unknown actor "${a}"`);
      for (const target of linksIn(s.d)) assert.ok(TOPICS[target], `${where}: narration links to unknown topic "${target}"`);
    });
    assert.ok(t.cmd && t.out && t.note, `${id}: the "Dive deeper" panel needs cmd, out and note`);
  }
});

test('abbreviations are spelled out at their first use in every topic', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    const text = readingText(t);
    for (const [abbr, full] of Object.entries(ACRONYMS)) {
      const m = new RegExp(`\\b${abbr}s?\\b`).exec(text);
      if (!m) continue;
      const before = text.slice(Math.max(0, m.index - full.length - 12), m.index).toLowerCase();
      assert.ok(before.endsWith('(') && before.includes(full.toLowerCase()),
        `${id}: first "${abbr}" must read "${full} (${abbr})", found: …${text.slice(Math.max(0, m.index - 40), m.index + abbr.length)}`);
    }
  }
});

test('page drawings name a real actor', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    for (const s of t.steps ?? []) {
      if (s.page !== undefined) assert.ok(t.actors.some((a) => a.id === s.page), `${id}: page drawn at unknown actor "${s.page}"`);
    }
  }
});

test('chains of trust are well formed', () => {
  for (const [id, t] of Object.entries(TOPICS)) {
    (t.steps ?? []).forEach((s, i) => {
      if (!s.chain) return;
      const where = `${id} step ${i + 1}`, c = s.chain, actors = new Set(t.actors.map((a) => a.id));
      assert.ok(actors.has(c.at), `${where}: chain checked by unknown actor "${c.at}"`);
      assert.ok(Array.isArray(c.cards) && c.cards.length > 0, `${where}: chain needs cards`);
      assert.ok(c.check === 'all' || (Number.isInteger(c.check) && c.check >= 0 && c.check < c.cards.length), `${where}: chain.check must be 'all' or a card index`);
      for (const card of c.cards) {
        assert.ok(card.name && card.checks?.length, `${where}: each card needs a name and checks`);
        for (const [text, ok = true, who] of card.checks) {
          assert.ok(text, `${where}: empty check on ${card.name}`);
          assert.equal(typeof ok, 'boolean', `${where}: check "${text}" ok must be true or false`);
          if (who !== undefined) assert.ok(actors.has(who), `${where}: check "${text}" names unknown actor "${who}"`);
        }
      }
    });
  }
});
