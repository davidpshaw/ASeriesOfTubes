// SPDX-License-Identifier: GPL-3.0-or-later
// Scroll-driven story engine. Captions scroll; the scene stays pinned and acts out
// whichever caption crosses the trigger line. Topics zoom into each other.
import { TOPICS, GROUPS } from './topics.js';

const $ = (s) => document.querySelector(s);
const svg = $('#svg'), scene = $('#scene'), wrap = $('.scene-wrap'), caps = $('#captions');
const pop = $('#pop'), backBtn = $('#back'), soon = $('#soonmsg');
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nameOf = (id) => TOPICS[id].short || TOPICS[id].title;
const groupOf = (id) => (GROUPS.find((g) => g[1].includes(id)) || ['Topics'])[0];

// 24×24 line icons, drawn with CSS stroke
const ICONS = {
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 18.5h18"/>',
  server: '<rect x="5" y="4" width="14" height="6.5" rx="1.5"/><rect x="5" y="13.5" width="14" height="6.5" rx="1.5"/><path d="M8.5 7.2h.01M8.5 16.8h.01"/>',
  book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M5 20.5V5.5M9 7.5h6M9 11h4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3.2 3 3.2 14 0 17M12 3.5c-3.2 3-3.2 14 0 17"/>',
  drawers: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 9h14M5 15h14M10 6h4M10 12h4M10 18h4"/>',
  doc: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14.5 3v4.5H19M9 12h7M9 16h7"/>',
  seal: '<circle cx="12" cy="9" r="5.5"/><path d="M9 13.8 7.5 21l4.5-2.6 4.5 2.6-1.5-7.2"/>',
  hood: '<path d="M12 3a6.5 6.5 0 0 0-6.5 6.5v2.5a6.5 6.5 0 0 0 13 0V9.5A6.5 6.5 0 0 0 12 3z"/><path d="M4 21c1.2-3.6 4.2-5.4 8-5.4s6.8 1.8 8 5.4M9 11.5h6"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5z"/><path d="M5.5 9.5v8.5M10 9.5v8.5M14 9.5v8.5M18.5 9.5v8.5M3 20.5h18"/>',
};

let cur = null, curId = '', active = -2, step = -1, done = 0, pkt = null, token = 0, busy = false;
let trail = []; // ancestors: {id, step, origin}
let cards = [];
let seen = {};
try { seen = JSON.parse(localStorage.getItem('sot-seen') || '{}'); } catch { /* storage unavailable */ }
const markSeen = (id) => { seen[id] = 1; try { localStorage.setItem('sot-seen', JSON.stringify(seen)); } catch { /* ignore */ } };

/* ---------- scene geometry and drawing ---------- */
function geo() {
  const W = svg.clientWidth, H = svg.clientHeight, small = W < 520;
  const r = small ? 20 : 26, px = Math.min(96, Math.max(54, W * 0.13)), top = r + 30, bot = r + (small ? 46 : 70);
  const P = {};
  for (const a of cur.actors) P[a.id] = { x: px + (a.x / 100) * (W - 2 * px), y: top + (a.y / 100) * (H - top - bot) };
  return { W, H, r, small, P };
}
const idx = (id) => cur.actors.findIndex((a) => a.id === id);
function seg(m, g) {
  const [f, t] = m, fw = idx(f) < idx(t);
  const lo = g.P[fw ? f : t], hi = g.P[fw ? t : f];
  const bx = hi.x - lo.x, by = hi.y - lo.y, L = Math.hypot(bx, by) || 1, n = { x: -by / L, y: bx / L }, o = fw ? 9 : -9;
  const F = g.P[f], T = g.P[t], u = { x: (T.x - F.x) / L, y: (T.y - F.y) / L }, d = g.r + 9;
  return { x1: F.x + u.x * d + n.x * o, y1: F.y + u.y * d + n.y * o, x2: T.x - u.x * d + n.x * o, y2: T.y - u.y * d + n.y * o, n, o };
}
function chip(x, y, m, i, W, fly, mini) {
  const label = m[2], k = m[3] || 'p', w = mini ? 26 : Math.round(label.length * 6.9 + 30), h = mini ? 17 : 26;
  x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));
  const body = k === 'e'
    ? `<rect class="env" width="${w}" height="${h}" rx="3"/><path class="flap" d="M1.5 1.5L${w / 2} ${h * 0.55}L${w - 1.5} 1.5"/><circle class="seal" cx="${w / 2}" cy="${h * 0.55}" r="3"/>`
    : `<rect class="pc" width="${w}" height="${h}" rx="3"/><rect class="stamp" x="${w - (mini ? 9 : 14)}" y="${mini ? 3 : 4}" width="${mini ? 5 : 9}" height="${mini ? 6 : 10}" rx="1"/>`;
  return `<g class="chip k${k}${fly ? ' fly' : ''}" data-m="${i}" transform="translate(${x - w / 2},${y - h / 2})" aria-label="${esc(label)}">${body}${mini ? `<title>${esc(label)}</title>` : `<text class="ct" x="9" y="17.5">${esc(label)}</text>`}</g>`;
}
const zoomActor = (st) => (st && (st.m?.[0]?.[1] || st.on?.[0])) || null;

function draw() {
  if (!cur || !cur.steps || !svg.clientWidth) { svg.innerHTML = ''; return; }
  const g = geo(), st = step >= 0 ? cur.steps[step] : null, ms = st?.m || [], on = new Set(st?.on || []);
  ms.forEach((m) => { on.add(m[0]); on.add(m[1]); });
  let h = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0 0L10 5L0 10z"/></marker><marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ahb" d="M0 0L10 5L0 10z"/></marker></defs>';
  for (const [a, b] of cur.links || []) h += `<line class="lnk" x1="${g.P[a].x}" y1="${g.P[a].y}" x2="${g.P[b].x}" y2="${g.P[b].y}"/>`;
  let chips = '';
  const spread = g.small ? 3.6 : 2.7;
  ms.slice(0, done).forEach((m, i) => {
    const s = seg(m, g), k = m[3] || 'p', lost = k === 'l';
    const ex = lost ? s.x1 + (s.x2 - s.x1) * 0.55 : s.x2, ey = lost ? s.y1 + (s.y2 - s.y1) * 0.55 : s.y2;
    h += `<line class="tr k${k}" x1="${s.x1}" y1="${s.y1}" x2="${ex}" y2="${ey}"${lost ? '' : ` marker-end="url(#${k === 'x' ? 'ahb' : 'ah'})"`}/>`;
    if (lost) h += `<path class="tr kx" d="M${ex - 6} ${ey - 6}l12 12M${ex + 6} ${ey - 6}l-12 12" stroke-width="2.5"/>`;
    // On narrow screens only the newest packet keeps its label; earlier ones shrink (still tappable).
    const mini = g.small && i < done - 1, sp = mini ? 1.6 : spread;
    chips += chip((s.x1 + ex) / 2 + s.n.x * s.o * sp, (s.y1 + ey) / 2 + s.n.y * s.o * sp, m, i, g.W, false, mini);
  });
  const sc = g.r / 21;
  for (const a of cur.actors) {
    const p = g.P[a.id], bd = st?.b?.[a.id];
    h += `<g class="node${on.has(a.id) ? ' on' : ''}${a.icon === 'hood' ? ' bad' : ''}" transform="translate(${p.x},${p.y})">`
      + `<circle class="halo" r="${g.r + 5}"/><circle class="disc" r="${g.r}"/>`
      + `<g class="ico" transform="translate(${-12 * sc},${-12 * sc}) scale(${sc})">${ICONS[a.icon] || ICONS.server}</g>`
      + `<text class="lb" y="${g.r + 18}">${esc(a.l)}</text>`
      + (a.term && !g.small ? `<text class="tm" y="${g.r + 33}">${esc(a.term)}</text>` : '')
      + (bd ? `<text class="bd" y="${g.r + (a.term && !g.small ? 50 : 34)}">${esc(bd)}</text>` : '')
      + '</g>';
  }
  if (st?.zoom && TOPICS[st.zoom]) {
    const z = g.P[zoomActor(st)] || { x: g.W / 2, y: g.H / 2 };
    h += `<g class="zb" data-zoom="${st.zoom}" role="button" aria-label="Zoom into ${esc(nameOf(st.zoom))}" transform="translate(${z.x + g.r * 0.85},${z.y - g.r * 0.85})"><circle r="13"/><path d="M-5 0h10M0-5v10"/></g>`;
  }
  h += chips;
  if (pkt && ms[pkt.i]) {
    const m = ms[pkt.i], s = seg(m, g), t = pkt.t, k = m[3] || 'p';
    const op = k === 'l' && t > 0.5 ? Math.max(0, 1 - (t - 0.5) * 4) : 1;
    h += `<g opacity="${op}">${chip(s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t, m, pkt.i, g.W, true)}</g>`;
  }
  svg.innerHTML = h;
}

/* ---------- step animation ---------- */
function fly(i, tok) {
  return new Promise((res) => {
    const t0 = performance.now(), dur = 1250;
    pkt = { i, t: 0 };
    const f = (now) => {
      if (tok !== token) return res();
      const r = Math.min(1, (now - t0) / dur);
      pkt.t = r < 0.5 ? 2 * r * r : 1 - ((-2 * r + 2) ** 2) / 2;
      draw();
      r < 1 ? requestAnimationFrame(f) : res();
    };
    requestAnimationFrame(f);
  });
}
async function run(i, instant) {
  const tok = ++token;
  step = i; done = 0; pkt = null;
  const ms = cur.steps[i].m || [];
  if (instant || RM.matches) { done = ms.length; draw(); return; }
  draw();
  await wait(200);
  for (let k = 0; k < ms.length; k++) {
    if (tok !== token) return;
    await fly(k, tok);
    if (tok !== token) return;
    pkt = null; done = k + 1; draw();
    await wait(300);
  }
}
function activate(i, instant) {
  if (i === active) return;
  active = i;
  hidePop();
  for (const c of cards) c.classList.toggle('on', +c.dataset.i === i);
  if (!cur.steps) return;
  const n = cur.steps.length;
  if (i < 0) { token++; step = -1; done = 0; pkt = null; draw(); }
  else if (i >= n) { token++; step = n - 1; done = (cur.steps[n - 1].m || []).length; pkt = null; draw(); }
  else run(i, instant);
}

/* ---------- scroll position → active caption ---------- */
function triggerLine() {
  if (innerWidth >= 900) return innerHeight * 0.5;
  const b = Math.max(0, wrap.getBoundingClientRect().bottom);
  return b + (innerHeight - b) * 0.3;
}
function onScroll() {
  if (busy || !cards.length) return;
  const line = triggerLine();
  let i = +cards[0].dataset.i;
  for (const c of cards) if (c.getBoundingClientRect().top < line) i = +c.dataset.i;
  activate(i);
}
function cardY(i) {
  const c = cards.find((x) => +x.dataset.i === i);
  return c ? c.getBoundingClientRect().top + scrollY - triggerLine() + 24 : 0;
}
function scrollToCard(i) {
  const lo = +cards[0].dataset.i, hi = +cards.at(-1).dataset.i;
  i = Math.max(lo, Math.min(hi, i));
  scrollTo({ top: cardY(i), behavior: RM.matches ? 'auto' : 'smooth' });
}

/* ---------- captions ---------- */
const POSTCARD = '<svg viewBox="0 0 44 26" aria-hidden="true"><g class="chip kp"><rect class="pc" x="1" y="1" width="42" height="24" rx="3"/><rect class="stamp" x="30" y="5" width="9" height="10" rx="1"/></g></svg>';
const ENVELOPE = '<svg viewBox="0 0 44 26" aria-hidden="true"><g class="chip ke"><rect class="env" x="1" y="1" width="42" height="24" rx="3"/><path class="flap" d="M2.5 2.5L22 15L41.5 2.5"/><circle class="seal" cx="22" cy="15" r="3"/></g></svg>';

function zoomButton(id, why, cls = '') {
  const t = TOPICS[id];
  return `<button class="zoomto ${cls}" data-zoom="${id}"><span><b>${esc(t.title)}</b>${why ? `<small>${esc(why)}${t.steps ? '' : ' · coming soon'}</small>` : ''}</span></button>`;
}
function renderCaptions() {
  const t = cur, parent = trail.at(-1);
  let h = `<section class="card intro" data-i="-1"><p class="kicker">${esc(groupOf(curId))}</p><h1>${esc(t.title)}</h1><p class="lead">${esc(t.blurb)}</p>`;
  if (t.steps) {
    h += `<p class="key"><span>${POSTCARD} A postcard: anyone along the way can read it.</span><span>${ENVELOPE} A sealed envelope: only the two ends can open it.</span></p><p class="hint">Scroll to start ↓ · tap any postcard or envelope to look inside</p></section>`;
    t.steps.forEach((s, i) => {
      h += `<section class="card" data-i="${i}"><span class="n">Step ${i + 1} of ${t.steps.length}</span><h2>${esc(s.t)}</h2><p>${s.d}</p>`
        + (s.zoom && TOPICS[s.zoom] ? zoomButton(s.zoom, 'Zoom in to see this step up close') : '') + '</section>';
    });
  } else {
    h += `</section><section class="card" data-i="0"><h2>What this topic will cover</h2><ul>${t.plan.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>`;
  }
  const n = t.steps ? t.steps.length : 1;
  h += `<section class="card end" data-i="${n}"><h2>Where next?</h2>`;
  if (parent) h += `<button class="zoomto out" data-back="${trail.length - 1}"><span><b>Back out to ${esc(TOPICS[parent.id].title)}</b><small>Return to the step you came from</small></span></button>`;
  h += (t.deeper || []).map(([id, why]) => zoomButton(id, why)).join('');
  if (t.cmd) {
    h += `<details><summary>Try it yourself in a terminal</summary><div class="box"><pre><b>$ ${esc(t.cmd)}</b>\n${esc(t.out)}</pre></div><p class="note">${esc(t.note)} Sample output, trimmed.</p></details>`;
  }
  caps.innerHTML = h + '</section>';
  cards = [...caps.querySelectorAll('.card')];
}
function renderTrail() {
  $('#trail').innerHTML = trail.map((e, k) => `<button data-back="${k}">${esc(nameOf(e.id))}</button><span class="sep" aria-hidden="true">›</span>`).join('')
    + `<span class="here" aria-current="location">${esc(nameOf(curId))}</span>`;
  const p = trail.at(-1);
  backBtn.hidden = !p;
  if (p) { backBtn.textContent = `↑ Back out to ${nameOf(p.id)}`; backBtn.dataset.back = trail.length - 1; }
}
function renderMenu() {
  $('#menuList').innerHTML = GROUPS.map(([g, ids]) => `<h3>${esc(g)}</h3>` + ids.map((id) =>
    `<a href="#${id}"${id === curId ? ' aria-current="page"' : ''}>${esc(nameOf(id))}<small>${TOPICS[id].steps ? (seen[id] ? '✓ seen' : '') : 'soon'}</small></a>`).join('')).join('');
}

/* ---------- loading topics and zooming ---------- */
function load(id) {
  cur = TOPICS[id]; curId = id;
  history.replaceState(null, '', '#' + id);
  document.title = `${nameOf(id)} · A Series of Tubes`;
  token++; active = -2; step = -1; done = 0; pkt = null;
  soon.hidden = !!cur.steps;
  renderCaptions(); renderTrail(); renderMenu();
  if (cur.steps) markSeen(id);
  draw();
}
function originFor(i) {
  const g = geo(), st = cur.steps?.[i];
  return g.P[zoomActor(st)] || { x: g.W / 2, y: g.H / 2 };
}
async function transition(dir, o, swap) {
  busy = true; hidePop();
  if (RM.matches) { swap(); busy = false; return; }
  const big = 'scale(5)', small = 'scale(0.3)';
  scene.style.transformOrigin = `${o.x}px ${o.y}px`;
  scene.style.transition = 'transform .4s cubic-bezier(.55,0,.85,.35), opacity .4s';
  caps.classList.add('fading');
  scene.style.transform = dir === 'in' ? big : small;
  scene.style.opacity = '0';
  await wait(400);
  swap();
  scene.style.transition = 'none';
  scene.style.transform = dir === 'in' ? small : big;
  void scene.offsetWidth;
  scene.style.transition = 'transform .55s cubic-bezier(.15,.65,.3,1), opacity .5s';
  scene.style.transform = 'scale(1)';
  scene.style.opacity = '1';
  caps.classList.remove('fading');
  await wait(560);
  scene.style.transition = '';
  busy = false;
}
async function zoomTo(id) {
  if (busy || !TOPICS[id] || id === curId) return;
  const back = trail.findIndex((e) => e.id === id);
  if (back >= 0) return backTo(back);
  const origin = originFor(active);
  trail.push({ id: curId, step: active, origin });
  await transition('in', origin, () => { load(id); scrollTo(0, 0); });
  onScroll();
}
async function backTo(k) {
  if (busy || !trail[k]) return;
  const e = trail[k];
  trail = trail.slice(0, k);
  await transition('out', e.origin, () => {
    load(e.id);
    scrollTo(0, cardY(e.step));
    activate(e.step, true);
  });
  onScroll();
}

/* ---------- looking inside packets ---------- */
function gibberish(s) {
  let x = 2166136261, out = [];
  for (let i = 0; i < 48; i++) { x ^= s.charCodeAt(i % s.length) + i; x = Math.imul(x, 16777619) >>> 0; out.push((x & 255).toString(16).padStart(2, '0')); }
  return out.join(' ');
}
const KINDS = {
  p: ['Postcard', 'Anyone along the way can read this, and could change it.'],
  e: ['Sealed envelope', 'Only the two ends hold the key. Anyone else sees scrambled bytes, and any change would be detected.'],
  x: ['Forgery', 'Made by the attacker to look like the real thing.'],
  l: ['Lost on the way', 'It never arrived. With no reply, the sender will notice and send it again.'],
};
function showPop(i, el) {
  const m = cur.steps[step]?.m?.[i];
  if (!m) return;
  const k = m[3] || 'p', [title, what] = KINDS[k];
  pop.innerHTML = `<button class="x" aria-label="Close">×</button><p class="ph"></p><p class="pd"></p><p class="pd">${k === 'e' ? 'Inside, as the two ends see it:' : 'What it says:'}</p><pre class="in"></pre>${k === 'e' ? '<p class="pd">What anyone in between sees:</p><pre class="gib"></pre>' : ''}`;
  pop.querySelector('.ph').textContent = `${title}: ${m[2]}`;
  pop.querySelectorAll('.pd')[0].textContent = what;
  pop.querySelector('.in').textContent = m[4] || m[2];
  if (k === 'e') pop.querySelector('.gib').textContent = gibberish(m[4] || m[2]) + ' …';
  pop.hidden = false;
  const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = r.left - wr.left + r.width / 2 - pw / 2, y = r.bottom - wr.top + 8;
  if (y + ph > wr.height - 8) y = r.top - wr.top - ph - 8;
  pop.style.left = `${Math.max(12, Math.min(wr.width - pw - 12, x))}px`;
  pop.style.top = `${Math.max(12, y)}px`;
  pop.querySelector('.x').focus({ preventScroll: true });
}
function hidePop() { pop.hidden = true; }

/* ---------- events ---------- */
svg.addEventListener('click', (e) => {
  const z = e.target.closest('[data-zoom]');
  if (z) return zoomTo(z.dataset.zoom);
  const c = e.target.closest('.chip');
  if (c) return showPop(+c.dataset.m, c);
  hidePop();
});
pop.addEventListener('click', (e) => { if (e.target.closest('.x')) hidePop(); });
caps.addEventListener('click', (e) => {
  const z = e.target.closest('[data-zoom]');
  if (z) return zoomTo(z.dataset.zoom);
  const b = e.target.closest('[data-back]');
  if (b) return backTo(+b.dataset.back);
  const a = e.target.closest('a[href^="#"]');
  if (a) { e.preventDefault(); return zoomTo(a.getAttribute('href').slice(1)); }
  const c = e.target.closest('.card');
  if (c && !c.classList.contains('on') && !e.target.closest('summary,details')) scrollToCard(+c.dataset.i);
});
$('#trail').addEventListener('click', (e) => { const b = e.target.closest('[data-back]'); if (b) backTo(+b.dataset.back); });
backBtn.addEventListener('click', () => backTo(+backBtn.dataset.back));
$('#menuList').addEventListener('click', () => { $('#menu').open = false; });
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea')) return;
  if (e.key === 'Escape') { if (!pop.hidden) hidePop(); else if (trail.length) backTo(trail.length - 1); }
  else if (e.key === 'ArrowRight' && cards.length) { e.preventDefault(); scrollToCard(active + 1); }
  else if (e.key === 'ArrowLeft' && cards.length) { e.preventDefault(); scrollToCard(active - 1); }
});
let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; onScroll(); });
}, { passive: true });
addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (TOPICS[id] && id !== curId) { trail = []; load(id); scrollTo(0, 0); onScroll(); }
});
const ro = new ResizeObserver(() => { draw(); onScroll(); });
ro.observe(svg);

const start = TOPICS[location.hash.slice(1)] ? location.hash.slice(1) : 'journey';
load(start);
onScroll();
