/**
 * Progressive enhancement for scroll reveals and cursor spotlights.
 * Everything degrades to a fully visible, static page without JS.
 */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

function initReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (targets.length === 0) return;

  // Nothing is hidden until we hide it, so with reduced motion or no observer
  // there is simply nothing to do — the page is already complete.
  if (REDUCED.matches || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("reveal-pending");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
  );

  // Stagger siblings that share a [data-reveal-group] parent.
  document.querySelectorAll<HTMLElement>("[data-reveal-group]").forEach((group) => {
    const step = Number(group.dataset.revealGroup) || 70;
    group.querySelectorAll<HTMLElement>("[data-reveal]").forEach((child, i) => {
      child.style.setProperty("--reveal-delay", `${i * step}ms`);
    });
  });

  // Hide only what is below the fold. Anything already on screen stays exactly
  // as the browser first painted it, so a first visit never shows a gap.
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  targets.forEach((el) => {
    const box = el.getBoundingClientRect();
    if (box.top < viewport && box.bottom > 0) return;
    el.classList.add("reveal-pending");
    observer.observe(el);
  });
}

function initSpotlight(): void {
  if (REDUCED.matches) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  document.querySelectorAll<HTMLElement>(".spotlight").forEach((card) => {
    let rect: DOMRect | null = null;
    let x = 50;
    let y = 50;
    let queued = false;

    const flush = () => {
      queued = false;
      card.style.setProperty("--mx", `${x}%`);
      card.style.setProperty("--my", `${y}%`);
    };

    // Cache the rect on enter so pointermove never forces layout, and
    // coalesce writes to one per frame rather than one per event.
    card.addEventListener(
      "pointerenter",
      () => {
        rect = card.getBoundingClientRect();
      },
      { passive: true },
    );

    card.addEventListener(
      "pointermove",
      (event) => {
        if (!rect) rect = card.getBoundingClientRect();
        x = ((event.clientX - rect.left) / rect.width) * 100;
        y = ((event.clientY - rect.top) / rect.height) * 100;
        if (queued) return;
        queued = true;
        requestAnimationFrame(flush);
      },
      { passive: true },
    );

    card.addEventListener(
      "pointerleave",
      () => {
        rect = null;
      },
      { passive: true },
    );
  });
}

function initCountUp(): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-count-to]");
  if (targets.length === 0) return;

  if (REDUCED.matches || !("IntersectionObserver" in window)) {
    targets.forEach((el) => {
      el.textContent = el.dataset.countTo ?? el.textContent;
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        animateCount(el);
      }
    },
    { threshold: 0.6 },
  );

  targets.forEach((el) => observer.observe(el));
}

function animateCount(el: HTMLElement): void {
  const raw = el.dataset.countTo ?? "";
  const target = Number.parseFloat(raw.replace(",", "."));
  if (Number.isNaN(target)) return;

  const decimals = raw.includes(",") ? raw.split(",")[1].length : 0;
  const duration = 1400;
  const start = performance.now();

  const tick = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    // easeOutExpo
    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    el.textContent = (target * eased).toFixed(decimals).replace(".", ",");
    if (t < 1) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

function init(): void {
  initReveal();
  initSpotlight();
  initCountUp();
}

/*
 * Timing matters here more than anywhere else on the page.
 *
 * initReveal hides whatever is below the fold. On a client-side navigation
 * astro:page-load fires after the new page has already painted, so the content
 * appeared and was then hidden a frame later — a visible blink before it
 * revealed again.
 *
 * astro:after-swap fires immediately after the DOM swap and before that paint,
 * so the marking lands while the new page is still being composed. It does not
 * fire on the very first load, which is what astro:page-load covers; the flag
 * keeps a navigation from initialising twice.
 */
let handledBySwap = false;

document.addEventListener("astro:after-swap", () => {
  handledBySwap = true;
  init();
});

document.addEventListener("astro:page-load", () => {
  if (handledBySwap) {
    handledBySwap = false;
    return;
  }
  init();
});
