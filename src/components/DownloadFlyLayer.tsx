import { useEffect } from "react";
import { useDownloadStore } from "@/stores/downloads";

const FLY_MS = 560;

/**
 * Imperative fly-to-tray animation (DOM + Web Animations API).
 * Avoids React state races that skipped the CSS-transition version.
 */
export function DownloadFlyLayer() {
  const flyBurst = useDownloadStore((s) => s.flyBurst);
  const clearFlyBurst = useDownloadStore((s) => s.clearFlyBurst);

  useEffect(() => {
    if (!flyBurst) return;

    const burstId = flyBurst.id;
    const x = flyBurst.x;
    const y = flyBurst.y;

    const target = document.getElementById("app-downloads-btn");
    const to = target?.getBoundingClientRect();
    const tx = to ? to.left + to.width / 2 : Math.min(window.innerWidth - 48, x + 120);
    const ty = to ? to.top + to.height / 2 : 56;

    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      "z-index:9999",
      "pointer-events:none",
      "width:32px",
      "height:32px",
      "display:grid",
      "place-items:center",
      "border-radius:999px",
      "background:var(--color-accent)",
      "color:var(--color-accent-ink)",
      "box-shadow:0 0 20px rgba(94,240,176,0.5)",
      "will-change:transform,opacity",
    ].join(";");
    el.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
    document.body.appendChild(el);

    const anim = el.animate(
      [
        {
          transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(1)`,
          opacity: 1,
        },
        {
          transform: `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(0.35)`,
          opacity: 0.2,
          offset: 1,
        },
      ],
      {
        duration: FLY_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      },
    );

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      el.remove();
      if (useDownloadStore.getState().flyBurst?.id === burstId) {
        clearFlyBurst();
      }
      if (target) {
        target.classList.add("download-tray-pop");
        window.setTimeout(() => target.classList.remove("download-tray-pop"), 400);
      }
    };

    anim.addEventListener("finish", finish);
    anim.addEventListener("cancel", () => {
      el.remove();
    });

    // Safety if WAAPI is unavailable / stalled
    const fallback = window.setTimeout(finish, FLY_MS + 80);

    return () => {
      window.clearTimeout(fallback);
      try {
        anim.cancel();
      } catch {
        /* ignore */
      }
      el.remove();
    };
  }, [flyBurst?.id, flyBurst?.x, flyBurst?.y, clearFlyBurst]);

  return null;
}
