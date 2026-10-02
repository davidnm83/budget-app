// Run after `expo export --platform web`: lists every built file inside sw.js so the whole app is
// saved on the device the first time it opens, not only the pages you happen to visit.
//   node scripts/make-sw.mjs [dist]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const dir = path.resolve(process.argv[2] ?? 'dist');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
walk(dir);
const skip = /(^|\/)(sw\.js|metadata\.json|index\.html)$|\.map$/;
const list = files.map((f) => '/' + path.relative(dir, f).split(path.sep).join('/')).filter((f) => !skip.test(f)).sort();
const hash = crypto.createHash('sha256');
for (const f of ['/index.html', ...list]) hash.update(f).update(fs.readFileSync(path.join(dir, f)));
// The time comes first so versions sort oldest to newest.
const version = `${Date.now().toString(36)}-${hash.digest('hex').slice(0, 8)}`;
const sw = path.join(dir, 'sw.js');
fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__VERSION__', version).replace('/*__FILES__*/', list.map((f) => JSON.stringify(encodeURI(f))).join(',')));
console.log(`sw.js: ${list.length + 1} files, version ${version}`);
