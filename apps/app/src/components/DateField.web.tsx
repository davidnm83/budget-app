// Web (and the app installed from Chrome): a real date input, so tapping it opens the
// phone's calendar picker. The value stays YYYY-MM-DD like everywhere else in the app.
import { createElement } from 'react';
import { useTheme } from '@/lib/theme';

export function DateField({ value, onChange, min, max }: {
  value: string; onChange: (v: string) => void; placeholder?: string; min?: string; max?: string;
}) {
  const t = useTheme();
  const dark = t.bg.toLowerCase() < '#888888';
  return createElement('input', {
    type: 'date', value: value ?? '', min, max,
    onChange: (e: any) => onChange(e.target.value),
    style: {
      boxSizing: 'border-box', width: '100%', minHeight: 40, border: `1px solid ${t.line}`, borderRadius: 8,
      padding: '8px 10px', fontSize: 15, color: t.text, background: t.card, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      colorScheme: dark ? 'dark' : 'light', outline: 'none',
    },
  });
}
