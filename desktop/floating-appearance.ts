export const DEFAULT_FLOATING_RADIUS = 10;
export function floatingRadius(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_FLOATING_RADIUS;
  return Math.max(0, Math.min(28, Math.round(value)));
}
