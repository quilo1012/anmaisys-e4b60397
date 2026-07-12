// Downscale an uploaded image to a small square favicon data URL.
// SVGs are passed through as-is (already tiny + vector).
export async function fileToFaviconDataUrl(
  file: File,
  size = 128,
  maxBytes = 200 * 1024,
): Promise<string> {
  const readAsDataUrl = (f: File | Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(f);
    });

  if (file.type === "image/svg+xml") {
    const url = await readAsDataUrl(file);
    if (url.length > maxBytes * 1.4) throw new Error("SVG too large. Please use a smaller file.");
    return url;
  }

  const srcUrl = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read image"));
    el.src = srcUrl;
  });

  const render = (dim: number, quality = 0.92, mime = "image/png") => {
    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    // Contain into square, transparent padding for PNG.
    const scale = Math.min(dim / img.width, dim / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (dim - w) / 2, (dim - h) / 2, w, h);
    return canvas.toDataURL(mime, quality);
  };

  let out = render(size);
  if (out.length > maxBytes * 1.4) out = render(size, 0.85, "image/webp");
  if (out.length > maxBytes * 1.4) out = render(64, 0.85, "image/webp");
  if (out.length > maxBytes * 1.4) throw new Error("Image could not be compressed under 200KB.");
  return out;
}
