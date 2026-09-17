#!/usr/bin/env node
// Turn a real Flex query XML into a committable fixture: same structure,
// sections, types and dates; account, ids, tickers, ISINs, strikes and
// amounts rewritten. Quantities (shares, contracts, Open Positions'
// "position") are deliberately left real — see the comment at "7." below.
//
//   node scripts/anonymize-flex.mjs ../../private/flex_<compte>_<date>.xml > tests/fixtures/flex_activity_sample.xml
//
// --full keeps every row of every section instead of trimming to
// MAX_ROWS_PER_SECTION, for the journals engine's oracle corpus, which needs
// the whole year of trading rather than a handful of sample rows.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const full = args.includes("--full");
const input = args.find((a) => !a.startsWith("--"));
if (!input) {
  console.error("usage: anonymize-flex.mjs [--full] <flex.xml>");
  process.exit(1);
}
let xml = readFileSync(input, "utf8");

const MAX_ROWS_PER_SECTION = 40;
const MONEY_COLUMNS = [
  "tradePrice", "proceeds", "ibCommission", "netCash", "cost", "amount", "fifoPnlRealized",
  // Open Positions: absent from the current export, but a replay of this script once the
  // user ticks that section on will carry real mark/cost/unrealized-P&L figures under
  // these names, which appear nowhere else in the file.
  "markPrice", "markValue", "positionValue", "openPrice", "costBasisPrice", "costBasisMoney", "fifoPnlUnrealized", "percentOfNAV",
];
const BLANK = ["acctAlias", "conid", "securityID", "cusip", "isin", "figi", "underlyingConid", "underlyingSecurityID", "issuer", "clientReference", "serialNumber"];

// 1. Trim each section to a handful of rows.
xml = xml.replace(/<(Trades|CashTransactions|CorporateActions|Transfers|OpenPositions)>([\s\S]*?)<\/\1>/g, (_, tag, body) => {
  const rows = body.match(/<[A-Za-z]+ [^>]*\/>/g) ?? [];
  return `<${tag}>\n${rows.slice(0, full ? rows.length : MAX_ROWS_PER_SECTION).join("\n")}\n</${tag}>`;
});

// 2. Account id.
xml = xml.replace(/accountId="[^"]*"/g, 'accountId="U0000001"');

// 3. Ids: stable, sequential.
const ids = new Map();
for (const name of ["tradeID", "transactionID", "actionID"]) {
  xml = xml.replace(new RegExp(`${name}="(\\d+)"`, "g"), (_, id) => {
    if (!ids.has(id)) ids.set(id, String(1000000 + ids.size));
    return `${name}="${ids.get(id)}"`;
  });
}

// 4. Tickers: every distinct first token of a symbol, except currency pairs.
const tickers = new Map();
for (const [, symbol] of xml.matchAll(/ symbol="([^"]*)"/g)) {
  const ticker = symbol.trim().split(/\s+/)[0];
  if (!ticker || /^[A-Z]{3}\.[A-Z]{3}$/.test(ticker) || tickers.has(ticker)) continue;
  tickers.set(ticker, `SYM${tickers.size + 1}`);
}
for (const [ticker, alias] of tickers) {
  xml = xml.replace(new RegExp(`\\b${ticker.replace(/[.^$*+?()[\]{}|\\]/g, "\\$&")}\\b`, "g"), alias);
}
// Company names live in description; keep the option contract descriptions ("SYM1 20FEB26 15 P").
xml = xml.replace(/ description="([^"]*)"/g, (_, d) => (/\d{2}[A-Z]{3}\d{2}/.test(d) || /^[A-Z]{3}\.[A-Z]{3}$/.test(d) ? ` description="${d}"` : ` description="${d.replace(/[A-Za-z]{4,}/g, (w) => (["CASH", "RECEIPTS", "ELECTRONIC", "FUND", "TRANSFERS", "WITHHOLDING", "CREDIT", "DIVIDEND", "INTEREST"].includes(w.toUpperCase()) ? w : "ANON"))}"`));

// 5. ISINs.
xml = xml.replace(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g, "XX0000000000");

// 6. Strikes. Scaling a strike like an ordinary money field would land on an implausible
// number, and the real value would still survive inside the packed OCC symbol and inside
// the human-readable description ("SYM7 20FEB26 15 P") regardless. Instead, map every
// distinct real strike to a synthetic, round one (the n-th distinct strike becomes
// 10*(n+1)) and rewrite the attribute, the packed symbol and the description together, per
// row, so the three stay mutually consistent and no real strike survives anywhere.
// Ranked ascending so that K1 < K2 < K3 < K4 of a condor stays ordered.
const strikes = new Map();
const realStrikes = Array.from(new Set(Array.from(xml.matchAll(/ strike="([^"]*)"/g), (m) => m[1]).filter(Boolean)))
  .sort((a, b) => Number(a) - Number(b));
realStrikes.forEach((s, i) => strikes.set(s, String(10 * (i + 1))));
xml = xml.replace(/<([A-Za-z]+) ([^>]*)\/>/g, (whole, tag, attrs) => {
  const real = attrs.match(/ strike="([^"]*)"/)?.[1];
  const mapped = real ? strikes.get(real) : undefined;
  if (mapped === undefined) return whole;
  let newAttrs = attrs.replace(/ strike="[^"]*"/, ` strike="${mapped}"`);
  const strikeThousandths = String(Math.round(Number(mapped) * 1000)).padStart(8, "0");
  // OCC symbol: root (padded), 6-digit expiry, C/P, 8-digit strike in thousandths. Leave
  // the root and the expiry untouched, rewrite only the trailing strike digits.
  newAttrs = newAttrs.replace(/ symbol="([^"]*)"/, (m, sym) => {
    const occ = sym.match(/^(.*)(\d{6})([CP])\d{8}$/);
    return occ ? ` symbol="${occ[1]}${occ[2]}${occ[3]}${strikeThousandths}"` : m;
  });
  // Human-readable contract description: "<ticker> <expiry> <strike> <C/P>".
  newAttrs = newAttrs.replace(/ description="([^"]*)"/, (m, d) => {
    const contract = d.match(/^(\S+ \d{2}[A-Z]{3}\d{2} )[\d.]+( [CP])$/);
    return contract ? ` description="${contract[1]}${mapped}${contract[2]}"` : m;
  });
  return `<${tag} ${newAttrs}/>`;
});

// 7. Quantities (shares, contracts, Open Positions' "position") are deliberately left
// real, untouched by this script. The journals engine's reconciliation (task 7) checks
// an additive identity: a contract's snapshot quantity must equal the *sum* of that same
// contract's own trade quantities. Reconciliation requires an additive mapping
// (`f(a) + f(b) = f(a+b)`); the only functions satisfying that identity are
// multiplications, `f(x) = S*x`; and any such multiplication divides back out — anyone
// holding the fixture recovers every real quantity exactly by dividing by the right S,
// contract by contract if S varies, or by one S if it does not. A prior version of this
// script scaled quantities per contract to keep the additive property while varying S
// across contracts; a repository review recovered 132 to 291 of 291 real option-leg
// quantities from the committed fixture alone (a five-line GCD attack needs no knowledge
// of the ladder). Additive implies linear implies recoverable: there is no scheme that is
// both additively-reconciling and unrecoverable. Given that choice, the repository owner
// decided position sizing is not sensitive enough to give up a genuine oracle for, and
// chose to keep quantities real rather than anonymise them. Every other field (account,
// ids, tickers, strikes, money, ISINs) stays anonymised. See docs/points-reportes.md.

// 8. Identifying attributes blanked.
for (const name of BLANK) xml = xml.replace(new RegExp(` ${name}="[^"]*"`, "g"), ` ${name}=""`);

// 8b. Cash Report. Every numeric attribute of a CashReportCurrency row is a money
// figure (starting/ending cash, deposits, commissions, dividends, interest…), except
// its two dates. Their names are collected from the file rather than listed here, so
// a column IB adds tomorrow is scrubbed too.
const cashReportMoney = new Set();
for (const [, attrs] of xml.matchAll(/<CashReportCurrency ([^>]*)\/>/g)) {
  for (const [, name] of attrs.matchAll(/ ?([A-Za-z]+)="-?\d[\d.]*"/g)) {
    if (name !== "fromDate" && name !== "toDate") cashReportMoney.add(name);
  }
}
const MONEY = [...MONEY_COLUMNS, ...cashReportMoney];

// 8c. A share delivery is priced at the option's strike, and the journals engine
// reads an assignment from that equality. Such prices follow the strike map, not the
// money map, so the equality survives anonymization. Marked here, resolved after the
// money pass below, which must not see them as amounts. Guarded by `ibCommission="0"`,
// the same tell a delivery always carries, so an ordinary commissioned STK trade whose
// price happens to equal some option's strike in the file is never mistaken for one and
// does not manufacture a phantom assignment.
xml = xml.replace(/<Trade ([^>]*)\/>/g, (m, attrs) => {
  if (!/ assetCategory="STK"/.test(attrs)) return m;
  if (attrs.match(/ ibCommission="([^"]*)"/)?.[1] !== "0") return m;
  const price = attrs.match(/ tradePrice="([^"]*)"/)?.[1];
  const mapped = price !== undefined ? strikes.get(price) : undefined;
  if (mapped === undefined) return m;
  return `<Trade ${attrs.replace(/ tradePrice="[^"]*"/, ` tradePrice="STRIKE:${mapped}"`)}/>`;
});

// 9. Money. The previous version multiplied every value by a single published constant
// (SCALE = 0.37): reversible by anyone, since dividing any fixture figure by 0.37 recovers
// the real one, and the tell was visible on every row where fxRateToBase (see below) landed
// on exactly 0.37. This version maps every distinct real magnitude to a synthetic one by
// rank, log-interpolated across a FIXED span, rather than by a scaling factor. (An
// intermediate version interpolated across the real file's own [min, max]: both ends then
// survived almost intact, and every figure could be read back to within about ten percent.)
//
// - Collect the distinct absolute value of every money attribute across the file, and sort
//   them ascending: magnitude[0] (smallest) .. magnitude[n-1] (largest).
// - The real values span decades unevenly (this file has 168 distinct magnitudes crowded
//   into 7 decades, from 3 to 47 per decade): a fixed number of synthetic slots per decade,
//   as the strike and quantity ladders above use, either overflows for a crowded decade or
//   wastes most of a decade for a sparse one. Interpolating in log space instead spreads
//   exactly the file's own count of distinct values evenly over the fixed span, whatever
//   their real distribution across decades.
// - Rank i (0-indexed) is placed at t = (i + 0.5) / n, strictly inside the open interval
//   (0, 1) — the extra 0.5 keeps even the smallest and largest real values from mapping to
//   themselves, since t never reaches exactly 0 or 1. The synthetic magnitude is
//   `10 ** (MONEY_LOG_MIN + t * (MONEY_LOG_MAX - MONEY_LOG_MIN))`, between 0.01 and 100 000.
// - t is strictly increasing in i, and exponentiation is strictly increasing in its
//   argument, so the composition is strictly increasing in i: two different ranks can never
//   land on the same synthetic value. Provably injective, the same shape of proof as the
//   strike ladder above (a strictly increasing function of a distinct index is injective).
// - The mapping is not affine: the ratio (synthetic / real) depends on where a value's rank
//   falls in the file's own sorted distribution, not on a fixed constant,
//   so it is different on every row. No single constant recovers a real figure, unlike
//   SCALE = 0.37.
//
// Sign is preserved, zero maps to zero. A candidate that would still land on its own real
// magnitude (defensive only: not observed on real data, since t never touches its endpoints)
// is nudged by a tiny deterministic offset until it differs.
const MONEY_LOG_MIN = -2;
const MONEY_LOG_MAX = 5;

function formatMoney(x) {
  return x.toFixed(4).replace(/\.?0+$/, "");
}

const realMoneyMagnitudes = new Set();
for (const name of MONEY) {
  for (const [, v] of xml.matchAll(new RegExp(` ${name}="(-?[\\d.]+)"`, "g"))) {
    const magnitude = Math.abs(Number(v));
    if (magnitude !== 0) realMoneyMagnitudes.add(magnitude);
  }
}
const sortedMoneyMagnitudes = Array.from(realMoneyMagnitudes).sort((a, b) => a - b);
const moneyMap = new Map();
if (sortedMoneyMagnitudes.length === 1) {
  // A single distinct magnitude has no range to interpolate across; move it
  // to a fixed, unmistakably synthetic order of magnitude instead.
  moneyMap.set(sortedMoneyMagnitudes[0], sortedMoneyMagnitudes[0] * 3 + 7);
} else {
  const n = sortedMoneyMagnitudes.length;
  const logMin = MONEY_LOG_MIN;
  const logMax = MONEY_LOG_MAX;
  sortedMoneyMagnitudes.forEach((magnitude, i) => {
    const t = (i + 0.5) / n;
    let candidate = 10 ** (logMin + t * (logMax - logMin));
    let bump = 1;
    while (candidate === magnitude) candidate = 10 ** (logMin + t * (logMax - logMin)) * (1 + 0.0001 * bump++);
    moneyMap.set(magnitude, candidate);
  });
}
for (const name of MONEY) {
  xml = xml.replace(new RegExp(` ${name}="(-?[\\d.]+)"`, "g"), (_, v) => {
    const n = Number(v);
    if (n === 0) return ` ${name}="0"`;
    return ` ${name}="${formatMoney(Math.sign(n) * moneyMap.get(Math.abs(n)))}"`;
  });
}
xml = xml.replace(/ tradePrice="STRIKE:([^"]*)"/g, ' tradePrice="$1"');

// 10. fxRateToBase is not a money amount read by any parser (grep confirms nothing in
// packages/ib-parsers consumes it) and carried the clearest tell of the old affine
// transform: every row whose real rate was 1 (same-currency row) landed on exactly 0.37,
// naming SCALE outright. It gets a single fixed synthetic rate instead of a mapped one —
// there is nothing about it worth preserving row to row once it is understood to be inert.
xml = xml.replace(/ fxRateToBase="[^"]*"/g, ' fxRateToBase="1.0842"');

process.stdout.write(xml);
