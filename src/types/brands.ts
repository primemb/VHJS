/**
 * Branded primitive types + their smart constructors.
 *
 * A brand makes an otherwise-anonymous `number` carry meaning at the type level:
 * a `Bitrate` cannot be passed where `Pixels` is expected, even though both are
 * numbers at runtime. Values only enter the branded world through the smart
 * constructors below, which validate the invariant once — so downstream domain
 * code can trust them without re-checking. This is the "make illegal states
 * unrepresentable" rule from CLAUDE.md, applied to scalars.
 */

declare const brand: unique symbol;

/** A nominal wrapper over `T`, tagged by the string literal `B`. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Encoder bitrate in **bits per second** (always > 0). */
export type Bitrate = Brand<number, "Bitrate">;

/** A pixel dimension — a video width or height (positive integer). */
export type Pixels = Brand<number, "Pixels">;

/** Frames per second (always > 0; may be fractional, e.g. 29.97). */
export type FrameRate = Brand<number, "FrameRate">;

/** A duration or timestamp in **milliseconds** (>= 0). */
export type Milliseconds = Brand<number, "Milliseconds">;

/** Wrap a positive, finite bits-per-second value. Throws `RangeError` otherwise. */
export function asBitrate(value: number): Bitrate {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Bitrate must be a positive finite number, got ${value}`);
  }
  return value as Bitrate;
}

/** Wrap a positive integer pixel dimension. Throws `RangeError` otherwise. */
export function asPixels(value: number): Pixels {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`Pixels must be a positive integer, got ${value}`);
  }
  return value as Pixels;
}

/** Wrap a positive, finite frames-per-second value. Throws `RangeError` otherwise. */
export function asFrameRate(value: number): FrameRate {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`FrameRate must be a positive finite number, got ${value}`);
  }
  return value as FrameRate;
}

/** Wrap a non-negative, finite millisecond value. Throws `RangeError` otherwise. */
export function asMilliseconds(value: number): Milliseconds {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Milliseconds must be a non-negative finite number, got ${value}`);
  }
  return value as Milliseconds;
}
