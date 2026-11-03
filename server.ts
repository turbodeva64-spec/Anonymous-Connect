import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { z } from 'zod';
import * as dotenv from 'dotenv';

import {
  MAX_ATTACHMENT_SIZE_BYTES,
  SESSION_DURATION_MS,
  SlidingWindowRateLimiter,
  hashToken,
  validateFileAttachment,
  verifySignedAttachmentQuery,
} from './src/utils/security.ts';
import {
  acceptChatRequest,
  blockGuestUser,
  cancelChatRequest,
  createChatRequest,
  createMessage,
  declineChatRequest,
  deleteMessageByPublicId,
  getActiveGuestByPublicId,
  getAuthorizedAttachment,
  getConversationDetail,
  getConversationMessages,
  getGuestSessionByRawToken,
  getIncomingRequests,
  getOutgoingRequests,
  getSecurityAuditOverview,
  getUserConversations,
  initializeGuestSession,
  listBlockedUsers,
  listOnlineDiscoverableUsers,
  markConversationMessagesRead,
  markMessageReadByIdOrConversation,
  revokeGuestSession,
  saveAttachmentRecord,
  searchDiscoverableUsers,
  setGuestOnlineState,
  submitUserReport,
  toggleMessageReaction,
  unblockGuestUser,
  updateGuestProfile,
} from './src/db/repository.ts';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';

dotenv.config();

const PORT = 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_NAME = 'ac_guest_session';
const PRIVATE_STORAGE_DIR = '/tmp/anonymous-connect-storage';
const ATTACHMENT_SIGNING_SECRET =
  process.env.SESSION_SECRET ||
  hashToken(`anonymous-connect-signing-key-${process.env.SQL_DB_NAME || 'dev'}`);

// Ensure private storage directory exists with restricted permissions
fs.mkdir(PRIVATE_STORAGE_DIR, { recursive: true, mode: 0o700 }).catch((err) => {
  console.error('Failed to initialize private storage directory:', err);
});

// Rate limiters per security requirement #8
const sessionLimiter = new SlidingWindowRateLimiter(60_000, 25);
const searchLimiter = new SlidingWindowRateLimiter(60_000, 60);
const requestLimiter = new SlidingWindowRateLimiter(60_000, 25);
const messageLimiter = new SlidingWindowRateLimiter(60_000, 90);
const uploadLimiter = new SlidingWindowRateLimiter(60_000, 15);
const reportLimiter = new SlidingWindowRateLimiter(60_000, 10);
const socketEventLimiter = new SlidingWindowRateLimiter(10_000, 40);

function getClientIpHash(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp =
    (typeof forwarded === 'string' ? forwarded.split(',')[0] : '') ||
    req.socket.remoteAddress ||
    'unknown';
  return hashToken(rawIp).slice(0, 24);
}

function createRateLimitMiddleware(limiter: SlidingWindowRateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = getClientIpHash(req);
    const result = limiter.check(key);
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil(result.resetInMs / 1000))
      );
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
      });
    }
    next();
  };
}

interface GuestAuthenticatedRequest extends Request {
  guestUser?: Awaited<ReturnType<typeof getGuestSessionByRawToken>> extends
    | infer R
    | null
    ? R extends { user: infer U }
      ? U
      : never
    : never;
  guestSession?: Awaited<ReturnType<typeof getGuestSessionByRawToken>> extends
    | infer R
    | null
    ? R extends { session: infer S }
      ? S
      : never
    : never;
  rawSessionToken?: string;
}

function extractRawSessionToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[COOKIE_NAME];
  const fromHeader = req.headers['x-guest-session'];
  if (typeof fromHeader === 'string' && fromHeader.length >= 32) {
    return fromHeader;
  }
  if (typeof fromCookie === 'string' && fromCookie.length >= 32) {
    return fromCookie;
  }
  return undefined;
}

async function requireGuestSession(
  req: GuestAuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const rawToken = extractRawSessionToken(req);
    if (!rawToken) {
      return res.status(401).json({
        error: 'Valid guest session required. Please initialize your session.',
      });
    }

    const sessionData = await getGuestSessionByRawToken(rawToken);
    if (!sessionData) {
      res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PROD,
      });
      return res.status(401).json({
        error: 'Your temporary guest session has expired or been revoked.',
      });
    }

    // Strict CSRF validation on state-changing requests:
    // Required whenever authenticating via browser cookie (no X-Guest-Session header)
    // or whenever X-CSRF-Token header is provided.
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      const hasExplicitSessionHeader =
        typeof req.headers['x-guest-session'] === 'string' &&
        req.headers['x-guest-session'].length >= 32;

      if (!hasExplicitSessionHeader) {
        if (
          typeof csrfHeader !== 'string' ||
          csrfHeader !== sessionData.session.csrfToken
        ) {
          return res.status(403).json({
            error: 'Invalid or missing CSRF security token.',
          });
        }
      } else if (
        typeof csrfHeader === 'string' &&
        csrfHeader.length > 0 &&
        csrfHeader !== sessionData.session.csrfToken
      ) {
        return res.status(403).json({
          error: 'Invalid CSRF security token.',
        });
      }
    }

    req.guestUser = sessionData.user;
    req.guestSession = sessionData.session;
    req.rawSessionToken = rawToken;
    next();
  } catch (error) {
    console.error('Guest authentication middleware error:', error);
    return res.status(500).json({
      error: 'Unable to verify guest session at this time.',
    });
  }
}

function parseCookiesFromHeader(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = decodeURIComponent(pair.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

// Validation Schemas (Zod)
const ProfileUpdateSchema = z
  .object({
    displayName: z.string().min(2).max(32).optional(),
    isDiscoverable: z.boolean().optional(),
  })
  .strict();

const DiscoverabilitySchema = z
  .object({
    isDiscoverable: z.boolean(),
  })
  .strict();

const CreateRequestSchema = z
  .object({
    targetUser: z.string().min(3).max(64),
    introMessage: z.string().max(240).optional(),
  })
  .strict();

const SendMessageSchema = z
  .object({
    conversationId: z.string().min(5).max(64),
    clientMessageId: z.string().min(5).max(80),
    content: z.string().max(2000).optional().default(''),
    attachmentIds: z.array(z.string().min(5).max(64)).max(5).optional(),
  })
  .strict();

const ReactionSchema = z
  .object({
    emoji: z.string().min(1).max(8),
  })
  .strict();

const BlockUserSchema = z
  .object({
    reason: z.string().max(200).optional(),
  })
  .strict();

const ReportUserSchema = z
  .object({
    reportedUser: z.string().min(3).max(64),
    conversationId: z.string().max(64).optional(),
    category: z.enum([
      'harassment',
      'spam',
      'malicious_file',
      'impersonation',
      'other',
    ]),
    description: z.string().min(5).max(1000),
  })
  .strict();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE_BYTES,
    files: 1,
  },
});

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);

  app.disable('x-powered-by');

  // 11. Security Headers (Helmet)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://apis.google.com'],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
          frameAncestors: ["'self'", 'https://*.google.com', 'https://*.run.app'],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // 10. CORS Security
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const allowed =
          origin.includes('localhost:3000') ||
          origin.endsWith('.run.app') ||
          origin.endsWith('.google.com') ||
          (process.env.APP_URL && origin === process.env.APP_URL);
        if (allowed || !IS_PROD) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRF-Token',
        'X-Guest-Session',
      ],
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '512kb' }));

  // 14. Exposed File Protection Middleware
  app.use((req, res, next) => {
    const lowerPath = req.path.toLowerCase();
    if (
      lowerPath.includes('..') ||
      lowerPath.startsWith('/.env') ||
      lowerPath.startsWith('/.git') ||
      lowerPath.includes('drizzle.config') ||
      lowerPath.endsWith('.sql') ||
      lowerPath.endsWith('.bak') ||
      lowerPath.endsWith('.map')
    ) {
      return res.status(403).json({ error: 'Access to internal files is forbidden.' });
    }
    next();
  });

  // 18. Socket.IO Real-Time Server with Session Authentication & Room Authorization
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
    maxHttpBufferSize: 256 * 1024, // 256 KB max socket payload
  });

  // Track active sockets per guest publicId (supports multi-tab sessions)
  const activeGuestSockets = new Map<string, Set<string>>();

  io.use(async (socket, next) => {
    try {
      const cookies = parseCookiesFromHeader(socket.handshake.headers.cookie);
      const tokenFromAuth = socket.handshake.auth?.sessionToken;
      const rawToken =
        typeof tokenFromAuth === 'string' && tokenFromAuth.length >= 32
          ? tokenFromAuth
          : cookies[COOKIE_NAME];

      if (!rawToken) {
        return next(new Error('Authentication error: Missing guest session.'));
      }

      const sessionData = await getGuestSessionByRawToken(rawToken);
      if (!sessionData) {
        return next(
          new Error('Authentication error: Invalid or expired guest session.')
        );
      }

      socket.data.guestId = sessionData.user.id;
      socket.data.publicId = sessionData.user.publicId;
      socket.data.username = sessionData.user.username;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const guestId: number = socket.data.guestId;
    const publicId: string = socket.data.publicId;

    // Join personal private notification room
    socket.join(`user:${publicId}`);

    if (!activeGuestSockets.has(publicId)) {
      activeGuestSockets.set(publicId, new Set());
    }
    activeGuestSockets.get(publicId)!.add(socket.id);

    // Mark user online and broadcast status update
    const updatedProfile = await setGuestOnlineState(guestId, true);
    if (updatedProfile && updatedProfile.isDiscoverable) {
      io.emit('user:presence', {
        publicId: updatedProfile.publicId,
        username: updatedProfile.username,
        displayName: updatedProfile.displayName,
        isOnline: true,
        lastSeenAt: updatedProfile.lastSeenAt,
      });
    }

    // Join authorized conversation room
    socket.on(
      'conversation:join',
      async (
        payload: { conversationId?: string },
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        try {
          if (!socketEventLimiter.check(`${publicId}:join`).allowed) {
            return ack?.({ ok: false, error: 'Rate limit exceeded.' });
          }
          const convId = payload?.conversationId;
          if (!convId || typeof convId !== 'string') {
            return ack?.({ ok: false, error: 'Invalid conversation ID.' });
          }
          await getConversationDetail(
            guestId,
            publicId,
            convId,
            ATTACHMENT_SIGNING_SECRET
          );
          socket.join(`conv:${convId}`);
          ack?.({ ok: true });
        } catch (err: any) {
          ack?.({ ok: false, error: err.message || 'Unauthorized room access.' });
        }
      }
    );

    socket.on('conversation:leave', (payload: { conversationId?: string }) => {
      if (payload?.conversationId && typeof payload.conversationId === 'string') {
        socket.leave(`conv:${payload.conversationId}`);
      }
    });

    // Typing indicators
    socket.on(
      'typing:update',
      async (payload: { conversationId?: string; isTyping?: boolean }) => {
        try {
          if (!socketEventLimiter.check(`${publicId}:typing`).allowed) return;
          const convId = payload?.conversationId;
          if (!convId || typeof convId !== 'string') return;

          const detail = await getConversationDetail(
            guestId,
            publicId,
            convId,
            ATTACHMENT_SIGNING_SECRET
          );
          if (detail.isPeerBlocked || detail.hasBlockedMe) return;

          socket.to(`user:${detail.peer.publicId}`).emit('typing:indicator', {
            conversationId: convId,
            userPublicId: publicId,
            username: socket.data.username,
            isTyping: Boolean(payload.isTyping),
          });
        } catch {
          // Ignore unauthorized typing events
        }
      }
    );

    // Real-time message sending via Socket with acknowledgement & DB persistence
    socket.on(
      'message:send',
      async (
        payload: unknown,
        ack?: (res: { ok: boolean; message?: any; error?: string }) => void
      ) => {
        try {
          if (!messageLimiter.check(`msg:${publicId}`).allowed) {
            return ack?.({
              ok: false,
              error: 'Message rate limit exceeded. Please slow down.',
            });
          }
          const parsed = SendMessageSchema.safeParse(payload);
          if (!parsed.success) {
            return ack?.({ ok: false, error: 'Invalid message payload.' });
          }

          const result = await createMessage({
            senderId: guestId,
            senderPublicId: publicId,
            conversationPublicId: parsed.data.conversationId,
            clientMessageId: parsed.data.clientMessageId,
            content: parsed.data.content,
            attachmentPublicIds: parsed.data.attachmentIds,
            attachmentSecret: ATTACHMENT_SIGNING_SECRET,
          });

          if (!result.isDuplicate) {
            // Re-hydrate for peer so peer gets their own signed download URL
            const [peerMessages] = await Promise.all([
              getConversationMessages(
                result.peerId,
                result.peerPublicId,
                parsed.data.conversationId,
                ATTACHMENT_SIGNING_SECRET,
                1
              ),
            ]);
            const msgForPeer = peerMessages[0] || result.message;

            io.to(`user:${result.peerPublicId}`).emit('message:new', msgForPeer);
            io.to(`user:${publicId}`).emit('message:new', result.message);
          }

          ack?.({ ok: true, message: result.message });
        } catch (error: any) {
          ack?.({
            ok: false,
            error: error.message || 'Failed to send message.',
          });
        }
      }
    );

    // Real-time read receipt acknowledgement
    socket.on(
      'message:mark-read',
      async (payload: { conversationId?: string }) => {
        try {
          const convId = payload?.conversationId;
          if (!convId || typeof convId !== 'string') return;
          const readResult = await markConversationMessagesRead(guestId, convId);
          if (readResult.readMessagePublicIds.length > 0) {
            io.to(`user:${readResult.peerPublicId}`).emit('message:read', {
              conversationId: convId,
              messageIds: readResult.readMessagePublicIds,
              readAt: readResult.readAt,
            });
          }
        } catch {
          // Ignore invalid read receipts
        }
      }
    );

    socket.on('disconnect', async () => {
      const set = activeGuestSockets.get(publicId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          activeGuestSockets.delete(publicId);
          const updated = await setGuestOnlineState(guestId, false);
          if (updated && updated.isDiscoverable) {
            io.emit('user:presence', {
              publicId: updated.publicId,
              username: updated.username,
              displayName: updated.displayName,
              isOnline: false,
              lastSeenAt: updated.lastSeenAt,
            });
          }
        }
      }
    });
  });

  // ============================================================================
  // REST API ENDPOINTS
  // ============================================================================

  // 1. GUEST IDENTITY & SESSION ENDPOINTS
  app.post(
    '/api/guest/initialize',
    createRateLimitMiddleware(sessionLimiter),
    async (req: Request, res: Response) => {
      try {
        const existingRawToken = extractRawSessionToken(req);
        const forceNew = Boolean(req.body?.forceNew);
        const isolatedMode = Boolean(req.body?.isolatedMode);
        const isHttps =
          req.secure ||
          req.headers['x-forwarded-proto'] === 'https' ||
          IS_PROD;

        if (forceNew && existingRawToken && !isolatedMode) {
          const prevSession = await getGuestSessionByRawToken(existingRawToken);
          if (prevSession) {
            const oldPubId = prevSession.user.publicId;
            const oldSockets = activeGuestSockets.get(oldPubId);
            if (oldSockets) {
              for (const sid of oldSockets) {
                io.sockets.sockets.get(sid)?.disconnect(true);
              }
              activeGuestSockets.delete(oldPubId);
            }
            io.emit('user:presence', {
              publicId: prevSession.user.publicId,
              username: prevSession.user.username,
              displayName: prevSession.user.displayName,
              isOnline: false,
              lastSeenAt: new Date().toISOString(),
            });
          }
        }

        const result = await initializeGuestSession({
          existingRawToken: isolatedMode ? undefined : existingRawToken,
          userAgent: req.headers['user-agent'] || 'unknown',
          ipHash: getClientIpHash(req),
          forceNew,
        });

        if (!isolatedMode) {
          res.cookie(COOKIE_NAME, result.rawToken, {
            httpOnly: true,
            secure: isHttps,
            sameSite: isHttps ? 'none' : 'lax',
            maxAge: SESSION_DURATION_MS,
            path: '/',
          });
        }

        res.status(result.isNew ? 201 : 200).json({
          user: result.user,
          csrfToken: result.csrfToken,
          sessionExpiresAt: result.sessionExpiresAt,
          isNew: result.isNew,
          sessionToken: result.rawToken,
          ...(isolatedMode ? { isolatedSessionHeader: result.rawToken } : {}),
        });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to initialize guest session.',
        });
      }
    }
  );

  app.get(
    '/api/guest/me',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const user = req.guestUser!;
        const session = req.guestSession!;
        res.json({
          user: {
            publicId: user.publicId,
            username: user.username,
            displayName: user.displayName,
            isDiscoverable: user.isDiscoverable,
            isOnline: user.isOnline,
            lastSeenAt: user.lastSeenAt.toISOString(),
            expiresAt: user.expiresAt.toISOString(),
            createdAt: user.createdAt.toISOString(),
          },
          csrfToken: session.csrfToken,
          sessionExpiresAt: session.expiresAt.toISOString(),
        });
      } catch (error: any) {
        res.status(500).json({ error: 'Failed to retrieve guest identity.' });
      }
    }
  );

  app.patch(
    '/api/guest/profile',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = ProfileUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error:
              parsed.error.issues[0]?.message || 'Invalid profile update data.',
          });
        }

        const updated = await updateGuestProfile(req.guestUser!.id, parsed.data);
        io.emit('user:updated', updated);
        io.emit('user:presence', {
          publicId: updated.publicId,
          username: updated.username,
          displayName: updated.displayName,
          isOnline: Boolean(updated.isOnline && updated.isDiscoverable),
          lastSeenAt: updated.lastSeenAt,
        });
        res.json({ user: updated });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to update guest profile.',
        });
      }
    }
  );

  app.post(
    '/api/guest/end-session',
    async (req: Request, res: Response) => {
      try {
        const rawToken = extractRawSessionToken(req);
        const isHttps =
          req.secure ||
          req.headers['x-forwarded-proto'] === 'https' ||
          IS_PROD;

        if (rawToken) {
          const sessionData = await getGuestSessionByRawToken(rawToken);
          if (sessionData) {
            const publicId = sessionData.user.publicId;
            await revokeGuestSession(sessionData.user.id, rawToken);

            const socketIds = activeGuestSockets.get(publicId);
            if (socketIds) {
              for (const sid of socketIds) {
                io.sockets.sockets.get(sid)?.disconnect(true);
              }
              activeGuestSockets.delete(publicId);
            }
          }
        }

        res.clearCookie(COOKIE_NAME, {
          httpOnly: true,
          secure: isHttps,
          sameSite: isHttps ? 'none' : 'lax',
          path: '/',
        });

        res.json({ ok: true, message: 'Guest session terminated and revoked.' });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to end session.',
        });
      }
    }
  );

  // 2. USER DISCOVERY ENDPOINTS
  app.get(
    '/api/users/search',
    requireGuestSession,
    createRateLimitMiddleware(searchLimiter),
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const q = typeof req.query.q === 'string' ? req.query.q : '';
        const users = await searchDiscoverableUsers(req.guestUser!.id, q);
        res.json({ users });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to search users.',
        });
      }
    }
  );

  app.get(
    '/api/users/online',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const users = await listOnlineDiscoverableUsers(req.guestUser!.id);
        res.json({ users });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to fetch online users.',
        });
      }
    }
  );

  app.patch(
    '/api/users/discoverability',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = DiscoverabilitySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid discoverability flag.' });
        }
        const updated = await updateGuestProfile(req.guestUser!.id, {
          isDiscoverable: parsed.data.isDiscoverable,
        });
        io.emit('user:updated', updated);
        io.emit('user:presence', {
          publicId: updated.publicId,
          username: updated.username,
          displayName: updated.displayName,
          isOnline: Boolean(updated.isOnline && updated.isDiscoverable),
          lastSeenAt: updated.lastSeenAt,
        });
        res.json({ user: updated });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to update discoverability.',
        });
      }
    }
  );

  // 3. CHAT REQUEST ENDPOINTS
  app.post(
    '/api/requests',
    requireGuestSession,
    createRateLimitMiddleware(requestLimiter),
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = CreateRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error:
              parsed.error.issues[0]?.message || 'Invalid chat request payload.',
          });
        }

        const created = await createChatRequest(
          req.guestUser!.id,
          parsed.data.targetUser,
          parsed.data.introMessage
        );

        // Notify recipient in real-time via Socket.IO
        io.to(`user:${created.receiver.publicId}`).emit(
          'request:incoming',
          created
        );

        res.status(201).json({ request: created });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Could not send chat request.',
        });
      }
    }
  );

  app.get(
    '/api/requests/incoming',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const requests = await getIncomingRequests(req.guestUser!.id);
        res.json({ requests });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to load incoming requests.',
        });
      }
    }
  );

  app.get(
    '/api/requests/outgoing',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const requests = await getOutgoingRequests(req.guestUser!.id);
        res.json({ requests });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to load outgoing requests.',
        });
      }
    }
  );

  app.post(
    '/api/requests/:id/accept',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const result = await acceptChatRequest(
          req.guestUser!.id,
          req.params.id
        );

        // Notify both sender and receiver in real-time
        io.to(`user:${result.request.sender.publicId}`).emit(
          'request:accepted',
          result
        );
        io.to(`user:${result.request.receiver.publicId}`).emit(
          'request:accepted',
          result
        );

        res.json(result);
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to accept chat request.',
        });
      }
    }
  );

  app.post(
    '/api/requests/:id/decline',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const updated = await declineChatRequest(
          req.guestUser!.id,
          req.params.id
        );
        io.to(`user:${updated.sender.publicId}`).emit(
          'request:declined',
          updated
        );
        res.json({ request: updated });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to decline chat request.',
        });
      }
    }
  );

  app.delete(
    '/api/requests/:id',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const updated = await cancelChatRequest(
          req.guestUser!.id,
          req.params.id
        );
        io.to(`user:${updated.receiver.publicId}`).emit(
          'request:cancelled',
          updated
        );
        res.json({ request: updated });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to cancel chat request.',
        });
      }
    }
  );

  // 4. CONVERSATIONS ENDPOINTS
  app.get(
    '/api/conversations',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const conversations = await getUserConversations(
          req.guestUser!.id,
          req.guestUser!.publicId,
          ATTACHMENT_SIGNING_SECRET
        );
        res.json({ conversations });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to load conversations.',
        });
      }
    }
  );

  app.get(
    '/api/conversations/:id',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const conversation = await getConversationDetail(
          req.guestUser!.id,
          req.guestUser!.publicId,
          req.params.id,
          ATTACHMENT_SIGNING_SECRET
        );
        res.json({ conversation });
      } catch (error: any) {
        const status = error.message?.includes('Forbidden') ? 403 : 404;
        res.status(status).json({
          error: error.message || 'Conversation not found.',
        });
      }
    }
  );

  app.get(
    '/api/conversations/:id/messages',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const limit = Number(req.query.limit) || 60;
        const messagesList = await getConversationMessages(
          req.guestUser!.id,
          req.guestUser!.publicId,
          req.params.id,
          ATTACHMENT_SIGNING_SECRET,
          limit
        );
        res.json({ messages: messagesList });
      } catch (error: any) {
        const status = error.message?.includes('Forbidden') ? 403 : 404;
        res.status(status).json({
          error: error.message || 'Failed to load messages.',
        });
      }
    }
  );

  // 5. MESSAGES ENDPOINTS
  app.post(
    '/api/messages',
    requireGuestSession,
    createRateLimitMiddleware(messageLimiter),
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = SendMessageSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error:
              parsed.error.issues[0]?.message || 'Invalid message payload.',
          });
        }

        const result = await createMessage({
          senderId: req.guestUser!.id,
          senderPublicId: req.guestUser!.publicId,
          conversationPublicId: parsed.data.conversationId,
          clientMessageId: parsed.data.clientMessageId,
          content: parsed.data.content,
          attachmentPublicIds: parsed.data.attachmentIds,
          attachmentSecret: ATTACHMENT_SIGNING_SECRET,
        });

        if (!result.isDuplicate) {
          const peerMessages = await getConversationMessages(
            result.peerId,
            result.peerPublicId,
            parsed.data.conversationId,
            ATTACHMENT_SIGNING_SECRET,
            1
          );
          const msgForPeer = peerMessages[0] || result.message;
          io.to(`user:${result.peerPublicId}`).emit('message:new', msgForPeer);
          io.to(`user:${req.guestUser!.publicId}`).emit(
            'message:new',
            result.message
          );
        }

        res.status(result.isDuplicate ? 200 : 201).json({
          message: result.message,
        });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to send message.',
        });
      }
    }
  );

  app.delete(
    '/api/messages/:id',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const deleted = await deleteMessageByPublicId(
          req.guestUser!.id,
          req.params.id
        );

        io.to(`user:${deleted.peerPublicId}`).emit('message:deleted', {
          messagePublicId: deleted.messagePublicId,
          conversationPublicId: deleted.conversationPublicId,
        });
        io.to(`user:${req.guestUser!.publicId}`).emit('message:deleted', {
          messagePublicId: deleted.messagePublicId,
          conversationPublicId: deleted.conversationPublicId,
        });

        res.json({ ok: true, ...deleted });
      } catch (error: any) {
        const status = error.message?.includes('Forbidden') ? 403 : 400;
        res.status(status).json({
          error: error.message || 'Failed to delete message.',
        });
      }
    }
  );

  app.post(
    '/api/messages/:id/read',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const readResult = await markMessageReadByIdOrConversation(
          req.guestUser!.id,
          req.params.id
        );
        if (readResult.readMessagePublicIds.length > 0) {
          io.to(`user:${readResult.peerPublicId}`).emit('message:read', {
            conversationId: readResult.conversationPublicId,
            messageIds: readResult.readMessagePublicIds,
            readAt: readResult.readAt,
          });
        }
        res.json({ ok: true, ...readResult });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to mark messages as read.',
        });
      }
    }
  );

  app.post(
    '/api/messages/:id/reactions',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = ReactionSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid reaction emoji.' });
        }

        const result = await toggleMessageReaction(
          req.guestUser!.id,
          req.guestUser!.publicId,
          req.params.id,
          parsed.data.emoji,
          ATTACHMENT_SIGNING_SECRET
        );

        io.to(`user:${result.peerPublicId}`).emit('message:reaction', {
          conversationPublicId: result.message.conversationPublicId,
          messagePublicId: result.message.publicId,
          reactions: result.message.reactions,
        });
        io.to(`user:${req.guestUser!.publicId}`).emit('message:reaction', {
          conversationPublicId: result.message.conversationPublicId,
          messagePublicId: result.message.publicId,
          reactions: result.message.reactions,
        });

        res.json({ message: result.message });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to toggle message reaction.',
        });
      }
    }
  );

  // 6. FILE & MEDIA ATTACHMENT ENDPOINTS
  app.post(
    '/api/attachments/upload',
    requireGuestSession,
    createRateLimitMiddleware(uploadLimiter),
    upload.single('file'),
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const file = req.file;
        const conversationId = req.body?.conversationId;

        if (!file) {
          return res.status(400).json({ error: 'No file uploaded.' });
        }
        if (!conversationId || typeof conversationId !== 'string') {
          return res
            .status(400)
            .json({ error: 'conversationId is required for attachment upload.' });
        }

        const validation = validateFileAttachment(
          file.buffer,
          file.originalname,
          file.mimetype
        );

        if (!validation.valid) {
          return res.status(400).json({
            error: validation.error || 'File failed security validation.',
          });
        }

        // Write encrypted/isolated copy to private storage directory with random storageName
        const privateFilePath = path.join(
          PRIVATE_STORAGE_DIR,
          validation.storageName!
        );
        await fs.writeFile(privateFilePath, file.buffer, { mode: 0o600 });

        const metadata = await saveAttachmentRecord({
          uploaderId: req.guestUser!.id,
          uploaderPublicId: req.guestUser!.publicId,
          conversationPublicId: conversationId,
          originalName: file.originalname,
          storageName: validation.storageName!,
          mimeType: file.mimetype.toLowerCase(),
          extension: validation.extension!,
          sizeBytes: file.size,
          category: validation.category!,
          dataBase64: file.buffer.toString('base64'),
          sha256Checksum: validation.sha256Checksum!,
          attachmentSecret: ATTACHMENT_SIGNING_SECRET,
        });

        res.status(201).json({ attachment: metadata });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Attachment upload failed.',
        });
      }
    }
  );

  app.get(
    '/api/attachments/:id',
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const expires = String(req.query.expires || '');
        const sig = String(req.query.sig || '');
        const viewerParam =
          typeof req.query.viewer === 'string' ? req.query.viewer : '';
        const attachmentPublicId = req.params.id;

        // 1. Check if an explicit X-Guest-Session header was provided
        const headerToken =
          typeof req.headers['x-guest-session'] === 'string' &&
          req.headers['x-guest-session'].length >= 32
            ? req.headers['x-guest-session']
            : undefined;
        const cookieToken =
          typeof req.cookies?.[COOKIE_NAME] === 'string' &&
          req.cookies[COOKIE_NAME].length >= 32
            ? req.cookies[COOKIE_NAME]
            : undefined;

        let resolvedGuestId: number | null = null;
        let resolvedPublicId: string | null = null;

        if (headerToken) {
          const sessionData = await getGuestSessionByRawToken(headerToken);
          if (!sessionData) {
            return res.status(401).json({
              error: 'Your temporary guest session has expired or been revoked.',
            });
          }
          resolvedGuestId = sessionData.user.id;
          resolvedPublicId = sessionData.user.publicId;
        } else if (cookieToken) {
          const sessionData = await getGuestSessionByRawToken(cookieToken);
          if (
            sessionData &&
            (!viewerParam || sessionData.user.publicId === viewerParam)
          ) {
            resolvedGuestId = sessionData.user.id;
            resolvedPublicId = sessionData.user.publicId;
          }
        }

        // 2. Fallback for native <img>, <video>, <audio>, <a download> in cookie-blocked iframes or isolated tabs
        if (!resolvedGuestId && viewerParam) {
          const activeViewer = await getActiveGuestByPublicId(viewerParam);
          if (activeViewer) {
            resolvedGuestId = activeViewer.id;
            resolvedPublicId = activeViewer.publicId;
          }
        }

        if (!resolvedGuestId || !resolvedPublicId) {
          return res.status(401).json({
            error: 'Valid guest session required to access attachment.',
          });
        }

        const isSigValid = verifySignedAttachmentQuery(
          attachmentPublicId,
          resolvedPublicId,
          expires,
          sig,
          ATTACHMENT_SIGNING_SECRET
        );

        if (!isSigValid) {
          return res.status(403).json({
            error: 'Signed download URL is invalid or has expired.',
          });
        }

        const att = await getAuthorizedAttachment(
          resolvedGuestId,
          attachmentPublicId
        );

        let fileBuffer: Buffer;
        const diskPath = path.join(PRIVATE_STORAGE_DIR, att.storageName);
        try {
          fileBuffer = await fs.readFile(diskPath);
        } catch {
          fileBuffer = Buffer.from(att.dataBase64, 'base64');
        }

        res.setHeader('Content-Type', att.mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=300');
        const safeFilename = att.originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const dispositionType =
          att.category === 'image' ||
          att.category === 'video' ||
          att.category === 'audio' ||
          att.extension === '.pdf'
            ? 'inline'
            : 'attachment';
        res.setHeader(
          'Content-Disposition',
          `${dispositionType}; filename="${safeFilename}"`
        );
        res.send(fileBuffer);
      } catch (error: any) {
        const status = error.message?.includes('Forbidden') ? 403 : 404;
        res.status(status).json({
          error: error.message || 'Unable to retrieve attachment.',
        });
      }
    }
  );

  // 7. SAFETY, BLOCKING & REPORTING ENDPOINTS
  app.get(
    '/api/users/blocked',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const blocked = await listBlockedUsers(req.guestUser!.id);
        res.json({ blockedUsers: blocked });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to load blocked users.',
        });
      }
    }
  );

  app.post(
    '/api/users/:id/block',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = BlockUserSchema.safeParse(req.body || {});
        const reason = parsed.success ? parsed.data.reason : undefined;
        const blocked = await blockGuestUser(
          req.guestUser!.id,
          req.params.id,
          reason
        );
        io.to(`user:${blocked.publicId}`).emit('user:block-changed', {
          blockerPublicId: req.guestUser!.publicId,
          blockedPublicId: blocked.publicId,
          isBlocked: true,
        });
        io.to(`user:${req.guestUser!.publicId}`).emit('user:block-changed', {
          blockerPublicId: req.guestUser!.publicId,
          blockedPublicId: blocked.publicId,
          isBlocked: true,
        });
        res.status(201).json({ blockedUser: blocked });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to block user.',
        });
      }
    }
  );

  app.delete(
    '/api/users/:id/block',
    requireGuestSession,
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        await unblockGuestUser(req.guestUser!.id, req.params.id);
        io.emit('user:block-changed', {
          blockerPublicId: req.guestUser!.publicId,
          targetIdentifier: req.params.id,
          isBlocked: false,
        });
        res.json({ ok: true });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to unblock user.',
        });
      }
    }
  );

  app.post(
    '/api/reports',
    requireGuestSession,
    createRateLimitMiddleware(reportLimiter),
    async (req: GuestAuthenticatedRequest, res: Response) => {
      try {
        const parsed = ReportUserSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error:
              parsed.error.issues[0]?.message || 'Invalid report submission.',
          });
        }

        const report = await submitUserReport({
          reporterId: req.guestUser!.id,
          targetIdentifier: parsed.data.reportedUser,
          conversationPublicId: parsed.data.conversationId,
          category: parsed.data.category,
          description: parsed.data.description,
        });

        res.status(201).json({ report });
      } catch (error: any) {
        res.status(400).json({
          error: error.message || 'Failed to submit report.',
        });
      }
    }
  );

  // 8. PROTECTED ADMIN SECURITY OPERATIONS (Protected via Firebase ID Token Verification)
  app.get(
    '/api/admin/audit',
    requireAuth,
    async (_req: AuthRequest, res: Response) => {
      try {
        const summary = await getSecurityAuditOverview();
        res.json({ audit: summary });
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Failed to load administrative security audit.',
        });
      }
    }
  );

  // Vite Dev Server or Production Static Serving
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler — hides stack traces in production (Requirement #12)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        error: `Upload error: ${err.message}`,
      });
    }
    console.error('Unhandled server error:', err?.message || err);
    res.status(500).json({
      error: 'An unexpected server error occurred.',
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Anonymous Connect server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
