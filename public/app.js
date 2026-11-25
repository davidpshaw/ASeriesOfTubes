// SPDX-License-Identifier: GPL-3.0-or-later
// Scroll-driven story engine. Captions scroll; the scene stays pinned and acts out
// whichever caption crosses the trigger line. Topics zoom into each other.
import { TOPICS, GROUPS } from './topics.js';

const $ = (s) => document.querySelector(s);
const svg = $('#svg'), scene = $('#scene'), wrap = $('.scene-wrap'), caps = $('#captions');
const pop = $('#pop'), backBtn = $('#back'), soon = $('#soonmsg');
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const REPLAY_MS = 10000; // a step's animation repeats this long after it finishes
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
  bandit: '<path d="M4.5 8.5h15M8 8.5V6.2a4 4 0 0 1 8 0v2.3"/><circle cx="12" cy="14.5" r="5.5"/><path class="f" d="M6 12.6h12v3H6z"/><circle class="h" cx="9.7" cy="14.1" r="1.1"/><circle class="h" cx="14.3" cy="14.1" r="1.1"/><path d="M18 13.2l2.5-1.6M18 14.6l2.5 1.4"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5z"/><path d="M5.5 9.5v8.5M10 9.5v8.5M14 9.5v8.5M18.5 9.5v8.5M3 20.5h18"/>',
};

let cur = null, curId = '', active = -2, step = -1, done = 0, pkt = null, token = 0, busy = false, pageStage = 0, chainPos = 0, mixT = 1;
let trail = []; // ancestors: {id, step, origin}
let cards = [];
let seen = {};
try { seen = JSON.parse(localStorage.getItem('sot-seen') || '{}'); } catch { /* storage unavailable */ }
let peeked = false;
try { peeked = localStorage.getItem('sot-peeked') === '1'; } catch { /* storage unavailable */ }
const markPeeked = () => {
  if (peeked) return;
  peeked = true;
  document.body.classList.add('peeked');
  try { localStorage.setItem('sot-peeked', '1'); } catch { /* ignore */ }
};
if (peeked) document.body.classList.add('peeked');
let landedAt = 0; // when the newest packet arrived, for its one-time ripple
const markSeen = (id) => { seen[id] = 1; try { localStorage.setItem('sot-seen', JSON.stringify(seen)); } catch { /* ignore */ } };

/* ---------- scene geometry and drawing ---------- */
function geo() {
  const W = svg.clientWidth, H = svg.clientHeight, small = W < 520;
  // While the "Back out" button shows, keep a strip clear for it across the top of the scene.
  const inset = trail.length ? (small ? 48 : 60) : 0;
  const r = small ? 18 : 26, px = Math.min(96, Math.max(54, W * 0.13)), top = r + 30 + inset, bot = r + (small ? 82 : 70);
  const P = {};
  for (const a of cur.actors) P[a.id] = { x: px + (a.x / 100) * (W - 2 * px), y: top + (a.y / 100) * (H - top - bot) };
  return { W, H, r, small, P, inset };
}
const idx = (id) => cur.actors.findIndex((a) => a.id === id);
function seg(m, g, lane = 0) {
  const [f, t] = m, fw = idx(f) < idx(t);
  const lo = g.P[fw ? f : t], hi = g.P[fw ? t : f];
  const bx = hi.x - lo.x, by = hi.y - lo.y, L = Math.hypot(bx, by) || 1, n = { x: -by / L, y: bx / L };
  const sign = fw ? 1 : -1, o = sign * (9 + lane * 5);
  const F = g.P[f], T = g.P[t], u = { x: (T.x - F.x) / L, y: (T.y - F.y) / L }, d = g.r + 9;
  return { x1: F.x + u.x * d + n.x * o, y1: F.y + u.y * d + n.y * o, x2: T.x - u.x * d + n.x * o, y2: T.y - u.y * d + n.y * o, n, o, sign };
}
// How far a packet's label sits from its line. Repeat trips in the same direction get their own lane.
function labelOffset(g, lane, mini) {
  if (g.small) return 12 + lane * 24 + (mini ? 0 : 12);
  return 32 + lane * 46;
}
// Where a packet's label goes. Labels are wide and short, so on sloped lines they stack straight up or
// down (never along the slope, where they would collide); beside near-vertical lines they sit to the side.
function labelPos(g, s, mx, my, m, lane, mini, numbered) {
  const off = labelOffset(g, lane, mini), dir = s.sign;
  if (Math.abs(s.n.y) >= 0.35) return { x: mx, y: my + Math.sign(s.n.y) * dir * off };
  const w = mini ? 32 : m[2].length * 8.1 + 24 + (numbered ? 24 : 0) + (m[5] ? 20 : 0) + ((m[3] || 'p') === 'e' ? 8 : 46);
  const side = Math.sign(s.n.x) * dir || 1, h = mini ? 24 : 46;
  return { x: mx + side * (w / 2 + 16), y: my + (lane - 0.5) * h * (lane ? 1 : 0) };
}
// Lane = how many earlier messages in this step went the same way between the same two actors.
const lanesOf = (ms) => ms.map((m, i) => ms.slice(0, i).filter((x) => x[0] === m[0] && x[1] === m[1]).length);

function chip(x, y, m, i, W, opts = {}) {
  const { fly = false, mini = false, num = 0, land = false } = opts;
  const label = m[2], k = m[3] || 'p', env = k === 'e', sw = !mini && m[5] ? 20 : 0;
  const numW = (num && !mini ? 24 : 0) + sw;
  const w = mini ? 32 : Math.round(label.length * 8.1 + 24 + numW + (env ? 8 : 46)), h = mini ? 20 : 38;
  const mini2 = mini && m[5] ? `<circle class="swatch" cx="${w - 8}" cy="${h / 2}" r="5" fill="${PAINT[m[5]] || m[5]}"/>` : '';
  x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));
  let body;
  if (mini) {
    body = env
      ? `<rect class="env" width="${w}" height="${h}" rx="2"/><path class="flap" d="M1.5 1.5L${w / 2} ${h * 0.55}L${w - 1.5} 1.5"/>`
      : `<rect class="pc" width="${w}" height="${h}" rx="2"/><rect class="stamp" x="${w - 10}" y="3.5" width="6.5" height="7.5"/>`;
  } else if (env) {
    body = `<rect class="env" width="${w}" height="${h}" rx="3"/><path class="flap" d="M2 2L${w / 2} 15L${w - 2} 2"/>`
      + `<circle class="seal" cx="${w / 2}" cy="15" r="5.5"/><path class="sealx" d="M${w / 2 - 2.6} 15h5.2M${w / 2} ${15 - 2.6}v5.2"/>`;
  } else {
    // postcard: perforated stamp with a little house, and wavy postmark lines beside it
    const sx = w - 31;
    body = `<rect class="pc" width="${w}" height="${h}" rx="3"/>`
      + `<path class="pm" d="M${sx - 14} 13q3.5-3 7 0t7 0M${sx - 14} 19q3.5-3 7 0t7 0M${sx - 14} 25q3.5-3 7 0t7 0"/>`
      + `<rect class="stamp" x="${sx}" y="6" width="23" height="26" rx="1"/>`
      + `<path class="house" d="M${sx + 5.5} 18l6-5 6 5v7h-12z"/>`;
  }
  const ty = env ? 31 : 24.5;
  const by = env ? 26 : 19, nx = sw ? 36 : 16;
  let badge = num && !mini ? `<circle class="num" cx="${nx}" cy="${by}" r="9"/><text class="numt" x="${nx}" y="${by + 4.5}">${num}</text>` : '';
  if (sw) badge += `<circle class="swatch" cx="16" cy="${by}" r="8" fill="${PAINT[m[5]] || m[5]}"/>`;
  const text = mini ? `<title>${esc(label)}</title>${num ? `<text class="mnum" x="${env ? w / 2 : 11}" y="${env ? 17.5 : 14.5}">${num}</text>` : ''}` : `<text class="ct" x="${12 + numW}" y="${ty}">${esc(label)}</text>`;
  const ring = land ? `<rect class="ring" x="-3" y="-3" width="${w + 6}" height="${h + 6}" rx="6"/>` : '';
  return `<g class="chip k${k}${fly ? ' fly' : ''}${mini ? ' mini' : ''}" data-m="${i}" transform="translate(${x - w / 2},${y - h / 2})" aria-label="${esc(label)}: look inside">${ring}${body}${badge}${mini2}${text}</g>`;
}
const zoomActor = (st) => (st && (st.m?.[0]?.[1] || st.on?.[0])) || null;

function draw() {
  if (!cur || !cur.steps || !svg.clientWidth) { svg.innerHTML = ''; return; }
  const g = geo(), st = step >= 0 ? cur.steps[step] : null, ms = st?.m || [], on = new Set(st?.on || []);
  ms.forEach((m) => { on.add(m[0]); on.add(m[1]); });
  const ch = st?.chain ? chainState(st.chain, chainPos) : null;
  if (ch?.who) on.add(ch.who);
  if (ch) on.add(st.chain.at);
  let h = '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0 0L10 5L0 10z"/></marker><marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="ahb" d="M0 0L10 5L0 10z"/></marker></defs>';
  const hideScene = g.small && ch;
  if (!hideScene) for (const [a, b] of cur.links || []) h += `<line class="lnk${st?.page ? ' dim' : ''}" x1="${g.P[a].x}" y1="${g.P[a].y}" x2="${g.P[b].x}" y2="${g.P[b].y}"/>`;
  let chips = '', hintAt = null;
  const lanes = lanesOf(ms), numbered = ms.length > 1;
  (hideScene ? [] : ms.slice(0, done)).forEach((m, i) => {
    const s = seg(m, g, lanes[i]), k = m[3] || 'p', lost = k === 'l';
    const ex = lost ? s.x1 + (s.x2 - s.x1) * 0.55 : s.x2, ey = lost ? s.y1 + (s.y2 - s.y1) * 0.55 : s.y2;
    h += `<line class="tr k${k}" x1="${s.x1}" y1="${s.y1}" x2="${ex}" y2="${ey}"${lost ? '' : ` marker-end="url(#${k === 'x' ? 'ahb' : 'ah'})"`}/>`;
    if (lost) h += `<path class="tr kx" d="M${ex - 6} ${ey - 6}l12 12M${ex + 6} ${ey - 6}l-12 12" stroke-width="2.5"/>`;
    const mini = g.small, p = labelPos(g, s, (s.x1 + ex) / 2, (s.y1 + ey) / 2, m, lanes[i], mini, numbered);
    const newest = i === done - 1 && !pkt, land = newest && !g.small && performance.now() - landedAt < 120 && !RM.matches;
    chips += chip(p.x, p.y, m, i, g.W, { mini, land, num: numbered ? i + 1 : 0 });
    if (newest && !g.small) hintAt = { x: Math.max(80, Math.min(g.W - 80, p.x)), y: p.y - 19 };
  });
  const sc = g.r / 21;
  for (const a of hideScene ? [] : cur.actors) {
    const p = g.P[a.id], bd = st?.b?.[a.id];
    const half = Math.max(a.l.length * 3.8, (a.term && !g.small ? a.term.length * 3.3 : 0), (bd ? bd.length * 3.6 : 0)) + 4;
    const dx = Math.max(half, Math.min(g.W - half, p.x)) - p.x;
    h += `<g class="node${on.has(a.id) ? ' on' : ''}${a.icon === 'hood' || a.icon === 'bandit' ? ' bad' : ''}${st?.page && st.page !== a.id ? ' dim' : ''}" transform="translate(${p.x},${p.y})">`
      + `<circle class="halo" r="${g.r + 5}"/><circle class="disc" r="${g.r}"/>`
      + `<g class="ico" transform="translate(${-12 * sc},${-12 * sc}) scale(${sc})">${ICONS[a.icon] || ICONS.server}</g>`
      + `<text class="lb" x="${dx}" y="${g.r + 18}">${esc(a.l)}</text>`
      + (a.term && !g.small ? `<text class="tm" x="${dx}" y="${g.r + 33}">${esc(a.term)}</text>` : '')
      + (bd ? `<text class="bd" x="${dx}" y="${g.r + (a.term && !g.small ? 50 : 34)}">${esc(bd)}</text>` : '')
      + '</g>';
  }
  if (!hideScene) for (const a of cur.actors) h += potsFor(g, a, st);
  if (st?.zoom && TOPICS[st.zoom]) {
    const z = g.P[zoomActor(st)] || { x: g.W / 2, y: g.H / 2 };
    h += `<g class="zb" data-zoom="${st.zoom}" role="button" aria-label="Zoom into ${esc(nameOf(st.zoom))}" transform="translate(${z.x + g.r * 0.85},${z.y - g.r * 0.85})"><circle r="13"/><path d="M-5 0h10M0-5v10"/></g>`;
  }
  h += chips;
  if (ch) h += chainPanel(g, st.chain, ch);
  if (st?.page && g.P[st.page]) h += browserPage(g, g.P[st.page], pageStage, st.warn);
  if (pkt && ms[pkt.i] && !hideScene) {
    const m = ms[pkt.i], s = seg(m, g, lanes[pkt.i]), t = pkt.t, k = m[3] || 'p';
    const op = k === 'l' && t > 0.5 ? Math.max(0, 1 - (t - 0.5) * 4) : 1;
    h += `<g opacity="${op}">${chip(s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t, m, pkt.i, g.W, { fly: true, mini: g.small, num: numbered ? pkt.i + 1 : 0 })}</g>`;
  }
  // Phones: the packet in flight, or the newest one, gets its full label in a strip along the bottom.
  const focus = pkt ? pkt.i : done - 1;
  if (g.small && ms[focus] && !hideScene) {
    const land = !pkt && performance.now() - landedAt < 120 && !RM.matches;
    h += chip(g.W / 2, g.H - 26, ms[focus], focus, g.W, { land, num: numbered ? focus + 1 : 0 });
    if (!pkt) {
      // on phones the hint is a small tag on the strip packet's top corner, so it never covers the scene
      const m = ms[focus], cw = Math.min(g.W - 8, m[2].length * 8.1 + 24 + (numbered ? 24 : 0) + (m[5] ? 20 : 0) + ((m[3] || 'p') === 'e' ? 8 : 46));
      hintAt = { tag: true, right: g.W / 2 + cw / 2, top: g.H - 26 - 19 };
    }
  }
  // Until someone has opened a packet once, point at the newest one.
  if (!peeked && hintAt?.tag && !hideScene) {
    const tw = 124, tx = Math.min(g.W - tw - 4, hintAt.right - tw + 8), ty = hintAt.top - 13;
    h += `<g class="hint" transform="translate(${tx},${ty})"><rect width="${tw}" height="22" rx="11"/><text x="${tw / 2}" y="15.5" class="ht">Tap to look inside</text></g>`;
  } else if (!peeked && hintAt && !hideScene) {
    const txt = g.small ? 'Tap to look inside' : 'Click to look inside', bw = txt.length * 7.6 + 24;
    const above = hintAt.y - 10 - 30, flip = above < 6 + g.inset, by = flip ? hintAt.y + 38 + 10 : above;
    const tip = flip ? `<path d="M${bw / 2 - 7} 0.5l7 -8 7 8z"/>` : `<path d="M${bw / 2 - 7} 29.5l7 8 7-8z"/>`;
    h += `<g class="hint" transform="translate(${hintAt.x - bw / 2},${by})"><rect width="${bw}" height="30" rx="15"/>${tip}<text x="${bw / 2}" y="20">${txt}</text></g>`;
  }
  svg.innerHTML = h;
}

/* ---------- paint pots (step fields `pots` and `mix`) ----------
   pots: {actorId: [[colour, label, flag]]}  flag: 'lock' (kept secret) or 'gone' (thrown away)
   mix:  {actorId: [i, j, [colour, label]]}  animates pots i and j being mixed into a new pot */
export const PAINT = { yellow: '#f2c230', red: '#d8453b', blue: '#3b6fd8', orange: '#ef8c2d', green: '#3f9c5c', brown: '#7b4f2c' };
function potsFor(g, a, st) {
  const base = st?.pots?.[a.id];
  if (!base) return '';
  const mix = st.mix?.[a.id], p = g.P[a.id], total = base.length + (mix ? 1 : 0);
  const pr = g.small ? 9 : 12, gap = g.small ? 42 : 46, perRow = g.small ? 3 : 6, rowH = pr * 2 + 26;
  const bd = st?.b?.[a.id], below = g.r + (a.term && !g.small ? 50 : 34) + (bd ? 18 : 0);
  const y0 = p.y + below + pr + 4;
  // Rows stay inside the scene: on phones they wrap after three pots, and a row near an edge shifts inward.
  const slot = (k) => {
    const row = Math.floor(k / perRow), col = k % perRow, inRow = Math.min(perRow, total - row * perRow);
    const half = ((inRow - 1) / 2) * gap + 30, cx = Math.max(half + 4, Math.min(g.W - half - 4, p.x));
    return { x: cx + (col - (inRow - 1) / 2) * gap, y: y0 + row * rowH };
  };
  const pot = (k, colour, label, flag, opacity = 1) => {
    const c = slot(k);
    let h = `<g class="pot${flag === 'gone' ? ' gone' : ''}" opacity="${opacity}"><circle cx="${c.x}" cy="${c.y}" r="${pr}" fill="${PAINT[colour] || colour}"/>`;
    if (flag === 'lock') h += `<g class="potlock" transform="translate(${c.x + pr * 0.75},${c.y - pr * 0.85})"><circle r="6.5"/><rect x="-3" y="-0.8" width="6" height="4.6" rx=".8"/><path d="M-1.7 -0.8v-1.4a1.7 1.7 0 0 1 3.4 0v1.4"/></g>`;
    return h + `<text class="potl" x="${c.x}" y="${c.y + pr + 13}">${esc(label)}</text></g>`;
  };
  let h = '';
  base.forEach(([colour, label, flag], k) => { h += pot(k, colour, label, flag); });
  if (mix) {
    const [i, j, [colour, label]] = mix, to = slot(total - 1), t = mixT;
    if (t < 1) {
      // copies of the two pots slide together into the new slot, then become the mixture
      for (const k of [i, j]) {
        const from = slot(k), e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
        h += `<circle class="ghost" cx="${from.x + (to.x - from.x) * e}" cy="${from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * 20}" r="${pr * 0.85}" fill="${PAINT[base[k][0]]}" opacity="${t > 0.75 ? (1 - t) * 4 : 1}"/>`;
      }
    }
    if (t > 0.7) h += pot(total - 1, colour, label, null, Math.min(1, (t - 0.7) / 0.3));
  }
  return h;
}

/* ---------- a browser page that builds itself (step field `page`) ---------- */
const PAGE_STAGES = ['', 'Structure, from the HTML', 'Colors and layout, from style.css', 'The picture, from logo.png', 'Page loaded'];
function browserPage(g, at, stage, warn) {
  const w = Math.min(360, g.W * (g.small ? 0.72 : 0.6)), hh = w * 0.68;
  let x = Math.max(at.x + g.r + 28, g.W / 2 - w / 2 + 20);
  x = Math.min(x, g.W - w - 10);
  if (x < 10) x = 10;
  const y = Math.max(12 + g.inset, Math.min(g.H - hh - 40, at.y - hh * 0.62));
  const bar = 26, ix = x + 12, iw = w - 24, top = y + bar + 10;
  const styled = stage >= 2;
  let h = `<g class="page">`;
  h += `<path class="plink" d="M${at.x + g.r + 4} ${at.y}L${x} ${Math.min(y + hh - 8, Math.max(y + 8, at.y))}"/>`;
  h += `<rect class="pwin" x="${x}" y="${y}" width="${w}" height="${hh}" rx="8"/>`;
  h += `<path class="pbar" d="M${x} ${y + bar}h${w}"/>`;
  h += `<circle class="pdot" cx="${x + 12}" cy="${y + 13}" r="3.5"/><circle class="pdot" cx="${x + 23}" cy="${y + 13}" r="3.5"/><circle class="pdot" cx="${x + 34}" cy="${y + 13}" r="3.5"/>`;
  h += `<rect class="paddr" x="${x + 46}" y="${y + 6}" width="${w - 56}" height="15" rx="7.5"/>`;
  h += `<g class="plock" transform="translate(${x + 53},${y + 8})"><rect y="4.5" width="8" height="6.5" rx="1"/><path d="M1.8 5V3.4a2.2 2.2 0 0 1 4.4 0V5"/></g>`;
  if (w > 220) h += `<text class="paddrt" x="${x + 66}" y="${y + 17.5}">https://www.example.com/</text>`;
  if (warn && stage >= 1) {
    const cx = x + w / 2, ty = top + hh * 0.08;
    h += `<path class="pwarn" d="M${cx} ${ty}l${hh * 0.17} ${hh * 0.3}h${-hh * 0.34}z"/><path class="pwarnx" d="M${cx} ${ty + hh * 0.1}v${hh * 0.1}M${cx} ${ty + hh * 0.25}v.5"/>`;
    h += `<text class="pwarnt" x="${cx}" y="${ty + hh * 0.43}">Your connection isn’t private</text>`;
    for (let k = 0; k < 2; k++) h += `<rect class="pblock" x="${ix + iw * 0.12}" y="${ty + hh * 0.52 + k * 12}" width="${iw * (k ? 0.56 : 0.76)}" height="5" rx="2"/>`;
    h += `<rect class="pbtn" x="${cx - iw * 0.2}" y="${ty + hh * 0.52 + 30}" width="${iw * 0.4}" height="${Math.max(18, hh * 0.1)}" rx="4"/>`;
    h += `<text class="pstage" x="${x + w / 2}" y="${y + hh + 26}">The browser refuses to load the page</text>`;
    return h + '</g>';
  }
  if (stage >= 1) {
    const hb = hh * 0.16, picW = iw * 0.38, picH = hh * 0.34, rowY = top + hb + 12;
    h += `<rect class="${styled ? 'phead' : 'pblock'}" x="${ix}" y="${top}" width="${iw}" height="${hb}" rx="3"/>`;
    h += `<rect class="${styled ? 'ptitle' : 'pblock2'}" x="${ix + 10}" y="${top + hb * 0.32}" width="${iw * 0.45}" height="${hb * 0.36}" rx="2"/>`;
    if (stage >= 3) {
      h += `<g class="ppic"><rect x="${ix}" y="${rowY}" width="${picW}" height="${picH}" rx="3"/><circle cx="${ix + picW * 0.72}" cy="${rowY + picH * 0.3}" r="${picH * 0.12}"/><path d="M${ix} ${rowY + picH}l${picW * 0.35} ${-picH * 0.55} ${picW * 0.2} ${picH * 0.25} ${picW * 0.2} ${-picH * 0.2} ${picW * 0.25} ${picH * 0.5}z"/></g>`;
    } else {
      h += `<rect class="pblock" x="${ix}" y="${rowY}" width="${picW}" height="${picH}" rx="3"/>`;
    }
    for (let k = 0; k < 4; k++) {
      h += `<rect class="${styled ? 'ptext' : 'pblock'}" x="${ix + picW + 12}" y="${rowY + 4 + k * (picH / 4.2)}" width="${(iw - picW - 12) * (k === 3 ? 0.6 : 1)}" height="${Math.max(4, picH / 9)}" rx="2"/>`;
    }
    for (let k = 0; k < 2; k++) {
      h += `<rect class="${styled ? 'ptext' : 'pblock'}" x="${ix}" y="${rowY + picH + 12 + k * 12}" width="${iw * (k ? 0.7 : 1)}" height="${Math.max(4, picH / 9)}" rx="2"/>`;
    }
  }
  if (stage >= 4) {
    h += `<g class="pdone" transform="translate(${x + w - 6},${y + hh - 6})"><circle r="15"/><path d="M-6 0l4 4 8-8"/></g>`;
  }
  if (stage >= 1) h += `<text class="pstage" x="${x + w / 2}" y="${y + hh + 26}">${esc(PAGE_STAGES[stage])}</text>`;
  return h + '</g>';
}

/* ---------- chain of trust (step field `chain`) ----------
   chain: {at: actor that checks, cards: [{name, checks: [[text, ok = true, who]]}], check: card index | 'all'}
   cards run from the site's certificate (0) up to the root. Cards below `check` show as already passed. */
function chainRange(c) {
  const from = c.check === 'all' ? 0 : c.check, to = c.check === 'all' ? c.cards.length - 1 : c.check;
  const list = [];
  for (let k = from; k <= to; k++) c.cards[k].checks.forEach((_, j) => list.push([k, j]));
  return { from, to, list };
}
function chainState(c, pos) {
  const { from, to, list } = chainRange(c), shown = list.slice(0, pos);
  const revealed = (k) => (k < from ? c.cards[k].checks.length : shown.filter(([kk]) => kk === k).length);
  const failedAt = shown.findIndex(([k, j]) => c.cards[k].checks[j][1] === false);
  const last = shown.at(-1), who = last ? c.cards[last[0]].checks[last[1]][2] : null;
  const passed = (k) => revealed(k) === c.cards[k].checks.length && !c.cards[k].checks.slice(0, revealed(k)).some((x) => x[1] === false);
  const complete = pos >= list.length;
  // the card in focus: the one whose check comes next, or the last one once everything is shown
  const focus = complete ? (failedAt >= 0 ? shown[failedAt][0] : to) : list[pos][0];
  return { from, to, revealed, passed, failed: failedAt >= 0, who, complete, focus, trusted: complete && failedAt < 0 && to === c.cards.length - 1 };
}
function chainPanel(g, c, s) {
  const n = c.cards.length, w = g.small ? g.W - 24 : Math.min(360, g.W * 0.5), x = g.small ? 12 : 16;
  const row = g.small ? 20 : 23, gap = g.small ? 16 : 30, head = g.small ? 29 : 34;
  // On phones only the card in focus opens up; the rest collapse to one line with their result.
  const collapsed = (k) => g.small && k !== s.focus;
  const cardH = (k) => (collapsed(k) ? head : head + c.cards[k].checks.length * row + 6);
  let y = 0, h = '';
  const tops = [];
  for (let k = n - 1; k >= 0; k--) { tops[k] = y; y += cardH(k) + gap; }
  for (let k = n - 1; k >= 0; k--) {
    const top = tops[k], card = c.cards[k], rev = s.revealed(k), inRange = k >= s.from && k <= s.to;
    const bad = card.checks.slice(0, rev).some((x) => x[1] === false), ok = s.passed(k);
    const current = inRange && !s.complete && rev < card.checks.length && (k === s.from || s.passed(k - 1));
    h += `<rect class="ccard${ok ? ' ok' : ''}${bad ? ' bad' : ''}${current ? ' cur' : ''}" x="${x}" y="${top}" width="${w}" height="${cardH(k)}" rx="8"/>`;
    h += `<g class="ico cico" transform="translate(${x + 10},${top + 7}) scale(.8)">${ICONS.seal}</g>`;
    h += `<text class="cname" x="${x + 36}" y="${top + 22}">${esc(card.name)}</text>`;
    if (collapsed(k)) {
      if (ok) h += `<g class="ctick" transform="translate(${x + w - 18},${top + 15})"><circle r="8"/><path d="M-3.5 0l2.5 2.6 4.6-5"/></g>`;
      else if (bad) h += `<g class="ccross" transform="translate(${x + w - 18},${top + 15})"><circle r="8"/><path d="M-3 -3l6 6M3 -3l-6 6"/></g>`;
    } else card.checks.forEach(([text, good = true], j) => {
      const cy = top + head + j * row + 12, shownNow = j < rev;
      if (shownNow && good) h += `<g class="ctick" transform="translate(${x + 20},${cy - 4})"><circle r="8"/><path d="M-3.5 0l2.5 2.6 4.6-5"/></g>`;
      else if (shownNow) h += `<g class="ccross" transform="translate(${x + 20},${cy - 4})"><circle r="8"/><path d="M-3 -3l6 6M3 -3l-6 6"/></g>`;
      else h += `<circle class="cpend" cx="${x + 20}" cy="${cy - 4}" r="7"/>`;
      h += `<text class="ctext${shownNow ? (good ? '' : ' no') : ' wait'}" x="${x + 36}" y="${cy}">${esc(text)}</text>`;
    });
    if (k < n - 1) {
      // the link between this card and the one above: solid once this card passes, broken if it failed
      const ly = top - gap + (g.small ? -3 : 0), cx = x + 34, state = ok ? 'ok' : bad ? 'bad' : 'wait';
      h += `<g class="clink ${state}"><rect x="${cx - 6}" y="${ly + 2}" width="12" height="16" rx="6"/><rect x="${cx - 6}" y="${ly + 12}" width="12" height="16" rx="6"/></g>`;
    }
  }
  const foot = y - gap + 22, y0 = 14 + g.inset;
  // On short scenes (phones) shrink the whole panel so the verdict line still fits.
  const sc = Math.min(1, (g.H - 8 - y0) / (foot + 6));
  if (s.trusted) h += `<g class="cverdict ok"><text x="${x + 6}" y="${foot}">✓ Every link holds: trusted</text></g>`;
  else if (s.failed && s.complete) h += `<g class="cverdict bad"><text x="${x + 6}" y="${foot}">✗ The chain is broken: not trusted</text></g>`;
  h = `<g class="chain" transform="translate(${x * (1 - sc)},${y0}) scale(${sc})">${h}</g>`;
  // padlock on the checking actor once the whole chain is trusted
  const at = g.P[c.at];
  if (at && !g.small && s.trusted) h += `<g class="lockb" transform="translate(${at.x + g.r * 0.8},${at.y - g.r * 0.8})"><circle r="12"/><rect x="-4.5" y="-1" width="9" height="7" rx="1.2"/><path d="M-2.6 -1v-2.2a2.6 2.6 0 0 1 5.2 0V-1"/></g>`;
  if (at && !g.small && s.failed && s.complete) h += `<g class="lockb bad" transform="translate(${at.x + g.r * 0.8},${at.y - g.r * 0.8})"><circle r="12"/><path d="M-4 -4l8 8M4 -4l-8 8"/></g>`;
  return h;
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
  step = i; done = 0; pkt = null; pageStage = 0; chainPos = 0; mixT = cur.steps[i].mix ? 0 : 1;
  const st = cur.steps[i], ms = st.m || [], chainLen = st.chain ? chainRange(st.chain).list.length : 0;
  if (instant || RM.matches) { done = ms.length; pageStage = 4; chainPos = chainLen; mixT = 1; draw(); return; }
  draw();
  await wait(200);
  for (let k = 0; k < ms.length; k++) {
    if (tok !== token) return;
    await fly(k, tok);
    if (tok !== token) return;
    pkt = null; done = k + 1; landedAt = performance.now(); draw();
    await wait(300);
  }
  if (st.mix) {
    await wait(500);
    if (tok !== token) return;
    await new Promise((res) => {
      const t0 = performance.now();
      const f = (now) => {
        if (tok !== token) return res();
        mixT = Math.min(1, (now - t0) / 1400);
        draw();
        mixT < 1 ? requestAnimationFrame(f) : res();
      };
      requestAnimationFrame(f);
    });
    if (tok !== token) return;
  }
  for (let k = 1; k <= chainLen; k++) {
    await wait(k === 1 ? 500 : 950);
    if (tok !== token) return;
    chainPos = k; draw();
  }
  if (st.page && st.warn) {
    await wait(1200);
    if (tok !== token) return;
    pageStage = 4; draw();
  } else if (st.page) {
    for (let k = 1; k <= 4; k++) {
      await wait(k === 1 ? 500 : 1300);
      if (tok !== token) return;
      pageStage = k; draw();
    }
  }
  // Replay while the reader stays on this step, but never while they're looking inside
  // a packet, the tab is hidden, or a zoom is under way.
  await wait(REPLAY_MS);
  while (tok === token && (!pop.hidden || document.hidden || busy)) await wait(1000);
  if (tok === token) run(i);
}
function activate(i, instant) {
  if (i === active) return;
  active = i;
  hidePop();
  for (const c of cards) c.classList.toggle('on', +c.dataset.i === i);
  if (!cur.steps) return;
  const n = cur.steps.length;
  if (i < 0) { token++; step = -1; done = 0; pkt = null; mixT = 1; draw(); }
  else if (i >= n) {
    token++; step = n - 1; done = (cur.steps[n - 1].m || []).length; pageStage = 4; pkt = null; mixT = 1;
    chainPos = cur.steps[n - 1].chain ? chainRange(cur.steps[n - 1].chain).list.length : 0;
    draw();
  }
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
const POSTCARD = '<svg viewBox="0 0 64 38" aria-hidden="true"><g class="chip kp"><rect class="pc" x="1" y="1" width="62" height="36" rx="3"/><path class="pm" d="M19 13q3.5-3 7 0t7 0M19 19q3.5-3 7 0t7 0M19 25q3.5-3 7 0t7 0"/><rect class="stamp" x="36" y="6" width="23" height="26" rx="1"/><path class="house" d="M41.5 18l6-5 6 5v7h-12z"/></g></svg>';
const ENVELOPE = '<svg viewBox="0 0 64 38" aria-hidden="true"><g class="chip ke"><rect class="env" x="1" y="1" width="62" height="36" rx="3"/><path class="flap" d="M3 3L32 16L61 3"/><circle class="seal" cx="32" cy="16" r="5.5"/><path class="sealx" d="M29.4 16h5.2M32 13.4v5.2"/></g></svg>';

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
        + (s.m?.length ? '<p class="peek-hint">Click or tap any postcard or envelope in the picture to see what’s inside.</p>' : '')
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
    + `<span class="here" aria-current="location">${esc(cur.title)}</span>`;
  const p = trail.at(-1);
  backBtn.hidden = !p;
  if (p) {
    backBtn.innerHTML = `↑ Back out<span class="bo-to"> to ${esc(nameOf(p.id))}</span>`;
    backBtn.setAttribute('aria-label', `Back out to ${nameOf(p.id)}`);
    backBtn.dataset.back = trail.length - 1;
  }
}
function renderMenu() {
  $('#menuList').innerHTML = GROUPS.map(([g, ids]) => `<h3>${esc(g)}</h3>` + ids.map((id) =>
    `<a href="#${id}"${id === curId ? ' aria-current="page"' : ''}>${esc(TOPICS[id].title)}<small>${TOPICS[id].steps ? (seen[id] ? '✓ seen' : '') : 'soon'}</small></a>`).join('')).join('');
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
  p: ['A postcard', 'Anyone who handles it along the way can read it, and could change it.'],
  e: ['A sealed envelope', 'Only the two ends hold the key. Anyone else sees scrambled bytes, and any change would be detected.'],
  x: ['Forgery', 'Made by the attacker to look like the real thing.'],
  l: ['Lost on the way', 'It never arrived. With no reply, the sender will notice and send it again.'],
};
function showPop(i, el) {
  const m = cur.steps[step]?.m?.[i];
  if (!m) return;
  if (!peeked) { markPeeked(); draw(); el = svg.querySelector(`.chip[data-m="${i}"]`) || el; }
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
// The header stays pinned; the scene sits just below it, so publish its height to CSS.
const header = $('.top');
const headerRo = new ResizeObserver(() => document.documentElement.style.setProperty('--hh', `${header.offsetHeight}px`));
headerRo.observe(header);

const start = TOPICS[location.hash.slice(1)] ? location.hash.slice(1) : 'journey';
load(start);
onScroll();
