/**
 * Netesis — Token ROI model: the DOM wiring for calculator.html.
 *
 * This file owns the page and nothing else. Every number it displays is a string produced by
 * `formatResults()` (or `verdict()` / `summaryText()`) inside ./calculator.js — no formula and no
 * number formatting is reimplemented here, so the page and the test suite can never disagree.
 * The one place a formatter is called directly is the number tween, which needs an intermediate
 * string per frame (SPEC §7.5); it uses the module's own `fmt`, and the settled frame is always the
 * exact string from `formatResults()`.
 *
 * Flow, on load and on every input event:
 *   read the fields as typed → sanitize() → compute() → formatResults() → write into [data-out]
 *
 * Contract with the markup:
 *   [data-out="<key>"]        element receives formatted[<key>] as its text
 *   [data-out-title="<key>"]  element also receives formatted[<key>] as its title attribute
 *   [data-animate]            numeric elements tween from the previous value over 240 ms
 *   [data-sens-row="<key>"]   one row of the sensitivity table, matched to a SCENARIOS key
 *
 * Sensitivity rows are keyed by scenario, so the table follows SCENARIOS: a row whose key is no
 * longer produced is dropped, and a scenario without a row gets one built for it. The static rows
 * in the HTML carry the example scenario, so the panel reads correctly before this file runs and
 * when it cannot run at all.
 *
 * SPEC §7.5. Nothing here touches the network; the URL hash is the only state that leaves the page.
 */

import {
  EXAMPLE, PRESETS,
  sanitize, compute, formatResults, summaryText,
  encodeState, decodeState, fmt,
} from './calculator.js';

// ----------------------------------------------------------------------------- constants

/** Every input id, which is also its key in the model and in the hash state (SPEC §7.1). */
const FIELDS = [
  'name', 'tasks', 'inTok', 'outTok', 'retry', 'preset', 'priceIn', 'priceOut', 'acceptance',
  'reviewMin', 'reworkMin', 'humanMin', 'hourly', 'build', 'recurring', 'amort', 'currency',
];

const TWEEN_MS = 240;        // number transition (SPEC §7.5)
const LIVE_MS = 700;         // screen-reader announcement debounce
const HASH_MS = 150;         // history.replaceState debounce
const STATUS_MS = 6000;      // how long an action message stays in the status line

const PLUS = '+';
const MINUS = '−';      // − true minus sign, as produced by fmt

/**
 * Which [data-out] keys are numeric, where the raw number lives in the compute() result, and which
 * formatter renders an intermediate tween frame. `get` returns null when the key has no number at
 * these inputs (a payback that never happens, a breakeven that does not exist) — those never tween.
 */
const ANIM = {
  netSavingsSigned: { get: (r) => r.netSavings, fmt: (v, c) => (v > 0 ? PLUS : '') + fmt.money(v, c) },
  netSavings: { get: (r) => r.netSavings, fmt: fmt.money },
  inputCost: { get: (r) => r.inputCost, fmt: fmt.money },
  outputCost: { get: (r) => r.outputCost, fmt: fmt.money },
  tokenCost: { get: (r) => r.tokenCost, fmt: fmt.money },
  laborCost: { get: (r) => r.laborCost, fmt: fmt.money },
  aiCost: { get: (r) => r.aiCost, fmt: fmt.money },
  tokenCostPerTask: { get: (r) => r.tokenCostPerTask, fmt: fmt.money },
  effectiveCostPerTask: { get: (r) => r.effectiveCostPerTask, fmt: fmt.money },
  costPerAccepted: { get: (r) => r.costPerAccepted, fmt: fmt.money },
  humanPerTask: { get: (r) => r.humanPerTask, fmt: fmt.money },
  humanMonthly: { get: (r) => r.humanMonthly, fmt: fmt.money },
  grossSavings: { get: (r) => r.grossSavings, fmt: fmt.money },
  programMonthly: { get: (r) => r.programMonthly, fmt: fmt.money },
  inTokM: { get: (r) => r.inTokM, fmt: (v) => fmt.tokens(v) },
  outTokM: { get: (r) => r.outTokM, fmt: (v) => fmt.tokens(v) },
  accepted: { get: (r) => r.accepted, fmt: (v) => fmt.int(v) },
  rejected: { get: (r) => r.rejected, fmt: (v) => fmt.int(v) },
  payback: { get: (r) => (r.payback && r.payback.kind === 'months' ? r.payback.months : null), fmt: (v) => fmt.months(v) },
  breakevenAcceptance: {
    get: (r) => (r.breakevenAcceptance && (r.breakevenAcceptance.kind === 'floor' || r.breakevenAcceptance.kind === 'ceiling') ? r.breakevenAcceptance.value : null),
    fmt: (v) => fmt.pct(v),
  },
  breakevenTokenPrice: {
    get: (r) => (r.breakevenTokenPrice && (r.breakevenTokenPrice.kind === 'rise' || r.breakevenTokenPrice.kind === 'fall') ? r.breakevenTokenPrice.multiplier : null),
    fmt: (v) => fmt.mult(v),
  },
};

// ----------------------------------------------------------------------------- small helpers

const $ = (sel, root = document) => root.querySelector(sel);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Debounce that keeps one timer per call site. */
function debounce(fn, ms) {
  let t = 0;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}

/** Live check, so a preference changed after load is honoured without a reload. */
function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** 'pos' | 'neg' | '' from a formatted signed string — the sign character, not a recomputation. */
function toneOfSigned(text) {
  if (typeof text !== 'string') return '';
  if (text.startsWith(PLUS)) return 'pos';
  if (text.startsWith(MINUS) || text.includes(MINUS)) return 'neg';
  return '';
}

/** Apply the money semantics classes without disturbing anything else on the element. */
function setTone(el, tone) {
  if (!el) return;
  el.classList.toggle('is-pos', tone === 'pos');
  el.classList.toggle('is-neg', tone === 'neg');
}

// ----------------------------------------------------------------------------- number tween

/**
 * Write `text` into `el`, tweening the figure from its previous value when that makes sense.
 * The tween is skipped under reduced motion, on the first paint, when either end is not a real
 * number (a dash, "Does not pay back", "Any rate"), and when nothing changed. Whatever happens,
 * the element ends holding exactly the string `formatResults()` produced.
 */
function writeValue(el, key, text, results, currency, animate) {
  // The number behind the string is read on every render, animated or not, so the next render
  // has something to tween from — including the very first paint.
  const spec = ANIM[key];
  const to = spec ? spec.get(results) : null;
  const from = el.__calcNum;

  if (el.__calcRaf) { cancelAnimationFrame(el.__calcRaf); el.__calcRaf = 0; }

  const canTween = animate && spec && !reducedMotion() && isNum(from) && isNum(to) && from !== to;
  if (!canTween) {
    if (el.textContent !== text) el.textContent = text;
    el.__calcNum = isNum(to) ? to : null;
    return;
  }

  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / TWEEN_MS);
    if (p >= 1) {
      el.__calcRaf = 0;
      el.textContent = text;                       // the authoritative, formatted string
      return;
    }
    const eased = 1 - Math.pow(1 - p, 3);          // ease-out cubic
    const v = from + (to - from) * eased;
    const frame = spec.fmt(v, currency);
    el.textContent = typeof frame === 'string' ? frame : text;
    el.__calcRaf = requestAnimationFrame(step);
  };
  el.__calcNum = to;
  el.__calcRaf = requestAnimationFrame(step);
}

// ----------------------------------------------------------------------------- the page

function init() {
  const form = $('.calc__form');
  const results = $('.results');
  if (!form || !results) return false;

  const els = {};
  for (const key of FIELDS) els[key] = document.getElementById(key);

  const liveEl = $('#results-live');
  const heroEl = $('[data-out="netSavingsSigned"]', results);
  const statusEl = $('#calc-status');
  const resetBtn = $('#calc-reset');
  const copyBtn = $('#calc-copy');
  const copyOut = $('#copy-fallback');
  const copyOutText = $('#copy-fallback-text');
  const sensBody = $('.sensitivity tbody', results);
  const fallback = $('#calc-fallback');

  let statusTimer = 0;

  /** Read every field exactly as typed. Sanitizing is calculator.js's job, not this file's. */
  function readRaw() {
    const raw = {};
    for (const key of FIELDS) if (els[key]) raw[key] = els[key].value;
    return raw;
  }

  /** Push a full input set into the form. Values are written as text; empty stays empty. */
  function applyState(state) {
    for (const key of FIELDS) {
      const el = els[key];
      if (!el) continue;
      const v = state[key];
      el.value = v === undefined || v === null ? '' : String(v);
    }
  }

  function setStatus(message) {
    if (!statusEl) return;
    clearTimeout(statusTimer);
    statusEl.textContent = message;
    if (message) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, STATUS_MS);
  }

  // ------------------------------------------------------------- sensitivity table

  /** Make the rows in the table match the scenarios formatResults just produced, in order. */
  function syncSensRows(rows) {
    if (!sensBody) return;
    const wanted = new Set(rows.map((r) => r.key));
    for (const tr of Array.from(sensBody.querySelectorAll('[data-sens-row]'))) {
      if (!wanted.has(tr.dataset.sensRow)) tr.remove();
    }
    let previous = null;
    for (const row of rows) {
      let tr = sensBody.querySelector(`[data-sens-row="${CSS.escape(row.key)}"]`);
      if (!tr) {
        tr = document.createElement('tr');
        tr.dataset.sensRow = row.key;
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = row.label;
        const net = document.createElement('td');
        net.className = 'num';
        net.dataset.out = `sens:${row.key}:net`;
        const delta = document.createElement('td');
        delta.className = 'num';
        delta.dataset.out = `sens:${row.key}:delta`;
        tr.append(th, net, delta);
      }
      // keep the DOM order identical to the scenario order
      if (previous) previous.after(tr); else sensBody.prepend(tr);
      previous = tr;

      tr.classList.toggle('is-base', row.key === 'base');
      setTone(tr, row.tone === 'pos' ? 'pos' : row.tone === 'neg' ? 'neg' : '');
      const netCell = tr.querySelector(`[data-out="sens:${row.key}:net"]`);
      const deltaCell = tr.querySelector(`[data-out="sens:${row.key}:delta"]`);
      // The sign character carries the same information as the colour: a loss reads "−$6,454"
      // and a worsening delta "−$20,800" in greyscale, in print, and to a screen reader.
      setTone(netCell, row.tone === 'pos' ? 'pos' : row.tone === 'neg' ? 'neg' : '');
      setTone(deltaCell, toneOfSigned(row.delta));
    }
  }

  // ------------------------------------------------------------- render

  const announce = debounce((text) => { if (liveEl) liveEl.textContent = text; }, LIVE_MS);
  const writeHash = debounce((raw) => {
    try { history.replaceState(null, '', '#' + encodeState(raw)); } catch { /* history is optional */ }
  }, HASH_MS);

  let first = true;

  /**
   * The whole pipeline. `pushHash` is false for the renders the page performs on its own behalf
   * (first paint, a hashchange, a reset) so the URL is only rewritten when the reader types.
   */
  function render({ pushHash = true } = {}) {
    const raw = readRaw();
    const inputs = sanitize(raw);
    const r = compute(inputs);
    const f = formatResults(inputs, r);

    // Flatten the sensitivity rows into the same data-out namespace as everything else.
    const flat = Object.create(null);
    for (const key of Object.keys(f)) if (key !== 'sensitivity') flat[key] = f[key];
    for (const row of f.sensitivity) {
      flat[`sens:${row.key}:net`] = row.net;
      flat[`sens:${row.key}:delta`] = row.delta;
    }

    syncSensRows(f.sensitivity);

    const animate = !first;
    for (const el of document.querySelectorAll('[data-out]')) {
      const key = el.dataset.out;
      const text = flat[key];
      if (typeof text !== 'string') continue;          // nothing else may ever reach the DOM
      writeValue(el, key, text, r, f.currency, animate && el.hasAttribute('data-animate'));
      const titleKey = el.dataset.outTitle;
      if (titleKey && typeof flat[titleKey] === 'string') el.title = flat[titleKey];
    }

    setTone(heroEl, f.netTone === 'pos' ? 'pos' : f.netTone === 'neg' ? 'neg' : '');
    announce(f.verdict);

    if (pushHash) writeHash(raw);
    first = false;
  }

  // ------------------------------------------------------------- events

  function applyPreset() {
    const preset = PRESETS.find((p) => p.key === (els.preset ? els.preset.value : ''));
    if (!preset || preset.priceIn === null || preset.priceIn === undefined) return;
    if (els.priceIn) els.priceIn.value = String(preset.priceIn);
    if (els.priceOut) els.priceOut.value = String(preset.priceOut);
  }

  function onFormEvent(event) {
    const id = event.target && event.target.id;
    if (id === 'preset') applyPreset();
    // Typing a price is what "custom" means; the preset select follows the prices, not the reverse.
    else if ((id === 'priceIn' || id === 'priceOut') && els.preset) els.preset.value = 'custom';
    render();
  }

  form.addEventListener('input', onFormEvent);
  form.addEventListener('change', onFormEvent);
  form.addEventListener('submit', (e) => e.preventDefault());   // novalidate form, nowhere to post

  window.addEventListener('hashchange', () => {
    applyState({ ...EXAMPLE, ...decodeState(location.hash) });
    render({ pushHash: false });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      applyState(EXAMPLE);
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
      if (copyOut) copyOut.hidden = true;
      render({ pushHash: false });
      setStatus('Reset to the example scenario.');
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const raw = readRaw();
      const inputs = sanitize(raw);
      const text = summaryText(inputs, compute(inputs), location.href);

      if (await copyToClipboard(text)) {
        if (copyOut) copyOut.hidden = true;
        setStatus('Copied the summary to the clipboard.');
        return;
      }
      if (copyOut && copyOutText) {
        copyOutText.value = text;
        copyOut.hidden = false;
        copyOutText.focus();
        copyOutText.select();
      }
      setStatus('Copy failed — select the summary below and copy it.');
    });
  }

  // ------------------------------------------------------------- start

  applyState({ ...EXAMPLE, ...decodeState(location.hash) });
  render({ pushHash: false });

  if (fallback) fallback.hidden = true;
  document.documentElement.dataset.calcReady = '1';
  return true;
}

/**
 * Clipboard with a fallback: the async API first, then a hidden textarea and execCommand for
 * browsers (and headless sessions) that refuse it. Returns false rather than throwing, so the
 * caller can offer the text for manual selection instead.
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the textarea */ }

  let ta = null;
  try {
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }
}

// A failure here must leave the page exactly as it renders without JavaScript: the example
// scenario in the panel, the formulas below it, and the notice explaining what happened.
try {
  if (!init()) throw new Error('calculator: the form or the results panel is missing');
} catch (error) {
  const fallback = document.getElementById('calc-fallback');
  if (fallback) fallback.hidden = false;
  throw error;
}
