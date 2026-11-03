import { useEffect, type RefObject } from "react";
import type { PicLiteBridge } from "./clop-types";

// Native pointer samples are authoritative even when the WebView's :hover is
// stale. Browser previews keep normal CSS hover because they have no sampler.
export function useFloatingPointer(
  rootRef: RefObject<HTMLElement | null>,
  api: PicLiteBridge,
  enabled: boolean,
  setPointerInside: (inside: boolean) => void,
) {
  useEffect(() => {
    const root = rootRef.current;
    const read = api.getFloatingPointerPosition;
    if (!enabled || !root || !read) return;
    let disposed = false;
    let reading = false;
    const set = (node: HTMLElement, key: string, value: boolean) => {
      const text = String(value);
      if (node.dataset[key] !== text) node.dataset[key] = text;
    };
    const refresh = async () => {
      if (reading || disposed) return;
      reading = true;
      try {
        const point = await read();
        if (disposed) return;
        const hit = point && point.x >= 0 && point.y >= 0 && point.x < innerWidth && point.y < innerHeight
          ? document.elementFromPoint(point.x, point.y) : null;
        const inside = !!hit && root.contains(hit);
        set(root, "pointerTracked", true);
        set(root, "pointerInside", inside);
        set(root, "windowFocused", !!point?.focused);
        const activeCard = inside ? hit?.closest(".result-card") : null;
        for (const card of root.querySelectorAll<HTMLElement>(".result-card")) {
          set(card, "pointerTracked", true);
          set(card, "pointerInside", card === activeCard);
          set(card, "windowFocused", !!point?.focused);
        }
        setPointerInside(inside);
      } catch {
        // A window can disappear during shutdown. The next sample retries.
      } finally { reading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 100);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", refresh);
    root.addEventListener("pointerenter", refresh);
    root.addEventListener("pointerleave", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("blur", refresh);
      root.removeEventListener("pointerenter", refresh);
      root.removeEventListener("pointerleave", refresh);
      document.removeEventListener("visibilitychange", refresh);
      for (const node of [root, ...root.querySelectorAll<HTMLElement>(".result-card")]) {
        delete node.dataset.pointerTracked;
        delete node.dataset.pointerInside;
        delete node.dataset.windowFocused;
      }
    };
  }, [api, enabled, rootRef, setPointerInside]);
}
