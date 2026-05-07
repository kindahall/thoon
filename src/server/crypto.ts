import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type EncryptedPayload = {
  algorithm: 'aes-256-gcm';
  authTag: string;
  iv: string;
  value: string;
};

function keyFromSecret(secret: string) {
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string, secret: string): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return {
    algorithm: 'aes-256-gcm',
    authTag: cipher.getAuthTag().toString('base64'),
    iv: iv.toString('base64'),
    value: encrypted.toString('base64'),
  };
}

export function decryptSecret(payload: EncryptedPayload, secret: string): string {
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(value: string, prefix = 'key') {
  const compact = value.replace(/\s+/g, '');

  if (!compact) {
    return `${prefix}_****`;
  }

  return `${prefix}_${'*'.repeat(4)}_${compact.slice(-4)}`;
}

export type { EncryptedPayload };
