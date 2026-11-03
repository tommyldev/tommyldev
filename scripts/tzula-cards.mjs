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

// ---- contributions: the usual calendar grid, one square per day ----
function gridCard() {
  const weeks = cc.contributionCalendar.weeks;
  const x0 = 28, y0 = 48, w = 900, gap = 3;
  const size = (w - x0 * 2 + gap) / weeks.length - gap, h = y0 + 7 * (size + gap) + 34;
  const fill = { NONE: "#15181c", FIRST_QUARTILE: "#2b3138", SECOND_QUARTILE: "#56606b", THIRD_QUARTILE: "#9aa4ae", FOURTH_QUARTILE: "#dfe7ee" };
  let cells = "", months = "", lastM = -1;
  weeks.forEach((wk, wi) => wk.contributionDays.forEach((d) => {
    const dt = new Date(d.date + "T00:00:00Z"), dow = dt.getUTCDay();
    const x = (x0 + wi * (size + gap)).toFixed(1), y = (y0 + dow * (size + gap)).toFixed(1);
    cells += `<rect x="${x}" y="${y}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="2.5" fill="${fill[d.contributionLevel] ?? fill.NONE}"><title>${d.date}: ${d.contributionCount}</title></rect>`;
    if (dow === 0 && dt.getUTCMonth() !== lastM && dt.getUTCDate() <= 7) {
      lastM = dt.getUTCMonth();
      months += `<text x="${x}" y="${h - 12}">${dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()}</text>`;
    }
  }));
  return frame(w, h, `
<text x="${x0}" y="30" font-family="${MONO}" font-size="11" letter-spacing="3" fill="${C.mid}">CONTRIBUTIONS</text>
<text x="${w - x0}" y="30" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.dim}">${fmt(stats.contributions)} IN THE LAST YEAR</text>
<g>${cells}</g>
<g font-family="${MONO}" font-size="9" letter-spacing="2" fill="${C.dim}">${months}</g>`);
}

mkdirSync("tzula", { recursive: true });
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
writeFileSync("tzula/profile.svg", combined([statsCard(), gridCard()]));
// Browsers cache the profile images by URL, so stamp each one with a content hash.
let readme = readFileSync("README.md", "utf8");
for (const f of ["profile"]) {
  const v = createHash("sha1").update(readFileSync(`tzula/${f}.svg`)).digest("hex").slice(0, 8);
  readme = readme.replace(new RegExp(`tzula/${f}\\.svg(\\?v=\\w+)?`), `tzula/${f}.svg?v=${v}`);
}
writeFileSync("README.md", readme);
console.log(stats);
