/**
 * Progressive enhancement for scroll reveals and cursor spotlights.
 * Everything degrades to a fully visible, static page without JS.
 */

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

function initReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (targets.length === 0) return;

  if (REDUCED.matches || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
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

  // Anything already on screen at load is not a "reveal" — it is just the page.
  // Observing it means every navigation replays the whole above-the-fold
  // animation, which reads as the layout assembling itself.
  const viewport = window.innerHeight || document.documentElement.clientHeight;
  targets.forEach((el) => {
    const box = el.getBoundingClientRect();
    if (box.top < viewport && box.bottom > 0) {
      el.style.setProperty("--reveal-delay", "0ms");
      el.classList.add("reveal-instant", "is-visible");
      return;
    }
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
