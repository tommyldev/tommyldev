// Generates Tzula-styled profile SVGs into ./tzula/. Needs GITHUB_TOKEN and USERNAME.
import { mkdirSync, writeFileSync } from "node:fs";

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
  const w = 900, h = 200;
  let bits = "";
  for (let y = 18; y < h - 8; y += 16) for (let x = 16; x < w - 8; x += 13) {
    const b = rand() < 0.5 ? 0 : 1;
    const d = (rand() * 9).toFixed(2), dur = (5 + rand() * 7).toFixed(2);
    bits += `<text x="${x}" y="${y}" class="b" style="animation-delay:${d}s;animation-duration:${dur}s">${b}</text>`;
  }
  return frame(w, h, `
<defs><radialGradient id="v" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="${C.bg}" stop-opacity="0.96"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0.15"/></radialGradient></defs>
<g font-family="${MONO}" font-size="11" fill="${C.dim}">${bits}</g>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="14" fill="url(#v)"/>
<text x="${w / 2}" y="86" text-anchor="middle" font-family="${SANS}" font-size="44" font-weight="300" letter-spacing="22" fill="${C.mid}">${esc((user.name || login).toUpperCase())}</text>
<text x="${w / 2}" y="120" text-anchor="middle" font-family="${MONO}" font-size="12" letter-spacing="5" fill="${C.dim}">@${esc(login.toUpperCase())}  ·  ${stats.repos} REPOS  ·  SINCE ${stats.since}</text>`,
  `.b { opacity: .35; animation: flip 8s steps(1) infinite; }
@keyframes flip { 0%,92% { opacity: .35; fill: ${C.dim}; } 93%,96% { opacity: 1; fill: ${C.glow}; } 97%,100% { opacity: .35; } }`);
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

// ---- contribution year as a bit field ----
function gridCard() {
  const weeks = cc.contributionCalendar.weeks;
  const x0 = 28, y0 = 54, gap = 2.5, w = 900;
  const cell = (w - x0 * 2) / weeks.length - gap;
  const h = y0 + 7 * (cell + gap) + 40;
  const lvl = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  const fill = ["#14171b", "#2a2f37", "#59606b", "#a7adb6", C.glow];
  let cells = "";
  weeks.forEach((wk, wi) => wk.contributionDays.forEach((d) => {
    const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
    const l = lvl[d.contributionLevel] ?? 0;
    const x = x0 + wi * (cell + gap), y = y0 + dow * (cell + gap);
    cells += `<g class="c" style="animation-delay:${(wi * 0.025 + dow * 0.01).toFixed(3)}s"><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${fill[l]}"/><text x="${x + cell / 2}" y="${y + cell - 3.5}" text-anchor="middle" fill="${l >= 3 ? C.bg : C.dim}">${l ? 1 : 0}</text><title>${d.date}: ${d.contributionCount}</title></g>`;
  }));
  return frame(w, h, `
<text x="${x0}" y="32" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.mid}">CONTRIBUTION FIELD</text>
<text x="${w - x0}" y="32" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.dim}">${fmt(stats.contributions)} BITS SET</text>
<g font-family="${MONO}" font-size="9">${cells}</g>
<text x="${x0}" y="${h - 14}" font-family="${MONO}" font-size="10" letter-spacing="2" fill="${C.dim}">0 = IDLE   1 = SHIPPED</text>`,
    `.c { animation: on .5s steps(2) both; }
@keyframes on { from { opacity: 0; } to { opacity: 1; } }`);
}

mkdirSync("tzula", { recursive: true });
writeFileSync("tzula/header.svg", header());
writeFileSync("tzula/stats.svg", statsCard());
writeFileSync("tzula/field.svg", gridCard());
console.log(stats);
