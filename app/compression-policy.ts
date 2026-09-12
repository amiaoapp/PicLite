export type SmartCompressionMode = "balanced" | "small";

/**
 * In smart modes, "keep" means prefer the source container while also measuring
 * WebP. Explicit JPEG/PNG/WebP choices remain hard output constraints.
 */
export function smartCandidateOutputFormats<T extends string>(requestedFormat: T): T[] {
  return requestedFormat === "keep"
    ? [requestedFormat, "image/webp" as T]
    : [requestedFormat];
}

export function isRequestedMimeType(actualType: string, requestedType: string) {
  const normalize = (value: string) => value.toLowerCase() === "image/jpg" ? "image/jpeg" : value.toLowerCase();
  return normalize(actualType) === normalize(requestedType);
}

/**
 * Lossy smart compression should save enough bytes to justify changing the
 * decoded image. Tiny, already-optimised assets otherwise lose visible detail
 * for only a few bytes of container overhead.
 */
export function minimumSmartSavingsBytes(originalBytes: number, mode: SmartCompressionMode) {
  const ratio = mode === "balanced" ? 0.05 : 0.02;
  const floor = mode === "balanced" ? 256 : 128;
  return Math.max(floor, Math.ceil(originalBytes * ratio));
}

export function isSmartCompressionWorthwhile(
  originalBytes: number,
  outputBytes: number,
  mode: SmartCompressionMode,
) {
  if (originalBytes <= 0 || outputBytes >= originalBytes) return false;
  return originalBytes - outputBytes >= minimumSmartSavingsBytes(originalBytes, mode);
}
