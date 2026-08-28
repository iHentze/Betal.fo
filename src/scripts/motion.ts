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

  targets.forEach((el) => observer.observe(el));
}

function initSpotlight(): void {
  if (REDUCED.matches || !window.matchMedia("(hover: hover)").matches) return;

  document.querySelectorAll<HTMLElement>(".spotlight").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
      card.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
    });
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
