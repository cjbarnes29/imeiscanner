// Re-reads a label that was not read with confidence, trying one image treatment at a time and
// stopping as soon as the readings agree. The reading and the image work are passed in, so the
// decision logic is the same in the browser and in the tests.
import { imeiReadings, judgeImei, type Judgement } from './imei-validate';
import type { Variant } from './ocr-preprocess';

export type RetryOptions<Picture> = {
  /** Text already read from this label (all earlier passes). */
  text: string;
  barcode?: string;
  knownTacs?: ReadonlySet<string>;
  plan: Variant[];
  /** Make the picture for one treatment. */
  prepare: (variant: Variant) => Promise<Picture> | Picture;
  /** Read text from a picture. */
  read: (picture: Picture, variant: Variant) => Promise<string>;
  /** At most this many extra passes. */
  maxPasses?: number;
  /** Stop early at this confidence. */
  goodEnough?: number;
};
export type RetryResult = { judgement: Judgement; text: string; passes: Variant[] };

/** A result is accepted without more passes when it is confident and not a repair. */
export const isSettled = (j: Judgement, goodEnough = 75) => !!j.imei && !j.needsReview && j.confidence >= goodEnough && j.method !== 'repair';

export async function retryLowConfidence<Picture>(options: RetryOptions<Picture>): Promise<RetryResult> {
  const { plan, prepare, read, barcode = '', knownTacs, maxPasses = 4, goodEnough = 75 } = options;
  let text = options.text;
  const judge = () => judgeImei({ readings: imeiReadings(text), barcode, knownTacs });
  let judgement = judge();
  const passes: Variant[] = [];
  for (const variant of plan) {
    if (isSettled(judgement, goodEnough) || passes.length >= maxPasses) break;
    try {
      const extra = await read(await prepare(variant), variant);
      if (extra) text += `\n${extra}`;
    } catch (error) { console.warn('Extra pass skipped', variant, error); }
    passes.push(variant);
    judgement = judge();
  }
  return { judgement, text, passes };
}
