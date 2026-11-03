import crypto from 'node:crypto';
import path from 'node:path';

export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export type AttachmentCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'spreadsheet';

interface AllowedFileSpec {
  category: AttachmentCategory;
  mimes: string[];
  checkMagicBytes: (buf: Buffer) => boolean;
}

const isPrintableCsv = (buf: Buffer): boolean => {
  if (buf.length === 0) return false;
  // Reject Windows PE ('MZ') or Linux ELF ('\x7fELF') or script tags
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return false;
  if (
    buf.length >= 4 &&
    buf[0] === 0x7f &&
    buf[1] === 0x45 &&
    buf[2] === 0x4c &&
    buf[3] === 0x46
  ) {
    return false;
  }
  const sample = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8');
  if (/<script\b|javascript:/i.test(sample)) return false;
  // Reject null bytes in CSV
  for (let i = 0; i < Math.min(buf.length, 4096); i++) {
    if (buf[i] === 0x00) return false;
  }
  return true;
};

export const ALLOWED_FILE_SPECS: Record<string, AllowedFileSpec> = {
  '.jpg': {
    category: 'image',
    mimes: ['image/jpeg', 'image/jpg'],
    checkMagicBytes: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  '.jpeg': {
    category: 'image',
    mimes: ['image/jpeg', 'image/jpg'],
    checkMagicBytes: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  '.png': {
    category: 'image',
    mimes: ['image/png'],
    checkMagicBytes: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  '.webp': {
    category: 'image',
    mimes: ['image/webp'],
    checkMagicBytes: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  '.mp4': {
    category: 'video',
    mimes: ['video/mp4', 'application/mp4'],
    checkMagicBytes: (b) =>
      b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  '.webm': {
    category: 'video',
    mimes: ['video/webm', 'audio/webm'],
    checkMagicBytes: (b) =>
      b.length >= 4 &&
      b[0] === 0x1a &&
      b[1] === 0x45 &&
      b[2] === 0xdf &&
      b[3] === 0xa3,
  },
  '.mp3': {
    category: 'audio',
    mimes: ['audio/mpeg', 'audio/mp3'],
    checkMagicBytes: (b) =>
      b.length >= 3 &&
      ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || // ID3
        (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)), // MPEG sync
  },
  '.wav': {
    category: 'audio',
    mimes: ['audio/wav', 'audio/wave', 'audio/x-wav'],
    checkMagicBytes: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WAVE',
  },
  '.m4a': {
    category: 'audio',
    mimes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
    checkMagicBytes: (b) =>
      b.length >= 12 && b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  '.pdf': {
    category: 'document',
    mimes: ['application/pdf'],
    checkMagicBytes: (b) =>
      b.length >= 4 && b.subarray(0, 4).toString('ascii') === '%PDF',
  },
  '.doc': {
    category: 'document',
    mimes: ['application/msword'],
    checkMagicBytes: (b) =>
      b.length >= 8 &&
      b[0] === 0xd0 &&
      b[1] === 0xcf &&
      b[2] === 0x11 &&
      b[3] === 0xe0,
  },
  '.docx': {
    category: 'document',
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    checkMagicBytes: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 &&
      b[1] === 0x4b &&
      b[2] === 0x03 &&
      b[3] === 0x04,
  },
  '.xls': {
    category: 'spreadsheet',
    mimes: ['application/vnd.ms-excel'],
    checkMagicBytes: (b) =>
      b.length >= 8 &&
      b[0] === 0xd0 &&
      b[1] === 0xcf &&
      b[2] === 0x11 &&
      b[3] === 0xe0,
  },
  '.xlsx': {
    category: 'spreadsheet',
    mimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    checkMagicBytes: (b) =>
      b.length >= 4 &&
      b[0] === 0x50 &&
      b[1] === 0x4b &&
      b[2] === 0x03 &&
      b[3] === 0x04,
  },
  '.csv': {
    category: 'spreadsheet',
    mimes: ['text/csv', 'application/csv', 'text/plain'],
    checkMagicBytes: isPrintableCsv,
  },
};

const FORBIDDEN_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.sh',
  '.bash',
  '.bat',
  '.cmd',
  '.ps1',
  '.msi',
  '.com',
  '.scr',
  '.vbs',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.php',
  '.py',
  '.rb',
  '.pl',
  '.jar',
  '.war',
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  '.xml',
  '.swf',
]);

export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generatePublicId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export function generateGuestUsername(): string {
  const num = crypto.randomInt(10000, 99999);
  return `Guest_${num}`;
}

export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeInputText(input: string, maxLength = 2000): string {
  if (typeof input !== 'string') return '';
  // Remove null bytes and non-printable control chars except newline/tab
  const cleaned = input
    .replace(/\0/g, '')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
  return cleaned.slice(0, maxLength);
}

export function validateUsernameFormat(username: string): boolean {
  return /^[A-Za-z0-9_]{3,24}$/.test(username);
}

export function validateDisplayNameFormat(displayName: string): boolean {
  if (typeof displayName !== 'string') return false;
  const trimmed = displayName.trim();
  if (trimmed.length < 2 || trimmed.length > 32) return false;
  if (/[<>\\/{}[\]`$]|javascript:|on\w+=/i.test(trimmed)) return false;
  return true;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  extension?: string;
  category?: AttachmentCategory;
  storageName?: string;
  sha256Checksum?: string;
}

export function validateFileAttachment(
  buffer: Buffer,
  originalName: string,
  declaredMimeType: string,
  maxBytes = MAX_ATTACHMENT_SIZE_BYTES
): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file is not allowed.' };
  }
  if (buffer.length > maxBytes) {
    return {
      valid: false,
      error: `File size exceeds maximum limit of ${Math.round(maxBytes / (1024 * 1024))}MB.`,
    };
  }

  const baseName = path.basename(originalName || '');
  if (!baseName || baseName.includes('\0') || baseName.startsWith('.')) {
    return { valid: false, error: 'Invalid file name.' };
  }

  // Reject dangerous double extensions like report.pdf.exe or image.svg.png
  const parts = baseName.toLowerCase().split('.');
  if (parts.length < 2) {
    return { valid: false, error: 'File must have a valid extension.' };
  }
  for (let i = 1; i < parts.length; i++) {
    const extPart = `.${parts[i]}`;
    if (FORBIDDEN_EXTENSIONS.has(extPart)) {
      return {
        valid: false,
        error: `Executable or script extension (${extPart}) is strictly prohibited.`,
      };
    }
  }

  const ext = `.${parts[parts.length - 1]}`;
  const spec = ALLOWED_FILE_SPECS[ext];
  if (!spec) {
    return {
      valid: false,
      error: `Unsupported file extension "${ext}".`,
    };
  }

  const normalizedMime = (declaredMimeType || '').toLowerCase().trim();
  if (!spec.mimes.includes(normalizedMime)) {
    return {
      valid: false,
      error: `MIME type "${normalizedMime}" does not match extension "${ext}".`,
    };
  }

  // Reject executable magic bytes globally (MZ / ELF / Shebang)
  if (
    (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) ||
    (buffer.length >= 4 &&
      buffer[0] === 0x7f &&
      buffer[1] === 0x45 &&
      buffer[2] === 0x4c &&
      buffer[3] === 0x46) ||
    (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21)
  ) {
    return {
      valid: false,
      error: 'Executable binary or script signature detected and rejected.',
    };
  }

  if (!spec.checkMagicBytes(buffer)) {
    return {
      valid: false,
      error: `File binary signature does not match declared ${ext.toUpperCase()} format.`,
    };
  }

  const randomStorageName = `att_${crypto.randomBytes(16).toString('hex')}${ext}`;
  const sha256Checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    valid: true,
    extension: ext,
    category: spec.category,
    storageName: randomStorageName,
    sha256Checksum,
  };
}

export function createSignedAttachmentQuery(
  attachmentPublicId: string,
  guestPublicId: string,
  secret: string,
  ttlSeconds = 300,
  nowMs = Date.now()
): { expires: number; sig: string } {
  const expires = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `${attachmentPublicId}:${guestPublicId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { expires, sig };
}

export function verifySignedAttachmentQuery(
  attachmentPublicId: string,
  guestPublicId: string,
  expiresStr: string,
  signature: string,
  secret: string,
  nowMs = Date.now()
): boolean {
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Math.floor(nowMs / 1000)) {
    return false;
  }
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const payload = `${attachmentPublicId}:${guestPublicId}:${expires}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  public check(key: string, now = Date.now()): {
    allowed: boolean;
    remaining: number;
    resetInMs: number;
  } {
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) || []).filter((t) => t > cutoff);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] || now;
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetInMs: Math.max(0, oldest + this.windowMs - now),
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      resetInMs: this.windowMs,
    };
  }

  public reset(key: string): void {
    this.hits.delete(key);
  }
}
