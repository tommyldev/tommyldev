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
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount ? run + 1 : 0; longest = Math.max(longest, run); }
// Current streak: today may still be empty, so start from yesterday in that case.
let current = 0;
let i = days.length - 1;
if (i >= 0 && days[i].contributionCount === 0) i--;
for (; i >= 0 && days[i].contributionCount; i--) current++;

const stats = {
  contributions: cc.contributionCalendar.totalContributions,
  commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
  prs: user.pullRequests.totalCount,
  stars: user.repositories.nodes.reduce((n, r) => n + r.stargazerCount, 0),
  repos: user.repositories.totalCount,
  followers: user.followers.totalCount,
  current, longest,
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
  const w = 900, h = 210;
  const R = () => rand();
  // ---- tech layer: dim bit field ----
  let bits = "";
  for (let y = 14; y < h - 6; y += 12) for (let x = 14; x < w - 6; x += 10) {
    bits += `<text x="${x}" y="${y}" class="b" style="animation-delay:${(R() * 12).toFixed(2)}s">${R() < 0.5 ? 0 : 1}</text>`;
  }
  // ---- organic layer: tapered trunk + limbs as smooth filled shapes ----
  const tube = (f, r0, r1, n = 40) => {
    const L = [], Rr = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, [x, y] = f(t), [x2, y2] = f(Math.min(1, t + 0.01)), [x1, y1] = f(Math.max(0, t - 0.01));
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, r = r0 + (r1 - r0) * t;
      L.push([x - (dy / len) * r, y + (dx / len) * r]); Rr.push([x + (dy / len) * r, y - (dx / len) * r]);
    }
    const pts = [...L, ...Rr.reverse()].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);
    return `M${pts[0]} L${pts.slice(1).join(" ")} Z`;
  };
  const spine = (t) => [452 + 34 * Math.sin(t * Math.PI * 1.3) - 4 * t, 174 - 120 * t];
  const limb = (t0, x1, y1, bend) => (t) => {
    const [x0, y0] = spine(t0);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - bend * Math.sin(t * Math.PI)];
  };
  const limbs = [[limb(0.45, 352, 96, 12), 7, 2], [limb(0.66, 596, 76, 16), 6, 2], [limb(0.3, 530, 120, 8), 5, 1.6], [limb(0.82, 470, 52, 6), 5, 2]];
  const wood = [tube(spine, 15, 4), ...limbs.map(([f, a, b]) => tube(f, a, b))]
    .map((d) => `<path d="${d}" fill="url(#bark)"/>`).join("");
  // Foliage pads: clusters of small leaves, domed top, flat underside. Each pad sways from its base.
  const pads = [[352, 92, 56, 22], [470, 48, 70, 26], [596, 72, 58, 21], [530, 118, 38, 14]];
  const leafCols = ["#7f93a3", "#9fb3c4", "#c3d3e0", "#8fa596", "#b3c7b9", "#dbe6ee"];
  let foliage = "";
  pads.forEach(([cx, cy, rx, ry], p) => {
    let leaves = "";
    for (let k = 0; k < 420; k++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R());
      const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d * (Math.sin(a) > 0 ? 0.5 : 1);
      const col = leafCols[Math.min(5, Math.floor((1 - (y - cy + ry) / (2 * ry)) * 4 + R() * 2.2))];
      leaves += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(2.4 + R() * 2.2).toFixed(1)}" ry="${(1.3 + R()).toFixed(1)}" transform="rotate(${(-25 + R() * 50).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${col}" class="lf" style="animation-delay:${(x * 0.005 + R() * 0.3).toFixed(2)}s"/>`;
    }
    foliage += `<g class="pad" style="transform-origin:${cx}px ${cy + ry * 0.5}px;animation-delay:${(p * 0.35).toFixed(2)}s">${leaves}</g>`;
  });
  // Ghibli wind: thin streaks that draw across, and loose leaves riding them.
  const streak = (y0, amp, ph) => {
    let d = "";
    for (let x = 0; x <= w; x += 20) d += `${x ? "L" : "M"}${x},${(y0 + amp * Math.sin(x / 70 + ph)).toFixed(1)} `;
    return d;
  };
  const streaks = [[38, 7, 0, 0], [134, 9, 1.8, 2.6], [176, 6, 3.2, 5.1], [70, 5, 4.4, 7.4]]
    .map(([y0, a, ph, dl]) => `<path d="${streak(y0, a, ph)}" class="wd" style="animation-delay:${dl}s"/>`).join("");
  let flyers = "";
  for (let k = 0; k < 9; k++) {
    const y = 40 + R() * 100, x = 360 + R() * 260;
    flyers += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="3" ry="1.6" fill="${leafCols[2 + (k % 3)]}" class="fl" style="--dy:${(-30 + R() * 60).toFixed(0)}px;animation-delay:${(k * 1.1).toFixed(1)}s;animation-duration:${(7 + R() * 4).toFixed(1)}s"/>`;
  }
  return frame(w, h, `
<defs>
  <radialGradient id="v" cx="50%" cy="55%" r="40%"><stop offset="0" stop-color="${C.bg}" stop-opacity="0.92"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient>
  <linearGradient id="bark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a2e34"/><stop offset=".45" stop-color="#6b727c"/><stop offset="1" stop-color="#23272c"/></linearGradient>
  <linearGradient id="pot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3037"/><stop offset="1" stop-color="#14171b"/></linearGradient>
</defs>
<g font-family="${MONO}" font-size="9">${bits}</g>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#v)"/>
<g fill="none" stroke="${C.mid}" stroke-width="1" stroke-linecap="round">${streaks}</g>
${wood}
${foliage}
<path d="M367,172 L543,172 L538,180 L372,180 Z" fill="#3a4049"/>
<path d="M376,180 L534,180 L520,196 L390,196 Z" fill="url(#pot)" stroke="#2e333a"/>
${flyers}
<text x="${w - 22}" y="${h - 14}" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="4" fill="${C.mid}">@${esc(login.toUpperCase())}  ·  SINCE ${stats.since}</text>`,
  `.b { fill: ${C.dim}; opacity: .25; animation: bg 12s steps(1) infinite; }
@keyframes bg { 0%,96% { opacity: .25; } 97%,99% { opacity: .85; fill: ${C.mid}; } }
.pad { animation: sway 5s ease-in-out infinite; }
@keyframes sway { 0%,100% { transform: skewX(0deg) translateX(0); } 40% { transform: skewX(-5deg) translateX(3px); } 55% { transform: skewX(-3deg) translateX(2px); } 75% { transform: skewX(1deg) translateX(-1px); } }
.lf { animation: gust 5s ease-in-out infinite; }
@keyframes gust { 0%,30%,60%,100% { opacity: 1; } 42% { opacity: .55; } }
.wd { stroke-dasharray: 140 1200; stroke-dashoffset: 140; opacity: .5; animation: draw 9s ease-in-out infinite; }
@keyframes draw { from { stroke-dashoffset: 140; } to { stroke-dashoffset: -1060; } }
.fl { opacity: 0; animation: fly 8s ease-in-out infinite; }
@keyframes fly { 0% { opacity: 0; transform: translate(0,0) rotate(0); } 10% { opacity: .9; } 80% { opacity: .7; } 100% { opacity: 0; transform: translate(420px, var(--dy)) rotate(540deg); } }
.fl { transform-box: fill-box; transform-origin: center; }`);
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
    ["STREAK", stats.current, `LONGEST ${stats.longest} DAYS`],
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
