import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSecureToken,
  hashToken,
  generatePublicId,
  generateGuestUsername,
  sanitizeInputText,
  validateDisplayNameFormat,
  validateFileAttachment,
  createSignedAttachmentQuery,
  verifySignedAttachmentQuery,
  SlidingWindowRateLimiter,
} from './security';

test('generateSecureToken & hashToken produce distinct deterministic SHA-256 hashes', () => {
  const token1 = generateSecureToken(32);
  const token2 = generateSecureToken(32);
  assert.equal(token1.length, 64);
  assert.notEqual(token1, token2);

  const hash1a = hashToken(token1);
  const hash1b = hashToken(token1);
  assert.equal(hash1a, hash1b);
  assert.notEqual(hash1a, token1);
  assert.equal(hash1a.length, 64);
});

test('generateGuestUsername & generatePublicId adhere to format constraints', () => {
  const username = generateGuestUsername();
  assert.match(username, /^Guest_\d{5}$/);

  const pubId = generatePublicId('usr');
  assert.match(pubId, /^usr_[a-f0-9]{20}$/);
});

test('sanitizeInputText strips null bytes and control characters and enforces length', () => {
  const raw = '  Hello\x00\x07 World!  ';
  assert.equal(sanitizeInputText(raw, 100), 'Hello World!');
  assert.equal(sanitizeInputText('abcdef', 3), 'abc');
});

test('validateDisplayNameFormat accepts clean names and rejects XSS payloads', () => {
  assert.equal(validateDisplayNameFormat('Guest_84291'), true);
  assert.equal(validateDisplayNameFormat('Cipher Fox 42'), true);
  assert.equal(validateDisplayNameFormat('<script>alert(1)</script>'), false);
  assert.equal(validateDisplayNameFormat('javascript:void(0)'), false);
  assert.equal(validateDisplayNameFormat('A'), false);
});

test('validateFileAttachment validates magic bytes and blocks executables or spoofed files', () => {
  // Valid PNG magic header
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const validPng = validateFileAttachment(pngBuffer, 'diagram.png', 'image/png');
  assert.equal(validPng.valid, true);
  assert.equal(validPng.category, 'image');
  assert.match(validPng.storageName!, /^att_[a-f0-9]{32}\.png$/);

  // Spoofed executable disguised as PNG
  const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
  const spoofedExe = validateFileAttachment(exeBuffer, 'malware.png', 'image/png');
  assert.equal(spoofedExe.valid, false);

  // Double extension trick
  const doubleExt = validateFileAttachment(pngBuffer, 'invoice.exe.png', 'image/png');
  assert.equal(doubleExt.valid, false);

  // Valid PDF magic header
  const pdfBuffer = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj');
  const validPdf = validateFileAttachment(
    pdfBuffer,
    'whitepaper.pdf',
    'application/pdf'
  );
  assert.equal(validPdf.valid, true);
  assert.equal(validPdf.category, 'document');
});

test('createSignedAttachmentQuery and verifySignedAttachmentQuery enforce TTL and HMAC integrity', () => {
  const secret = 'test-hmac-secret-key-999';
  const now = 1_700_000_000_000;
  const { expires, sig } = createSignedAttachmentQuery(
    'att_12345',
    'usr_abcde',
    secret,
    300,
    now
  );

  // Valid within window
  assert.equal(
    verifySignedAttachmentQuery(
      'att_12345',
      'usr_abcde',
      String(expires),
      sig,
      secret,
      now + 60_000
    ),
    true
  );

  // Rejects different user (IDOR prevention)
  assert.equal(
    verifySignedAttachmentQuery(
      'att_12345',
      'usr_intruder',
      String(expires),
      sig,
      secret,
      now + 60_000
    ),
    false
  );

  // Rejects expired link
  assert.equal(
    verifySignedAttachmentQuery(
      'att_12345',
      'usr_abcde',
      String(expires),
      sig,
      secret,
      now + 305_000
    ),
    false
  );
});

test('SlidingWindowRateLimiter enforces request limits and recovers after window expires', () => {
  const limiter = new SlidingWindowRateLimiter(10_000, 2);
  const t0 = 1_000_000;

  assert.equal(limiter.check('ip_1', t0).allowed, true);
  assert.equal(limiter.check('ip_1', t0 + 100).allowed, true);
  assert.equal(limiter.check('ip_1', t0 + 200).allowed, false);
  // After 10s window passes
  assert.equal(limiter.check('ip_1', t0 + 10_500).allowed, true);
});
