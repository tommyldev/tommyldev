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

// ---- header: spaced wordmark over a field of flipping bits ----
function header() {
  // Vines of bits grow from the left edge; where they reach the right they become 毅力.
  // Same cell language as the tzula.ai bonsai: a grid of 0/1, leaves turn over in gusts.
  // yili-mask.json: per-cell ink coverage of 毅 and 力 (Zhi Mang Xing, OFL), 31x31 each, trimmed to the brush.
  const mask = JSON.parse(readFileSync(new URL("./yili-mask.json", import.meta.url), "utf8"));
  const R = () => rand();
  const w = 900, h = 248, cell = 3.85, ox = 10, oy = 8;
  const cols = Math.floor((w - 2 * ox) / cell), rows = Math.floor((h - 2 * oy) / cell);
  const grid = new Map(); // "c,r" -> { c, r, t, b, leaf }
  const put = (c, r, t, b, leaf = false) => {
    c = Math.round(c); r = Math.round(r);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const k = `${c},${r}`, cur = grid.get(k);
    grid.set(k, { c, r, t: Math.min(t, cur?.t ?? t), b: Math.max(b, cur?.b ?? 0), leaf: leaf || (cur?.leaf ?? false) });
  };

  // Calligraphy, stacked: 毅 over 力, at the right.
  const ink = [];
  for (const [g, gc, gr] of [[mask.yi, cols - 40, 0], [mask.li, cols - 40, 29]])
    g.forEach((row, y) => row.forEach((v, x) => { if (v > 0.22) ink.push([gc + x, gr + y, v]); }));
  // Each vine lands on the leftmost ink within a band of rows.
  const entryAt = (r0, r1) => ink.filter(([, r]) => r >= r0 && r <= r1).reduce((a, b) => (b[0] < a[0] ? b : a));
  const vines = [
    { y0: 6, entry: entryAt(6, 9), start: 0.0, a: 3.5 },
    { y0: 20, entry: entryAt(14, 18), start: 0.35, a: 5 },
    { y0: 33, entry: entryAt(36, 44), start: 0.15, a: 4.5 },
    { y0: 52, entry: entryAt(46, 52), start: 0.5, a: 3 },
  ];
  const speed = 58; // cells per second
  const smooth = (u) => u * u * (3 - 2 * u);
  const arrivals = [];
  for (const v of vines) {
    const [ex, ey] = v.entry, p = R() * 6, q = R() * 6;
    let len = 0, px = 0, py = v.y0;
    for (let x = 0; x <= ex; x += 0.25) {
      const wander = v.y0 + v.a * Math.sin(x / 11 + p) + 2 * Math.sin(x / 4.3 + q);
      const k = smooth(Math.max(0, (x - (ex - 34)) / 34));
      const y = wander * (1 - k) + ey * k;
      len += Math.hypot(x - px, y - py); px = x; py = y;
      const t = v.start + len / speed, rad = x < ex * 0.35 ? 1 : 0.4;
      for (let dy = -2; dy <= 2; dy++) if (Math.abs(dy) <= rad + 0.2) put(x, y + dy, t, 0.5 - 0.15 * Math.abs(dy));
      // Tendrils curl off the stem.
      if (R() < 0.004 && x > 6 && x < ex - 10) {
        const dir = R() < 0.5 ? -1 : 1, turns = 1.2 + R();
        for (let s = 0; s < 1; s += 0.02) {
          const ang = s * turns * Math.PI * 2, rr = 7 * (1 - s);
          put(x + s * 10 + rr * Math.sin(ang) * 0.6, y + dir * (3 + s * 6 - rr * Math.cos(ang) * 0.5), t + s * 0.5, 0.32);
        }
      }
      // Leaves sit beside the stem.
      if (R() < 0.014 && x < ex - 4) {
        const side = R() < 0.5 ? -1 : 1, lx = x + 1 + R() * 2, ly = y + side * (2 + R());
        for (let a = -2; a <= 2; a++) for (let b = -1; b <= 1; b++)
          if ((a / 2.4) ** 2 + (b / 1.3) ** 2 <= 1) put(lx + a, ly + side * (b + 1) + a * 0.3 * side, t + 0.15, 0.6 + R() * 0.15, true);
      }
    }
    arrivals.push([ex, ey, v.start + len / speed]);
  }
  // The brush is drawn outward from where the vines arrive.
  for (const [c, r, v] of ink) {
    const t = Math.min(...arrivals.map(([ex, ey, ta]) => ta + Math.hypot(c - ex, r - ey) * 0.045));
    put(c, r, t, 0.7 + 0.3 * v);
  }

  const cells = [...grid.values()];
  const done = Math.max(...cells.map((g) => g.t)) + 0.6;
  let out = "";
  for (const { c, r, t, b, leaf } of cells) {
    const x = (ox + c * cell + cell / 2).toFixed(1), y = (oy + r * cell + cell * 0.82).toFixed(1);
    const bit = R() < 0.5 ? 0 : 1, grow = `animation-delay:${t.toFixed(2)}s`;
    if (!leaf) { out += `<text x="${x}" y="${y}" opacity="${b.toFixed(2)}" class="g" style="${grow}">${bit}</text>`; continue; }
    // Gusts travel left to right once the vines have grown.
    const gust = `animation-duration:${(5 + R() * 1.2).toFixed(2)}s;animation-delay:${(done + c * 0.03 + Math.sin(r * 0.4) * 0.4).toFixed(2)}s`;
    out += `<g opacity="${b.toFixed(2)}" class="g" style="${grow}"><text x="${x}" y="${y}" class="f" style="${gust}">${bit}</text><text x="${x}" y="${y}" class="k" style="${gust}">${1 - bit}</text></g>`;
  }
  return frame(w, h, `
<defs><radialGradient id="v" cx="45%" cy="55%" r="70%"><stop offset="0" stop-color="#0d1114"/><stop offset="1" stop-color="${C.bg}"/></radialGradient></defs>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#v)"/>
<g font-family="${MONO}" font-size="${(cell * 0.95).toFixed(1)}" text-anchor="middle" fill="#d6dbe0">${out}</g>`,
  `.g { animation: grow .35s cubic-bezier(.3,0,.1,1) both; transform-box: fill-box; transform-origin: center; }
@keyframes grow { from { opacity: 0; transform: scaleY(0); } }
.f, .k { transform-box: fill-box; transform-origin: center; animation-name: front; animation-iteration-count: infinite; }
.k { animation-name: back; transform: scaleY(0); }
@keyframes front { 0%,38% { transform: scaleY(1); animation-timing-function: cubic-bezier(.7,0,.2,1); } 43%,77% { transform: scaleY(0); } 82%,100% { transform: scaleY(1); } }
@keyframes back { 0%,43% { transform: scaleY(0); } 48%,72% { transform: scaleY(1); } 77%,100% { transform: scaleY(0); } }`);
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
  });
  return frame(w, h, `<g font-family="${MONO}" font-weight="600" fill="${C.hi}" font-size="30">${body}</g>`,
    `.s { animation: spin 1.6s cubic-bezier(.2,.7,.2,1) both; }
@keyframes spin { from { transform: translateY(0); } to { transform: translateY(var(--to)); } }
.p { animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
text { font-variant-numeric: tabular-nums; }`);
}

// ---- contribution year as a continuous heat field ----
function gridCard() {
  const weeks = cc.contributionCalendar.weeks;
  const x0 = 28, y0 = 56, w = 900, cw = (w - x0 * 2) / weeks.length, ch = 15, h = y0 + 7 * ch + 54;
  const sorted = days.map((d) => d.contributionCount).filter(Boolean).sort((a, b) => a - b);
  const max = Math.max(1, sorted[Math.floor(sorted.length * 0.95)] || 1);
  let cells = "", hits = "", months = "", lastM = -1;
  weeks.forEach((wk, wi) => wk.contributionDays.forEach((d) => {
    const dt = new Date(d.date + "T00:00:00Z"), dow = dt.getUTCDay();
    const v = Math.min(1, d.contributionCount / max) ** 0.55, g = Math.round(v * 255);
    const x = x0 + wi * cw, y = y0 + dow * ch;
    if (g) cells += `<rect x="${x.toFixed(1)}" y="${y}" width="${(cw + 0.6).toFixed(1)}" height="${ch + 0.6}" fill="rgb(${g},${g},${g})"/>`;
    hits += `<rect x="${x.toFixed(1)}" y="${y}" width="${cw.toFixed(1)}" height="${ch}" fill="transparent"><title>${d.date}: ${d.contributionCount}</title></rect>`;
    if (dow === 0 && dt.getUTCMonth() !== lastM && dt.getUTCDate() <= 7) {
      lastM = dt.getUTCMonth();
      months += `<text x="${x.toFixed(1)}" y="${y0 + 7 * ch + 20}">${dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()}</text>`;
    }
  }));
  // Grey intensities -> blurred -> mapped through a dusk-to-moonlight palette: a heat field, not blocks.
  return frame(w, h, `
<defs>
  <filter id="heat" color-interpolation-filters="sRGB" x="-5%" y="-30%" width="110%" height="160%">
    <feGaussianBlur stdDeviation="7 5"/>
    <feComponentTransfer>
      <feFuncR type="table" tableValues="0.04 0.07 0.16 0.36 0.66 0.92"/>
      <feFuncG type="table" tableValues="0.045 0.09 0.24 0.48 0.78 0.96"/>
      <feFuncB type="table" tableValues="0.05 0.11 0.24 0.46 0.82 1"/>
      <feFuncA type="linear" slope="0" intercept="1"/>
    </feComponentTransfer>
  </filter>
  <clipPath id="field"><rect x="${x0}" y="${y0 - 6}" width="${w - x0 * 2}" height="${7 * ch + 12}" rx="10"/></clipPath>
  <linearGradient id="legend"><stop offset="0" stop-color="#0d0f12"/><stop offset=".35" stop-color="#3f5466"/><stop offset=".7" stop-color="#9eb8cc"/><stop offset="1" stop-color="${C.glow}"/></linearGradient>
  <linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<text x="${x0}" y="32" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.mid}">CONTRIBUTIONS</text>
<text x="${w - x0}" y="32" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.dim}">${fmt(stats.contributions)} IN THE LAST YEAR</text>
<g clip-path="url(#field)">
  <rect x="${x0}" y="${y0 - 6}" width="${w - x0 * 2}" height="${7 * ch + 12}" fill="#0b0d10"/>
  <g filter="url(#heat)"><rect x="${x0 - 20}" y="${y0 - 20}" width="${w - x0 * 2 + 40}" height="${7 * ch + 40}" fill="#000"/>${cells}</g>
  <rect class="sh" x="${x0 - 200}" y="${y0 - 6}" width="200" height="${7 * ch + 12}" fill="url(#sheen)"/>
</g>
<g font-family="${MONO}" font-size="9" letter-spacing="2" fill="${C.dim}">${months}</g>
<g>${hits}</g>
<text x="${w - x0 - 132}" y="${h - 14}" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="2" fill="${C.dim}">LESS</text>
<rect x="${w - x0 - 124}" y="${h - 21}" width="90" height="7" rx="3.5" fill="url(#legend)"/>
<text x="${w - x0}" y="${h - 14}" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="2" fill="${C.dim}">MORE</text>`,
    `.sh { animation: sheen 9s ease-in-out infinite; }
@keyframes sheen { from { transform: translateX(0); } to { transform: translateX(${w + 200}px); } }`);
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
