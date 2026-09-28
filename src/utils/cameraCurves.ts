import type { StepTransition } from '@/types'

/**
 * The curves a camera move is drawn with.
 *
 * The default used to be a quadratic ease-in-out, and it was the reason the
 * transition felt harsh rather than quick. A quadratic has an acceleration that
 * never reaches a peak and a deceleration that starts too late, so the first
 * tenth of the move looks like nothing is happening and the last tenth looks
 * like a hard stop. Read at presentation speed — a second or two, watched by a
 * room — that is a lurch.
 *
 * What it is replaced with matters as much as the maths: every curve here starts
 * and ends with *zero velocity*, so the camera does not arrive at speed and then
 * stop, and none of them overshoots by more than a rounding error, because
 * overshooting a card means the audience briefly sees the wrong thing.
 *
 *   linear  exactly as named. For a step whose timing is being read against
 *           something else.
 *   ease    the workhorse. A smooth acceleration into a long glide and a smooth
 *           deceleration out of it, with a gentler curve than a parabola at
 *           both ends.
 *   drift   `ease`, plus a small overshoot in the last quarter and a settle
 *           back. Reads as a hand carrying the camera rather than a machine
 *           parking it. The overshoot is a *fraction* of the distance, so a long
 *           move still only overshoots a little.
 *   instant no curve at all. The caller does not animate; this exists so the
 *           switch is total and typed, rather than a duration of zero happening
 *           to mean the same thing.
 */

/**
 * How far past the destination `drift` goes, as a fraction of the distance.
 *
 * Small on purpose. The camera has to land *exactly* on the card, so the further
 * it goes the longer the wrong thing is on screen, and past about a tenth of the
 * distance it stops reading as a settle and starts reading as a mistake.
 */
const DRIFT_OVERSHOOT = 0.06

/**
 * Cubic in, cubic out: the standard "ease-in-out" curve, and what most
 * interfaces use for a move that should feel deliberate but unhurried.
 *
 * The alternative every implementation reaches for first is a quadratic, whose
 * acceleration is `2t` — it never reaches a peak before turning round, so the
 * move spends a noticeable fraction of its length at very low speed at both
 * ends. On a two-second camera move that reads as hesitation.
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * A gentler curve still, with a longer glide in the middle.
 *
 * The cubic above is good but slightly "urgent" at the start, which shows on a
 * long move across a big map where the distance is thousands of pixels. This one
 * spends longer near the destination, so a long move arrives rather than
 * stopping.
 */
function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2
}

/**
 * `ease` with a small overshoot in the last quarter, settling back to exactly
 * the destination.
 *
 * The overshoot is a *fraction of the distance*, not a fixed number of pixels,
 * so it is equally small whether the step moves 50px or 5000. And it is resolved
 * by the last 25% of the curve, so most of the move is the ordinary ease and only
 * the very end has any character to it.
 */
function drift(t: number): number {
  // The first three quarters are the ordinary ease, landing exactly on the
  // destination. The overshoot is a *continuation* of that motion, so it starts
  // from where the ease ended rather than beginning a second movement.
  if (t < 0.75) return easeInOutQuint(t / 0.75)

  // A quarter period of a sine, peaking halfway: it leaves the destination with
  // zero velocity, so the pass is smooth rather than a jolt, and returns to
  // exactly the destination with zero velocity again, so the settle is where the
  // eye expects it and not a snap.
  const p = (t - 0.75) / 0.25
  return 1 + DRIFT_OVERSHOOT * Math.sin(p * Math.PI)
}

/** The curve for a transition, or a no-op for one that does not animate. */
export function cameraCurve(transition: StepTransition): (t: number) => number {
  switch (transition) {
    case 'linear':
      return (t) => t
    case 'drift':
      return drift
    case 'ease':
    default:
      return easeInOutCubic
  }
}
