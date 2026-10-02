// Small, cheap motion (web only, where the app runs): cards rise in, charts grow from their
// baseline, pages and pop-ups ease into place, and selections and bars ease between states. All
// of it is CSS, so it costs no JavaScript per frame, and it is switched off for people who ask
// their device for less motion (see the global rule added in the root layout).
//
// The entrances are keyframe animations, which only work when registered through StyleSheet
// (as plain inline styles the keyframes are silently dropped). Transitions are fine inline.
import { Platform, StyleSheet } from 'react-native';

const web = Platform.OS === 'web';
const kf = (from: object, to: object, duration: string, timing = 'cubic-bezier(0.2, 0.9, 0.2, 1)', more: object = {}): any =>
  ({ animationKeyframes: { from, to }, animationDuration: duration, animationTimingFunction: timing, ...more });
const up = (px: number) => kf({ opacity: 0, transform: `translateY(${px}px)` }, { opacity: 1, transform: 'translateY(0px)' }, '260ms');

const S: Record<string, any> = web ? StyleSheet.create({
  rise: kf({ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0px)' }, '260ms'),
  grow: kf({ opacity: 0, transform: 'scaleY(0.8)' }, { opacity: 1, transform: 'scaleY(1)' }, '380ms', undefined, { transformOrigin: 'bottom' }),
  spin: kf({ opacity: 0, transform: 'rotate(-50deg) scale(0.9)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)' }, '420ms'),
  pop: kf({ opacity: 0, transform: 'translateY(10px) scale(0.97)' }, { opacity: 1, transform: 'translateY(0px) scale(1)' }, '220ms'),
  panel: kf({ opacity: 0, transform: 'translateX(36px)' }, { opacity: 1, transform: 'translateX(0px)' }, '240ms'),
  slide: kf({ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'translateX(0px)' }, '200ms'),
  enterA: up(10), enterB: up(10.01),
  pulse: { animationKeyframes: { '0%': { opacity: 1 }, '50%': { opacity: 0.45 }, '100%': { opacity: 1 } }, animationDuration: '1400ms', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' } as any,
  backwards: { animationFillMode: 'backwards' } as any,
}) : {};

/** A card or panel appearing. */
export const RISE: any = S.rise ?? {};
/** A plot appearing: grows up from the baseline. */
export const GROW: any = S.grow ?? {};
/** A pie appearing. */
export const SPIN: any = S.spin ?? {};
/** A centred pop-up arriving on a wide screen. */
export const POP: any = S.pop ?? {};
/** A panel sliding in from the right edge (transaction details beside the list). */
export const PANEL: any = S.panel ?? {};
/** A page arriving from the right. */
export const SLIDE: any = S.slide ?? {};
/** A page coming into view. Two near-identical versions, so switching between them replays it each time a page is shown. */
export const ENTER: [any, any] = [S.enterA ?? {}, S.enterB ?? {}];
/** A loading placeholder breathing. */
export const PULSE: any = S.pulse ?? {};
/** Cards on a board arrive one after another. */
export const riseAfter = (i: number): any => (web ? [S.rise, S.backwards, { animationDelay: `${Math.min(i, 8) * 45}ms` }] : {});

/** Colour and size changes between states (selected chips, progress bars). */
export const EASE: any = web ? { transitionProperty: 'background-color, border-color, color, opacity, width, transform', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' } : {};
/** Things you press give a little: pair with `pressed && { transform: [{ scale: 0.97 }] }`. */
export const PRESS: any = web ? { transitionProperty: 'transform, opacity, background-color, box-shadow', transitionDuration: '140ms', transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : {};
