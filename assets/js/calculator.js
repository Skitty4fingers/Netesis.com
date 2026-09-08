/**
 * Netesis — Token ROI model: the pure math module.
 *
 * Every export here is a pure function or a frozen constant. Nothing in this file touches
 * the page, storage, the network, or the clock, so the same file runs unchanged as a browser
 * module, under Node
 *   node --input-type=module -e "import('file:///D:/Projects/Netesis.com/assets/js/calculator.js').then(m => console.log(m.compute(m.EXAMPLE)))"
 * and inside the test page next to it (./calculator.test.html).
 *
 * The contract is SPEC §7: inputs (§7.1), formulas (§7.2), hand-checked expected values (§7.3),
 * public API (§7.4). Each formula below carries its plain-English meaning as a comment.
 *
 * Conventions
 *   - Money is a plain Number in the chosen currency; there is no conversion between currencies.
 *   - A quantity that cannot be defined (a per-task cost with zero tasks) is `null`, never NaN.
 *   - Every formatter returns "—" for null / NaN / Infinity / non-numbers, so the strings that
 *     reach the page never read "NaN", "Infinity", "undefined", "null" or "[object Object]".
 *   - Negative numbers are shown with a true minus sign (U+2212), never accounting parentheses.
 */

export const VERSION = '1.0.0';

/** Version tag written into the URL hash state (`v=1&…`). */
const STATE_VERSION = '1';

/** Locale used for every Intl.NumberFormat call so output is identical everywhere. */
const LOCALE = 'en-US';
const MINUS = '\u2212';   // − true minus sign
const DASH = '\u2014';    // — "no value"

// ----------------------------------------------------------------------------- constants

/** Display currencies. Display only — no conversion happens anywhere in the model. */
export const CURRENCIES = Object.freeze([
  Object.freeze({ code: 'USD', label: 'US dollar' }),
  Object.freeze({ code: 'EUR', label: 'Euro' }),
  Object.freeze({ code: 'GBP', label: 'British pound' }),
  Object.freeze({ code: 'CAD', label: 'Canadian dollar' }),
  Object.freeze({ code: 'AUD', label: 'Australian dollar' }),
]);

/**
 * Pricing presets: illustrative starting points — not any vendor's list price.
 * Prices are per million tokens. "custom" carries no prices; it means "whatever is typed".
 * To change a preset, edit the numbers here; the UI reads this array.
 */
export const PRESETS = Object.freeze([
  Object.freeze({ key: 'frontier', label: 'Frontier', priceIn: 5, priceOut: 25 }),
  Object.freeze({ key: 'mid', label: 'Mid-tier', priceIn: 1, priceOut: 5 }),
  Object.freeze({ key: 'small', label: 'Small / batch', priceIn: 0.10, priceOut: 0.50 }),
  Object.freeze({ key: 'custom', label: 'Custom', priceIn: null, priceOut: null }),
]);

/** The example scenario (SPEC §7.3). The page loads with these values; "Reset to example" restores them. */
export const EXAMPLE = Object.freeze({
  name: 'Invoice triage',
  tasks: 12000,       // tasks per month
  inTok: 6000,        // average input tokens per task
  outTok: 600,        // average output tokens per task
  retry: 1.15,        // retry / regeneration multiplier (1.15 = 15% of calls repeated)
  preset: 'frontier',
  priceIn: 5,         // price per million input tokens
  priceOut: 25,       // price per million output tokens
  acceptance: 80,     // % of outputs usable without rework
  reviewMin: 2,       // minutes a person spends checking an accepted output
  reworkMin: 9,       // minutes to fix or redo a rejected output
  humanMin: 5,        // minutes per task when a person does it (the baseline)
  hourly: 65,         // fully loaded hourly cost
  build: 40000,       // one-time build cost
  recurring: 2500,    // recurring monthly platform / engineering cost
  amort: 12,          // months over which the build cost is spread
  currency: 'USD',
});

/** Sensitivity scenarios: each `apply` returns a modified copy of sanitized inputs. */
export const SCENARIOS = Object.freeze([
  Object.freeze({ key: 'base', label: 'Base', apply: (i) => ({ ...i }) }),
  Object.freeze({ key: 'volume-half', label: 'Volume ×0.5', apply: (i) => ({ ...i, tasks: i.tasks * 0.5 }) }),
  Object.freeze({ key: 'volume-double', label: 'Volume ×2', apply: (i) => ({ ...i, tasks: i.tasks * 2 }) }),
  Object.freeze({ key: 'acceptance-minus-15', label: 'Acceptance −15 pts', apply: (i) => ({ ...i, acceptance: Math.max(0, i.acceptance - 15) }) }),
  Object.freeze({ key: 'price-double', label: 'Token price ×2', apply: (i) => ({ ...i, priceIn: i.priceIn * 2, priceOut: i.priceOut * 2 }) }),
  Object.freeze({ key: 'review-double', label: 'Review time ×2', apply: (i) => ({ ...i, reviewMin: i.reviewMin * 2 }) }),
]);

/** Numeric input keys, in form order. */
const NUMERIC_KEYS = Object.freeze([
  'tasks', 'inTok', 'outTok', 'retry', 'priceIn', 'priceOut', 'acceptance',
  'reviewMin', 'reworkMin', 'humanMin', 'hourly', 'build', 'recurring', 'amort',
]);

/** Every input key, in form order (used for the hash state). */
const KEYS = Object.freeze([
  'name', 'tasks', 'inTok', 'outTok', 'retry', 'preset', 'priceIn', 'priceOut', 'acceptance',
  'reviewMin', 'reworkMin', 'humanMin', 'hourly', 'build', 'recurring', 'amort', 'currency',
]);

const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));
const PRESET_KEYS = new Set(PRESETS.map((p) => p.key));

// ----------------------------------------------------------------------------- helpers

/** True for a real, finite number (rejects NaN, ±Infinity, null, strings, objects). */
function fin(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Coerce anything to a finite non-negative number; `fallback` when it is not a number at all. */
function toNonNegative(raw, fallback) {
  let v;
  try { v = Number(raw); } catch { v = NaN; }        // Number(Symbol()) throws
  if (!Number.isFinite(v)) v = fallback;
  if (v <= 0) v = 0;                                  // also turns -0 into +0
  return v;
}

/** "a" or "an" for a number that will be read aloud: an 8, an 11, an 18, an 80–89, an 800–899. */
function article(numberText) {
  const m = /^\d+/.exec(String(numberText));
  if (!m) return 'a';
  const digits = m[0];
  // The leading group of one to three digits decides the spoken sound ("eighty", "eight hundred").
  const lead = Number(digits.slice(0, ((digits.length - 1) % 3) + 1));
  const an = lead === 8 || lead === 11 || lead === 18 || (lead >= 80 && lead <= 89) || (lead >= 800 && lead <= 899);
  return an ? 'an' : 'a';
}

/** 'pos' | 'neg' | 'zero' | 'none' — a tone for colouring a money value. */
function tone(v) {
  if (!fin(v)) return 'none';
  if (v > 0) return 'pos';
  if (v < 0) return 'neg';
  return 'zero';
}

/** Finest precision fmt.money ever shows (three decimals): below half of it a value prints as "$0". */
const MONEY_EPS = 0.0005;

/**
 * Zero, for display and for the verdict. netSavings is a difference of rounded doubles, so a
 * mathematically exact breakeven usually computes to noise rather than 0 — 12,000 tasks × 5 min at
 * $65/h against a $65,000 recurring cost gives −7.3e-12 — and that noise must not become "−$0.000",
 * a red tone, or "loses $0.000/month net". A value counts as zero when it would print as "$0" anyway
 * (|v| < 0.0005) or when it is below 1e-9 of the amounts it was computed from (`scale`): many orders
 * of magnitude above double-precision noise, and below the precision of anything a person types in.
 * Non-finite values and everything else come back unchanged.
 */
function snapZero(v, scale) {
  if (!fin(v)) return v;
  const eps = Math.max(MONEY_EPS, fin(scale) ? 1e-9 * scale : 0);
  return Math.abs(v) < eps ? 0 : v;
}

/** The magnitude netSavings was computed from: the largest monthly amount that feeds it (at least 1). */
function netScale(r) {
  return Math.max(1, ...[r.humanMonthly, r.aiCost, r.programMonthly].filter(fin));
}

// ----------------------------------------------------------------------------- sanitize

/**
 * Coerce a raw input object (form strings, hash values, anything) into a complete, safe input set.
 *   - numeric fields: Number(); not finite → 0 (amort → 1); negative → 0
 *   - acceptance clamped to [0, 100]; amort = max(1, round(amort))
 *   - name trimmed, at most 80 characters counted in code points, so an emoji or any other astral
 *     character is never cut in half into a lone surrogate (trimmed again after the cut so a space
 *     at character 80 never survives and sanitize(sanitize(x)) === sanitize(x)); currency must be
 *     one of CURRENCIES, else USD; preset must be one of PRESETS, else "custom".
 */
export function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};

  let name = '';
  if (typeof src.name === 'string') name = src.name;
  else if (fin(src.name)) name = String(src.name);
  out.name = Array.from(name.trim()).slice(0, 80).join('').trim();   // cut by code point, not UTF-16 unit

  for (const k of NUMERIC_KEYS) out[k] = toNonNegative(src[k], k === 'amort' ? 1 : 0);
  out.acceptance = Math.min(100, out.acceptance);
  out.amort = Math.max(1, Math.round(out.amort));

  out.preset = typeof src.preset === 'string' && PRESET_KEYS.has(src.preset) ? src.preset : 'custom';
  const cur = typeof src.currency === 'string' ? src.currency.toUpperCase() : '';
  out.currency = CURRENCY_CODES.has(cur) ? cur : 'USD';
  return out;
}

// ----------------------------------------------------------------------------- compute

/**
 * Payback: how many months of cash flow it takes to repay the one-time build cost.
 *   build <= 0     → { kind: 'none' }   there is nothing to recover
 *   cashflow <= 0  → { kind: 'never' }  the workflow does not generate cash to repay it
 *   otherwise      → { kind: 'months', months: build / cashflow }
 */
function paybackOf(build, cashflow) {
  if (build <= 0) return { kind: 'none' };
  if (!(cashflow > 0)) return { kind: 'never' };
  const months = build / cashflow;
  if (!Number.isFinite(months)) return { kind: 'never' };
  return { kind: 'months', months };
}

/**
 * Breakeven acceptance rate: solve netSavings(a) = 0 for the acceptance fraction a.
 * netSavings is linear in a:  netSavings(a) = K − L·(reworkMin + a·(reviewMin − reworkMin))
 *   K     = humanMonthly − tokenCost − programMonthly   (savings before any review or rework labour)
 *   L     = tasks · hourly / 60                          (cost of one labour-minute on every task)
 *   slope = L · (reviewMin − reworkMin)                  (d netSavings / d a = −slope)
 * When review is cheaper than rework (the normal case) more acceptance means more savings and the
 * root is a FLOOR: below it the workflow loses money. When review costs more than rework the line
 * runs the other way and the root is a CEILING — a sign the inputs deserve a second look.
 */
function breakevenAcceptanceOf(i, r) {
  const K = r.humanMonthly - r.tokenCost - r.programMonthly;
  const L = i.tasks * i.hourly / 60;
  const slope = L * (i.reviewMin - i.reworkMin);
  if (slope === 0 || Number.isNaN(slope)) {
    // Acceptance has no effect on the result (no tasks, free labour, or review == rework).
    return r.netSavings >= 0 ? { kind: 'always' } : { kind: 'never' };
  }
  const aStar = (K / L - i.reworkMin) / (i.reviewMin - i.reworkMin);
  // ±Infinity is a real answer — a subnormal review − rework difference pushes the root off the
  // scale — and the comparisons below read it correctly (+Infinity >= 1, −Infinity <= 0). Only NaN
  // (an overflow upstream) has no root; then the sign of netSavings is the only honest verdict.
  if (Number.isNaN(aStar)) return r.netSavings >= 0 ? { kind: 'always' } : { kind: 'never' };
  // 'never' means the workflow loses money at every acceptance rate, which cannot be true while it
  // is paying now. With an extreme review or rework time the root sits within float precision of
  // an endpoint (reworkMin 1e100 at 100% acceptance: the true root is 1 − 1e-85, aStar computes as
  // exactly 1), so the endpoint branches defer to the sign of netSavings — snapped, so noise at an
  // exact breakeven still reads as breakeven — and report the boundary the workflow is sitting on.
  const paying = snapZero(r.netSavings, netScale(r)) > 0;
  const a = i.acceptance / 100;
  if (i.reviewMin < i.reworkMin) {
    if (aStar <= 0) return { kind: 'always' };
    if (aStar >= 1) return paying ? { kind: 'floor', value: Math.min(aStar, a) * 100 } : { kind: 'never' };
    return { kind: 'floor', value: aStar * 100 };
  }
  if (aStar >= 1) return { kind: 'always' };
  if (aStar <= 0) return paying ? { kind: 'ceiling', value: Math.max(aStar, a) * 100 } : { kind: 'never' };
  return { kind: 'ceiling', value: aStar * 100 };
}

/**
 * Breakeven token price: the multiplier m applied to BOTH prices at which netSavings hits zero.
 *   netSavings(m) = netSavings − (m − 1)·tokenCost = 0  →  m = 1 + netSavings / tokenCost
 *   tokenCost <= 0 → { kind: 'no-tokens' }  nothing is spent on tokens, so price is irrelevant
 *   m = +Infinity  → { kind: 'no-tokens' }  the spend is so far below the margin (a subnormal token
 *                                           cost against real savings) that price cannot matter
 *   m > 1          → { kind: 'rise', … }    prices would have to rise m× to erase the margin
 *   0 < m <= 1     → { kind: 'fall', … }    already losing; prices would have to FALL to m×
 *   m <= 0         → { kind: 'never' }      even free tokens would not make it pay (−Infinity included)
 *   m = NaN        → { kind: 'never' }      the inputs overflowed upstream; there is no honest multiplier
 */
function breakevenTokenPriceOf(i, tokenCost, netSavings) {
  if (!(tokenCost > 0)) return { kind: 'no-tokens' };
  const m = 1 + netSavings / tokenCost;
  if (Number.isNaN(m)) return { kind: 'never' };
  if (m === Infinity) return { kind: 'no-tokens' };   // overflow of a positive margin, not a loss
  if (m <= 0) return { kind: 'never' };
  const kind = m > 1 ? 'rise' : 'fall';
  return { kind, multiplier: m, priceIn: i.priceIn * m, priceOut: i.priceOut * m };
}

/**
 * The model. Takes raw or sanitized inputs (sanitize() runs first either way) and returns every
 * quantity in SPEC §7.2. All money is per month unless the name says otherwise.
 */
export function compute(rawInputs) {
  const i = sanitize(rawInputs);

  const a = i.acceptance / 100;                       // acceptance rate as a fraction 0–1

  // Token volume, retries included: each task sends its prompt `retry` times on average.
  const inTokM = i.tasks * i.inTok * i.retry;         // input tokens per month
  const outTokM = i.tasks * i.outTok * i.retry;       // output tokens per month
  const totalTokM = inTokM + outTokM;                 // all tokens per month

  // Token spend: tokens per month, in millions, times the price per million.
  const inputCost = inTokM / 1e6 * i.priceIn;
  const outputCost = outTokM / 1e6 * i.priceOut;
  const tokenCost = inputCost + outputCost;

  // Quality reality: how many outputs are kept, and how many have to be fixed.
  const accepted = i.tasks * a;                       // outputs usable without rework
  const rejected = i.tasks * (1 - a);                 // outputs that fail review

  // Labour around the model: review minutes on accepted outputs, rework minutes on rejected ones.
  const reviewCost = accepted * i.reviewMin / 60 * i.hourly;
  const reworkCost = rejected * i.reworkMin / 60 * i.hourly;
  const laborCost = reviewCost + reworkCost;

  // Monthly operating cost of the AI workflow: tokens plus the people around them.
  const aiCost = tokenCost + laborCost;

  // Unit costs. Undefined (null) when there is nothing to divide by.
  const tokenCostPerTask = i.tasks > 0 ? tokenCost / i.tasks : null;         // token spend per task
  const effectiveCostPerTask = i.tasks > 0 ? aiCost / i.tasks : null;        // all-in cost per task
  const costPerAccepted = accepted > 0 ? aiCost / accepted : null;           // all-in cost per output you keep

  // Human baseline: what the same work costs when a person does it.
  const humanPerTask = i.humanMin / 60 * i.hourly;
  const humanMonthly = i.tasks * humanPerTask;

  // Savings: baseline minus AI operating cost, then minus the program that keeps it alive.
  const grossSavings = humanMonthly - aiCost;
  const buildMonthly = i.build / i.amort;             // build cost spread evenly over the amortization months
  const programMonthly = i.recurring + buildMonthly;  // recurring cost plus amortized build
  const netSavings = grossSavings - programMonthly;
  const cashflow = grossSavings - i.recurring;        // what actually repays the build each month

  const payback = paybackOf(i.build, cashflow);
  const breakevenAcceptance = breakevenAcceptanceOf(i, { humanMonthly, aiCost, tokenCost, programMonthly, netSavings });
  const breakevenTokenPrice = breakevenTokenPriceOf(i, tokenCost, netSavings);

  return {
    inputs: i,
    a,
    inTokM, outTokM, totalTokM,
    inputCost, outputCost, tokenCost,
    accepted, rejected,
    reviewCost, reworkCost, laborCost,
    aiCost,
    tokenCostPerTask, effectiveCostPerTask, costPerAccepted,
    humanPerTask, humanMonthly,
    grossSavings, buildMonthly, programMonthly, netSavings, cashflow,
    payback, breakevenAcceptance, breakevenTokenPrice,
  };
}

// ----------------------------------------------------------------------------- sensitivity

/**
 * Net monthly savings under stress: each SCENARIO re-runs compute() on a modified copy of the
 * inputs. Returns [{ key, label, net, delta }] where delta is the change against the base row.
 */
export function sensitivity(rawInputs) {
  const base = sanitize(rawInputs);
  const baseNet = compute(base).netSavings;
  return SCENARIOS.map((s) => {
    const net = compute(s.apply(base)).netSavings;
    return { key: s.key, label: s.label, net, delta: s.key === 'base' ? 0 : net - baseNet };
  });
}

// ----------------------------------------------------------------------------- verdict

/**
 * The one-sentence verdict (SPEC §7.2 templates). The name is used as typed; a blank name
 * becomes "this workflow".
 */
export function verdict(rawInputs, results) {
  const i = sanitize(rawInputs);
  const r = results && typeof results === 'object' ? results : compute(i);
  const money = (v) => fmt.money(v, i.currency);
  const name = i.name || 'this workflow';
  const nameAtStart = i.name || 'This workflow';

  if (i.tasks === 0) {
    return `With no monthly volume there is nothing to measure. ${nameAtStart} would cost ${money(r.programMonthly)}/month in program costs.`;
  }

  // Float noise at an exact breakeven (−7e-12) reads as zero, so the "breaks even" branch is reachable.
  const net = snapZero(r.netSavings, netScale(r));
  if (!fin(net)) {
    // Overflow (inputs around 1e308): there is no honest number to print, so say so without one.
    return `${nameAtStart} is outside the range this model can compute at these inputs. Reduce the largest values and try again.`;
  }

  const acc = fmt.pct(i.acceptance);
  const tasksText = fmt.int(i.tasks);
  const opening = `At ${tasksText} ${tasksText === '1' ? 'task' : 'tasks'}/month and ${article(acc)} ${acc} acceptance rate, ${name}`;

  const be = r.breakevenAcceptance || { kind: 'never' };
  const beValue = fin(be.value) ? fmt.pct(be.value) : '';

  if (net > 0) {
    const pb = r.payback || { kind: 'never' };
    let paybackClause;
    if (pb.kind === 'months') paybackClause = `pays back the build in ${fmt.months(pb.months)}`;
    else if (pb.kind === 'none') paybackClause = 'has no build cost to recover';
    else paybackClause = 'does not pay back the build';

    let floorClause = '';
    if (be.kind === 'floor') floorClause = `It stops paying for itself below ${article(beValue)} ${beValue} acceptance rate.`;
    else if (be.kind === 'ceiling') floorClause = `Above ${article(beValue)} ${beValue} acceptance rate it stops paying for itself, which means rework is cheaper than review in these inputs — check them.`;
    else if (be.kind === 'always') floorClause = 'It stays ahead at any acceptance rate.';

    return `${opening} saves ${money(net)}/month net and ${paybackClause}.${floorClause ? ' ' + floorClause : ''}`;
  }

  if (net === 0) {
    return `${opening} breaks even exactly at these inputs.`;
  }

  let needClause = '';
  if (be.kind === 'floor' && be.value > i.acceptance) needClause = `It would need an acceptance rate above ${beValue} to break even.`;
  else if (be.kind === 'never') needClause = 'No acceptance rate makes it pay at these inputs.';
  else if (be.kind === 'ceiling') needClause = `It only breaks even below ${article(beValue)} ${beValue} acceptance rate, which means rework is cheaper than review in these inputs — check them.`;

  // lossPaybackClause (SPEC §7.2, netSavings < 0). Net is negative after amortizing the build, yet
  // monthly cash flow can still be positive: then payback.kind is 'months' and build / cashflow is
  // longer than the amortization window. Say that precisely — a bare "does not pay back" would
  // contradict the payback figure shown beside it. 'none' and 'never' keep the flat clause.
  const pb = r.payback || { kind: 'never' };
  const paybackClause = pb.kind === 'months'
    ? `does not pay back inside its ${fmt.int(i.amort)}-month amortization; the build alone would take ${fmt.months(pb.months)}`
    : 'does not pay back';

  return `${opening} loses ${money(Math.abs(net))}/month net and ${paybackClause}.${needClause ? ' ' + needClause : ''}`;
}

// ----------------------------------------------------------------------------- formatResults

/**
 * Every display string the results panel needs, already formatted for the chosen currency.
 * Values are strings (or, for `sensitivity`, an array of rows of strings). Nothing here is
 * ever "NaN", "Infinity", "undefined", "null" or "[object Object]".
 */
export function formatResults(rawInputs, results) {
  const i = sanitize(rawInputs);
  const r = results && typeof results === 'object' ? results : compute(i);
  const cur = i.currency;
  const scale = netScale(r);                        // the amounts netSavings was computed from
  const net = snapZero(r.netSavings, scale);        // float noise at an exact breakeven → 0 (see snapZero)
  const money = (v, opts) => fmt.money(v, cur, opts);
  // "+" only on a real gain: a value that snaps to zero is "$0", never "+$0" or "−$0.000".
  const signed = (v) => { const z = snapZero(v, scale); return fin(z) && z > 0 ? '+' + money(z) : money(z); };

  const out = {
    currency: cur,
    name: i.name || 'this workflow',
    tasks: fmt.int(i.tasks),
    acceptance: fmt.pct(i.acceptance),

    // Token spend
    inTokM: fmt.tokens(r.inTokM),
    inTokMFull: fmt.int(r.inTokM),
    outTokM: fmt.tokens(r.outTokM),
    outTokMFull: fmt.int(r.outTokM),
    totalTokM: fmt.tokens(r.totalTokM),
    totalTokMFull: fmt.int(r.totalTokM),
    inputCost: money(r.inputCost),
    outputCost: money(r.outputCost),
    tokenCost: money(r.tokenCost),

    // Quality and labour
    accepted: fmt.int(r.accepted),
    rejected: fmt.int(r.rejected),
    reviewCost: money(r.reviewCost),
    reworkCost: money(r.reworkCost),
    laborCost: money(r.laborCost),
    aiCost: money(r.aiCost),

    // Per task
    tokenCostPerTask: money(r.tokenCostPerTask),
    effectiveCostPerTask: money(r.effectiveCostPerTask),
    costPerAccepted: money(r.costPerAccepted),

    // Baseline
    humanPerTask: money(r.humanPerTask),
    humanMonthly: money(r.humanMonthly),

    // Savings
    grossSavings: money(r.grossSavings),
    buildMonthly: money(r.buildMonthly),
    programMonthly: money(r.programMonthly),
    netSavings: money(net),
    netSavingsSigned: signed(net),
    netTone: tone(net),
    cashflow: money(r.cashflow),
  };

  // Payback
  const pb = r.payback || { kind: 'never' };
  if (pb.kind === 'months') {
    out.payback = fmt.months(pb.months);
    out.paybackNote = `Build of ${money(i.build)} repaid by ${money(r.cashflow)}/month of cash flow after recurring costs.`;
  } else if (pb.kind === 'none') {
    out.payback = 'No build cost';
    out.paybackNote = 'There is no one-time build cost to recover.';
  } else {
    out.payback = 'Does not pay back';
    out.paybackNote = `Cash flow after recurring costs is ${money(r.cashflow)}/month, so the build is never recovered.`;
  }
  out.paybackKind = pb.kind;

  // Breakeven acceptance
  const be = r.breakevenAcceptance || { kind: 'never' };
  out.breakevenAcceptanceKind = be.kind;
  if (be.kind === 'floor') {
    out.breakevenAcceptance = fmt.pct(be.value);
    out.breakevenAcceptanceLabel = 'Floor';
    out.breakevenAcceptanceNote = 'Below this acceptance rate the workflow loses money.';
  } else if (be.kind === 'ceiling') {
    out.breakevenAcceptance = fmt.pct(be.value);
    out.breakevenAcceptanceLabel = 'Ceiling';
    out.breakevenAcceptanceNote = 'Above this acceptance rate it loses money, which means rework is cheaper than review in these inputs — check them.';
  } else if (be.kind === 'always') {
    out.breakevenAcceptance = 'Any rate';
    out.breakevenAcceptanceLabel = 'No floor';
    out.breakevenAcceptanceNote = 'It stays ahead at any acceptance rate.';
  } else {
    out.breakevenAcceptance = 'None';
    out.breakevenAcceptanceLabel = 'None';
    out.breakevenAcceptanceNote = 'No acceptance rate makes it pay at these inputs.';
  }

  // Breakeven token price
  const bp = r.breakevenTokenPrice || { kind: 'never' };
  out.breakevenTokenPriceKind = bp.kind;
  if (bp.kind === 'rise' || bp.kind === 'fall') {
    out.breakevenTokenPrice = fmt.mult(bp.multiplier);
    out.breakevenPriceIn = money(bp.priceIn, { digits: 2 });
    out.breakevenPriceOut = money(bp.priceOut, { digits: 2 });
    out.breakevenTokenPriceNote = bp.kind === 'rise'
      ? `Both prices would have to rise ${out.breakevenTokenPrice}, to ${out.breakevenPriceIn} in and ${out.breakevenPriceOut} out per million tokens, before the margin disappears.`
      : `Already underwater on price: both prices would have to fall to ${out.breakevenTokenPrice} of today's, ${out.breakevenPriceIn} in and ${out.breakevenPriceOut} out per million tokens, to break even.`;
  } else if (bp.kind === 'no-tokens') {
    out.breakevenTokenPrice = DASH;
    out.breakevenPriceIn = DASH;
    out.breakevenPriceOut = DASH;
    out.breakevenTokenPriceNote = 'No token spend in these inputs, so price does not matter.';
  } else {
    out.breakevenTokenPrice = 'Never';
    out.breakevenPriceIn = DASH;
    out.breakevenPriceOut = DASH;
    out.breakevenTokenPriceNote = 'Even free tokens would not make this workflow pay; labour and program costs alone exceed the baseline.';
  }

  out.verdict = verdict(i, r);

  out.sensitivity = sensitivity(i).map((row) => {
    const rowNet = snapZero(row.net, scale);       // the same snap as the hero figure, so the base row matches it
    return {
      key: row.key,
      label: row.label,
      net: money(rowNet),
      delta: row.key === 'base' ? DASH : signed(row.delta),
      tone: tone(rowNet),
    };
  });

  return out;
}

// ----------------------------------------------------------------------------- summaryText

/** Plain number with up to two decimals (minutes, multipliers in the summary). */
function plain(v) {
  if (!fin(v)) return DASH;
  const s = nf({ maximumFractionDigits: 2 }).format(Math.abs(v));
  return v < 0 ? MINUS + s : s;
}

/**
 * Plain-text recap for the clipboard: title, link, inputs, results, verdict, sensitivity rows.
 * `url` is optional; when given it is printed on the second line.
 */
export function summaryText(rawInputs, results, url) {
  const i = sanitize(rawInputs);
  const r = results && typeof results === 'object' ? results : compute(i);
  const f = formatResults(i, r);
  const money = (v, opts) => fmt.money(v, i.currency, opts);
  const preset = PRESETS.find((p) => p.key === i.preset);
  const presetNote = preset && preset.key !== 'custom' ? ` (${preset.label} preset)` : '';

  const lines = [];
  lines.push(`Token ROI model — ${f.name}`);
  if (typeof url === 'string' && url.trim()) lines.push(url.trim());
  lines.push('');
  lines.push('Inputs');
  lines.push(`  Tasks per month: ${f.tasks}`);
  lines.push(`  Tokens per task: ${fmt.int(i.inTok)} in, ${fmt.int(i.outTok)} out, retry ${fmt.mult(i.retry)}`);
  lines.push(`  Price per million tokens: ${money(i.priceIn, { digits: 2 })} in, ${money(i.priceOut, { digits: 2 })} out${presetNote}`);
  lines.push(`  Acceptance rate: ${f.acceptance}; review ${plain(i.reviewMin)} min per accepted output; rework ${plain(i.reworkMin)} min per rejected output`);
  lines.push(`  Human baseline: ${plain(i.humanMin)} min per task at ${money(i.hourly)} per hour`);
  lines.push(`  Program costs: ${money(i.build)} build over ${fmt.int(i.amort)} ${i.amort === 1 ? 'month' : 'months'}; ${money(i.recurring)} per month recurring`);
  lines.push('');
  lines.push('Results (per month)');
  lines.push(`  Token cost: ${f.tokenCost} (${f.inputCost} in, ${f.outputCost} out; ${f.totalTokMFull} tokens)`);
  lines.push(`  Cost per task: ${f.effectiveCostPerTask}; per accepted output: ${f.costPerAccepted}`);
  lines.push(`  Human baseline: ${f.humanMonthly} (${f.humanPerTask} per task)`);
  lines.push(`  Gross savings: ${f.grossSavings}; program costs: ${f.programMonthly}`);
  lines.push(`  Net savings: ${f.netSavingsSigned}`);
  lines.push(`  Payback: ${f.payback}`);
  const beKind = f.breakevenAcceptanceKind;
  lines.push(`  Breakeven acceptance: ${beKind === 'floor' || beKind === 'ceiling' ? `${f.breakevenAcceptance} (${f.breakevenAcceptanceLabel.toLowerCase()})` : f.breakevenAcceptanceNote}`);
  const bpKind = f.breakevenTokenPriceKind;
  lines.push(`  Breakeven token price: ${bpKind === 'rise' || bpKind === 'fall' ? `${f.breakevenTokenPrice} (${f.breakevenPriceIn} in, ${f.breakevenPriceOut} out per million tokens)` : f.breakevenTokenPriceNote}`);
  lines.push('');
  lines.push('Verdict');
  lines.push(`  ${f.verdict}`);
  lines.push('');
  lines.push('Sensitivity (net savings per month)');
  for (const row of f.sensitivity) {
    lines.push(`  ${row.label.padEnd(20)} ${row.net}${row.key === 'base' ? '' : ` (${row.delta})`}`);
  }
  lines.push('');
  lines.push('Illustrative model, not a client result. Presets are starting points, not list prices.');
  return lines.join('\n');
}

// ----------------------------------------------------------------------------- hash state

/**
 * Serialize inputs for the URL hash: "v=1&" followed by every known key as typed
 * (numbers are not sanitized here; the name is URL-encoded by URLSearchParams).
 */
export function encodeState(inputs) {
  const src = inputs && typeof inputs === 'object' ? inputs : {};
  const params = new URLSearchParams();
  for (const k of KEYS) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' || typeof v === 'function' || typeof v === 'symbol') continue;
    params.set(k, String(v));
  }
  const body = params.toString();
  return body ? `v=${STATE_VERSION}&${body}` : `v=${STATE_VERSION}`;
}

/**
 * Parse a hash (with or without the leading "#") back into a partial inputs object.
 * Only known keys are kept; numeric keys must parse to a finite number, `preset` and `currency`
 * must be valid choices, everything else is dropped. Never throws.
 */
export function decodeState(hash) {
  const out = {};
  if (typeof hash !== 'string') return out;
  let s = hash.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (!s) return out;
  let params;
  try { params = new URLSearchParams(s); } catch { return out; }

  for (const k of NUMERIC_KEYS) {
    if (!params.has(k)) continue;
    const raw = params.get(k).trim();
    if (raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[k] = n;
  }
  if (params.has('name')) out.name = Array.from(params.get('name')).slice(0, 80).join('');   // by code point (see sanitize)
  if (params.has('preset') && PRESET_KEYS.has(params.get('preset'))) out.preset = params.get('preset');
  if (params.has('currency')) {
    const cur = params.get('currency').toUpperCase();
    if (CURRENCY_CODES.has(cur)) out.currency = cur;
  }
  return out;
}

// ----------------------------------------------------------------------------- fmt

const formatterCache = new Map();

/** Cached Intl.NumberFormat for a given options object. */
function nf(options) {
  const key = JSON.stringify(options);
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, options);
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Money (SPEC §7.2 number formatting). null / non-finite → "—". Decimals: |v| < 1 → 3; < 100 → 2;
 * else 0; override with { digits }. Anything that rounds to zero at that precision — an exact 0, −0,
 * or float noise such as −7.3e-12 — is the SPEC's exact-zero case: "$0", no decimals, no sign (there is
 * no precision to show, and "−$0.000" is never a correct amount). Negatives get a leading U+2212,
 * never parentheses.
 */
function money(v, currency, opts) {
  if (!fin(v)) return DASH;
  const code = typeof currency === 'string' && CURRENCY_CODES.has(currency.toUpperCase()) ? currency.toUpperCase() : 'USD';
  let abs = Math.abs(v);
  let digits = opts && fin(opts.digits) ? Math.min(20, Math.max(0, Math.round(opts.digits))) : null;
  if (digits === null) digits = abs < 1 ? 3 : abs < 100 ? 2 : 0;
  // Round FIRST, then decide whether there is a sign to show. (abs × 10^digits can overflow to
  // Infinity for a huge value with a large digits override; that is simply "not zero".)
  if (Math.round(abs * 10 ** digits) === 0) { abs = 0; digits = 0; }
  const options = { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits };
  let s;
  try {
    s = nf(options).format(abs);
  } catch {
    s = nf({ ...options, currency: 'USD' }).format(abs);
  }
  return abs > 0 && v < 0 ? MINUS + s : s;
}

/** Percentage of a 0–100 value: pct(80) → "80%". */
function pct(v, digits = 0) {
  if (!fin(v)) return DASH;
  const d = fin(digits) ? Math.min(20, Math.max(0, Math.round(digits))) : 0;
  const s = nf({ style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v) / 100);
  return v < 0 ? MINUS + s : s;
}

/** Whole number with grouping: int(12000) → "12,000". */
function int(v) {
  if (!fin(v)) return DASH;
  const s = nf({ maximumFractionDigits: 0 }).format(Math.abs(v));
  return v < 0 ? MINUS + s : s;
}

/** Months to one decimal: "2.3 months", "1.0 month" (singular only when the shown value is 1.0). */
function months(v) {
  if (!fin(v)) return DASH;
  const s = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(v));
  return `${v < 0 ? MINUS : ''}${s} ${s === '1.0' ? 'month' : 'months'}`;
}

/** Multiplier: "×24.1" (one decimal from 10 up, up to two below: "×1.15", "×0.6"). */
function mult(v) {
  if (!fin(v)) return DASH;
  const abs = Math.abs(v);
  const s = abs >= 10
    ? nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(abs)
    : nf({ maximumFractionDigits: 2 }).format(abs);
  return `×${v < 0 ? MINUS : ''}${s}`;
}

/** Token counts to three significant figures with a unit: "82.8M", "8.28M", "600", "1.5K", "1T". */
function tokens(v) {
  if (!fin(v)) return DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? MINUS : '';
  if (abs < 1000) return sign + nf({ maximumFractionDigits: 0 }).format(abs);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const x = abs / size;
      const s = x >= 1000 ? nf({ maximumFractionDigits: 0 }).format(x) : nf({ maximumSignificantDigits: 3 }).format(x);
      return sign + s + unit;
    }
  }
  return sign + nf({ maximumFractionDigits: 0 }).format(abs);
}

export const fmt = Object.freeze({ money, pct, int, months, mult, tokens });
