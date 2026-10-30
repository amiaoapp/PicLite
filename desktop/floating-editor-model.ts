import type { ImageFormat, OptimisationPreset } from "./clop-types";

export function cropFromDrag(a: {x: number; y: number}, b: {x: number; y: number}, width: number, height: number) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const x = Math.min(width - 1, Math.round(Math.min(clamp(a.x), clamp(b.x)) * width));
  const y = Math.min(height - 1, Math.round(Math.min(clamp(a.y), clamp(b.y)) * height));
  return { x, y, width: Math.max(1, Math.round(Math.max(clamp(a.x), clamp(b.x)) * width) - x), height: Math.max(1, Math.round(Math.max(clamp(a.y), clamp(b.y)) * height) - y) };
}

export function editorCompressionSettings(quality: number, format: ImageFormat): Partial<OptimisationPreset> {
  return { mode: "manual", quality: Math.max(1, Math.min(100, Math.round(quality))), format, scale: 100, preventLarger: false };
}
