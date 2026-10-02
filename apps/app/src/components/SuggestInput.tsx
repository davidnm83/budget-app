// A text field that suggests names you've used before as you type. Tap one to use it, or keep
// typing for a new one. With `multi`, the field holds a comma-separated list (tags) and the
// suggestions are for the word being typed.
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

export function SuggestInput({ value, onChange, options, multi, placeholder, style, max = 6 }: {
  value: string; onChange: (v: string) => void; options: string[]; multi?: boolean; placeholder?: string; style?: StyleProp<TextStyle>; max?: number;
}) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  const input = useRef<TextInput>(null);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parts = multi ? value.split(',') : [value];
  const typing = parts[parts.length - 1].trim().toLowerCase();
  const have = new Set(multi ? parts.slice(0, -1).map((p) => p.trim().toLowerCase()) : []);
  // Names starting with what's typed come first, then names containing it. With nothing typed,
  // tags show the ones used most; a single name shows nothing until you type.
  const pool = options.filter((o) => !have.has(o.toLowerCase()) && o.toLowerCase() !== typing);
  const hits = typing
    ? [...pool.filter((o) => o.toLowerCase().startsWith(typing)), ...pool.filter((o) => !o.toLowerCase().startsWith(typing) && o.toLowerCase().includes(typing))]
    : multi ? pool : [];
  const exact = options.some((o) => o.toLowerCase() === typing);
  const pick = (o: string) => onChange(multi ? [...parts.slice(0, -1).map((p) => p.trim()).filter(Boolean), o].join(', ') + ', ' : o);
  // Picking keeps you in the field (so the next tag can be typed straight away).
  const choose = (o: string) => {
    pick(o);
    input.current?.focus();
    // Put the cursor at the end once the new text is in (web keeps the old cursor position otherwise).
    setTimeout(() => (input.current as any)?.setSelectionRange?.(100000, 100000), 0);
  };
  const show = focus && (hits.length > 0 || (!!typing && !exact && !multi));
  return (
    <View>
      <TextInput ref={input} style={style} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.muted}
        autoCapitalize={multi ? 'none' : 'sentences'} onFocus={() => { if (blur.current) clearTimeout(blur.current); setFocus(true); }}
        onBlur={() => { blur.current = setTimeout(() => setFocus(false), 150); }} />
      {show && (
        <View style={[styles.list, { borderColor: t.line, backgroundColor: t.card }]}>
          {hits.slice(0, max).map((o) => (
            <Pressable key={o} onPress={() => choose(o)} style={({ hovered }: any) => [styles.row, hovered && { backgroundColor: t.bg }]}>
              <Text style={{ color: t.text, fontSize: 14 }} numberOfLines={1}>{o}</Text>
            </Pressable>
          ))}
          {!!typing && !exact && !multi && (
            <View style={styles.row}><Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>New merchant: “{value.trim()}”</Text></View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 8, marginTop: 4, overflow: 'hidden' },
  row: { paddingHorizontal: 10, paddingVertical: 8 },
});
