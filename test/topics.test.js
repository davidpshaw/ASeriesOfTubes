// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the content in public/topics.js so a typo in a new topic fails CI
// instead of breaking the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, GROUPS } from '../public/topics.js';

const ids = Object.keys(TOPICS);
const KINDS = new Set(['p', 'e', 'x', 'l']);
const ICONS = new Set(['laptop', 'server', 'book', 'globe', 'drawers', 'doc', 'seal', 'hood', 'bank']);
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
