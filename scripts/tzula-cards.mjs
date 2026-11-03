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

// A creeper along a path of cell points: stem cells timed by arc length, leaves and tendrils on the way.
function creep(put, pts, { t0 = 0, speed = 58, thick = 0.4, bright = 0.5, leafP = 0.014, tendrilP = 0.004, side = 0 } = {}) {
  let len = 0, [px, py] = pts[0];
  pts.forEach(([x, y], i) => {
    len += Math.hypot(x - px, y - py); px = x; py = y;
    const t = t0 + len / speed, u = i / pts.length, rad = thick * (1 - 0.6 * u);
    for (let dy = -2; dy <= 2; dy++) if (Math.abs(dy) <= rad + 0.2) put(x, y + dy, t, bright - 0.15 * Math.abs(dy));
    if (R() < tendrilP && u > 0.1) {
      const dir = side || (R() < 0.5 ? -1 : 1), turns = 1.2 + R(), dx = R() < 0.5 ? -1 : 1;
      for (let s = 0; s < 1; s += 0.03) {
        const ang = s * turns * Math.PI * 2, rr = 5 * (1 - s);
        put(x + dx * (s * 7 + rr * Math.sin(ang) * 0.6), y + dir * (2 + s * 4 - rr * Math.cos(ang) * 0.5), t + s * 0.5, bright * 0.65);
      }
    }
    if (R() < leafP && u > 0.03) {
      const s = side || (R() < 0.5 ? -1 : 1);
      leaf(put, x + (R() - 0.5) * 3, y + s * (2 + R()), s, t + 0.15);
    }
  });
}

// ---- header: vines of bits root at the right edge and sprawl to the left ----
function header() {
  const w = 900, h = 248;
  const { cols, put, render } = plantGrid(w, h, 10, 8);
  const smooth = (u) => u * u * (3 - 2 * u);
  for (const v of [
    { y0: 6, root: 9, start: 0.0, a: 3.5 },
    { y0: 20, root: 22, start: 0.4, a: 5 },
    { y0: 33, root: 36, start: 0.15, a: 4.5 },
    { y0: 52, root: 50, start: 0.55, a: 3 },
  ]) {
    const ex = cols - 1, p = R() * 6, q = R() * 6, pts = [];
    for (let x = ex; x >= 0; x -= 0.25) {
      const k = smooth(Math.max(0, 1 - (ex - x) / 34));
      const wander = v.y0 + v.a * Math.sin(x / 11 + p) + 2 * Math.sin(x / 4.3 + q);
      pts.push([x, wander * (1 - k) + v.root * k]);
    }
    // Thick like a trunk near the root, thinning toward the tip.
    creep(put, pts, { t0: v.start, thick: 1, leafP: 0.014 });
  }
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
  const { put, render } = plantGrid(w, h);
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
    // Creepers overgrow each tile: one climbs the left edge and runs along the top,
    // another crawls in along the bottom from the right corner.
    const L = x / CELL, T = 20 / CELL, Rt = (x + tw) / CELL, B = (h - 20) / CELL, j = R() * 6;
    const climb = [];
    for (let s = B + 1; s >= T + 2; s -= 0.25) climb.push([L + 0.6 * Math.sin(s / 2.3 + j), s]);
    for (let s = L + 1; s <= L + (Rt - L) * (0.45 + R() * 0.35); s += 0.25) climb.push([s, T + 0.6 * Math.sin(s / 2.1 + j)]);
    creep(put, climb, { t0: 0.6 + t * 0.35, speed: 45, thick: 0.7, bright: 0.7, side: -1, leafP: 0.05, tendrilP: 0.008 });
    const crawl = [];
    for (let s = Rt + 1; s >= Rt - (Rt - L) * (0.3 + R() * 0.3); s -= 0.25) crawl.push([s, B + 0.6 * Math.sin(s / 2.2 + j)]);
    creep(put, crawl, { t0: 1.4 + t * 0.35, speed: 45, thick: 0.5, bright: 0.65, side: 1, leafP: 0.05, tendrilP: 0 });
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
    const tall = Math.round(v * maxH), lean = (R() - 0.35) * 4, t0 = 0.3 + wi * 0.035;
    for (let k = 0; k <= tall; k += 0.5) {
      const u = tall ? k / tall : 0;
      put(base + lean * u * u, ground - k, t0 + k / 26, 0.4 + 0.5 * u * v + 0.1);
      // Alternate leaves up the stem; a cluster at the tip of busy weeks.
      if (k > 3 && k % 6 === 0 && k < tall - 2) leaf(put, base + lean * u * u + (k % 12 ? 2 : -2), ground - k, k % 12 ? 1 : -1, t0 + k / 26 + 0.1, 0.7);
    }
    if (tall > 4) leaf(put, base + lean, ground - tall - 1, -1, t0 + tall / 26 + 0.1, 0.9);
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
