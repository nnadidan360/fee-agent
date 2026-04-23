import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { Pool } from 'pg';
import { AuthError } from '../errors.js';
import type { JWTPayload } from '../types/index.js';

function getJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

export async function generateChallenge(
  pool: Pool,
  walletAddress: string
): Promise<{ nonce: string; expiresAt: string }> {
  const nonce = uuidv4();
  const result = await pool.query<{ expires_at: Date }>(
    `INSERT INTO nonces (nonce, wallet_address, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
     RETURNING expires_at`,
    [nonce, walletAddress]
  );
  const expiresAt = result.rows[0]!.expires_at;
  return { nonce, expiresAt: expiresAt.toISOString() };
}

export async function verifySignature(
  pool: Pool,
  walletAddress: string,
  nonce: string,
  signature: string
): Promise<{ token: string }> {
  // Load nonce from DB
  const nonceResult = await pool.query<{
    nonce: string;
    wallet_address: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    'SELECT nonce, wallet_address, expires_at, used_at FROM nonces WHERE nonce = $1',
    [nonce]
  );

  if (nonceResult.rowCount === 0) {
    throw new AuthError('Nonce not found');
  }

  const record = nonceResult.rows[0]!;

  if (record.expires_at < new Date()) {
    throw new AuthError('Nonce expired');
  }

  if (record.used_at !== null) {
    throw new AuthError('Nonce already used');
  }

  // Mark nonce as used IMMEDIATELY regardless of signature outcome
  await pool.query('UPDATE nonces SET used_at = NOW() WHERE nonce = $1', [nonce]);

  // Verify ed25519 signature
  const messageBytes = new TextEncoder().encode(nonce);
  const signatureBytes = bs58.decode(signature);
  const publicKeyBytes = new PublicKey(walletAddress).toBytes();

  const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

  if (!isValid) {
    throw new AuthError('Invalid signature');
  }

  const jti = uuidv4();
  const token = jwt.sign({ sub: walletAddress, jti }, getJwtSecret(), { expiresIn: '24h' });

  return { token };
}

export async function logout(pool: Pool, jti: string, exp: number): Promise<void> {
  await pool.query(
    'INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
    [jti, new Date(exp * 1000)]
  );
}

export async function validateJWT(pool: Pool, token: string): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    payload = jwt.verify(token, getJwtSecret()) as JWTPayload;
  } catch (err) {
    throw new AuthError(err instanceof Error ? err.message : 'Invalid token');
  }

  const revoked = await pool.query(
    'SELECT 1 FROM revoked_tokens WHERE jti = $1',
    [payload.jti]
  );

  if (revoked.rowCount && revoked.rowCount > 0) {
    throw new AuthError('Token revoked');
  }

  return payload;
}
