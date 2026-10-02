// One place for the sizes every screen shares, so pages line up on big screens.
import { useWindowDimensions } from 'react-native';

/** Widest a page's content gets; it's centred beyond that. */
export const PAGE_MAX = 1080;
/** From this width up (laptops, landscape tablets) the tab bar moves to the top and pop-ups become centred panels. */
export const WIDE = 900;
export const useWide = () => useWindowDimensions().width >= WIDE;
