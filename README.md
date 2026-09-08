# Netesis.com

## What this is

The public website for Netesis, a boutique IT consulting firm that does unit economics for AI workloads, including the interactive Token ROI model at `calculator.html`. It is a hand-written static site – plain HTML, one stylesheet, vanilla JavaScript modules, no build step, no dependencies – deployed to GitHub Pages at https://netesis.com.

## Preview locally

From the repository root:

```sh
python -m http.server 8000
```

Then open http://localhost:8000 (any static file server will do; this one ships with Python 3).

Opening the `.html` files straight from disk renders every page's HTML and CSS correctly, but Chrome, Edge and Safari refuse to load ES modules from `file://`, so the two JavaScript features – the theme toggle and the calculator – only run over HTTP. In that case the toggle button stays hidden and the calculator page (like the test page) shows a notice explaining what happened and how to serve the folder; a theme you chose earlier still applies, because that boot script is a classic inline script.

## Repository map

There are no includes and nothing is generated: the header and footer are repeated by hand in every page, so a shell change means editing all seven.

| File | Purpose |
|---|---|
| `index.html` | Home: hero with the example ledger, the problem, the four-step method, services summary, calculator teaser, CTA. Carries the `Organization` + `WebSite` JSON-LD. |
| `method.html` | How an engagement works – instrument, attribute, baseline, verdict – with the spend → attribution → baseline → verdict diagram as inline SVG. |
| `services.html` | The engagements, each with scope, indicative duration, and the artifact the client receives. |
| `calculator.html` | The Token ROI model: form, live results, sensitivity table, "How this is calculated", and the module-failed notice. |
| `about.html` | Who Netesis is, how it works with clients, what it refuses to do. |
| `contact.html` | Contact routes and the short qualifying form (a `mailto:` form until a real endpoint exists). |
| `404.html` | Not-found page. GitHub Pages serves it for any missing path; it carries `noindex`. |
| `assets/css/styles.css` | The only stylesheet: design tokens at the top (light palette, then two dark blocks), then every component in numbered sections. |
| `assets/js/site.js` | Module: adds the `js` class, runs the theme toggle (preference persisted in `localStorage["netesis-theme"]`), and the reveal-on-scroll. Wrapped in try/catch so it can never break a page. |
| `assets/js/calculator.js` | Module: the model as pure exported functions. No DOM access, no side effects; runs unchanged in Node. |
| `assets/js/calculator-ui.js` | Module: DOM wiring for `calculator.html` – reads the form, calls `calculator.js`, writes the results panel, keeps the URL hash in sync. The only file that touches the calculator's markup. |
| `assets/js/calculator.test.html` | Dependency-free test page. Imports `./calculator.js` and prints a PASS/FAIL line per assertion. Not linked from the site, not in the sitemap. |
| `CNAME` | `netesis.com` – the custom domain for GitHub Pages. |
| `.nojekyll` | Empty. Tells Pages not to run Jekyll, so nothing gets filtered or rewritten. |
| `robots.txt` | Allows all crawlers and points at the sitemap. |
| `sitemap.xml` | The six indexable pages (not `404.html`, not the test page). Update `lastmod` when a page changes. |
| `README.md` | This file. |
| `.github/workflows/pages.yml` | Deploys the repository root to GitHub Pages on every push to `main`, or by hand from the Actions tab. No build step. |
| `.gitignore` | Keeps `FABLE-PROMPT.md` (local build notes) and OS/editor noise out of the repository. |

## The calculator

### Where the math lives

Everything numerical is in `assets/js/calculator.js`, an ES module of pure functions with no DOM access:

- `sanitize(raw)` – coerces and clamps the raw form values (non-numbers → 0, negatives → 0, acceptance to 0–100, amortization to a whole number ≥ 1, currency to one of the five supported codes).
- `compute(inputs)` – the full results object: token cost, labour cost, per-task and per-accepted-output cost, human baseline, gross and net savings, payback, breakeven acceptance rate, breakeven token price.
- `sensitivity(inputs)` – net savings under the `SCENARIOS` (volume ×0.5 and ×2, acceptance −15 points, token price ×2, review time ×2).
- `verdict(inputs, results)` – the one-sentence plain-English verdict.
- `formatResults(inputs, results)` and `summaryText(inputs, results, url)` – every display string, already formatted with `Intl.NumberFormat`; nothing can reach the page as `NaN`, `Infinity` or `undefined`.
- `encodeState(inputs)` / `decodeState(hash)` – the URL-hash state (see below).
- `fmt` – the number formatters, and the constants `EXAMPLE`, `PRESETS`, `CURRENCIES`, `SCENARIOS`, `VERSION`.

`assets/js/calculator-ui.js` is the only DOM code: it wires form inputs → `sanitize` → `compute` → `formatResults` → the results panel on every `input` event. Change formulas in `calculator.js`, never in the UI file, and the test page will tell you what you broke.

### Running the tests

Serve the folder (see above) and open http://localhost:8000/assets/js/calculator.test.html. The page prints one line per assertion and ends with a `PASS n/n` summary line (`PASS 334/334` as the suite stands today) – the same figure appears in the tab title and as a `TESTS: …` line in the browser console. A failure reads `FAIL k of n` and lists which assertions failed and why. The test page shows the same module-failed notice as the calculator when opened from `file://`, so it must be served too.

The assertions cover the hand-checked example scenario (every intermediate value to 1e-6 relative), the edge cases (zero volume, 0% and 100% acceptance, a workflow that never pays back, a positive-cash-flow loss, zero hourly cost, review slower than rework, zero build cost), every formatter against `NaN`/`Infinity`/`undefined`/`null`, the hash round-trip, and a brute-force sweep of over a thousand input sets asserting that no output string ever contains `NaN`, `Infinity`, `undefined`, `null` or `[object`.

### From Node

The module runs in Node (18 or newer) without changes. From the repository root:

```sh
node --input-type=module -e "import('./assets/js/calculator.js').then(m => console.log(m.compute(m.EXAMPLE)))"
```

or, for just the verdict:

```sh
node --input-type=module -e "import('./assets/js/calculator.js').then(m => console.log(m.verdict(m.EXAMPLE, m.compute(m.EXAMPLE))))"
```

which prints:

```
At 12,000 tasks/month and an 80% acceptance rate, Invoice triage saves $14,346/month net and pays back the build in 2.3 months. It stops paying for itself below a 64% acceptance rate.
```

From any other directory, use a `file://` URL instead of the relative path, e.g. `import('file:///D:/Projects/Netesis.com/assets/js/calculator.js')`.

### Sharing a filled-in model

The calculator keeps its inputs in the URL fragment. As you type, `calculator-ui.js` writes `#v=1&name=…&tasks=…&priceIn=…` (every input key, values as typed, the name URL-encoded) with `history.replaceState`, debounced by 150 ms, so the address bar always holds the current model and the page never reloads. Copy the address – or use "Copy summary", which includes it – and whoever opens it sees the same inputs: on load the page merges `decodeState(location.hash)` over the example scenario. Unknown keys, non-numeric values, and unknown presets or currencies are dropped, and `sanitize` clamps the rest, so a hand-edited or truncated link degrades to the example rather than breaking. "Reset to example" clears the hash.

Nothing is sent anywhere: browsers never transmit the fragment in an HTTP request, and the page makes no network calls.

## Changing the price presets

The presets are the `PRESETS` array near the top of `assets/js/calculator.js`:

```js
export const PRESETS = Object.freeze([
  Object.freeze({ key: 'frontier', label: 'Frontier', priceIn: 5, priceOut: 25 }),
  Object.freeze({ key: 'mid', label: 'Mid-tier', priceIn: 1, priceOut: 5 }),
  Object.freeze({ key: 'small', label: 'Small / batch', priceIn: 0.10, priceOut: 0.50 }),
  Object.freeze({ key: 'custom', label: 'Custom', priceIn: null, priceOut: null }),
]);
```

Prices are per million tokens in whatever currency is selected (the currency select is display only; there is no conversion). Edit the numbers or labels, or add an entry with a new `key`; keep the `custom` entry with `null` prices, because that is what the select switches to when either price field is edited by hand.

The presets are illustrative starting points, not any vendor's list price, and the calculator page says so in a callout next to the selector. If you change a preset to track a real contract, keep that wording honest.

Two things depend on the example scenario, not the presets: `EXAMPLE` in the same file carries its own `priceIn: 5, priceOut: 25` (with `preset: 'frontier'`), and the hand-checked expected values in `calculator.test.html` assert the example's results. The site copy also quotes the example's figures – $621 token cost, $14,346 net, 2.3 months payback, 64% breakeven acceptance – in the home page ledger and on the method page. Changing the frontier preset alone is safe; changing `EXAMPLE` means updating the expected values in the test page and the hand-written figures (grep the tree for `14,346`).

## Changing colours and type

All colours, fonts, sizes, spacing and motion are custom properties at the top of `assets/css/styles.css` (section 1, Tokens). Components only ever reference tokens, so a palette change is a token change.

- The light palette is on `:root`. Every colour is a `--c-*` token: ground (`--c-bg`, `--c-surface`, `--c-surface-2`, `--c-border`, `--c-hairline`), ink (`--c-text`, `--c-text-2`, `--c-text-3`), the one accent (`--c-accent` and its `-hover`, `-ink`, `-soft`, `-soft-ink` companions), the money semantics (`--c-pos`, `--c-neg`, `--c-warn`, each with a `-soft` tint), plus `--c-focus` and `--c-selection`.
- The dark palette is defined twice, immediately below, and the two blocks must stay identical: once under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` for the operating-system preference, and once as `:root[data-theme="dark"] { … }` for the explicit toggle. Only tokens are redefined there; nothing else in the file mentions a theme.
- Type: `--font-sans` (Inter) and `--font-mono` (JetBrains Mono) with full system fallback stacks, the `--t-*` size scale, `--lh-*` line heights. Numbers are set in the mono face via `.num`; that is the design's motif, so change the mono font with care. The Google Fonts `<link>` lives in every page's `<head>`; change it in all seven pages together with the two font tokens.

Every text/background pair in both palettes was checked against WCAG AA (4.5:1 for body text, 3:1 for large text, focus rings and meaningful borders). If you change a token, re-check contrast – a few lines of Node computing relative luminance is enough – and fix the token value, not the component that uses it. `--c-text-3` is the lightest colour allowed for body-size text.

Three values are duplicated outside the stylesheet because CSS variables cannot reach them: the two `<meta name="theme-color">` tags in every page head carry `--c-bg` for light (`#f8f7f4`) and dark (`#0f0f11`), and the favicon data URI in every page head hard-codes the light accent `#1f4fd6`. Update those if you change `--c-bg` or `--c-accent`.

## Deployment to GitHub Pages

The site is committed on `main`. Once, in order:

1. Create an empty repository on GitHub (no README, licence or `.gitignore` – the repository already has what it needs). Note its owner and name; they appear below as `<github-username>` and `<repo>`.
2. Add the remote and push `main`:

   ```sh
   git remote add origin git@github.com:<github-username>/<repo>.git
   git push -u origin main
   ```

3. In the repository on GitHub: Settings → Pages → Build and deployment → Source: **GitHub Actions**. Do not pick a starter workflow; `.github/workflows/pages.yml` is already in the repository and needs no changes.
4. The workflow runs on every push to `main`, and can be started by hand from Actions → "Deploy to GitHub Pages" → Run workflow. If the push in step 2 landed before Pages was switched on, that first run fails at the "Configure Pages" step – re-run it. When the run is green the site is live at `https://<github-username>.github.io/<repo>/` (every link in the site is relative, so it works from that subpath as well as from the apex domain).
5. Settings → Pages → Custom domain: enter `netesis.com` → Save. GitHub starts a DNS check, which passes once the registrar records in the next section resolve; use "Check again" after changing DNS. The `CNAME` file in the repository mirrors this setting – keep the two the same.
6. When the DNS check has passed, tick **Enforce HTTPS**. The checkbox stays disabled until GitHub has issued the certificate, which follows the DNS check and can lag behind it; come back later if it is greyed out.
7. Optional, recommended: verify the domain for your account or organisation (profile Settings → Pages → Add a domain, then the `TXT` record it gives you) so nobody else can claim `netesis.com` on Pages.

## DNS at the registrar

Add these records at the registrar that hosts the `netesis.com` zone. `@` means the apex (some registrars call it "root", others want it left blank).

| Type | Host | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `<github-username>.github.io` |

- Remove any existing `A`, `ALIAS` or `ANAME` record on the apex first (registrar parking pages usually add one), and any `AAAA` that is not in the list. Never put a `CNAME` on the apex.
- The `www` target is your GitHub user or organisation name followed by `.github.io` – not the repository name. With the apex set as the custom domain and this record in place, GitHub redirects `www.netesis.com` to `netesis.com`.
- Verify from any machine with `dig`:

  ```sh
  dig netesis.com +noall +answer          # expect the four A records
  dig netesis.com AAAA +noall +answer     # expect the four AAAA records
  dig www.netesis.com +noall +answer      # expect a CNAME to <github-username>.github.io
  ```

  On Windows without `dig`, `nslookup -type=A netesis.com`, `nslookup -type=AAAA netesis.com` and `nslookup -type=CNAME www.netesis.com` show the same.
- Propagation can take up to 24 hours, though it is usually minutes. GitHub's DNS check in the Pages settings passes once the new records are visible to it; certificate issuance for HTTPS follows the DNS check, after which Enforce HTTPS can be ticked (step 6 above).

## Content still to supply

Everything the site could not truthfully say yet is marked with an HTML comment naming exactly what is needed, and the visible placeholders carry a "placeholder" pill. List them with:

```sh
grep -rn "TODO(content)" --include=*.html .
```

What they are:

- **Social image** – an `og:image` / `twitter:image` (1200×630 PNG) for link previews; every page head.
- **Team bios** – names, roles, photos, LinkedIn links for the placeholder team card on `about.html`.
- **Phone, office, social links** – the placeholder rows on `contact.html`, and `sameAs` profiles in the JSON-LD on `index.html`.
- **Client references** – the "Looking for a reference?" callout on `about.html`; references must be supplied and approved before anything is named.
- **Pricing decision** – whether to publish indicative ranges on `services.html`; today it says fixed prices are quoted after a scoping call, with no numbers.
- **Form endpoint** – the contact form posts to `mailto:hello@netesis.com`; replace the `action` with a real endpoint (a Formspree/Basin URL or your own) and delete the note saying the form opens the visitor's mail client.
- **Legal entity line** – registered company name and jurisdiction in the footer of every page, if required where Netesis is registered.

Remove each comment as its content lands; the grep should eventually return nothing.

## No analytics

The site has no analytics, no trackers, no third-party scripts, no cookies and no cookie banner – there is nothing to consent to. The only third-party requests are the Google Fonts stylesheet and font files. The theme preference is a single `localStorage` key, and the calculator's state lives in the URL fragment, which browsers never send to a server. If analytics are ever added, that statement, and the "nothing leaves this page" line on the calculator, have to change with it.
