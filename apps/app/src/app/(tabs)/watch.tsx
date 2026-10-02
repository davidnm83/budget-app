// The spending watch moved into Reports; old links land on its tab there.
import { Redirect } from 'expo-router';

export default function Watch() {
  return <Redirect href={'/reports?tab=watch' as any} />;
}
