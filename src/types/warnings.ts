/**
 * `ValidationWarning` — the non-fatal counterpart to the typed errors.
 *
 * Some requests are legal but suboptimal: a bitrate slightly above source is
 * clamped down rather than rejected; two ladder rungs that collapse to the same
 * height are redundant. Instead of throwing, the validation/ladder layers return
 * warnings on a side channel so the caller can surface them (log, event, UI)
 * while the job still runs. This is a pure domain type (innermost layer).
 */

/** Machine-readable discriminant for a `ValidationWarning`. */
export type ValidationWarningCode = "BITRATE_CLAMPED" | "REDUNDANT_RENDITION";

/** A non-fatal advisory produced while validating/normalizing a request. */
export interface ValidationWarning {
  /** Discriminant for `switch`-based handling. */
  readonly code: ValidationWarningCode;
  /** Human-readable explanation. */
  readonly message: string;
}
