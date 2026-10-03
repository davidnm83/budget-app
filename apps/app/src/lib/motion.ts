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
  // No lasting will-change: a sheet kept on its own GPU layer after it arrives is what Android Chrome fills with
  // black tiles on a long form (worse with one sheet over another). The animation is promoted while it runs anyway.
  sheet: kf({ transform: 'translateY(100%)' }, { transform: 'translateY(0%)' }, '280ms'),
  fade: kf({ opacity: 0 }, { opacity: 1 }, '200ms', 'ease-out'),
  enterA: up(10), enterB: up(10.01),
  // After a swipe between tabs: the new page comes in from the side the finger was heading to (two copies each, so it replays).
  inR: kf({ opacity: 0.4, transform: 'translateX(60px)' }, { opacity: 1, transform: 'translateX(0px)' }, '220ms'),
  inR2: kf({ opacity: 0.4, transform: 'translateX(60.01px)' }, { opacity: 1, transform: 'translateX(0px)' }, '220ms'),
  inL: kf({ opacity: 0.4, transform: 'translateX(-60px)' }, { opacity: 1, transform: 'translateX(0px)' }, '220ms'),
  inL2: kf({ opacity: 0.4, transform: 'translateX(-60.01px)' }, { opacity: 1, transform: 'translateX(0px)' }, '220ms'),
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
/** A phone sheet rising from the bottom edge. Runs off the main thread, so it stays smooth while the sheet's content is still being drawn. */
export const SHEET: any = S.sheet ?? {};
/** A pop-up's dimming arriving. Only the dimming fades: fading the whole pop-up let the page behind show through the sheet as it rose. */
export const FADE: any = S.fade ?? {};
/** A panel sliding in from the right edge (transaction details beside the list). */
export const PANEL: any = S.panel ?? {};
/** A page arriving from the right. */
export const SLIDE: any = S.slide ?? {};
/** A page coming into view. Two near-identical versions, so switching between them replays it each time a page is shown. */
export const ENTER: [any, any] = [S.enterA ?? {}, S.enterB ?? {}];
/** A tab reached by swiping: [from the right (swiped left), from the left (swiped right)], two copies each. */
export const SWIPE_IN: [[any, any], [any, any]] = [[S.inR ?? {}, S.inR2 ?? {}], [S.inL ?? {}, S.inL2 ?? {}]];
/** A loading placeholder breathing. */
export const PULSE: any = S.pulse ?? {};
/** Cards on a board arrive one after another. */
export const riseAfter = (i: number): any => (web ? [S.rise, S.backwards, { animationDelay: `${Math.min(i, 8) * 45}ms` }] : {});

/** Colour and size changes between states (selected chips, progress bars). */
export const EASE: any = web ? { transitionProperty: 'background-color, border-color, color, opacity, width, transform', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' } : {};
/** Things you press give a little: pair with `pressed && { transform: [{ scale: 0.97 }] }`. */
export const PRESS: any = web ? { transitionProperty: 'transform, opacity, background-color, box-shadow', transitionDuration: '140ms', transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : {};
