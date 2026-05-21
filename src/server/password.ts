import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const passwordHashPrefix = 'pbkdf2_sha256';

export function createPasswordHash(password: string) {
  const iterations = 310000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');

  return `${passwordHashPrefix}$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash?: string) {
  if (!storedHash || !storedHash.startsWith(`${passwordHashPrefix}$`)) {
    return false;
  }

  const [, rawIterations, salt, expectedHash] = storedHash.split('$');
  const iterations = Number(rawIterations);

  if (!Number.isInteger(iterations) || iterations < 100000 || !salt || !expectedHash) {
    return false;
  }

  const actual = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const expected = Buffer.from(expectedHash, 'base64url');

  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
