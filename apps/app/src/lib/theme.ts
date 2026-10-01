import { useColorScheme } from 'react-native';

const light = { bg: '#f7f7f5', card: '#ffffff', text: '#1d1d1b', muted: '#6b6b66', line: '#e4e4df', accent: '#1f6f5c', danger: '#b4541a', positive: '#1f6f5c' };
const dark = { bg: '#161615', card: '#20201e', text: '#ececea', muted: '#a3a39c', line: '#33332f', accent: '#4fb398', danger: '#e3894f', positive: '#4fb398' };
export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
