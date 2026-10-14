type FloatingSize = { floatingWidth: number; floatingHeight: number };

export class FloatingIconDrag {
  readonly startX: number;
  readonly startY: number;
  private lastX: number;
  private lastY: number;
  dragged = false;

  constructor(x: number, y: number) {
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
  }

  move(x: number, y: number): { x: number; y: number } | null {
    if (!this.dragged && Math.hypot(x - this.startX, y - this.startY) < 5) return null;
    this.dragged = true;
    const delta = { x: x - this.lastX, y: y - this.lastY };
    this.lastX = x;
    this.lastY = y;
    return delta.x || delta.y ? delta : null;
  }
}

export function rememberFloatingSize<T extends FloatingSize>(current: T, size: { width: number; height: number }, collapsedOrTransitioning: boolean): T {
  // Native folding briefly emits tiny or transitional sizes. They must never
  // replace the user's expanded dimensions in the saved settings.
  if (collapsedOrTransitioning || size.width < 246 || size.height < 188) return current;
  const width = Math.max(280, size.width);
  const height = Math.max(220, size.height);
  return current.floatingWidth === width && current.floatingHeight === height
    ? current : { ...current, floatingWidth: width, floatingHeight: height };
}
