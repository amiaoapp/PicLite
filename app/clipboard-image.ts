export type ClipboardImageMetadata = { name?: string; type?: string };
export type ClipboardImagePayload = ClipboardImageMetadata & { data: Uint8Array };

// Native paste must retain the encoded representation, not the browser's
// synthetic image.png. This helper is shared by manual and automatic ingress.
export function clipboardImageFile(data: Uint8Array, metadata: ClipboardImageMetadata = {}): File {
  const bytes = Array.from(data.subarray(0, 12));
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const type = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" ? "image/webp"
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg"
    : bytes[0] === 0x89 && ascii(1, 4) === "PNG" ? "image/png"
    : ascii(0, 3) === "GIF" ? "image/gif" : metadata.type || "image/png";
  const extension = type === "image/jpeg" ? "jpg" : type.split("/")[1] || "png";
  const name = metadata.name?.split(/[\\/]/).pop() || `clipboard-${Date.now()}.${extension}`;
  return new File([new Uint8Array(data)], name, { type });
}
