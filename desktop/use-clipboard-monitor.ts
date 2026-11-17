import { useCallback, useEffect, useState } from "react";
import type { PicLiteBridge } from "./clop-types";

export function useClipboardMonitor(api: PicLiteBridge) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let disposed = false, changed = false;
    const stop = api.onClipboardMonitorPaused(value => { changed = true; setPaused(value); });
    void api.getClipboardMonitorPaused().then(value => {
      if (!disposed && !changed) setPaused(value);
    }).catch(() => undefined);
    return () => { disposed = true; stop(); };
  }, [api]);
  const update = useCallback(async (value: boolean) => {
    setPaused(await api.setClipboardMonitorPaused(value));
  }, [api]);
  return { paused, update };
}
