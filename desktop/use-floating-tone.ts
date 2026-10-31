"use client";

import { useEffect, useState } from "react";
import { getCachedFloatingTone, loadFloatingTone, type FloatingTone } from "./floating-tone.ts";

export type { FloatingTone } from "./floating-tone.ts";

/** Image tone, not foreground tone: light images should use dark controls. */
export function useFloatingTone(src?: string): FloatingTone {
  const [sample, setSample] = useState<{ src?: string; tone: FloatingTone }>(() => ({
    src,
    tone: getCachedFloatingTone(src) ?? "dark",
  }));

  useEffect(() => {
    if (!src || getCachedFloatingTone(src)) return;
    let active = true;
    void loadFloatingTone(src).then((tone) => {
      if (active) setSample({ src, tone });
    });
    return () => { active = false; };
  }, [src]);

  // A source change must not briefly paint the previous image's foreground.
  return getCachedFloatingTone(src) ?? (src && sample.src === src ? sample.tone : "dark");
}

export default useFloatingTone;
