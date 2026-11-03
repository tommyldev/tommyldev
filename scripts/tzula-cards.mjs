// Generates Tzula-styled profile SVGs into ./tzula/. Needs GITHUB_TOKEN and USERNAME.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const login = process.env.USERNAME || "tommyldev";
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is required");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const { user } = await gql(
  `query($login: String!) {
    user(login: $login) {
      name createdAt
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC, first: 100) {
        totalCount nodes { stargazerCount }
      }
      pullRequests { totalCount }
      contributionsCollection {
        totalCommitContributions
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }`,
  { login },
);

const cc = user.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
// Commits authored in the last 24 hours (exact window, unlike the day-bucketed calendar).
const since = new Date(Date.now() - 864e5).toISOString().replace(/\.\d+Z$/, "Z");
const day = await fetch(`https://api.github.com/search/commits?q=${encodeURIComponent(`author:${login} author-date:>${since}`)}&per_page=1`, {
  headers: { authorization: `bearer ${token}`, accept: "application/vnd.github+json" },
}).then((r) => r.json());
if (typeof day.total_count !== "number") throw new Error(`commit search failed: ${JSON.stringify(day)}`);

const stats = {
  contributions: cc.contributionCalendar.totalContributions,
  commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
  prs: user.pullRequests.totalCount,
  stars: user.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0),
  repos: user.repositories.totalCount,
  followers: user.followers.totalCount,
  day: day.total_count,
  since: new Date(user.createdAt).getUTCFullYear(),
};

// ---- palette (Tzula: near-black, greys, one cold highlight) ----
const C = { bg: "#0a0b0d", panel: "#101215", line: "#1f2329", dim: "#3a3f47", mid: "#8a9099", hi: "#e8eaed", glow: "#cfe3ff" };
const SANS = "'Inter','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const frame = (w, h, body, extraCss = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<style>
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
${extraCss}
</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${C.bg}" stroke="${C.line}"/>
${body}
</svg>`;

// Deterministic pseudo-random so output only changes when data changes.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---- plants: everything organic is drawn in the tzula.ai cell language ----
// A grid of 0/1 bits; each cell flips into view when growth reaches it, and leaves turn over in gusts.
const R = () => rand();
const CELL = 3.85;
const PLANT_CSS = `.g { animation: grow .35s cubic-bezier(.3,0,.1,1) both; transform-box: fill-box; transform-origin: center; }
@keyframes grow { from { opacity: 0; transform: scaleY(0); } }
.f, .k { transform-box: fill-box; transform-origin: center; animation-name: front; animation-iteration-count: infinite; }
.k { animation-name: back; transform: scaleY(0); }
@keyframes front { 0%,38% { transform: scaleY(1); animation-timing-function: cubic-bezier(.7,0,.2,1); } 43%,77% { transform: scaleY(0); } 82%,100% { transform: scaleY(1); } }
@keyframes back { 0%,43% { transform: scaleY(0); } 48%,72% { transform: scaleY(1); } 77%,100% { transform: scaleY(0); } }`;

function plantGrid(w, h, ox = 0, oy = 0) {
  const cols = Math.floor((w - 2 * ox) / CELL), rows = Math.floor((h - 2 * oy) / CELL);
  const cells = new Map(); // "c,r" -> { c, r, t, b, leaf }
  const put = (c, r, t, b, leaf = false) => {
    c = Math.round(c); r = Math.round(r);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const k = `${c},${r}`, cur = cells.get(k);
    cells.set(k, { c, r, t: Math.min(t, cur?.t ?? t), b: Math.max(b, cur?.b ?? 0), leaf: leaf || (cur?.leaf ?? false) });
  };
  const render = () => {
    const all = [...cells.values()];
    const done = Math.max(0, ...all.map((g) => g.t)) + 0.6;
    let out = "";
    for (const { c, r, t, b, leaf } of all) {
      const x = (ox + c * CELL + CELL / 2).toFixed(1), y = (oy + r * CELL + CELL * 0.82).toFixed(1);
      const bit = R() < 0.5 ? 0 : 1, grow = `animation-delay:${t.toFixed(2)}s`;
      if (!leaf) { out += `<text x="${x}" y="${y}" opacity="${b.toFixed(2)}" class="g" style="${grow}">${bit}</text>`; continue; }
      // Gusts travel left to right once everything has grown.
      const gust = `animation-duration:${(5 + R() * 1.2).toFixed(2)}s;animation-delay:${(done + c * 0.03 + Math.sin(r * 0.4) * 0.4).toFixed(2)}s`;
      out += `<g opacity="${b.toFixed(2)}" class="g" style="${grow}"><text x="${x}" y="${y}" class="f" style="${gust}">${bit}</text><text x="${x}" y="${y}" class="k" style="${gust}">${1 - bit}</text></g>`;
    }
    return `<g font-family="${MONO}" font-size="${(CELL * 0.95).toFixed(1)}" text-anchor="middle" fill="#d6dbe0">${out}</g>`;
  };
  return { cols, rows, put, render };
}

// A leaf: a small ellipse of leaf cells at (x, y), leaning toward `side`.
function leaf(put, x, y, side, t, size = 1) {
  for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++)
    if ((a / (2.4 * size)) ** 2 + (b / (1.3 * size)) ** 2 <= 1) put(x + a, y + side * (b + 1) - a * 0.3 * side, t, 0.6 + R() * 0.15, true);
}

// Recursive growth: a stem random-walks from (x, y) along `ang`, forks into thinner children
// that do the same, and ends in a leaf or a curling tendril. Timing follows growth, so the
// plant visibly unfolds. `avoid(x, y)` keeps it off content; `hold` pulls the heading back
// toward the stem's own direction so long runners stay on course.
function grow(put, o) {
  const { len, depth, speed = 50, bright = 0.55, curl = 0.09, hold = 0.03, avoid, bounds, branchP = 0.018, leafP = 0.02 } = o;
  let { x, y, ang, t, thick = 1 } = o;
  const home = ang, step = 0.3;
  let s = 0, tries = 0;
  while (s < len && tries < 400) {
    ang += (R() - 0.5) * curl * 2 + (home - ang) * hold;
    const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step;
    if ((avoid && avoid(nx, ny)) || (bounds && !bounds(nx, ny))) { ang += (R() < 0.5 ? -1 : 1) * 0.5; tries++; continue; }
    tries = 0; x = nx; y = ny; s += step;
    const u = s / len, tt = t + s / speed, rad = thick * (1 - 0.65 * u);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++)
      if (dx * dx + dy * dy <= (rad + 0.25) ** 2) put(x + dx, y + dy, tt, bright - 0.12 * Math.hypot(dx, dy));
    if (depth > 0 && u > 0.08 && u < 0.85 && R() < branchP) {
      grow(put, { ...o, x, y, t: tt, depth: depth - 1, thick: rad * 0.7, bright: bright * 0.92,
        ang: ang + (R() < 0.5 ? -1 : 1) * (0.45 + R() * 0.7), len: (len - s) * (0.35 + R() * 0.4) });
    }
    if (u > 0.05 && R() < leafP) { const sd = R() < 0.5 ? -1 : 1; leaf(put, x + (R() - 0.5) * 2, y + sd * 1.5, sd, tt + 0.15, 0.6 + R() * 0.35); }
  }
  const tt = t + s / speed;
  if (R() < 0.55) leaf(put, x + Math.cos(ang) * 2, y + Math.sin(ang) * 2, R() < 0.5 ? -1 : 1, tt + 0.1, 0.8 + R() * 0.3);
  else {
    // A tendril curls off the tip.
    const dir = R() < 0.5 ? -1 : 1, turns = 1 + R() * 1.2;
    for (let k = 0; k < 1; k += 0.03) {
      const a = ang + dir * k * turns * Math.PI * 2, r = 4 * (1 - k);
      put(x + Math.cos(ang) * k * 5 + Math.cos(a) * r - Math.cos(ang) * 4, y + Math.sin(ang) * k * 5 + Math.sin(a) * r - Math.sin(ang) * 4, tt + k * 0.4, bright * 0.7);
    }
  }
}

// ---- header: vines of bits root at the right edge and sprawl to the left ----
function header() {
  const w = 900, h = 248;
  const { cols, rows, put, render } = plantGrid(w, h, 10, 8);
  const bounds = (x, y) => y > 1 && y < rows - 2 && x > -4;
  [9, 22, 36, 50].forEach((root, i) => {
    grow(put, { x: cols - 1, y: root, ang: Math.PI + (R() - 0.5) * 0.3, len: cols * (0.85 + R() * 0.3), depth: 2,
      t: [0, 0.4, 0.15, 0.55][i], speed: 58, thick: 0.8, curl: 0.1, hold: 0.03, bounds, branchP: 0.006, leafP: 0.008 });
  });
  return frame(w, h, `
<defs><radialGradient id="v" cx="45%" cy="55%" r="70%"><stop offset="0" stop-color="#0d1114"/><stop offset="1" stop-color="${C.bg}"/></radialGradient></defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#v)"/>
${render()}`, PLANT_CSS);
}

// ---- stats: split-flap counters that spin up and land on the real value ----
function flap(value, x, y, cw, ch, delay) {
  const digits = String(value).split("");
  let out = "";
  digits.forEach((dch, k) => {
    const cx = x + k * (cw + 6);
    const target = Number(dch);
    // Strip of 0-9 repeated twice, landing on target in the second cycle.
    const stop = 10 + target;
    let strip = "";
    for (let n = 0; n < 20; n++) strip += `<text x="${cx + cw / 2}" y="${y + ch * (n + 1) - ch * 0.28}" text-anchor="middle">${n % 10}</text>`;
    const id = `c${x}_${k}`;
    out += `<clipPath id="${id}"><rect x="${cx}" y="${y}" width="${cw}" height="${ch}" rx="5"/></clipPath>
<rect x="${cx}" y="${y}" width="${cw}" height="${ch}" rx="5" fill="${C.panel}" stroke="${C.line}"/>
<g clip-path="url(#${id})"><g class="s" style="--to:${-stop * ch}px;animation-delay:${(delay + k * 0.12).toFixed(2)}s;transform:translateY(${-stop * ch}px)">${strip}</g></g>
<line x1="${cx}" y1="${y + ch / 2}" x2="${cx + cw}" y2="${y + ch / 2}" stroke="${C.bg}" stroke-width="2"/>
<rect x="${cx}" y="${y}" width="${cw}" height="${ch / 2}" rx="5" fill="#ffffff" opacity="0.025"/>`;
  });
  return out;
}

function statsCard() {
  const w = 900, h = 200;
  const tiles = [
    ["COMMITS", stats.commits, "LAST 12 MONTHS"],
    ["CONTRIBUTIONS", stats.contributions, "LAST 12 MONTHS"],
    ["PULL REQUESTS", stats.prs, "ALL TIME"],
    ["COMMITS · 24H", stats.day, "LAST 24 HOURS"],
  ];
  const tw = (w - 40 - 3 * 14) / 4;
  const { cols, rows, put, render } = plantGrid(w, h);
  // Plants may wander anywhere except over a tile's contents.
  const inner = tiles.map((_, t) => { const x = 20 + t * (tw + 14); return [(x + 8) / CELL, 28 / CELL, (x + tw - 8) / CELL, (h - 26) / CELL]; });
  const avoid = (cx, cy) => inner.some(([a, b, c, d]) => cx > a && cx < c && cy > b && cy < d);
  const bounds = (cx, cy) => cx > 1 && cy > 1 && cx < cols - 1 && cy < rows - 1;
  let body = "";
  tiles.forEach(([label, value, sub], t) => {
    const x = 20 + t * (tw + 14);
    const len = String(value).length;
    const cw = Math.min(38, (tw - 32 - (len - 1) * 6) / len), ch = cw * 1.45;
    body += `<rect x="${x}" y="20" width="${tw}" height="${h - 40}" rx="10" fill="${C.panel}" fill-opacity="0.55" stroke="${C.line}"/>
<text x="${x + 16}" y="48" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.mid}">${label}</text>
<circle cx="${x + tw - 18}" cy="44" r="3" fill="${C.glow}" class="p" style="animation-delay:${t * 0.4}s"/>
${flap(value, x + 16, 72, cw, ch, 0.2 + t * 0.25)}
<text x="${x + 16}" y="${h - 40}" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${C.dim}">${esc(sub)}</text>`;
    // Each tile is overgrown from its bottom corners: a climber up the left edge, a runner along the bottom.
    const L = x / CELL, Rt = (x + tw) / CELL, B = (h - 22) / CELL;
    grow(put, { x: L, y: B, ang: -Math.PI / 2, len: (h - 40) / CELL + 20, depth: 3, t: 0.6 + t * 0.35, speed: 45,
      thick: 0.5, bright: 0.7, curl: 0.1, hold: 0.02, avoid, bounds, branchP: 0.012, leafP: 0.025 });
    grow(put, { x: Rt, y: B + 1, ang: Math.PI, len: (Rt - L) * (0.4 + R() * 0.4), depth: 2, t: 1.3 + t * 0.35, speed: 45,
      thick: 0.4, bright: 0.65, curl: 0.1, hold: 0.03, avoid, bounds, branchP: 0.012, leafP: 0.025 });
  });
  return frame(w, h, `<g font-family="${MONO}" font-weight="600" fill="${C.hi}" font-size="30">${body}</g>
${render()}`,
    `.s { animation: spin 1.6s cubic-bezier(.2,.7,.2,1) both; }
@keyframes spin { from { transform: translateY(0); } to { transform: translateY(var(--to)); } }
.p { animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
text { font-variant-numeric: tabular-nums; }
${PLANT_CSS}`);
}

// ---- contributions: a meadow, one stem per week, as tall as that week was busy ----
function gridCard() {
  const weeks = cc.contributionCalendar.weeks;
  const x0 = 28, y0 = 44, w = 900, fieldH = 130, h = y0 + fieldH + 40;
  const { put, render } = plantGrid(w, h);
  const totals = weeks.map((wk) => wk.contributionDays.reduce((n, d) => n + d.contributionCount, 0));
  const sorted = totals.filter(Boolean).sort((a, b) => a - b);
  const max = Math.max(1, sorted[Math.floor(sorted.length * 0.95)] || 1);
  const cw = (w - x0 * 2) / weeks.length, ground = (y0 + fieldH) / CELL, maxH = fieldH / CELL - 3;
  let hits = "", months = "", lastM = -1;
  // Soil: a faint line of bits along the bottom.
  for (let c = x0 / CELL; c <= (w - x0) / CELL; c++) put(c, ground + 1 + (R() < 0.3 ? 1 : 0), 0.1 + c * 0.004, 0.18);
  weeks.forEach((wk, wi) => {
    const v = Math.min(1, totals[wi] / max) ** 0.6, base = (x0 + wi * cw + cw / 2) / CELL;
    const tall = v * maxH, t0 = 0.3 + wi * 0.035;
    // Each week grows a small plant, as tall and as branched as the week was busy.
    if (tall >= 1) grow(put, { x: base, y: ground, ang: -Math.PI / 2 + (R() - 0.5) * 0.3, len: tall, depth: tall > 14 ? 2 : 1,
      t: t0, speed: 26, thick: 0.1, bright: 0.45 + 0.4 * v, curl: 0.1, hold: 0.06, branchP: 0.025, leafP: 0.012,
      bounds: (cx, cy) => cy > y0 / CELL && cy <= ground });
    const first = wk.contributionDays[0];
    const x = x0 + wi * cw;
    hits += `<rect x="${x.toFixed(1)}" y="${y0}" width="${cw.toFixed(1)}" height="${fieldH}" fill="transparent"><title>Week of ${first.date}: ${totals[wi]}</title></rect>`;
    const dt = new Date(first.date + "T00:00:00Z");
    if (dt.getUTCMonth() !== lastM && dt.getUTCDate() <= 7) {
      lastM = dt.getUTCMonth();
      months += `<text x="${x.toFixed(1)}" y="${h - 12}">${dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()}</text>`;
    }
  });
  return frame(w, h, `
<text x="${x0}" y="30" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.mid}">CONTRIBUTIONS</text>
<text x="${w - x0}" y="30" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.dim}">${fmt(stats.contributions)} IN THE LAST YEAR</text>
${render()}
<g font-family="${MONO}" font-size="9" letter-spacing="2" fill="${C.dim}">${months}</g>
<g>${hits}</g>`, PLANT_CSS);
}

mkdirSync("tzula", { recursive: true });
writeFileSync("tzula/header.svg", header());
writeFileSync("tzula/stats.svg", statsCard());
writeFileSync("tzula/field.svg", gridCard());

// One combined card: the three panels stacked inside a single frame, separated by hairlines.
function combined(parts) {
  const W = 900;
  let y = 0, body = "", css = "";
  parts.forEach((svg, i) => {
    const h = Number(svg.match(/height="([\d.]+)"/)[1]);
    css += svg.match(/<style>([\s\S]*?)<\/style>/)[1];
    const inner = svg
      .replace(/^[\s\S]*?<\/style>/, "")
      .replace(/<rect x="0.5" y="0.5"[^>]*\/>/, "")
      .replace(/<\/svg>\s*$/, "");
    if (i) body += `<line x1="28" x2="${W - 28}" y1="${y}" y2="${y}" stroke="${C.line}"/>`;
    body += `<svg x="0" y="${y}" width="${W}" height="${h}" overflow="hidden">${inner}</svg>`;
    y += h - (i < parts.length - 1 ? 14 : 0);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">
<style>${css}</style>
<defs><clipPath id="card"><rect width="${W}" height="${y}" rx="14"/></clipPath></defs>
<g clip-path="url(#card)"><rect width="${W}" height="${y}" fill="${C.bg}"/>${body}</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${y - 1}" rx="14" fill="none" stroke="${C.line}"/>
</svg>`;
}
writeFileSync("tzula/profile.svg", combined([header(), statsCard(), gridCard()]));
// Browsers cache the profile images by URL, so stamp each one with a content hash.
let readme = readFileSync("README.md", "utf8");
for (const f of ["profile"]) {
  const v = createHash("sha1").update(readFileSync(`tzula/${f}.svg`)).digest("hex").slice(0, 8);
  readme = readme.replace(new RegExp(`tzula/${f}\\.svg(\\?v=\\w+)?`), `tzula/${f}.svg?v=${v}`);
}
writeFileSync("README.md", readme);
console.log(stats);
