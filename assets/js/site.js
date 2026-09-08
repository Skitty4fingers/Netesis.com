/* site.js — theme toggle, reveal-on-scroll, small enhancements.
   ES module. Every step is wrapped so a failure never breaks the page.
   No globals except document.documentElement.dataset.siteReady. */

const root = document.documentElement;
const STORAGE_KEY = 'netesis-theme';

/* 1. Mark JS as available immediately (unlocks the .reveal styles). */
try { root.classList.add('js'); } catch (e) { /* ignore */ }

/* 2. Theme ------------------------------------------------------------- */
try {
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const toggle = document.querySelector('[data-theme-toggle]');

  const stored = () => {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) { return null; }
  };
  const current = () => stored() || (mq && mq.matches ? 'dark' : 'light');

  const label = (theme) => {
    if (!toggle) return;
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  };

  const apply = (theme, persist) => {
    root.setAttribute('data-theme', theme);
    if (persist) { try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* private mode etc. */ } }
    label(theme);
  };

  // Reflect the effective theme in the button, then reveal it.
  label(current());
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      try { apply(current() === 'dark' ? 'light' : 'dark', true); } catch (e) { /* ignore */ }
    });
  }

  // Follow the OS while the user has not chosen explicitly.
  if (mq) {
    const onChange = () => {
      if (stored()) return;
      const t = mq.matches ? 'dark' : 'light';
      root.removeAttribute('data-theme'); // let the media query rule drive the tokens
      label(t);
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  }
} catch (e) { /* theme is cosmetic; never break the page */ }

/* 3. Reveal on scroll ---------------------------------------------------
   Everything is visible from the first frame. The first genuine scroll arms
   the effect for sections still well below the fold; those then reveal at a
   12% intersection. Nothing that is on screen is ever hidden, and contexts
   that never scroll (print, full-page captures, reader modes) see the whole
   page. Reduced motion or no IntersectionObserver: plain visible. */
try {
  const items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const showAll = () => items.forEach((el) => el.classList.add('is-visible'));

  showAll();

  if (items.length && !reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    const arm = () => {
      try {
        const limit = window.innerHeight + 120; // only sections clearly off-screen
        items.forEach((el) => {
          if (el.getBoundingClientRect().top > limit) {
            el.classList.remove('is-visible');
            io.observe(el);
          }
        });
      } catch (e) { showAll(); }
    };
    window.addEventListener('scroll', arm, { passive: true, once: true });
  }
} catch (e) {
  try { document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible')); } catch (e2) { /* ignore */ }
}

/* 4. Small enhancements ------------------------------------------------- */
try {
  // Mark the current page in the header nav if the author forgot to.
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav a').forEach((a) => {
    const target = (a.getAttribute('href') || '').split('/').pop();
    if (target === here && !a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  });
} catch (e) { /* ignore */ }

try { root.dataset.siteReady = '1'; } catch (e) { /* ignore */ }
