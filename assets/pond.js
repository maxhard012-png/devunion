// DevUnion — ASCII pond. Own engine: fish are rasterised into a fine glyph grid, every cell a coloured glyph,
// blitted from a pre-drawn atlas (drawImage is far cheaper than fillText, which is what lets the grid be this fine).
// Any element with data-guide owns one fish: hover calls it over, click sends it into the element and then navigates.
// The page decides who lives in it: <canvas id="pond" data-fish="hammer,minnows">; no list means everyone.
(() => {
'use strict';
const $$ = s => [...document.querySelectorAll(s)];
const canvas = document.getElementById('pond');
if (!canvas) return;
const ctx = canvas.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ── palette ──────────────────────────────────────────────────────────
// colours for light water: tiles are tints of these, glyphs are a deep shade of the same hue
const PAL = [
  [112, 150, 150],  // 0 hammerhead: slate teal
  [96, 110, 196],   // 1 mako: metallic indigo
  [186, 146, 102],  // 2 nurse: tawny
  [232, 110, 40],   // 3 koi orange
  [214, 210, 200],  // 4 koi white: a warm grey, or it vanishes into the water
  [40, 38, 38],     // 5 koi black
  [206, 52, 44],    // 6 kohaku red
  [110, 140, 180],  // 7 sardine silver-blue
  [140, 150, 146],  // 8 small grey fish
  [120, 128, 130],  // 9 water: dust, wakes, ripples
];
const GUIDE_DOT = { hammer: 0, mako: 1, nurse: 2, koi: 3, koi3: 4, koi2: 6, school: 7 };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// more colour, same lightness: each channel pushed away from the grey of its own mean
const vivid = (c, k) => { const m = (c[0] + c[1] + c[2]) / 3; return c.map(v => clamp(Math.round(m + (v - m) * k), 0, 255)); };
const rgba = (c, a) =>`rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
const ACCENT = [[204, 64, 118], [32, 148, 140], [122, 80, 206], [204, 146, 34]];   // pink, teal, violet, gold
// per colour: the skin, the skin of a called fish (a touch deeper and more saturated), the glyph ink, and the tint of the
// light pool under a called fish
const LOOK = PAL.map(c => {
  const m = (c[0] + c[1] + c[2]) / 3;
  const hot = c.map(v => clamp(Math.round(m + (v - m) * 1.3 - 8), 0, 255));
  return { base: c, hot, ink: mix(c, BLACK, 0.58), glow: mix(c, WHITE, 0.35),
    // scale tiles, as in the reference: every cell is a small square in its own shade of the fish, from pale to near black,
    // plus a rare muted accent. tone(t, hue) gives the square; the glyph on it inverts (dark on pale, light on dark)
    accent: mix(ACCENT[PAL.indexOf(c) % ACCENT.length], [128, 128, 128], 0.3) };
});

// glyphs: 0–8 tone ramp, 9 eye, 10–13 fin rays by direction, 14 dot, 15 wave, 16+ extra scale characters
const GLYPHS = '.:-=+*%#@o-\\|/.~,;\'tSxX8& ';     // the last, a space, is a bare tile
// scale characters by tone, light skin to deep shadow, as in the reference: a cell picks one by its place on the body
const BANDS = ['.,:\'', ':;-=', '=+tx', '%Sx*', 'X8#%', '8#@&'].map(set => [...set].map(ch => GLYPHS.indexOf(ch)));
const NG = GLYPHS.length, RAMP_N = 9, G_EYE = 9, G_RAY = 10, G_WAVE = 15, G_BARE = NG - 1;
const LEVELS = 8, NC = PAL.length, NT = 3;         // sprite types: 0 body, 1 lit body, 2 glyph only (fins, water dots)
const NV = 6;                                      // tile tones per body sprite: 0 pale … 4 near black, 5 accent
const SPR_COLS = 128;

// ── grid + atlas ─────────────────────────────────────────────────────
let W = 0, H = 0, dpr = 1, CW = 6, CH = 7, cols = 0, rows = 0, scale = 1;
let val, col, own, dep, gly, wakeB;
// what is on screen, per cell: it chases this frame's stamp and fades out after the fish has left (phosphor persistence)
let showV, showC, showG, showO, showK, keyB, bandB;
let shimT = 0;                                     // scale-shimmer clock: stops with the pause, slows with reduced motion
let atlas, actx, sw = 0, sh = 0, painted;
function resize() {
  W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const small = W < 640;
  CW = small ? 6 : 8; CH = small ? 7 : 9;   // tiles big enough to read as squares, as in the reference
  scale = Math.max(0.38, Math.min(1.15, W / 1440)) * 1.9;      // fish 1.3× larger than the first pass (client: «рыбок чуть побольше»)
  cols = Math.ceil(W / CW) + 1; rows = Math.ceil(H / CH) + 1;
  const n = cols * rows;
  val = new Float32Array(n); col = new Uint8Array(n); own = new Int16Array(n);
  dep = new Float32Array(n); gly = new Uint8Array(n);
  wakeB = new Float32Array(n);
  showV = new Float32Array(n); showC = new Uint8Array(n); showG = new Uint8Array(n); showO = new Int16Array(n);
  showK = new Uint32Array(n); keyB = new Uint32Array(n); bandB = new Uint8Array(n);
  buildAtlas(); buildWaves();
  fish.forEach(f => f.rescale && f.rescale());
}
// Sprite layout: body sprites, plain and lit, come in NV tile tones (the shimmer); glyph-only sprites in one.
// Keys: [0, N0) plain body, [N0, 2·N0) lit body, then glyph-only.
let N0 = 0, N1 = 0;
function buildAtlas() {
  sw = Math.ceil(CW * dpr); sh = Math.ceil(CH * dpr);
  N0 = NC * LEVELS * NG * NV; N1 = N0;
  const total = 2 * N0 + NC * LEVELS * NG;
  atlas = document.createElement('canvas');
  atlas.width = SPR_COLS * sw; atlas.height = Math.ceil(total / SPR_COLS) * sh;
  actx = atlas.getContext('2d');
  actx.textAlign = 'center'; actx.textBaseline = 'middle';
  actx.font = `600 ${Math.round(CH * 1.02 * dpr)}px 'JetBrains Mono', ui-monospace, monospace`;
  painted = new Uint8Array(total);       // sprites are painted lazily, the first time a cell asks for them
}
function paint(key) {
  let type, c, lv, g, vr = 0, k = key;
  if (k < N0 + N1) { type = k < N0 ? 0 : 1; if (type) k -= N0; vr = k % NV; k = (k / NV) | 0; } else { type = 2; k -= N0 + N1; }
  g = k % NG; lv = ((k / NG) | 0) % LEVELS; c = ((k / (NG * LEVELS)) | 0) % NC;
  const x = (key % SPR_COLS) * sw, y = ((key / SPR_COLS) | 0) * sh, v = lv / (LEVELS - 1), L = LOOK[c];
  if (type === 0 || type === 1) {
    // a square in one of five shades of the fish (a called fish, type 1, in its saturated hue) or the accent, with a
    // hairline gap to its neighbours; value fades the cell in and out, so a cell a fish is leaving dims instead of
    // switching off. The glyph inverts against its square, so it always reads
    const hue = type ? L.hot : L.base, inset = Math.max(1, Math.round(dpr * 0.5));
    // a narrow band of shades around the fish's own colour: varied enough to read as scales, close enough to read as one skin
    // On night water the colours are pushed richer (the muted daylight skins read as grey on a dark page), the band runs
    // from that rich hue down a step, and every glyph is light, so the fish glow out of the dark
    const nh = night ? vivid(hue, 1.7) : hue;
    const tile = night ? (vr === 5 ? mix(vivid(L.accent, 1.2), nh, 0.25) : mix(nh, mix(nh, BLACK, 0.4), vr / 4))
      : vr === 5 ? mix(L.accent, hue, 0.45) : mix(mix(hue, WHITE, 0.28), mix(hue, BLACK, 0.34), vr / 4), dark = night || vr === 4;
    actx.fillStyle = rgba(tile, night ? 0.38 + 0.6 * v : 0.3 + 0.62 * v);
    actx.fillRect(x + inset * 0.5, y + inset * 0.5, sw - inset, sh - inset);
    actx.fillStyle = dark ? rgba(mix(nh, WHITE, 0.8), 0.55 + 0.45 * v) : rgba(mix(hue, BLACK, 0.72), 0.45 + 0.55 * v);
    actx.fillText(GLYPHS[g], x + sw / 2, y + sh / 2 + dpr * 0.5);
  } else {
    const ink = night ? (c === 9 ? mix(L.base, WHITE, 0.15) : mix(L.base, WHITE, 0.3)) : c === 9 ? L.base : L.ink;
    actx.fillStyle = c === 9 ? rgba(ink, (night ? 0.1 : 0.14) + 0.56 * v) : rgba(ink, 0.3 + 0.7 * v);
    actx.fillText(GLYPHS[g], x + sw / 2, y + sh / 2);
  }
  painted[key] = 1;
}
function blit(type, c, lv, g, X, Y, vr = 0) {
  const k = (c * LEVELS + lv) * NG + g, key = type === 2 ? N0 + N1 + k : type * N0 + k * NV + vr;
  if (!painted[key]) paint(key);
  ctx.drawImage(atlas, (key % SPR_COLS) * sw, ((key / SPR_COLS) | 0) * sh, sw, sh, X, Y, CW, CH);
}
// theme: the page's <html data-theme> is light, dark or system (follow the device). Night water repaints the atlas
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
let night = false;
const readTheme = () => { const t = document.documentElement.dataset.theme; night = t === 'dark' || (t === 'system' && darkMQ.matches); };
function tintButtons() {
  for (const b of $$('[data-guide]')) {
    const c = PAL[GUIDE_DOT[b.dataset.guide]];
    // deep enough for borders and labels on light glass; lifted on dark glass
    if (c) b.style.setProperty('--btn-fish', `rgb(${(night ? mix(c, WHITE, 0.3) : mix(c, BLACK, 0.35)).join(',')})`);
  }
}
readTheme(); tintButtons();

// ── stamping into the grid ───────────────────────────────────────────
let curId = 0, curDepth = 0;
// glyph code per cell: 0 = pick from the tone ramp, 1 = eye, 2–5 = fin ray (− \ | /); +8 = sheer: glyph only, no tile
function stamp(x, y, v, c, g, key = 0) {
  const cx = (x / CW) | 0, cy = (y / CH) | 0;
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
  const i = cy * cols + cx;
  if (own[i] === curId) {
    if (g === 1 || (v > val[i] && gly[i] !== 1) || (gly[i] >= SHEER && g < SHEER)) { val[i] = Math.max(v, val[i]); col[i] = c; gly[i] = g; keyB[i] = key; }
    return;
  }
  if (own[i] >= 0 && dep[i] > curDepth) return;
  own[i] = curId; dep[i] = curDepth; val[i] = v; col[i] = c; gly[i] = g; keyB[i] = key;
}
function stampWake(x, y, v) {
  const cx = (x / CW) | 0, cy = (y / CH) | 0;
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
  const i = cy * cols + cx;
  if (v > wakeB[i]) wakeB[i] = v;
}
// a fin ray glyph follows the direction from the fin root to the cell, so fins read as fanned rays
const rayCode = (dx, dy) => 2 + (((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 4) + 4) % 4);
const SHEER = 8;
function stampTri(ax, ay, bx, by, cx, cy, v, c, rays) {
  const step = Math.min(CW, CH) * 0.45;
  const minx = Math.min(ax, bx, cx), maxx = Math.max(ax, bx, cx), miny = Math.min(ay, by, cy), maxy = Math.max(ay, by, cy);
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-3) return;
  for (let y = miny; y <= maxy; y += step) for (let x = minx; x <= maxx; x += step) {
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const edge = Math.min(l2, l3) < 0.12 ? 0.7 : 1;                // soft outer edge
    stamp(x, y, v * (0.5 + 0.5 * l1) * edge, c, rays ? rayCode(x - ax, y - ay) + SHEER : 0);
  }
}
function stampLine(ax, ay, bx, by, v, c) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (Math.min(CW, CH) * 0.5)));
  for (let k = 0; k <= n; k++) { const t = k / n; stamp(ax + (bx - ax) * t, ay + (by - ay) * t, v * (1 - t * 0.4), c, rayCode(bx - ax, by - ay) + SHEER); }
}

// ── body plans: half-width tables along the length (u, w/L) ───────────
const lerpTable = (t, u) => {
  for (let i = 1; i < t.length; i++) if (u <= t[i][0]) {
    const [u0, w0] = t[i - 1], [u1, w1] = t[i];
    return w0 + (w1 - w0) * (u - u0) / (u1 - u0);
  }
  return 0;
};
// gait: 'cruise' is a shark's steady sweep; 'burst' is a koi's kick-and-glide
const PLANS = {
  hammer: { len: 300, speed: 46, turn: 0.9, wander: 0.32, wave: 0.05, col: 0, depth: 3, gait: 'cruise',
    body: [[0, .02], [.05, .03], [.1, .045], [.28, .068], [.45, .058], [.65, .034], [.84, .013], [1, .006]] },
  mako: { len: 250, speed: 55, turn: 1.1, wander: 0.38, wave: 0.045, col: 1, depth: 2.6, gait: 'cruise',
    body: [[0, 0], [.06, .025], [.16, .05], [.32, .066], [.5, .05], [.7, .028], [.84, .011], [1, .005]] },
  nurse: { len: 270, speed: 28, turn: 0.75, wander: 0.28, wave: 0.06, col: 2, depth: 2.2, gait: 'cruise',
    body: [[0, .04], [.04, .062], [.2, .085], [.4, .08], [.6, .055], [.8, .03], [1, .012]] },
  koi: { len: 150, speed: 38, turn: 2.0, wander: 0.7, wave: 0.075, col: 3, depth: 1.4, gait: 'burst', koi: [3, 4, 5],
    body: [[0, .03], [.05, .07], [.2, .105], [.42, .1], [.62, .07], [.76, .036], [.8, .03], [1, 0]] },
  koi2: { len: 138, speed: 40, turn: 2.1, wander: 0.75, wave: 0.075, col: 6, depth: 1.2, gait: 'burst', koi: [6, 4, 4],
    body: [[0, .03], [.05, .07], [.2, .1], [.42, .098], [.62, .068], [.76, .035], [.8, .03], [1, 0]] },
  koi3: { len: 118, speed: 34, turn: 2.2, wander: 0.8, wave: 0.08, col: 4, depth: 1.0, gait: 'burst', koi: [4, 3, 5],
    body: [[0, .03], [.05, .07], [.2, .1], [.42, .098], [.62, .068], [.76, .035], [.8, .03], [1, 0]] },
};
// tables are drawn true to the animal; on a glyph grid that reads too thin, so every body gets a little more girth
for (const p of Object.values(PLANS)) p.body = p.body.map(([u, w]) => [u, w * 1.3]);

// smooth 2D value noise: koi patches ride on the body, and every fish's wandering is driven by it
function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = t => t * t * (3 - 2 * t), u = s(xf), v = s(yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ── world state shared by the behaviours ─────────────────────────────
const fish = [];
const pointer = { x: 0, y: 0, on: false, moved: 0 };
const ripples = [];
const dust = [];
const foam = [];
let guides = {}, clock = 0;

const SEG = 36;
const MAX_JOINT = 14 * Math.PI / 180;      // the most one spine joint may bend from its neighbour
class Fish {
  constructor(kind, id) {
    this.kind = kind; this.p = PLANS[kind]; this.id = id; this.seed = Math.random() * 1000;
    this.x = W * (0.1 + Math.random() * 0.8); this.y = H * (0.1 + Math.random() * 0.8); this.a = Math.random() * TAU;
    this.v = 0; this.omega = 0; this.phase = Math.random() * TAU; this.amp = 1;
    this.kickT = Math.random(); this.heading = this.a; this.nextTurn = 0; this.stroke = 1; this.power = 1; this.foamAcc = 0; this.fin = 0.5; this.glow = 0; this.mode = 'free'; this.z = 0.5; this.startle = 0;
    this.nibbleT = 0;
    // the long script: pace changes, koi lingering, and leaving the frame to come back elsewhere
    this.pace = 1; this.paceGoal = 1; this.paceT = 0; this.linger = 0; this.away = false; this.awayT = 0; this.enteredAt = 0; this.bold = Math.random() < 0.7;
    this.sx = new Float32Array(SEG); this.sy = new Float32Array(SEG); this.nx = new Float32Array(SEG); this.ny = new Float32Array(SEG);
    this.rescale(); this.v = this.spd; this.resetTrail();
  }
  // speed follows body size, so a fish crosses the same share of its own length per second on any screen (on a big screen
  // the bodies grow; with fixed px/s they looked sluggish), and 1.05× the first pass: 1.3× read as darting (client, 2026-10-21)
  rescale() { this.L = this.p.len * scale; this.spd = this.p.speed * (scale / 1.9) * 1.05; }
  resetTrail() {
    this.trail = [];
    for (let i = 0; i < 300; i++) this.trail.push([this.x - Math.cos(this.a) * i * 2, this.y - Math.sin(this.a) * i * 2]);
  }
  pickTarget() {}   // kept for callers: free swimming no longer chases random points
  // fully out of the frame, head and tail: the fish is gone for a while instead of looping round just past the edge
  offscreen() {
    const out = (x, y) => x < -30 || x > W + 30 || y < -30 || y > H + 30;
    return out(this.x, this.y) && out(this.sx[SEG - 1], this.sy[SEG - 1]);
  }
  // come back across a random edge (or the edge nearest a calling element), already swimming in, body trailing outside
  reenter(t, toward) {
    let ex, ey, tx, ty;
    if (toward) {
      const r = toward.getBoundingClientRect(); tx = r.left + r.width / 2; ty = r.top + r.height / 2;
      const d = [tx, W - tx, ty, H - ty], e = d.indexOf(Math.min(...d));
      ex = e === 0 ? 0 : e === 1 ? W : tx; ey = e === 2 ? 0 : e === 3 ? H : ty;
    } else {
      const e = Math.random() * 2 * (W + H), m = this.L * 0.1;
      if (e < W) { ex = e; ey = -m; } else if (e < W + H) { ex = W + m; ey = e - W; } else if (e < 2 * W + H) { ex = e - W - H; ey = H + m; } else { ex = -m; ey = e - 2 * W - H; }
      tx = W * (0.2 + Math.random() * 0.6); ty = H * (0.2 + Math.random() * 0.6);
    }
    this.a = this.heading = Math.atan2(ty - ey, tx - ex);
    this.x = ex - Math.cos(this.a) * this.L * 0.1; this.y = ey - Math.sin(this.a) * this.L * 0.1;
    this.omega = 0; this.v = this.spd; this.nextTurn = t + 4000; this.enteredAt = t;
    this.away = false; this.bold = Math.random() < 0.7;
    this.resetTrail();
  }
  // Steering works on angular velocity, never on heading directly: every turn eases in and out, so paths are curves, not corners.
  steer(dt, t) {
    const p = this.p, L = this.L;
    let want = this.spd, turnMax = p.turn, resp = 1.6;
    const sharkish = p.gait === 'cruise';
    // 0. Every 8–20 s the fish changes pace (unhurried, normal, brisk); now and then a koi lingers in one spot for a while,
    //    pottering about slowly. Over a minute no two fish follow the same rhythm.
    if (t > this.paceT) {
      const r = Math.random();
      this.paceGoal = r < 0.3 ? 0.65 : r < 0.8 ? 1 : 1.2;
      this.paceT = t + 8000 + Math.random() * 12000;
      this.linger = !sharkish && r < 0.22 ? t + 6000 + Math.random() * 8000 : 0;
    }
    this.pace += (this.paceGoal - this.pace) * Math.min(1, dt * 0.5);
    const lingering = t < this.linger;
    want *= lingering ? 0.45 : this.pace;
    // 1. Seen from above a fish swims nearly straight and turns in decisions: pick a new heading, ease into it, go straight again.
    // A long steady turn rate instead draws arcs and loops, which read as a body thrown and falling, i.e. side view.
    if (t > this.nextTurn) {
      this.heading = this.a + (Math.random() < 0.5 ? -1 : 1) * (lingering ? 0.7 + Math.random() * 1.2 : 0.4 + Math.random() * (sharkish ? 0.7 : 1.3));
      this.nextTurn = t + (lingering ? 1500 + Math.random() * 2000 : sharkish ? 5000 + Math.random() * 6000 : 3000 + Math.random() * 3500);
      if (!sharkish) this.kickT = 0;          // a koi turns with a stroke
    }
    let target = clamp(angDiff(this.heading, this.a) * 1.4, -turnMax * 0.6, turnMax * 0.6)
      + (vnoise(t * 0.0005 + this.seed, this.seed) - 0.5) * p.wander * 0.3;   // only a faint meander on the straight
    let goal = null, weight = 0;
    // 2. soft walls: fish may cross the frame and turn back off-screen, the way a pond seen from above is framed; only a look-ahead
    //    well past the edge turns them home
    const look = L * 0.3 + this.v * 0.8, lx = this.x + Math.cos(this.a) * look, ly = this.y + Math.sin(this.a) * look, m = this.bold ? -L * 0.95 : -L * 0.35;
    const over = Math.max(m - lx, lx - (W - m), m - ly, ly - (H - m), 0);
    if (over > 0) {
      if (!this.home || this.homeT < t) { this.home = [W * (0.12 + Math.random() * 0.76), H * (0.12 + Math.random() * 0.76)]; this.homeT = t + 4000; }
      goal = Math.atan2(this.home[1] - this.y, this.home[0] - this.x); weight = clamp(over / (L * 0.6), 0.25, 1);
      this.heading = goal; this.nextTurn = t + 3000;   // commit to the new course instead of curling along the wall
    }
    // 3. room: big bodies drift apart instead of stacking
    for (const o of fish) if (o !== this && o.L) {
      const dx = this.x - o.x, dy = this.y - o.y, d = Math.hypot(dx, dy), lim = (L + o.L) * 0.24;
      if (d < lim && d > 1 && weight < 0.5) { goal = Math.atan2(dy, dx); weight = 0.5 * (1 - d / lim); }
    }
    // 4. koi are curious: a resting cursor gathers them, and they nibble at the surface under it
    if (this.mode === 'free' && p.gait === 'burst' && pointer.on && t - pointer.moved > 900) {
      const dx = pointer.x - this.x, dy = pointer.y - this.y, d = Math.hypot(dx, dy);
      if (d < 520) {
        goal = Math.atan2(dy, dx); weight = 0.9;
        want = d > L * 0.75 ? this.spd * 0.9 : this.spd * 0.06;
        if (d < L * 0.9 && (this.nibbleT -= dt) < 0) {
          this.nibbleT = 0.7 + Math.random() * 0.9;
          ripples.push({ x: this.sx[0] + Math.cos(this.a) * 4, y: this.sy[0] + Math.sin(this.a) * 4, r: 0, max: 26, speed: 40 });
        }
      }
    }
    // 5. a startle (click in the water) overrides everything for a moment: bolt away
    if (this.startle > 0) {
      this.startle -= dt;
      goal = this.flee; weight = 1; want = this.spd * 2.2; turnMax *= 2.2; resp = 3.5;
    }
    // 6. called by a button or a catalogue row
    if (this.mode !== 'free' && this.btn) {
      const r = this.btn.getBoundingClientRect(), bx = r.left + r.width / 2, by = r.top + r.height / 2;
      resp = 4.5; turnMax *= 2.4;
      if (this.mode === 'call') { goal = Math.atan2(by - this.y, bx - this.x); weight = 1; want = this.spd * 3.6; }
      else {
        // the orbit hugs the element's own shape, so a wide row gets a lap along it, not a circle past its ends
        const rx = r.width / 2 + L * 0.18, ry = r.height / 2 + L * 0.25;
        const ex = (this.x - bx) / rx, ey = (this.y - by) / ry, far = Math.hypot(ex, ey) > 1.6;
        const ang = Math.atan2(ey, ex) + 0.9;
        const tx = far ? bx : bx + Math.cos(ang) * rx, ty = far ? by : by + Math.sin(ang) * ry;
        goal = Math.atan2(ty - this.y, tx - this.x); weight = 1;
        want = this.spd * (far ? 6 : 1.5);
      }
      target *= 0.15;
      // facing away, a called fish brakes into the turn instead of swinging round a huge arc at full speed
      if (goal !== null) want *= 1 - 0.65 * Math.min(1, Math.abs(angDiff(goal, this.a)) / Math.PI * 1.4);
    }
    if (goal !== null) target = target * (1 - weight) + clamp(angDiff(goal, this.a) * 2.4, -turnMax, turnMax) * weight;
    target = clamp(target, -turnMax, turnMax);
    this.omega += (target - this.omega) * Math.min(1, dt * resp);
    // a body cannot turn tighter than a radius tied to its own length: past that the spine folds into a hairpin.
    // On a big screen the bodies are large and the fixed turn rates did exactly that (kinks up to 170°).
    const wmax = Math.max(0.15, this.v / (L * (p.gait === 'cruise' ? 0.55 : 0.6)));
    this.omega = clamp(this.omega, -wmax, wmax);
    this.a += this.omega * dt;
    this.gait(dt, want);
  }
  // speed and tail beat come from the gait, so the body visibly works for its speed
  gait(dt, want) {
    const p = this.p, rel = want / this.spd;
    if (p.gait === 'burst') {
      // koi: a stroke, then a glide that bleeds speed. The stroke is a thrust envelope over ~0.8 s, never an impulse:
      // speed and tail sweep swell and settle, so seen from above the fish surges instead of jumping.
      if ((this.kickT -= dt) <= 0) {
        this.stroke = 0; this.power = 0.6 + 0.4 * Math.min(rel, 1.6);
        this.kickT = (1.0 + Math.random() * 1.0) / clamp(rel, 0.12, 4);
      }
      let thrust = 0;
      if (this.stroke < 0.8) { this.stroke += dt; thrust = Math.sin(Math.PI * Math.min(1, this.stroke / 0.8)) * this.power; }
      this.v += this.spd * 1.0 * thrust * dt;   // shorter, gentler strokes: speed swells ±30%, it never stalls
      this.v = Math.min(this.v * Math.exp(-dt * 0.35), this.spd * 2.4 * Math.max(1, rel));
      // a called koi still strokes, but its speed is pulled straight toward the goal: strokes alone took up to 5 s to arrive
      if (this.mode !== 'free') this.v += (want * 0.7 - this.v) * Math.min(1, dt * 2.5);
      this.amp += (0.32 + 0.9 * thrust - this.amp) * Math.min(1, dt * 3);
      this.phase += dt * (1.6 + 6 * this.amp);
    } else {
      // sharks: no bursts, a steady sweep; acceleration is slow and so is the beat
      this.v += (want - this.v) * Math.min(1, dt * (want > this.v ? (this.mode === 'free' ? 1.6 : 4) : 0.9));
      this.amp += (0.55 + 0.45 * Math.min(1.3, this.v / this.spd) - this.amp) * Math.min(1, dt * 2);
      this.phase += dt * (1.1 + (this.v / this.L) * 7);
    }
    // pectorals spread when slow or turning, tuck in when fast
    const finT = clamp(1.1 - this.v / (this.spd * 1.8) + Math.abs(this.omega) * 0.35, 0.15, 1);
    this.fin += (finT - this.fin) * Math.min(1, dt * 3);
  }
  move(dt, t) {
    this.x += Math.cos(this.a) * this.v * dt; this.y += Math.sin(this.a) * this.v * dt;
    // depth drifts slowly: deeper fish are dimmer and pass under shallower ones
    this.z = vnoise(t * 0.00005 + this.seed * 0.37, this.seed + 9);
    // near the surface the head pushes a bow wave: foam is shed at both cheeks and drifts outward, leaving a V
    const surface = clamp((this.z - 0.3) / 0.4, 0, 1);
    this.foamAcc += dt * 16 * surface * Math.min(1.6, this.v / this.spd);
    while (this.foamAcc > 1 && foam.length < 1400) {
      this.foamAcc -= 1;
      const a = this.at(0.06), push = 6 + this.v * 0.12;
      for (const s of [-1, 1]) foam.push({ x: a.x + a.nx * a.w * 1.15 * s, y: a.y + a.ny * a.w * 1.15 * s, vx: a.nx * push * s, vy: a.ny * push * s, life: 2.4, max: 2.4, k: 0.35 + 0.35 * surface });
    }
    // trail[0] is the live head; once it is 2 px past the last committed point it is committed and a new live head starts.
    // Measuring against the live point itself (which moves every frame) never commits at slow speeds: the body then
    // pivots around a stale point and the fish slides sideways.
    const h = this.trail[0], last = this.trail[1];
    h[0] = this.x; h[1] = this.y;
    if (Math.hypot(h[0] - last[0], h[1] - last[1]) >= 2) { this.trail.unshift([this.x, this.y]); if (this.trail.length > 500) this.trail.pop(); }
  }
  // the body follows the path the head took, plus a travelling wave growing toward the tail
  spine() {
    const { sx, sy, nx, ny, L, trail } = this, A = this.p.wave * L * this.amp;
    let acc = 0, j = 0;
    for (let i = 0; i < SEG; i++) {
      const want = (i / (SEG - 1)) * L;
      while (j < trail.length - 1) {
        const seg = Math.hypot(trail[j + 1][0] - trail[j][0], trail[j + 1][1] - trail[j][1]);
        if (acc + seg >= want) {
          const k = seg ? (want - acc) / seg : 0;
          sx[i] = trail[j][0] + (trail[j + 1][0] - trail[j][0]) * k; sy[i] = trail[j][1] + (trail[j + 1][1] - trail[j][1]) * k;
          break;
        }
        acc += seg; j++;
      }
      if (j >= trail.length - 1) { sx[i] = trail[trail.length - 1][0]; sy[i] = trail[trail.length - 1][1]; }
    }
    // Chain constraint: from the head back, a joint that bends more than MAX_JOINT is turned back to the limit, keeping its
    // link's own length; joints within the limit are left exactly where the path put them. Whatever the path does
    // (a re-entry, a dropped frame, a hairpin) the body then bends but can never fold, and ordinary swimming is untouched.
    const link = L / (SEG - 1);
    let dir = Math.atan2(sy[1] - sy[0], sx[1] - sx[0]);
    if (sx[1] === sx[0] && sy[1] === sy[0]) { dir = this.a + Math.PI; sx[1] = sx[0] + Math.cos(dir) * link; sy[1] = sy[0] + Math.sin(dir) * link; }
    for (let i = 2; i < SEG; i++) {
      const dx = sx[i] - sx[i - 1], dy = sy[i] - sy[i - 1], len = Math.hypot(dx, dy);
      const want = len > 1e-6 ? Math.atan2(dy, dx) : dir, d = angDiff(want, dir);
      if (Math.abs(d) > MAX_JOINT || len <= 1e-6) {
        dir += clamp(d, -MAX_JOINT, MAX_JOINT);
        const l = Math.max(len, link * 0.5);
        sx[i] = sx[i - 1] + Math.cos(dir) * l; sy[i] = sy[i - 1] + Math.sin(dir) * l;
      } else dir = want;
    }
    for (let i = 0; i < SEG; i++) {
      const a = Math.max(0, i - 1), b = Math.min(SEG - 1, i + 1);
      let tx = sx[a] - sx[b], ty = sy[a] - sy[b]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      nx[i] = -ty; ny[i] = tx;
    }
    for (let i = 1; i < SEG; i++) {
      const u = i / (SEG - 1), o = A * Math.pow(u, 1.6) * Math.sin(this.phase - u * 5.5);
      sx[i] += nx[i] * o; sy[i] += ny[i] * o;
    }
    // seen from above, every tail stroke swings the snout a little the other way
    const recoil = A * 0.1 * Math.sin(this.phase + Math.PI);
    for (let i = 0; i < SEG * 0.3; i++) { const k = 1 - i / (SEG * 0.3); sx[i] += nx[i] * recoil * k; sy[i] += ny[i] * recoil * k; }
  }
  at(u) {
    const f = clamp(u, 0, 1) * (SEG - 1), i = Math.min(SEG - 2, f | 0), t = f - i, { sx, sy, nx, ny } = this;
    let fx = sx[i] - sx[i + 1], fy = sy[i] - sy[i + 1]; const l = Math.hypot(fx, fy) || 1;
    return { x: sx[i] + (sx[i + 1] - sx[i]) * t, y: sy[i] + (sy[i + 1] - sy[i]) * t, nx: nx[i], ny: ny[i], fx: fx / l, fy: fy / l, w: lerpTable(this.p.body, u) * this.L };
  }
  draw() {
    this.spine();
    if (!(isFinite(this.x) && isFinite(this.y) && isFinite(this.sx[SEG - 1]))) { this.x = W / 2; this.y = -this.L; this.resetTrail(); return; }
    const { sx, sy, nx, ny, L, p } = this, step = Math.min(CW, CH) * 0.42;
    curId = this.id; curDepth = p.depth + this.z * 0.6;
    const g = this.glow, lx = -0.35, ly = -0.45, bright = 0.72 + 0.28 * this.z, shark = p.gait === 'cruise';
    for (let i = 0; i < SEG - 1; i++) {
      // a link is at most a few cells long; anything longer (or not a number) means a broken point, and drawing it would
      // run a loop for millions of steps and freeze the page, so it is skipped
      const segL = Math.hypot(sx[i + 1] - sx[i], sy[i + 1] - sy[i]);
      if (!(segL < L)) continue;
      const n = Math.max(1, Math.ceil(segL / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, u = (i + t) / (SEG - 1);
        const x = sx[i] + (sx[i + 1] - sx[i]) * t, y = sy[i] + (sy[i + 1] - sy[i]) * t;
        const Nx = nx[i] + (nx[i + 1] - nx[i]) * t, Ny = ny[i] + (ny[i + 1] - ny[i]) * t;
        const w = lerpTable(p.body, u) * L;
        if (w <= 0) continue;
        const side = Nx * lx + Ny * ly;
        for (let d = -w; d <= w; d += step) {
          const nd = d / w, an = Math.abs(nd), round = Math.sqrt(Math.max(0, 1 - nd * nd));
          let v = 0.26 + 0.64 * round + 0.07 * nd * side;
          let c = p.col;
          if (p.koi) {
            const nz = vnoise(u * 7 + this.seed, (nd + 1) * 1.7 + this.seed * 0.3);
            c = nz > 0.58 ? p.koi[0] : nz > 0.3 ? p.koi[1] : (nz < 0.14 ? p.koi[2] : p.koi[1]);
            if (u < 0.07) c = p.koi[1];
            v += 0.06 * Math.sin(u * 90 + nd * 9);                  // scale rows catch the light
          } else {
            if (u > 0.3 && u < 0.46 && an < 0.16) v += 0.28;        // first dorsal, seen edge-on from above
            if (u > 0.5 && an < 0.1) v += 0.1;                     // spine ridge toward the tail
            if (this.kind === 'nurse' && vnoise(u * 16 + this.seed, nd * 3.2) > 0.7) v *= 0.55;            // nurse: dark spots
            if (this.kind === 'hammer' && u > 0.34 && u < 0.8 && Math.sin(u * 46) > 0.8 && an < 0.7) v *= 0.72;  // faint saddle bars
          }
          // the outermost cells are glyph-only: a soft silhouette instead of a hard block edge
          // which scale this cell shows: fixed to the screen cell, not to the spot on the body. A body-fixed pattern slides
          // under the fixed grid as the fish swims, and a third of the cells changed character every frame: the jitter the
          // client saw. Fixed to the cell, a character holds while the fish covers it and only the outline moves
          const sx = x + Nx * d, sy = y + Ny * d;
          const key = (hash(Math.floor(sx / CW) * 7919 + Math.floor(sy / CH), this.id * 997 + 7) * 4294967295) >>> 0;
          stamp(sx, sy, clamp(v * bright * (an > 0.86 ? 0.8 : 1), 0, 1), c, an > 0.86 ? SHEER : 0, key);
        }
      }
    }
    if (shark) this.sharkFins(bright); else this.koiFins(bright);
  }
  koiFins(b) {
    const { L, p } = this;
    // pectorals: gauzy fans that open when the fish hovers and fold when it kicks
    for (const s of [-1, 1]) {
      const a = this.at(0.2), sz = L * (0.08 + 0.09 * this.fin), back = 0.4 + 0.8 * (1 - this.fin);
      const rx = a.x + a.nx * a.w * s, ry = a.y + a.ny * a.w * s;
      stampTri(rx, ry, rx + a.nx * sz * s - a.fx * sz * back, ry + a.ny * sz * s - a.fy * sz * back, rx - a.fx * sz * 1.1, ry - a.fy * sz * 1.1, 0.5 * b, p.koi[1], true);
    }
    { // pelvic pair, small
      const a = this.at(0.5), sz = L * 0.06;
      for (const s of [-1, 1]) { const rx = a.x + a.nx * a.w * s, ry = a.y + a.ny * a.w * s; stampTri(rx, ry, rx + a.nx * sz * s - a.fx * sz, ry + a.ny * sz * s - a.fy * sz, rx - a.fx * sz * 1.2, ry - a.fy * sz * 1.2, 0.42 * b, p.koi[1], true); }
    }
    { // long flowing tail: two lobes of rays that lag behind the beat
      const a = this.at(0.8), tl = L * 0.34, sw = Math.sin(this.phase - 4.6) * 0.55;
      for (const s of [-1, 1]) {
        const ex = a.x - a.fx * tl + a.nx * (s * 0.45 + sw) * tl, ey = a.y - a.fy * tl + a.ny * (s * 0.45 + sw) * tl;
        stampTri(a.x, a.y, ex, ey, a.x - a.fx * tl * 0.7 + a.nx * sw * tl, a.y - a.fy * tl * 0.7 + a.ny * sw * tl, 0.55 * b, p.koi[1], true);
      }
    }
    { // dorsal: a thin ray strip along the back
      const a0 = this.at(0.32), a1 = this.at(0.6);
      stampLine(a0.x, a0.y, a1.x + a1.nx * Math.sin(this.phase) * 2, a1.y + a1.ny * Math.sin(this.phase) * 2, 0.75 * b, p.koi[0]);
    }
    { // eyes and barbels
      const a = this.at(0.07), ew = a.w * 0.72;
      for (const s of [-1, 1]) stamp(a.x + a.nx * ew * s, a.y + a.ny * ew * s, 1, 5, 1);
      const h = this.at(0.01), bl = L * 0.07;
      for (const s of [-1, 1]) stampLine(h.x + h.nx * h.w * 0.6 * s, h.y + h.ny * h.w * 0.6 * s, h.x + h.fx * bl * 0.3 + h.nx * bl * s, h.y + h.fy * bl * 0.3 + h.ny * bl * s, 0.55 * b, p.koi[1]);
    }
  }
  sharkFins(b) {
    const { L, p, kind } = this, bank = clamp(this.omega * 0.7, -1, 1);
    // pectorals: sickle fins that bank into turns; the inside fin foreshortens
    for (const s of [-1, 1]) {
      const a = this.at(kind === 'nurse' ? 0.22 : 0.27), reach = L * (kind === 'mako' ? 0.15 : 0.17) * (1 - s * bank * 0.35) * (0.85 + 0.15 * this.fin), back = L * 0.11;
      const rx = a.x + a.nx * a.w * s, ry = a.y + a.ny * a.w * s;
      const tipx = rx + a.nx * reach * s - a.fx * back * 1.5, tipy = ry + a.ny * reach * s - a.fy * back * 1.5;
      stampTri(rx, ry, tipx, tipy, rx - a.fx * back, ry - a.fy * back, 0.72 * b, p.col);
      // trailing edge is concave: carve a notch by re-stamping the middle lighter
      stampTri(rx - a.fx * back * 0.9, ry - a.fy * back * 0.9, (tipx + rx - a.fx * back) / 2 - a.fx * back * 0.1, (tipy + ry - a.fy * back) / 2 - a.fy * back * 0.1, tipx, tipy, 0.5 * b, p.col);
    }
    { // pelvic pair and second dorsal
      const a = this.at(0.62), sz = L * 0.05;
      for (const s of [-1, 1]) { const rx = a.x + a.nx * a.w * s, ry = a.y + a.ny * a.w * s; stampTri(rx, ry, rx + a.nx * sz * s - a.fx * sz, ry + a.ny * sz * s - a.fy * sz, rx - a.fx * sz * 1.1, ry - a.fy * sz * 1.1, 0.55 * b, p.col); }
      const d2 = this.at(0.7); stamp(d2.x, d2.y, 0.9 * b, p.col, 0);
    }
    { // caudal, seen from above: the tail is a vertical blade, so it reads as a narrow wedge that sweeps side to side,
      // a beat behind the body; the upper/lower lobe fork only exists in side view
      const a = this.at(0.88), sw = Math.sin(this.phase - 5.2) * 0.45 * this.amp, tl = L * (kind === 'mako' ? 0.2 : 0.18), base = L * 0.022;
      const tx = a.x - a.fx * tl + a.nx * sw * tl, ty = a.y - a.fy * tl + a.ny * sw * tl;
      stampTri(tx, ty, a.x + a.nx * base, a.y + a.ny * base, a.x - a.nx * base, a.y - a.ny * base, 0.78 * b, p.col);
    }
    if (kind === 'hammer') {
      // cephalofoil, seen from above: a straight crossbar of nearly even chord, only slightly swept back, eyes at its tips.
      // Tapering it to the tips turns it into an arrowhead, which is the one thing a hammerhead must not look like.
      const a = this.at(0.02), span = L * 0.15, chord = L * 0.05, sweep = L * 0.018;
      for (const s of [-1, 1]) {
        const fx0 = a.x + a.fx * chord * 0.5, fy0 = a.y + a.fy * chord * 0.5;                     // leading edge at the centre
        const bx0 = a.x - a.fx * chord * 0.5, by0 = a.y - a.fy * chord * 0.5;                     // trailing edge at the centre
        const ox = a.nx * span * s - a.fx * sweep, oy = a.ny * span * s - a.fy * sweep;           // centre → tip
        const tip = chord * 0.8;                                                                  // the tips round off a little
        const fx1 = a.x + ox + a.fx * tip * 0.5, fy1 = a.y + oy + a.fy * tip * 0.5, bx1 = a.x + ox - a.fx * tip * 0.5, by1 = a.y + oy - a.fy * tip * 0.5;
        stampTri(fx0, fy0, fx1, fy1, bx1, by1, 0.86 * b, p.col);
        stampTri(fx0, fy0, bx1, by1, bx0, by0, 0.86 * b, p.col);
        stamp(a.x + ox, a.y + oy, 1, 5, 1);
      }
    } else {
      const a = this.at(0.075), w = a.w * 0.82;
      for (const s of [-1, 1]) stamp(a.x + a.nx * w * s, a.y + a.ny * w * s, 1, 5, 1);
    }
  }
}

// ── small fish: boids, each one a head cell and a tail ray ─────────────
class School {
  constructor(n, c, id) {
    this.c = c; this.id = id; this.glow = 0; this.mode = 'free';
    this.cx = W * (0.2 + Math.random() * 0.6); this.cy = H * (0.2 + Math.random() * 0.6);
    this.f = Array.from({ length: n }, () => ({ x: this.cx + (Math.random() - .5) * 80, y: this.cy + (Math.random() - .5) * 60, vx: (Math.random() - .5) * 40, vy: (Math.random() - .5) * 40, ph: Math.random() * TAU }));
    this.pickTarget();
  }
  pickTarget() { this.tx = W * (0.08 + Math.random() * 0.84); this.ty = H * (0.08 + Math.random() * 0.84); this.tTimer = 6 + Math.random() * 6; }
  update(dt, t) {
    let tx = this.tx, ty = this.ty, pull = 0.35, vmax = 95;
    if (this.mode === 'free') { this.tTimer -= dt; if (this.tTimer < 0) this.pickTarget(); }
    else {
      const r = this.btn.getBoundingClientRect(), bx = r.left + r.width / 2, by = r.top + r.height / 2;
      if (this.mode === 'call') { tx = bx; ty = by; pull = 3; vmax = 260; }
      else { const a = t * 0.0014; tx = bx + Math.cos(a) * (r.width * 0.6 + 26); ty = by + Math.sin(a) * (r.height * 0.9 + 22); pull = 1.4; vmax = 170; }
    }
    let mx = 0, my = 0, mvx = 0, mvy = 0; const F = this.f, n = F.length;
    for (const a of F) { mx += a.x; my += a.y; mvx += a.vx; mvy += a.vy; }
    mx /= n; my /= n; mvx /= n; mvy /= n; this.cx = mx; this.cy = my;
    for (const a of F) {
      let ax = (mx - a.x) * 0.6 + (mvx - a.vx) * 1.2 + (tx - a.x) * pull * 0.5, ay = (my - a.y) * 0.6 + (mvy - a.vy) * 1.2 + (ty - a.y) * pull * 0.5;
      for (const b of F) if (b !== a) { const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy; if (d2 < 200) { ax += dx * 240 / (d2 + 1); ay += dy * 240 / (d2 + 1); } }
      for (const s of fish) if (s.L && s.p.gait === 'cruise') { const dx = a.x - s.x, dy = a.y - s.y, d = Math.hypot(dx, dy); if (d < s.L * 0.6) { ax += dx / d * 900; ay += dy / d * 900; } }
      if (pointer.on && this.mode === 'free') { const dx = a.x - pointer.x, dy = a.y - pointer.y, d = Math.hypot(dx, dy); if (d < 90) { ax += dx / (d + 1) * 1400; ay += dy / (d + 1) * 1400; } }
      for (const r of ripples) if (!r.max || r.max > 60) { const dx = a.x - r.x, dy = a.y - r.y, d = Math.hypot(dx, dy); if (d < r.r + 40) { ax += dx / (d + 1) * 900; ay += dy / (d + 1) * 900; } }
      // each fish darts a little on its own clock, so the school shimmers instead of sliding as one block
      a.ph += dt * (3 + Math.random());
      ax += Math.cos(a.ph) * 26; ay += Math.sin(a.ph * 1.3) * 26;
      a.vx += ax * dt; a.vy += ay * dt;
      const sp = Math.hypot(a.vx, a.vy); if (sp > vmax) { a.vx *= vmax / sp; a.vy *= vmax / sp; }
      a.x += a.vx * dt; a.y += a.vy * dt;
    }
  }
  draw() {
    curId = this.id; curDepth = 0.5;
    for (const a of this.f) {
      const sp = Math.hypot(a.vx, a.vy) || 1, dx = a.vx / sp, dy = a.vy / sp;
      stamp(a.x, a.y, 0.85, this.c, 0);
      stamp(a.x - dx * CW * 1.1, a.y - dy * CH * 1.1, 0.7, this.c, rayCode(dx, dy) + SHEER);
      stamp(a.x - dx * CW * 2.1, a.y - dy * CH * 2.1, 0.45, this.c, rayCode(dx, dy) + SHEER);
    }
  }
}

function populate() {
  fish.length = 0;
  const all = ['hammer', 'mako', 'nurse', 'koi', 'koi2', 'koi3', 'school', 'minnows'];
  const kinds = canvas.dataset.fish ? canvas.dataset.fish.split(',').map(k => k.trim()).filter(k => all.includes(k)) : all;
  guides = {};
  kinds.forEach(k => {
    const id = fish.length;
    const f = k === 'school' ? new School(W < 640 ? 16 : 26, 7, id) : k === 'minnows' ? new School(W < 640 ? 10 : 18, 8, id) : new Fish(k, id);
    fish.push(f); guides[k] = f;
  });
  dust.length = 0;
  for (let i = 0; i < (W < 640 ? 50 : 120); i++) dust.push({ x: Math.random() * W, y: Math.random() * H, p: Math.random() * 6, l: Math.random() });
}

// ── elements call their fish ─────────────────────────────────────────
$$('[data-guide]').forEach(btn => {
  const call = mode => { const g = guides[btn.dataset.guide]; if (!g) return; if (g.mode !== 'call') { g.mode = mode; g.btn = btn; } wake(); };
  const release = () => { const g = guides[btn.dataset.guide]; if (g && g.mode === 'hover') { g.mode = 'free'; g.pickTarget(); } };
  btn.addEventListener('pointerenter', () => call('hover'));
  btn.addEventListener('focus', () => call('hover'));
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('blur', release);
  btn.addEventListener('click', e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduced.matches) return;
    const g = guides[btn.dataset.guide]; if (!g) return;
    e.preventDefault();
    g.mode = 'call'; g.btn = btn; btn.classList.add('is-called'); wake();
    const go = () => { if (!btn.dataset.gone) { btn.dataset.gone = '1'; location.href = btn.href; } };
    g.arrive = go; setTimeout(go, 900);
  });
});
addEventListener('pageshow', () => {
  $$('[data-guide]').forEach(b => { delete b.dataset.gone; b.classList.remove('is-called'); });
  fish.forEach(f => { if (f.mode === 'call') { f.mode = 'free'; f.pickTarget(); } });
});
addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType !== 'touch'; pointer.moved = clock; });
document.addEventListener('pointerleave', () => pointer.on = false);
// other scripts on the page can disturb the water (the fork example on the home page does when a fork appears)
addEventListener('pond:ripple', e => { ripples.push({ x: e.detail.x, y: e.detail.y, r: 0, max: 150, speed: 110 }); wake(); });
const retheme = () => { readTheme(); tintButtons(); buildAtlas(); wake(); };
addEventListener('pond:theme', retheme);
darkMQ.addEventListener('change', retheme);
// a tap in open water: a ripple, and every fish near it bolts
document.addEventListener('pointerdown', e => {
  if (e.target.closest('a,button,input,select,textarea,summary,label')) return;
  ripples.push({ x: e.clientX, y: e.clientY, r: 0, max: 170, speed: 120 });
  for (const f of fish) if (f.L) {
    const d = Math.hypot(f.x - e.clientX, f.y - e.clientY);
    if (d < 260) { f.startle = 0.5 + 0.4 * (1 - d / 260); f.flee = Math.atan2(f.y - e.clientY, f.x - e.clientX); f.kickT = 0; }
  }
  wake();
});

// ── frame ────────────────────────────────────────────────────────────
let raf = 0, last = 0;
function simulate(dt, t) {
  clock = t;
  for (const f of fish) {
    f.glow += ((f.mode !== 'free' ? 1 : 0) - f.glow) * Math.min(1, dt * 5);
    if (f instanceof School) {
      f.update(dt, t);
      if (f.mode === 'call' && f.arrive) { const r = f.btn.getBoundingClientRect(); if (Math.hypot(f.cx - r.left - r.width / 2, f.cy - r.top - r.height / 2) < 50) f.arrive(); }
      continue;
    }
    if (f.away) {
      f.awayT -= dt;
      if (f.awayT > 0 && f.mode === 'free') continue;
      f.reenter(t, f.mode !== 'free' ? f.btn : null);
    }
    // called while entirely out of the frame: come in across the edge nearest the calling element instead of a long way round
    else if (f.mode !== 'free' && f.offscreen() && !f.reentered) { f.reenter(t, f.btn); f.reentered = true; }
    if (f.mode === 'free') f.reentered = false;
    f.steer(dt, t); f.move(dt, t);
    if (f.mode === 'free' && t - f.enteredAt > 3000 && f.offscreen()) { f.away = true; f.awayT = 2 + Math.random() * 8; continue; }
    if (f.mode === 'call' && f.arrive) { const r = f.btn.getBoundingClientRect(); if (Math.hypot(f.x - r.left - r.width / 2, f.y - r.top - r.height / 2) < 30) f.arrive(); }
  }
  for (let i = foam.length - 1; i >= 0; i--) {
    const f = foam[i]; f.life -= dt;
    if (f.life <= 0) { foam[i] = foam[foam.length - 1]; foam.pop(); continue; }
    const k = Math.exp(-dt * 1.1); f.vx *= k; f.vy *= k; f.x += f.vx * dt; f.y += f.vy * dt;
  }
  for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.r += r.speed * dt; if (r.r > r.max) ripples.splice(i, 1); }
  const k = Math.pow(0.2, dt);
  for (let i = 0; i < wakeB.length; i++) wakeB[i] *= k;
  // motes ride the same current as the streaks, at half its speed (they sit a little deeper), and wrap at the edges
  for (const d of dust) { d.p += dt * 0.5; const [u, v] = flow(d.x, d.y); d.x = (d.x + u * 0.5 * dt + W) % W; d.y = (d.y + v * 0.5 * dt + H) % H; }
}
// a called fish swims in its own light: soft tinted pools along the spine, laid on the water under the tiles
function drawGlow() {
  const breathe = 0.85 + 0.15 * Math.sin(clock * 0.004);
  for (const f of fish) {
    if (f.glow < 0.02 || f.away) continue;
    const c = LOOK[f.p ? f.p.col : f.c].glow, k = 0.3 * f.glow * breathe;
    const pools = f.f ? [[f.cx, f.cy, 90]] : [0.08, 0.28, 0.48, 0.68, 0.88].map(u => { const a = f.at(u); return [a.x, a.y, a.w * 2.8 + 30]; });
    for (const [x, y, r] of pools) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, k)); g.addColorStop(0.5, rgba(c, k * 0.4)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}
// ── the current: a slow, coherent flow that the water's marks ride ──────
// The pond has one current: a steady drift to the right and a little down, with broad slow eddies turning in it. It is
// the curl of a stream function, so it never piles up or empties anywhere: marks follow it like dye in water, not
// at random. Speeds stay around 5–20 px/s, well below the fish, so the water reads as calm.
let flowT = 0;
// ψ = A·sin(x/260 + 0.03t)·sin(y/300) + B·sin((0.6x + y)/420 − 0.05t); velocity = (∂ψ/∂y, −∂ψ/∂x) plus the drift (7, 2)
const EDDY = 9 * 300, BAND = 6 * 420;
function flow(x, y) {
  const s1 = x / 260 + flowT * 0.03, c1 = y / 300, cq = Math.cos((0.6 * x + y) / 420 - flowT * 0.05);
  return [7 + EDDY / 300 * Math.sin(s1) * Math.cos(c1) + BAND / 420 * cq,
    2 - EDDY / 260 * Math.cos(s1) * Math.sin(c1) - 0.6 * BAND / 420 * cq];
}
// Marks on the water: short, translucent streaks drawn along their own path, so each one shows which way the water is
// going: its characters turn with the current (− \ | /), a "~" at the leading end, a dot where it trails off. Each fades in,
// rides the current for 6–12 s and fades out, then starts again elsewhere. About one per 30 000 px², capped.
const streaks = [];
function seedStreak(s, fresh) {
  s.x = Math.random() * W; s.y = Math.random() * H; s.trail = [[s.x, s.y]];
  s.len = 4 + ((Math.random() * 5) | 0); s.life = 6 + Math.random() * 6; s.age = fresh ? Math.random() * s.life : 0;
  s.peak = 0.45 + Math.random() * 0.3;
  return s;
}
function buildWaves() {
  const n = Math.min(60, Math.round(W * H / 30000));
  streaks.length = 0;
  for (let i = 0; i < n; i++) streaks.push(seedStreak({}, true));
}
function drawWaves(dt) {
  flowT += dt;
  for (const s of streaks) {
    s.age += dt;
    // midpoint step: follows the curve of an eddy instead of cutting across it
    const [u0, v0] = flow(s.x, s.y), [u1, v1] = flow(s.x + u0 * dt / 2, s.y + v0 * dt / 2);
    s.x += u1 * dt; s.y += v1 * dt;
    const last = s.trail[0];
    if (Math.hypot(s.x - last[0], s.y - last[1]) >= CW) { s.trail.unshift([s.x, s.y]); if (s.trail.length > s.len) s.trail.pop(); }
    if (s.age >= s.life || s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) seedStreak(s, false);
    const a = Math.sin(Math.PI * Math.min(1, s.age / s.life)) * s.peak;    // swells in, fades out
    if (a < 0.03) continue;
    const T = s.trail, n = T.length;
    for (let k = 0; k < n; k++) {
      // the leading end is the brightest; the stroke thins toward its tail
      const fade = a * (1 - 0.6 * k / Math.max(1, n - 1)), lv = Math.min(LEVELS - 1, (fade * LEVELS) | 0);
      if (lv < 1) continue;
      const p = T[k], q = T[Math.min(n - 1, k + 1)], r = T[Math.max(0, k - 1)];
      const glyph = k === 0 ? G_WAVE : k === n - 1 ? 14 : G_RAY + rayCode(r[0] - q[0], r[1] - q[1]) - 2;
      blit(2, 9, lv, glyph, p[0] - CW / 2, p[1] - CH / 2);
    }
  }
}

function render(dt) {
  own.fill(-1);
  for (const f of fish) if (!f.away) f.draw();
  for (const r of ripples) {
    const n = Math.ceil(r.r * 0.5) + 8, a = 1 - r.r / r.max;
    for (let i = 0; i < n; i++) { const th = i / n * TAU; stampWake(r.x + Math.cos(th) * r.r, r.y + Math.sin(th) * r.r * 0.8, 0.9 * a); }
  }
  for (const f of foam) stampWake(f.x, f.y, f.k * f.life / f.max);
  ctx.clearRect(0, 0, W, H);
  ctx.font = `600 ${Math.round(CH * 1.02)}px 'JetBrains Mono', ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  drawWaves(dt);
  drawGlow();
  const rise = dt > 0 ? 1 - Math.exp(-dt * 20) : 1, fall = dt > 0 ? Math.exp(-dt * 11) : 0;
  for (const d of dust) blit(2, 9, 1 + ((d.l * 3) | 0), 14, d.x, d.y);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const i = cy * cols + cx, X = cx * CW, Y = cy * CH;
    // A cell eases toward what the fish stamps into it and, once the fish has moved on, fades over ~250 ms.
    // Without this a cell is either on or off, and the body visibly hops from cell to cell.
    if (own[i] >= 0) { showV[i] += (val[i] - showV[i]) * rise; showC[i] = col[i]; showG[i] = gly[i]; showO[i] = own[i]; showK[i] = keyB[i]; }
    else showV[i] *= fall;
    if (showV[i] > 0.05) {
      const v = showV[i], lv = Math.min(LEVELS - 1, (v * (LEVELS - 1) + 0.5) | 0), g = showG[i], c = showC[i];
      const hot = fish[showO[i]].glow > 0.35 ? 1 : 0;
      const sheer = g >= SHEER, gg = g & 7;
      if (!sheer && gg === 0) {
        // shimmering scales: each cell re-rolls its character and the shade of its square on its own staggered clock,
        // about every 6 s, so the skin drifts rather than flickers. Shades lean darker towards the spine and stay mostly in the
        // middle of the band; one square in forty is a muted accent, and a few pale ones
        // at the edge carry no character at all
        // the tone band (0–3) follows the cell's brightness with hysteresis: it moves only once the brightness is well past
        // the band's edge, so a fish sliding over a cell does not tip its character back and forth at every threshold
        const bt = v * 4; let bd = bandB[i]; if (Math.abs(bt - bd - 0.5) > 0.85) bandB[i] = bd = Math.min(3, bt | 0);
        const k = showK[i], tick = Math.floor(shimT * 0.17 + (k % 997) / 97), set = BANDS[[1, 2, 3, 5][bd]];
        const h1 = hash(k % 100003, tick), h2 = hash((k >>> 7) % 100003, tick + 31);
        const tone = h2 > 0.975 ? 5 : Math.max(0, Math.min(4, Math.round(0.9 + bd * 0.55 + (h2 - 0.5) * 1.6)));
        const GL = bd === 0 && h1 > 0.8 ? G_BARE : set[(h1 * set.length) | 0];
        blit(hot, c, lv, GL, X, Y, tone);
      } else {
        const glyph = gg === 1 ? G_EYE : gg >= 2 ? G_RAY + gg - 2 : Math.min(RAMP_N - 1, (v * RAMP_N) | 0);
        blit(sheer ? 2 : hot, c, lv, glyph, X, Y, gg === 1 ? 4 : 1);   // the eye: a light mark on a dark square
      }
    } else if (wakeB[i] > 0.05) {
      blit(2, 9, Math.min(LEVELS - 1, (wakeB[i] * LEVELS) | 0), wakeB[i] > 0.45 ? 1 : 0, X, Y);
    }
  }
}
function frame(now) {
  raf = 0;
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  // "Reduce motion" is often switched off for speed rather than comfort, so it slows the pond to a calm drift instead of
  // freezing it (a frozen pond reads as broken). Stopping it completely is the pause button's job.
  const still = paused;
  if (!still) { simulate(dt * (reduced.matches ? 0.35 : 1), now); shimT += dt * (reduced.matches ? 0.35 : 1); }
  else for (const f of fish) f.glow += ((f.mode !== 'free' ? 1 : 0) - f.glow) * 0.5;
  render(still ? 0 : dt);
  canvas.classList.add('is-ready');
  // keep the clock running between frames: resetting it here would drop render time from dt and slow the whole pond down
  if (!document.hidden && (!still || fish.some(f => Math.abs((f.mode !== 'free' ? 1 : 0) - f.glow) > 0.02))) raf = requestAnimationFrame(frame);
}
function wake() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
reduced.addEventListener('change', wake);
// pause: stops the pond on every page and is remembered (WCAG 2.2.2 — moving content that runs on its own can be stopped)
let paused = false;
try { paused = localStorage.getItem('devunion-pond-paused') === '1'; } catch {}
const pauseBtn = document.querySelector('.pond-pause');
function syncPause() {
  if (!pauseBtn) return;
  pauseBtn.setAttribute('aria-pressed', String(paused));
  pauseBtn.classList.toggle('is-paused', paused);
}
if (pauseBtn) pauseBtn.addEventListener('click', () => {
  paused = !paused; syncPause();
  try { localStorage.setItem('devunion-pond-paused', paused ? '1' : '0'); } catch {}
  wake();
});
syncPause();
// a hidden pane can report a 0×0 viewport; rescaling from it would throw every fish to infinity
addEventListener('resize', () => {
  const oldW = W, oldH = H; resize();
  if (!W || !H) return;
  fish.forEach(f => {
    const kx = oldW ? W / oldW : 1, ky = oldH ? H / oldH : 1;
    if (f.f) f.f.forEach(a => { a.x = Math.min(W, a.x * kx); a.y = Math.min(H, a.y * ky); });
    else { f.x = Math.min(W, f.x * kx); f.y = Math.min(H, f.y * ky); f.resetTrail(); }
    f.pickTarget();
  });
  wake();
});
// glyphs painted before the web font arrived would stay in the fallback face forever: repaint the atlas once it lands
if (document.fonts) document.fonts.ready.then(() => { buildAtlas(); wake(); });

resize(); populate();
// settle the pond before the first visible frame, so fish are mid-swim, not spawning
for (let i = 0; i < 120; i++) simulate(1 / 60, i * 16.7);
wake();
window.__pond = { fish, guides };
})();
