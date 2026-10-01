// Copies packages/core/src into supabase/functions/_shared/core so Edge Functions
// (Deno) use exactly the same logic as the app. Run after changing core: npm run sync-core
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const src = 'packages/core/src';
const dest = 'supabase/functions/_shared/core';
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
for (const f of readdirSync(dest)) {
  const p = join(dest, f);
  writeFileSync(p, '// GENERATED from packages/core/src by `npm run sync-core`. Do not edit here.\n' + readFileSync(p, 'utf8'));
}
console.log('Copied core to', dest);
