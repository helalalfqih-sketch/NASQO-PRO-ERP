// Reject private data files and unrelated archives in shipped assets / Android packages.
// SQL migration source and import/export implementation are intentionally not removed.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const forbidden = /\.(?:xls[xmb]?|csv|back|bak|backup|db|sqlite3?|dump|sql|zip|rar|7z|tar|gz|apk|aab)(?:-(?:wal|shm|journal))?$/i;
const forbiddenDir = /(?:^|\/)(?:backups?|deliverables)(?:\/|$)/i;
const violations = [];
const check = (name, context) => {
  const n = name.replace(/\\/g, '/');
  if (forbidden.test(n) || forbiddenDir.test(n)) violations.push(context + ': ' + n);
};
function walk(root, current = root) {
  for (const item of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, item.name);
    if (item.isSymbolicLink()) throw new Error('Unexpected symlink in release assets: ' + full);
    if (item.isDirectory()) walk(root, full);
    else if (item.isFile()) check(path.relative(root, full), root);
  }
}
const targets = process.argv.slice(2);
if (!targets.length) throw new Error('Specify an asset directory or APK/AAB archive.');
for (const target of targets) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) walk(target);
  else if (stat.isFile() && /\.(apk|aab)$/i.test(target)) {
    const names = execFileSync('unzip', ['-Z1', target], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (!names.trim()) throw new Error('Empty Android package: ' + target);
    for (const name of names.split(/\r?\n/).filter(Boolean)) check(name, target);
  } else throw new Error('Unsupported audit input: ' + target);
}
if (violations.length) {
  console.error('Release asset audit FAILED:\n' + violations.join('\n'));
  process.exit(1);
}
console.log('Release asset audit PASS: ' + targets.join(', '));
