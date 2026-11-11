/** Read a QR / barcode from a photo.
 *  Uses the browser's native BarcodeDetector when present (Chrome on Android),
 *  otherwise falls back to @zxing/browser (loaded on demand — iOS Safari, Firefox, desktop). */
type Detector = new (o: unknown) => { detect: (b: ImageBitmap) => Promise<{ rawValue: string }[]> };

export async function scanCode(file: File): Promise<string | null> {
  const BD = (globalThis as unknown as { BarcodeDetector?: Detector }).BarcodeDetector;
  if (BD) {
    try {
      const codes = await new BD({ formats: ['qr_code', 'code_128', 'ean_13', 'data_matrix'] }).detect(await createImageBitmap(file));
      if (codes[0]?.rawValue) return codes[0].rawValue.trim();
    } catch {
      /* fall through to zxing */
    }
  }
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const url = URL.createObjectURL(file);
  try {
    const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
    return result.getText().trim() || null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
