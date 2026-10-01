// A date field. On the phone app this is a text box (YYYY-MM-DD) for now; the web build
// (DateField.web.tsx), which is what the installed app uses, opens the system calendar.
// TimeField is the same for a time of day (HH:MM).
import { StyleSheet, TextInput } from 'react-native';
import { useTheme } from '@/lib/theme';

export function DateField({ value, onChange, placeholder = 'YYYY-MM-DD', min, max }: {
  value: string; onChange: (v: string) => void; placeholder?: string; min?: string; max?: string;
}) {
  const t = useTheme();
  void min; void max;
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.muted}
      style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
});

export function TimeField({ value, onChange, placeholder = 'HH:MM' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useTheme();
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.muted}
      style={[styles.input, { color: t.text, borderColor: t.line, backgroundColor: t.card }]} />
  );
}
