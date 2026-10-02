// Choose a picture from the device and shrink it to a small square, in the browser, before it is
// saved. Nothing is uploaded anywhere except the finished 128×128 image into your own database.
export const PICTURE_HINT = 'Best: a square PNG with a clear or white background, 128×128 or larger. JPG and WebP work too. Up to 5 MB; it is shrunk to about 128 pixels.';
const MAX_BYTES = 5 * 1024 * 1024, SIZE = 128;

export function pickPicture(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('Choosing a picture needs the web app.')); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (!file.type.startsWith('image/')) { reject(new Error('That file isn’t a picture.')); return; }
      if (file.size > MAX_BYTES) { reject(new Error(`That picture is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB.`)); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          // Keep the picture's shape: its short side becomes 128, and a very long side is trimmed
          // from the centre to twice that. "Fill the circle" then decides how it is shown.
          const w = img.naturalWidth || SIZE, h = img.naturalHeight || SIZE, k = SIZE / Math.min(w, h);
          const cw = Math.min(Math.round(w * k), SIZE * 2), ch = Math.min(Math.round(h * k), SIZE * 2);
          const c = document.createElement('canvas'); c.width = cw; c.height = ch;
          const ctx = c.getContext('2d')!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (cw - w * k) / 2, (ch - h * k) / 2, w * k, h * k);
          let out = c.toDataURL('image/png');
          if (out.length > 120000) out = c.toDataURL('image/webp', 0.85); // photos: smaller as WebP
          resolve(out);
        } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture couldn’t be read.')); };
      img.src = url;
    };
    input.click();
  });
}
