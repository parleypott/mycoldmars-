// Per-user random password generation for the admin console (api/admin-users.js).
//
// Replaces the old fixed 'newpress' default, which was a shared skeleton key:
// it was printed on the public login screen, so every account that never
// rotated it was open to anyone who could read the sign-in page. Generated
// passwords are returned ONCE to the creating admin and never stored or
// echoed again.
//
// Alphabet is 32 chars (lowercase + digits, minus l/o/0/1 so a password read
// over the phone or off a sticky note can't be mis-typed). 32 divides 256
// evenly, so `byte & 31` is uniform — no modulo bias. 14 chars × 5 bits =
// 70 bits of entropy, far beyond online-guessing reach.
//
// Uses the WebCrypto global (`crypto.getRandomValues`) — present in the Vercel
// edge runtime, Node 19+, and Bun — so this stays runtime-agnostic.

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export const GENERATED_PASSWORD_LENGTH = 14;

export function generatePassword(length = GENERATED_PASSWORD_LENGTH) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}
