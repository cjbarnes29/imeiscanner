import type { PositionedBarcode } from './barcode-imei';

// Browser barcode reading with zxing-wasm. Works in every browser (Android,
// iPhone, desktop), unlike the built-in BarcodeDetector which only exists in
// Chrome on Android. Loaded lazily so the scanner's first screen stays light;
// the .wasm file is bundled with the app instead of fetched from a CDN.
type Reader = typeof import('zxing-wasm/reader');
let ready: Promise<Reader> | undefined;
function reader(): Promise<Reader> {
  return ready ||= (async () => {
    const [module, { default: wasmUrl }] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url')
    ]);
    await module.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => path.endsWith('.wasm') ? wasmUrl : prefix + path },
      fireImmediately: true
    });
    return module;
  })();
}

function frame(source: CanvasImageSource, width: number, height: number, longest: number) {
  const scale = longest > 0 ? longest / Math.max(width, height) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { data: context.getImageData(0, 0, canvas.width, canvas.height), scale };
}

/**
 * All Code 128 / EAN-13 barcodes in an image, with boxes in the source's pixel
 * coordinates. Small bars decode at some sizes and not others, so the image is
 * read at its own size plus several resamples and the results are combined.
 */
export async function readImageBarcodes(source: CanvasImageSource, width: number, height: number, sizes = [0, 1200, 1600, 2000, 2600]): Promise<PositionedBarcode[]> {
  try {
    const zxing = await reader();
    const found = new Map<string, PositionedBarcode>();
    for (const longest of sizes) {
      if (longest && Math.abs(longest - Math.max(width, height)) < 60) continue;
      const { data, scale } = frame(source, width, height, longest);
      const results = await zxing.readBarcodes(data, { formats: ['Code128', 'EAN13'], maxNumberOfSymbols: 40, tryHarder: true });
      for (const code of results) {
        if (!code.isValid || found.has(code.text)) continue;
        const p = code.position, xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x].map(v => v / scale), ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y].map(v => v / scale);
        found.set(code.text, { rawValue: code.text, boundingBox: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) } });
      }
    }
    return [...found.values()];
  } catch (error) {
    console.warn('Barcode reading unavailable', error);
    return [];
  }
}

export async function readDataUrlBarcodes(dataUrl: string, sizes?: number[]) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return readImageBarcodes(image, image.naturalWidth, image.naturalHeight, sizes);
}
