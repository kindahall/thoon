import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

const password = process.argv[2] ?? (await promptPassword());

if (!password || password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

const iterations = 310000;
const salt = randomBytes(16).toString('base64url');
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
const verifier = createHash('sha256').update(hash).digest('hex').slice(0, 12);

console.log(`THOON_ADMIN_PASSWORD_HASH=pbkdf2_sha256$${iterations}$${salt}$${hash}`);
console.log(`# verifier:${verifier}`);

async function promptPassword() {
  const rl = createInterface({ input, output });
  const value = await rl.question('Admin password: ');
  rl.close();

  return value;
}
