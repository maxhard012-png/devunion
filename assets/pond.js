// DevUnion — ASCII pond. Own engine: fish are rasterised into a fine glyph grid, every cell a coloured glyph,
// blitted from a pre-drawn atlas (drawImage is far cheaper than fillText, which is what lets the grid be this fine).
// Any element with data-guide owns one fish: hover calls it over, click sends it into the element and then navigates.
// The page decides who lives in it: <canvas id="pond" data-fish="hammer,koi">; no list means everyone.
(() => {
'use strict';
const $$ = s => [...document.querySelectorAll(s)];
const canvas = document.getElementById('pond');
if (!canvas) return;
const ctx = canvas.getContext('2d');
// The grid canvas redraws only the cells whose sprite changed since the last frame (dirty cells), so it is never cleared
// as a whole. What changes over wide areas every frame (the light pools under a called fish, the logo's glint) is drawn
// on a second canvas beneath it, cleared each frame. On a 1440×900 retina screen this took the frame from ~18 000 sprite
// copies to the few hundred that moved, which is what made heavy moments stutter
const under = document.createElement('canvas');
under.id = 'pond-under'; under.setAttribute('aria-hidden', 'true'); canvas.before(under);
const uctx = under.getContext('2d');
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
  [124, 124, 122],  // 9 water: wakes and ripples (neutral grey: the page has no tint)
];
const GUIDE_DOT = { hammer: 0, mako: 1, nurse: 2, koi: 3, koi3: 4, koi2: 6 };
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
// sharks draw from their own sets, closer to the reference: a pale rim of bare squares and dots, then S X % t, and
// 8 @ # along the spine (a space is a bare square)
const SHARK_BANDS = [':.  ', ': S ', 'SXt%', '8@#%'].map(set => [...set].map(ch => GLYPHS.indexOf(ch)));
const BANDS = ['.,:\'', ':;-=', '=+tx', '%Sx*', 'X8#%', '8#@&'].map(set => [...set].map(ch => GLYPHS.indexOf(ch)));
const NG = GLYPHS.length, RAMP_N = 9, G_EYE = 9, G_RAY = 10, G_WAVE = 15, G_BARE = NG - 1;
const LEVELS = 8, NC = PAL.length, NT = 3;         // sprite types: 0 body, 1 lit body, 2 glyph only (fins, water dots)
const NV = 6;                                      // tile tones per body sprite: 0 pale … 4 near black, 5 accent
const SPR_COLS = 128;

// ── grid + atlas ─────────────────────────────────────────────────────
let W = 0, H = 0, dpr = 1, CW = 6, CH = 7, cols = 0, rows = 0, scale = 1;
let val, col, own, dep, gly, wakeB;
// what is on screen, per cell: it chases this frame's stamp and fades out after the fish has left (phosphor persistence)
let showV, showC, showG, showO, showK, keyB, bandB, drawn, edgeX, edgeY;
let shimT = 0;                                     // scale-shimmer clock: stops with the pause, slows with reduced motion
let atlases = [], sw = 0, sh = 0;
function resize() {
  W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = under.width = Math.round(W * dpr); canvas.height = under.height = Math.round(H * dpr);
  uctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // the grid canvas stays in device pixels: see edgeX/edgeY
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
  // each cell's edges in whole device pixels. At 125 % or 150 % zoom a 9 px row is 11.25 or 13.5 device pixels, and a
  // sprite drawn there bleeds half a pixel into its neighbour, which clearing that neighbour then leaves behind as a hairline
  edgeX = Int32Array.from({ length: cols + 1 }, (_, c) => Math.round(c * CW * dpr));
  edgeY = Int32Array.from({ length: rows + 1 }, (_, r) => Math.round(r * CH * dpr));
  drawn = new Uint32Array(n);                // the sprite each cell shows on screen now (0: empty); resizing cleared the canvas
  buildAtlas();
  fish.forEach(f => f.rescale && f.rescale());
}
// Sprite layout: one atlas canvas per sprite type, so none grows past what the GPU keeps as a texture (one shared
// atlas of ~9 Mpx at dpr 2 fell back to software rendering: 3 fps). Body sprites, plain (0) and lit (1), come in NV
// tile tones (the shimmer); glyph-only sprites (2) in one. Key within a type: ((c·LEVELS + lv)·NG + g)·NV + tone.
function buildAtlas() {
  sw = Math.ceil(CW * dpr); sh = Math.ceil(CH * dpr);
  atlases = [NV, NV, 1].map(nv => {
    const total = NC * LEVELS * NG * nv, cv = document.createElement('canvas');
    cv.width = SPR_COLS * sw; cv.height = Math.ceil(total / SPR_COLS) * sh;
    const x = cv.getContext('2d');
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `600 ${Math.round(CH * 1.02 * dpr)}px 'JetBrains Mono', ui-monospace, monospace`;
    return { cv, x, nv, painted: new Uint8Array(total) };   // sprites are painted lazily, the first time a cell asks for them
  });
  // new sprites (a theme change, the web font arriving): every cell has to be drawn again
  if (drawn) { drawn.fill(0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  warmAtlas();
}
// Painting a sprite the first time a cell needs it stalled whole frames: a busy moment asked for dozens of new ones at
// once (slow frames averaged 9 first paints, smooth ones 0.6) and each forces the atlas texture to be re-uploaded before
// it can be drawn. So the atlases are filled ahead of time, in the browser's idle moments, a few milliseconds at a time;
// a sprite still missing when asked for is painted on the spot as before
let warmJob = 0;
function warmAtlas() {
  const idle = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 6 }), 30));
  const job = ++warmJob, order = [0, 2, 1];   // plain bodies first, then fins and water, then the lit bodies of called fish
  let t = 0, key = 0;
  const step = deadline => {
    if (job !== warmJob) return;               // a newer atlas replaced this one
    // one sprite at a time, checking the clock between them, so a slice never runs into the next frame
    while (t < order.length && deadline.timeRemaining() > 3) {
      const A = atlases[order[t]];
      while (key < A.painted.length && A.painted[key]) key++;
      if (key < A.painted.length) paint(order[t], key++);
      else { t++; key = 0; }
    }
    if (t < order.length) idle(step);
  };
  idle(step);
}
function paint(type, key) {
  const A = atlases[type], actx = A.x, vr = key % A.nv, k = (key / A.nv) | 0;
  const g = k % NG, lv = ((k / NG) | 0) % LEVELS, c = ((k / (NG * LEVELS)) | 0) % NC;
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
    if (c <= 2) {
      // sharks (palette 0–2) are drawn in neutral greys, as in the reference: tone 0 a pale rim square, tone 4 a near-black
      // spine square, with the glyph inverting against it; tone 5 a rare muted accent. On night water the ramp turns over,
      // so the spine is the brightest part. A called shark takes a wash of its own colour, so the fish answering the
      // pointer still shows which section it belongs to
      const pale = night ? [64, 64, 64] : [196, 196, 194], deep = night ? [218, 218, 216] : [44, 44, 46];
      let sq = vr === 5 ? mix(L.accent, [150, 150, 150], 0.3) : mix(pale, deep, vr / 4);
      if (type) sq = mix(sq, vivid(hue, 1.4), 0.32);
      const inv = night ? vr <= 1 : vr >= 3 || vr === 5;
      actx.fillStyle = rgba(sq, 0.5 + 0.48 * v);
      actx.fillRect(x + inset * 0.5, y + inset * 0.5, sw - inset, sh - inset);
      actx.fillStyle = inv ? rgba(mix(sq, WHITE, 0.85), 0.6 + 0.4 * v) : rgba(mix(sq, BLACK, 0.78), 0.5 + 0.5 * v);
      actx.fillText(GLYPHS[g], x + sw / 2, y + sh / 2 + dpr * 0.5);
      atlases[type].painted[key] = 1; return;
    }
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
  A.painted[key] = 1;
}
// a sprite as one number: type in the top bits, its key in the atlas below, +1 so that 0 can mean "nothing"
const SPRITE = 1 << 20;
const sprite = (type, c, lv, g, vr = 0) => type * SPRITE + ((c * LEVELS + lv) * NG + g) * atlases[type].nv + (atlases[type].nv > 1 ? vr : 0) + 1;
function blitCode(code, X, Y, to = ctx) {
  const type = (code / SPRITE) | 0, key = code - type * SPRITE - 1, A = atlases[type];
  if (!A.painted[key]) paint(type, key);
  to.drawImage(A.cv, (key % SPR_COLS) * sw, ((key / SPR_COLS) | 0) * sh, sw, sh, X, Y, CW, CH);
}
function blit(type, c, lv, g, X, Y, vr = 0, to = ctx) { blitCode(sprite(type, c, lv, g, vr), X, Y, to); }
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
// speeds tuned to the reference video (2026-10-23): about 0.18 body lengths a second for every fish, a touch slower
// than ascii-sharks (~0.2 for its hammerheads), as the client asked
const PLANS = {
  hammer: { len: 300, speed: 82, turn: 0.9, wander: 0.32, wave: 0.05, col: 0, depth: 3, gait: 'cruise',
    body: [[0, .02], [.05, .03], [.1, .045], [.28, .068], [.45, .058], [.65, .034], [.84, .013], [1, .006]] },
  mako: { len: 250, speed: 62, turn: 1.1, wander: 0.38, wave: 0.045, col: 1, depth: 2.6, gait: 'cruise',
    body: [[0, 0], [.06, .025], [.16, .05], [.32, .066], [.5, .05], [.7, .028], [.84, .011], [1, .005]] },
  nurse: { len: 270, speed: 64, turn: 0.75, wander: 0.28, wave: 0.06, col: 2, depth: 2.2, gait: 'cruise',
    body: [[0, .04], [.04, .062], [.2, .085], [.4, .08], [.6, .055], [.8, .03], [1, .012]] },
  koi: { len: 150, speed: 44, turn: 2.0, wander: 0.7, wave: 0.075, col: 3, depth: 1.4, gait: 'burst', koi: [3, 4, 5],
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
    this.pace = 1; this.paceGoal = 1; this.paceT = 0; this.linger = 0; this.away = false; this.awayT = 0; this.enteredAt = 0; this.bold = false;
    this.sx = new Float32Array(SEG); this.sy = new Float32Array(SEG); this.nx = new Float32Array(SEG); this.ny = new Float32Array(SEG);
    this.rescale(); this.v = this.spd; this.resetTrail();
  }
  // speed follows body size, so a fish crosses the same share of its own length per second on any screen (on a big screen
  // the bodies grow; with fixed px/s they looked sluggish), then eased to 1.05× and raised 30% (2026-10-23), 15% (2026-10-24) and 20% more (2026-10-27) on request
  rescale() { this.L = this.p.len * scale; this.spd = this.p.speed * (scale / 1.9) * 1.88; }
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
    this.away = false; this.bold = false;
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
    // 2. soft walls: the fish stay in the frame (client, 2026-10-27). The look-ahead reaches about a turning circle ahead,
    //    so a fish starts its turn early enough to come round before its head reaches the edge
    const look = L * 0.55 + this.v * 1.4, lx = this.x + Math.cos(this.a) * look, ly = this.y + Math.sin(this.a) * look, m = Math.min(L * 0.12, 60);
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
      goal = this.flee; weight = 1; want = this.spd * 2.2 * (this.bolt || 1); turnMax *= 2.2; resp = 3.5;
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
      if (this.startle > 0) this.v += (want - this.v) * Math.min(1, dt * 4);   // a startled koi darts, it does not wait for a stroke
      this.amp += (0.32 + 0.9 * thrust - this.amp) * Math.min(1, dt * 3);
      this.phase += dt * (1.6 + 6 * this.amp);
    } else {
      // sharks: no bursts, a steady sweep; acceleration is slow and so is the beat
      this.v += (want - this.v) * Math.min(1, dt * (want > this.v ? (this.startle > 0 ? 5 : this.mode === 'free' ? 1.6 : 4) : 0.9));
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
    { // barbels (no eye marks: the client found them odd, 2026-10-22)
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
      }
    }
  }
}

function populate() {
  fish.length = 0;
  const all = ['hammer', 'mako', 'nurse', 'koi', 'koi2', 'koi3'];
  const kinds = canvas.dataset.fish ? canvas.dataset.fish.split(',').map(k => k.trim()).filter(k => all.includes(k)) : all;
  guides = {};
  kinds.forEach(k => {
    const id = fish.length;
    const f = new Fish(k, id);
    fish.push(f); guides[k] = f;
  });
}

// ── elements call their fish ─────────────────────────────────────────
$$('[data-guide]').forEach(btn => {
  const call = mode => { const g = guides[btn.dataset.guide]; if (!g) return; if (g.mode !== 'call') { g.mode = mode; g.btn = btn; } wake(); };
  const release = () => { const g = guides[btn.dataset.guide]; if (g && g.mode === 'hover') { g.mode = 'free'; g.pickTarget(); } };
  btn.addEventListener('pointerenter', () => call('hover'));
  btn.addEventListener('focus', () => call('hover'));
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('blur', release);
  // a click opens the page at once; its fish only lights up. Waiting for the fish to arrive first (up to 0.9 s, more on
  // a slow machine) read as a dead or laggy button (client, 2026-10-24)
  btn.addEventListener('click', () => {
    const g = guides[btn.dataset.guide]; if (!g) return;
    g.mode = 'call'; g.btn = btn; btn.classList.add('is-called'); wake();
  });
});
addEventListener('pageshow', () => {
  $$('[data-guide]').forEach(b => b.classList.remove('is-called'));
  fish.forEach(f => { if (f.mode === 'call') { f.mode = 'free'; f.pickTarget(); } });
});
addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType !== 'touch'; pointer.moved = clock; });
document.addEventListener('pointerleave', () => pointer.on = false);
// other scripts on the page can disturb the water (the fork example on the home page does when a fork appears)
addEventListener('pond:ripple', e => { ripples.push({ x: e.detail.x, y: e.detail.y, r: 0, max: 150, speed: 110 }); wake(); });
const retheme = () => { readTheme(); tintButtons(); buildAtlas(); wake(); };
addEventListener('pond:theme', retheme);
darkMQ.addEventListener('change', retheme);
// a tap in the water: a ripple, and the fish react. Distance is to the nearest point of the body, not the head, so a tap
// on a long shark's tail counts. A fish tapped directly darts off hard for over a second, the way a real one bolts when
// touched; fish nearby only flinch away
document.addEventListener('pointerdown', e => {
  if (e.target.closest('a,button,input,select,textarea,summary,label')) return;
  const x = e.clientX, y = e.clientY;
  ripples.push({ x, y, r: 0, max: 170, speed: 120 });
  for (const f of fish) if (f.L && !f.away) {
    let d = Infinity, k = 0;
    for (let i = 0; i < f.sx.length; i++) { const di = Math.hypot(f.sx[i] - x, f.sy[i] - y); if (di < d) { d = di; k = i; } }
    const hit = d < f.at(k / (f.sx.length - 1)).w + 14;
    if (hit) { f.startle = 1.3; f.bolt = 1.5; ripples.push({ x, y, r: 0, max: 110, speed: 160 }); }
    else if (d < 220) { f.startle = 0.45 + 0.35 * (1 - d / 220); f.bolt = 1; }
    else continue;
    // flee away from the tap, bent toward the way the fish already faces so it shoots forward rather than spinning round
    const away = Math.atan2(f.y - y, f.x - x);
    f.flee = away + clamp(angDiff(f.a, away), -0.9, 0.9); f.kickT = 0;
  }
  wake();
});

// ── frame ────────────────────────────────────────────────────────────
let raf = 0, last = 0;
function simulate(dt, t) {
  clock = t;
  for (const f of fish) {
    f.glow += ((f.mode !== 'free' ? 1 : 0) - f.glow) * Math.min(1, dt * 5);
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
  }
  for (let i = foam.length - 1; i >= 0; i--) {
    const f = foam[i]; f.life -= dt;
    if (f.life <= 0) { foam[i] = foam[foam.length - 1]; foam.pop(); continue; }
    const k = Math.exp(-dt * 1.1); f.vx *= k; f.vy *= k; f.x += f.vx * dt; f.y += f.vy * dt;
  }
  for (let i = ripples.length - 1; i >= 0; i--) { const r = ripples[i]; r.r += r.speed * dt; if (r.r > r.max) ripples.splice(i, 1); }
  const k = Math.pow(0.2, dt);
  for (let i = 0; i < wakeB.length; i++) wakeB[i] *= k;
}
// a called fish swims in its own light: soft tinted pools along the spine, laid on the water under the tiles
function drawGlow() {
  const breathe = 0.85 + 0.15 * Math.sin(clock * 0.004);
  for (const f of fish) {
    if (f.glow < 0.02 || f.away) continue;
    const c = LOOK[f.p.col].glow, k = 0.3 * f.glow * breathe;
    const pools = [0.08, 0.28, 0.48, 0.68, 0.88].map(u => { const a = f.at(u); return [a.x, a.y, a.w * 2.8 + 30]; });
    for (const [x, y, r] of pools) {
      const g = uctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(c, k)); g.addColorStop(0.5, rgba(c, k * 0.4)); g.addColorStop(1, rgba(c, 0));
      uctx.fillStyle = g; uctx.fillRect(x - r, y - r, r * 2, r * 2); underUsed = true;
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
  if (underUsed) { uctx.clearRect(0, 0, W, H); underUsed = false; }
  drawGlow();
  const rise = dt > 0 ? 1 - Math.exp(-dt * 20) : 1, fall = dt > 0 ? Math.exp(-dt * 11) : 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const i = cy * cols + cx;
    let code = 0;
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
        const grey = c <= 2;                // the sharks: the full ramp, rim to spine, and their own characters
        const k = showK[i], tick = Math.floor(shimT * 0.17 + (k % 997) / 97), set = grey ? SHARK_BANDS[bd] : BANDS[[1, 2, 3, 5][bd]];
        const h1 = hash(k % 100003, tick), h2 = hash((k >>> 7) % 100003, tick + 31);
        const tone = h2 > 0.975 ? 5 : grey ? Math.max(0, Math.min(4, Math.round(bd * 1.3 + (h2 - 0.5) * 1.2)))
          : Math.max(0, Math.min(4, Math.round(0.9 + bd * 0.55 + (h2 - 0.5) * 1.6)));
        const GL = bd === 0 && h1 > 0.8 ? G_BARE : set[(h1 * set.length) | 0];
        code = sprite(hot, c, lv, GL, tone);
      } else {
        const glyph = gg === 1 ? G_EYE : gg >= 2 ? G_RAY + gg - 2 : Math.min(RAMP_N - 1, (v * RAMP_N) | 0);
        code = sprite(sheer ? 2 : hot, c, lv, glyph, gg === 1 ? 4 : 1);
      }
    } else if (wakeB[i] > 0.05) {
      code = sprite(2, 9, Math.min(LEVELS - 1, (wakeB[i] * LEVELS) | 0), wakeB[i] > 0.45 ? 1 : 0);
    }
    if (code !== drawn[i]) {
      const x0 = edgeX[cx], y0 = edgeY[cy], w = edgeX[cx + 1] - x0, h = edgeY[cy + 1] - y0;
      ctx.clearRect(x0, y0, w, h);
      if (code) { const type = (code / SPRITE) | 0, key = code - type * SPRITE - 1, A = atlases[type]; if (!A.painted[key]) paint(type, key); ctx.drawImage(A.cv, (key % SPR_COLS) * sw, ((key / SPR_COLS) | 0) * sh, sw, sh, x0, y0, w, h); }
      drawn[i] = code;
    }
  }
  drawLogo();
}
// ── the </> mark in the middle of the ring: solid, with a glint of fish tiles every few seconds ──────────────────
// The mark is the page's own SVG and stays as it is. Every 2.5–3.5 s a diagonal band, top left to bottom right, crosses it
// in about 0.8 s: inside the band the SVG is masked away and the same shape is laid in the sharks' tiles and characters,
// brightest at the leading edge, so the mark ripples into ASCII and back. The band's place is the gradient position
// (x + y) / (w + h), which is exactly where a 135° CSS gradient puts it, so the mask and the tiles line up.
const LOGO_PATH = new Path2D('M30 12 0 30l30 18v-9.5L15.5 30 30 21.5zM57 0h10L43 60H33zM70 12l30 18-30 18v-9.5L84.5 30 70 21.5z');
const logoBox = document.querySelector('.ring-word .logo');
const GLINT_BAND = 0.17, GLINT_TIME = 0.9;
let logoCells = [], logoKey = '', glintAt = 1.5, glintMasked = false, underUsed = false;
function buildLogo() {
  logoCells = [];
  if (!logoBox) return;
  const r = logoBox.getBoundingClientRect();
  if (!r.width) return;
  const probe = document.createElement('canvas').getContext('2d'), sx = 100 / r.width, sy = 60 / r.height;
  for (let y = 0; y * CH < r.height; y++) for (let x = 0; x * CW < r.width; x++) {
    // coverage from a 3×3 sample of the cell: full cells carry the stroke, partial ones its rim
    let cov = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (probe.isPointInPath(LOGO_PATH, (x * CW + (i + 0.5) * CW / 3) * sx, (y * CH + (j + 0.5) * CH / 3) * sy)) cov++;
    if (cov < 2) continue;
    logoCells.push({ x: x * CW, y: y * CH, cov: cov / 9, t: (x * CW + CW / 2 + y * CH + CH / 2) / (r.width + r.height),
      key: (hash(x * 131 + 7, y * 977 + 3) * 4294967295) >>> 0 });
  }
  logoKey = `${Math.round(r.width)}x${Math.round(r.height)}/${CW}`;
}
function setGlintMask(s) {
  const m = s === null ? '' : `linear-gradient(135deg,#000 ${((s - GLINT_BAND) * 100).toFixed(2)}%,transparent ${((s - GLINT_BAND) * 100).toFixed(2)}%,transparent ${((s + GLINT_BAND) * 100).toFixed(2)}%,#000 ${((s + GLINT_BAND) * 100).toFixed(2)}%)`;
  logoBox.style.webkitMaskImage = m; logoBox.style.maskImage = m; glintMasked = s !== null;
}
function drawLogo() {
  if (!logoBox) return;
  const p = (shimT - glintAt) / GLINT_TIME;                 // 0…1 while a glint crosses the mark
  if (p >= 1) glintAt = shimT + 2.5 + Math.random();          // the next one in 2.5–3.5 s
  if (p < 0 || p >= 1 || document.body.classList.contains('view-projects')) { if (glintMasked) setGlintMask(null); return; }
  const r = logoBox.getBoundingClientRect();
  if (`${Math.round(r.width)}x${Math.round(r.height)}/${CW}` !== logoKey) buildLogo();
  const ease = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) ** 2;
  const s = -GLINT_BAND + ease * (1 + 2 * GLINT_BAND);
  setGlintMask(s);
  const tick = Math.floor(shimT * 12);                        // characters flicker as the band passes over them
  for (const c of logoCells) {
    const d = (c.t - s) / GLINT_BAND;                         // −1 at the trailing edge, +1 at the leading one
    if (Math.abs(d) > 1.08) continue;
    const h1 = hash(c.key % 100003, tick), h2 = hash((c.key >>> 7) % 100003, tick + 31);
    const lead = Math.max(0, d);                              // the leading half is lit, the trailing half settles back to ink
    let tone = Math.max(0, Math.round(4 - lead * 3.4 - (h2 > 0.6 ? 1 : 0)));
    if (lead > 0.35 && h2 > 0.88) tone = 5;
    const set = SHARK_BANDS[lead > 0.5 ? 2 : 3], g = set[(h1 * set.length) | 0];
    blit(0, 0, LEVELS - 1, g === G_BARE ? set[0] : g, r.left + c.x, r.top + c.y, tone, uctx); underUsed = true;
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
  canvas.classList.add('is-ready'); under.classList.add('is-ready');
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
    f.x = Math.min(W, f.x * kx); f.y = Math.min(H, f.y * ky); f.resetTrail();
    f.pickTarget();
  });
  wake();
});
// glyphs painted before the web font arrived would stay in the fallback face forever: repaint the atlas once it lands.
// Only then: rebuilding an atlas that was already right threw away the warm-up and stalled the first seconds
const MONO = "600 12px 'JetBrains Mono'";
if (document.fonts && !document.fonts.check(MONO)) document.fonts.load(MONO).then(() => { buildAtlas(); wake(); });

resize(); populate();
// settle the pond before the first visible frame, so fish are mid-swim, not spawning
for (let i = 0; i < 120; i++) simulate(1 / 60, i * 16.7);
wake();
window.__pond = { fish, guides };
})();
