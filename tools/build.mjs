// Génère vault.json : chiffre localement les mails et le CV contenus dans private/.
// Chiffrement : AES-256-GCM, clé dérivée de la phrase secrète par PBKDF2-SHA256.
// Usage : node tools/build.mjs   (la phrase secrète est demandée, rien n'est écrit en clair)
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE = join(ROOT, 'private');
const OUT = join(ROOT, 'vault.json');
const ITERATIONS = 600_000;
const MIN_LENGTH = 8;

const fail = (msg) => { console.error(`Erreur : ${msg}`); process.exit(1); };

function askHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) fail('lancez la commande dans un terminal interactif.');
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') { stdout.write('\n'); process.exit(130); }
        if (ch === '\b' || ch === '\u007f') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function getPassphrase() {
  // Variable d'environnement réservée aux tests automatisés.
  if (process.env.SITECV_TEST_PASSPHRASE) return process.env.SITECV_TEST_PASSPHRASE;
  const first = await askHidden('Phrase secrète : ');
  if (first.length < MIN_LENGTH) fail(`la phrase secrète doit faire au moins ${MIN_LENGTH} caractères.`);
  const second = await askHidden('Confirmation   : ');
  if (first !== second) fail('les deux saisies sont différentes.');
  return first;
}

// Format d'un mail : lignes "Clé: valeur", une ligne vide, puis le corps du message.
function parseMail(file) {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const sep = text.indexOf('\n\n');
  if (sep < 0) fail(`${basename(file)} : en-têtes manquants.`);
  const headers = {};
  for (const line of text.slice(0, sep).split('\n')) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) headers[m[1].trim().toLowerCase()] = m[2].trim();
  }
  if (!headers.titre || !headers.objet) fail(`${basename(file)} : "Titre:" et "Objet:" sont obligatoires.`);
  return { title: headers.titre, subject: headers.objet, body: text.slice(sep + 2).trim() };
}

function findOne(ext) {
  const files = readdirSync(PRIVATE).filter((f) => extname(f).toLowerCase() === ext && !f.startsWith('~$'));
  if (files.length > 1) fail(`plusieurs fichiers ${ext} dans private/.`);
  return files[0] ? join(PRIVATE, files[0]) : null;
}

if (!existsSync(PRIVATE)) fail('dossier private/ introuvable.');
const mailDir = join(PRIVATE, 'mails');
const mails = existsSync(mailDir)
  ? readdirSync(mailDir).filter((f) => f.endsWith('.txt')).sort().map((f) => parseMail(join(mailDir, f)))
  : [];
if (!mails.length) fail('aucun mail dans private/mails/.');

const docx = findOne('.docx');
if (!docx) fail('aucun CV .docx dans private/.');
let pdf = findOne('.pdf');
if (!pdf) console.warn('Attention : aucun PDF dans private/, le bouton PDF sera masqué.');

const files = {
  docx: { path: docx, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ...(pdf && { pdf: { path: pdf, type: 'application/pdf' } }),
};

const passphrase = (await getPassphrase()).normalize('NFC');
const salt = randomBytes(16);
const key = pbkdf2Sync(Buffer.from(passphrase, 'utf8'), salt, ITERATIONS, 32, 'sha256');

// Chaque élément a son propre IV ; son identifiant est lié au chiffré (données associées).
function seal(id, data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(id, 'utf8'));
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64') };
}

const meta = {
  sections: mails,
  files: Object.fromEntries(Object.entries(files).map(([id, f]) => [id, { name: basename(f.path), type: f.type }])),
};
const items = { meta: seal('meta', Buffer.from(JSON.stringify(meta), 'utf8')) };
for (const [id, f] of Object.entries(files)) items[id] = seal(id, readFileSync(f.path));

const vault = {
  v: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: salt.toString('base64') },
  cipher: 'AES-GCM',
  items,
};
writeFileSync(OUT, JSON.stringify(vault) + '\n');
console.log(`vault.json généré : ${mails.length} mail(s), ${Object.keys(files).join(' + ')} chiffrés.`);
