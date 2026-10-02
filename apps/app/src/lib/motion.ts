// Small, cheap motion (web only, where the app runs): cards rise in, charts grow from their
// baseline, and selections and bars ease between states. All of it is CSS, so it costs no
// JavaScript per frame, and it is switched off for people who ask their device for less motion
// (see the global rule added in the root layout).
import { Platform } from 'react-native';

const web = Platform.OS === 'web';
/** A card or panel appearing. */
export const RISE: any = web ? { animationKeyframes: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0px)' } }, animationDuration: '220ms', animationTimingFunction: 'ease-out' } : {};
/** A plot appearing: grows up from the baseline. */
export const GROW: any = web ? { animationKeyframes: { from: { opacity: 0, transform: 'scaleY(0.82)' }, to: { opacity: 1, transform: 'scaleY(1)' } }, animationDuration: '320ms', animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)', transformOrigin: 'bottom' } : {};
/** A pie appearing. */
export const SPIN: any = web ? { animationKeyframes: { from: { opacity: 0, transform: 'rotate(-40deg) scale(0.92)' }, to: { opacity: 1, transform: 'rotate(0deg) scale(1)' } }, animationDuration: '360ms', animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : {};
/** Colour and size changes between states (selected chips, progress bars). */
export const EASE: any = web ? { transitionProperty: 'background-color, border-color, color, opacity, width', transitionDuration: '180ms', transitionTimingFunction: 'ease-out' } : {};
/** A page arriving from the right (opening a transaction). */
export const SLIDE: any = web ? { animationKeyframes: { from: { opacity: 0, transform: 'translateX(28px)' }, to: { opacity: 1, transform: 'translateX(0px)' } }, animationDuration: '200ms', animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : {};
