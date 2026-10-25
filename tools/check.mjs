// Vérifie qu'aucune donnée en clair n'est (ou n'a été) suivie par Git.
// Usage : node tools/check.mjs   (à lancer avant chaque commit/push)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set([
  '.gitignore', 'README.md', 'index.html', 'vault.json',
  'tools/build.mjs', 'tools/check.mjs',
]);
const FORBIDDEN = /(^|\/)private\/|\.(docx?|pdf|txt)$/i;

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { ok: r.status === 0, out: r.stdout || '' };
};
const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const problems = [];

// 1. Fichiers suivis + fichiers qu'un "git add ." ajouterait
const tracked = lines(git('ls-files').out);
const pending = lines(git('ls-files', '--others', '--exclude-standard').out);
for (const f of [...tracked, ...pending]) {
  if (!ALLOWED.has(f)) problems.push(`fichier non autorisé : ${f}`);
}

// 2. private/ doit être ignoré
if (!git('check-ignore', '-q', 'private/test.docx').ok) problems.push('private/ n\'est pas ignoré par .gitignore');

// 3. Historique : aucun fichier interdit dans un commit passé
const hasCommits = git('rev-parse', '--verify', '-q', 'HEAD').ok;
const history = hasCommits ? lines(git('log', '--all', '--name-only', '--pretty=format:').out) : [];
for (const f of new Set(history)) {
  if (FORBIDDEN.test(f)) problems.push(`historique Git : ${f} a été commité`);
}

// 4. Contenu : aucune phrase des mails en clair dans les fichiers ni dans l'historique
const mailDir = join(ROOT, 'private', 'mails');
const needles = existsSync(mailDir)
  ? readdirSync(mailDir).filter((f) => f.endsWith('.txt')).flatMap((f) =>
      readFileSync(join(mailDir, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/)
        .map((l) => l.replace(/^(objet|titre):\s*/i, '').trim())
        .filter((l) => l.length >= 10 && !/^(cordialement|bonjour)/i.test(l)))
  : [];
if (!needles.length) console.warn('Attention : private/mails/ absent, vérification du contenu limitée.');
for (const f of [...tracked, ...pending]) {
  const path = join(ROOT, f);
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf8');
  if (needles.some((n) => content.includes(n))) problems.push(`texte en clair trouvé dans ${f}`);
}
if (hasCommits && needles.length) {
  const revs = lines(git('rev-list', '--all').out);
  const args = ['grep', '-F', '-l', ...needles.flatMap((n) => ['-e', n]), ...revs];
  for (const hit of lines(git(...args).out)) problems.push(`texte en clair dans l'historique : ${hit}`);
}

// 5. vault.json doit exister et être chiffré
const vaultPath = join(ROOT, 'vault.json');
if (!existsSync(vaultPath)) problems.push('vault.json absent : lancez node tools/build.mjs');
else {
  try {
    const v = JSON.parse(readFileSync(vaultPath, 'utf8'));
    if (!v.items?.meta?.ct || !v.items?.docx?.ct) problems.push('vault.json incomplet');
  } catch { problems.push('vault.json illisible'); }
}

if (problems.length) {
  console.error('ÉCHEC — ne publiez pas :\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`OK — ${tracked.length + pending.length} fichier(s) publiables, aucune donnée en clair détectée.`);
