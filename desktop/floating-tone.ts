export type FloatingTone = "light" | "dark";

// Near the black/white contrast crossover (linear relative luminance).
const LIGHT_THRESHOLD = 0.18;
const NEUTRAL_CHANNEL = 128;

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** The image tone: light means dark foreground controls, dark means light controls. */
export function classifyFloatingPixels(pixels: ArrayLike<number>): FloatingTone {
  const count = Math.floor(pixels.length / 4);
  if (!count) return "dark";
  let luminance = 0;
  for (let index = 0; index < count * 4; index += 4) {
    const alpha = pixels[index + 3] / 255;
    const red = linearChannel(pixels[index] * alpha + NEUTRAL_CHANNEL * (1 - alpha));
    const green = linearChannel(pixels[index + 1] * alpha + NEUTRAL_CHANNEL * (1 - alpha));
    const blue = linearChannel(pixels[index + 2] * alpha + NEUTRAL_CHANNEL * (1 - alpha));
    luminance += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }
  return luminance / count >= LIGHT_THRESHOLD ? "light" : "dark";
}

const tones = new Map<string, FloatingTone>();
const pending = new Map<string, Promise<FloatingTone>>();
const CACHE_LIMIT = 64;

export function getCachedFloatingTone(src?: string): FloatingTone | undefined {
  return src ? tones.get(src) : undefined;
}

/** Decode once per source and read only a tiny, aspect-preserving canvas. */
export function loadFloatingTone(src?: string): Promise<FloatingTone> {
  if (!src) return Promise.resolve("dark");
  const cached = tones.get(src);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(src);
  if (existing) return existing;

  const result = new Promise<FloatingTone>((resolve) => {
    try {
      const image = new Image();
      const finish = (tone: FloatingTone) => {
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        resolve(tone);
      };
      image.onload = () => {
        try {
          if (!image.naturalWidth || !image.naturalHeight) return finish("dark");
          const scale = Math.min(1, 32 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return finish("dark");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          finish(classifyFloatingPixels(context.getImageData(0, 0, canvas.width, canvas.height).data));
        } catch {
          finish("dark");
        }
      };
      image.onerror = () => finish("dark");
      const timeout = setTimeout(() => finish("dark"), 15000);
      image.src = src;
    } catch {
      resolve("dark");
    }
  }).then((tone) => {
    pending.delete(src);
    if (tones.size >= CACHE_LIMIT) tones.delete(tones.keys().next().value!);
    tones.set(src, tone);
    return tone;
  });
  pending.set(src, result);
  return result;
}
