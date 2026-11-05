import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(pw: string) {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(pw: string, stored: string) {
  const [algo, salt, hash] = stored.split('$')
  if (algo !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(pw, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}
