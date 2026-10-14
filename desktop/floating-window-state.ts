type FloatingSize = { floatingWidth: number; floatingHeight: number };

export function rememberFloatingSize<T extends FloatingSize>(current: T, size: { width: number; height: number }, collapsedOrTransitioning: boolean): T {
  // Native folding briefly emits tiny or transitional sizes. They must never
  // replace the user's expanded dimensions in the saved settings.
  if (collapsedOrTransitioning || size.width < 246 || size.height < 188) return current;
  const width = Math.max(280, size.width);
  const height = Math.max(220, size.height);
  return current.floatingWidth === width && current.floatingHeight === height
    ? current : { ...current, floatingWidth: width, floatingHeight: height };
}
