export const DEFAULT_FLOATING_RADIUS = 24;
export function floatingRadius(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FLOATING_RADIUS;
  return Math.max(0, Math.min(28, Math.round(value)));
}

/** One SVG alpha boundary, rasterised at the WebView's actual device scale.
 * A sized viewBox keeps the radius circular during resizing (including HiDPI).
 * Avoid binary Win32 window regions and nested CSS clips at the outer edge.
 */
export function floatingAlphaMask(width: number, height: number, radius: unknown): string {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return "none";
  const r = Math.min(floatingRadius(radius), width / 2, height / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" rx="${r}" fill="white"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
