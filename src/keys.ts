import { exportJWK, generateKeyPair, type KeyLike } from 'jose'

export const KID = 'rsa1'

let privateKey: KeyLike
let publicKey: KeyLike
let publicJwk: Record<string, unknown>

export async function initKeys(): Promise<void> {
  const { privateKey: sk, publicKey: pk } = await generateKeyPair('RS256')
  privateKey = sk
  publicKey = pk
  publicJwk = { ...(await exportJWK(pk)), use: 'sig', alg: 'RS256', kid: KID }
}

export function getPrivateKey(): KeyLike {
  return privateKey
}

export function getPublicKey(): KeyLike {
  return publicKey
}

export function getJwks() {
  return { keys: [publicJwk] }
}
