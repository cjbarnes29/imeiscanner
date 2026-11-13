/**
 * Starting the text-reading worker (tesseract.js), kept apart from the screen code so it can be tested.
 *
 * Two problems this solves:
 * 1. The Android build tools unzip assets whose names end in ".gz" while packaging the APK, so the app contains
 *    ocr/eng.traineddata (not .gz). tesseract.js asks for "<lang>.traineddata.gz" unless told otherwise, which was a
 *    404 on Android: camera "Scan all", Crop Studio and the background crop queue could never read text.
 * 2. When the language data cannot be loaded, tesseract.js 5.1.1 never settles the promise from createWorker (its
 *    start-up chain swallows the rejection and only rethrows it inside a message handler unless an errorHandler is
 *    given). Callers waited forever: the crop queue stalled "0 of 1 done" and a camera scan vanished without a word.
 *    Here a failure, or no answer within the time limit, becomes a normal rejection that callers already handle.
 */

/** How long the reader may take to start. Slow phones need a few seconds to unpack the language data. */
export const OCR_START_TIMEOUT_MS = 60_000;

export type OcrWorkerOptions = {
  workerPath: string;
  corePath: string;
  langPath: string;
  /** false when the language data is served uncompressed (the Android app). */
  gzip: boolean;
  errorHandler?: (error: unknown) => void;
};

/** The options for the reader. Android serves plain "eng.traineddata"; the website serves "eng.traineddata.gz". */
export function ocrWorkerOptions(base: string, onAndroid: boolean): OcrWorkerOptions {
  return { workerPath: `${base}/worker.min.js`, corePath: base, langPath: base, gzip: !onAndroid };
}

type Terminable = { terminate: () => Promise<unknown> };

/**
 * Starts a worker and rejects (never hangs) when it cannot start.
 * @param create createWorker from tesseract.js (passed in so tests can supply a fake)
 */
export function startOcrWorker<W extends Terminable>(
  create: (lang: string, oem: number, options: OcrWorkerOptions) => Promise<W>,
  base: string,
  onAndroid: boolean,
  timeoutMs: number = OCR_START_TIMEOUT_MS
): Promise<W> {
  return new Promise<W>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: unknown) => {
      if (settled) return; // later errors belong to individual reading jobs, which reject on their own
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(`Text reader could not start: ${String(error)}`));
    };
    timer = setTimeout(() => fail(new Error(`Text reader did not start within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
    create('eng', 1, { ...ocrWorkerOptions(base, onAndroid), errorHandler: fail }).then(
      worker => {
        if (settled) { void worker.terminate().catch(() => undefined); return; } // arrived after the time limit: do not leak it
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(worker);
      },
      fail
    );
  });
}
