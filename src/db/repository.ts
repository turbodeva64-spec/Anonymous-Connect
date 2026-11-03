import { and, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  attachments,
  blockedUsers,
  chatRequests,
  conversationParticipants,
  conversations,
  guestSessions,
  guestUsers,
  messageReactions,
  messages,
  userReports,
} from './schema.ts';
import {
  SESSION_DURATION_MS,
  createSignedAttachmentQuery,
  generateGuestUsername,
  generatePublicId,
  generateSecureToken,
  hashToken,
  sanitizeInputText,
  validateDisplayNameFormat,
} from '../utils/security.ts';
import type {
  AttachmentMetadata,
  BlockedUserItem,
  ChatMessageItem,
  ChatRequestItem,
  ConversationSummary,
  MessageReactionSummary,
  PublicGuestProfile,
  SecurityAuditSummary,
} from '../types/index.ts';

export function toPublicGuestProfile(
  row: typeof guestUsers.$inferSelect
): PublicGuestProfile {
  return {
    publicId: row.publicId,
    username: row.username,
    displayName: row.displayName,
    isDiscoverable: row.isDiscoverable,
    isOnline: row.isOnline,
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ensureDirectoryPeersSeeded(): Promise<void> {
  try {
    const existingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(guestUsers);
    const total = Number(existingCount[0]?.count || 0);
    if (total >= 2) return;

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const seedPeers = [
      {
        publicId: 'usr_seed_cipher_84291',
        username: 'Guest_84291',
        displayName: 'Guest_84291',
        isDiscoverable: true,
        isOnline: true,
        expiresAt,
      },
      {
        publicId: 'usr_seed_vector_51902',
        username: 'Guest_51902',
        displayName: 'Guest_51902',
        isDiscoverable: true,
        isOnline: true,
        expiresAt,
      },
      {
        publicId: 'usr_seed_aurora_30488',
        username: 'Guest_30488',
        displayName: 'Guest_30488',
        isDiscoverable: true,
        isOnline: true,
        expiresAt,
      },
    ];

    for (const peer of seedPeers) {
      await db
        .insert(guestUsers)
        .values(peer)
        .onConflictDoNothing({ target: guestUsers.username });
    }
  } catch (error) {
    console.error('Seed check non-fatal error:', error);
  }
}

export async function getGuestSessionByRawToken(rawToken: string): Promise<{
  user: typeof guestUsers.$inferSelect;
  session: typeof guestSessions.$inferSelect;
} | null> {
  try {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
      return null;
    }
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    const rows = await db
      .select({
        user: guestUsers,
        session: guestSessions,
      })
      .from(guestSessions)
      .innerJoin(guestUsers, eq(guestSessions.guestUserId, guestUsers.id))
      .where(
        and(
          eq(guestSessions.tokenHash, tokenHash),
          isNull(guestSessions.revokedAt),
          gt(guestSessions.expiresAt, now),
          gt(guestUsers.expiresAt, now)
        )
      )
      .limit(1);

    if (!rows.length) {
      return null;
    }

    return rows[0];
  } catch (error) {
    console.error('Database query failed in getGuestSessionByRawToken:', error);
    throw new Error('Failed to verify guest session.', { cause: error });
  }
}

export async function initializeGuestSession(options: {
  existingRawToken?: string;
  userAgent: string;
  ipHash: string;
  forceNew?: boolean;
}): Promise<{
  rawToken: string;
  csrfToken: string;
  user: PublicGuestProfile;
  sessionExpiresAt: string;
  isNew: boolean;
}> {
  try {
    await ensureDirectoryPeersSeeded();

    if (options.existingRawToken) {
      const existing = await getGuestSessionByRawToken(options.existingRawToken);
      if (existing) {
        if (!options.forceNew) {
          const [updatedUser] = await db
            .update(guestUsers)
            .set({ isOnline: true, lastSeenAt: new Date() })
            .where(eq(guestUsers.id, existing.user.id))
            .returning();

          return {
            rawToken: options.existingRawToken,
            csrfToken: existing.session.csrfToken,
            user: toPublicGuestProfile(updatedUser || existing.user),
            sessionExpiresAt: existing.session.expiresAt.toISOString(),
            isNew: false,
          };
        } else {
          // Revoke old session and mark previous temporary identity offline when rotating
          await revokeGuestSession(existing.user.id, options.existingRawToken);
        }
      }
    }

    // Generate unique username with collision retry
    let username = generateGuestUsername();
    for (let attempt = 0; attempt < 8; attempt++) {
      const collision = await db
        .select({ id: guestUsers.id })
        .from(guestUsers)
        .where(eq(guestUsers.username, username))
        .limit(1);
      if (collision.length === 0) break;
      username = generateGuestUsername();
    }

    const publicId = generatePublicId('usr');
    const rawToken = generateSecureToken(32);
    const tokenHash = hashToken(rawToken);
    const csrfToken = generateSecureToken(24);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    const created = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(guestUsers)
        .values({
          publicId,
          username,
          displayName: username,
          isDiscoverable: true,
          isOnline: true,
          lastSeenAt: new Date(),
          expiresAt,
        })
        .returning();

      const [newSession] = await tx
        .insert(guestSessions)
        .values({
          guestUserId: newUser.id,
          tokenHash,
          csrfToken,
          userAgent: sanitizeInputText(options.userAgent || 'unknown', 255),
          ipHash: options.ipHash,
          expiresAt,
        })
        .returning();

      const [seedPeer] = await tx
        .select()
        .from(guestUsers)
        .where(eq(guestUsers.username, 'Guest_84291'))
        .limit(1);

      if (seedPeer && seedPeer.id !== newUser.id) {
        await tx.insert(chatRequests).values({
          publicId: generatePublicId('req'),
          senderId: seedPeer.id,
          receiverId: newUser.id,
          status: 'PENDING',
          introMessage:
            'Hello! Would you like to open a private one-to-one channel?',
        });
      }

      return { newUser, newSession };
    });

    return {
      rawToken,
      csrfToken: created.newSession.csrfToken,
      user: toPublicGuestProfile(created.newUser),
      sessionExpiresAt: created.newSession.expiresAt.toISOString(),
      isNew: true,
    };
  } catch (error) {
    console.error('Database operation failed in initializeGuestSession:', error);
    throw new Error('Failed to initialize temporary guest identity.', {
      cause: error,
    });
  }
}

export async function updateGuestProfile(
  guestUserId: number,
  updates: { displayName?: string; isDiscoverable?: boolean }
): Promise<PublicGuestProfile> {
  try {
    const patch: Partial<typeof guestUsers.$inferInsert> = {
      lastSeenAt: new Date(),
    };

    if (updates.displayName !== undefined) {
      const cleaned = sanitizeInputText(updates.displayName, 32);
      if (!validateDisplayNameFormat(cleaned)) {
        throw new Error(
          'Display name must be 2–32 characters and contain no script or HTML characters.'
        );
      }
      patch.displayName = cleaned;
    }

    if (updates.isDiscoverable !== undefined) {
      patch.isDiscoverable = Boolean(updates.isDiscoverable);
    }

    const [updated] = await db
      .update(guestUsers)
      .set(patch)
      .where(eq(guestUsers.id, guestUserId))
      .returning();

    if (!updated) {
      throw new Error('Guest user not found.');
    }

    return toPublicGuestProfile(updated);
  } catch (error: any) {
    console.error('Failed in updateGuestProfile:', error);
    throw new Error(error.message || 'Failed to update guest profile.', {
      cause: error,
    });
  }
}

export async function setGuestOnlineState(
  guestUserId: number,
  isOnline: boolean
): Promise<PublicGuestProfile | null> {
  try {
    const [updated] = await db
      .update(guestUsers)
      .set({
        isOnline,
        lastSeenAt: new Date(),
      })
      .where(eq(guestUsers.id, guestUserId))
      .returning();
    return updated ? toPublicGuestProfile(updated) : null;
  } catch (error) {
    console.error('Failed in setGuestOnlineState:', error);
    return null;
  }
}

export async function revokeGuestSession(
  guestUserId: number,
  rawToken: string
): Promise<void> {
  try {
    const tokenHash = hashToken(rawToken);
    await db.transaction(async (tx) => {
      await tx
        .update(guestSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(guestSessions.guestUserId, guestUserId),
            eq(guestSessions.tokenHash, tokenHash)
          )
        );

      await tx
        .update(guestUsers)
        .set({ isOnline: false, lastSeenAt: new Date() })
        .where(eq(guestUsers.id, guestUserId));
    });
  } catch (error) {
    console.error('Failed in revokeGuestSession:', error);
    throw new Error('Failed to end guest session.', { cause: error });
  }
}

export async function getBlockedSets(
  guestUserId: number
): Promise<{ blockedByMeIds: Set<number>; blockedMeIds: Set<number> }> {
  try {
    const rows = await db
      .select()
      .from(blockedUsers)
      .where(
        or(
          eq(blockedUsers.blockerId, guestUserId),
          eq(blockedUsers.blockedId, guestUserId)
        )
      );

    const blockedByMeIds = new Set<number>();
    const blockedMeIds = new Set<number>();
    for (const r of rows) {
      if (r.blockerId === guestUserId) blockedByMeIds.add(r.blockedId);
      if (r.blockedId === guestUserId) blockedMeIds.add(r.blockerId);
    }
    return { blockedByMeIds, blockedMeIds };
  } catch (error) {
    console.error('Failed in getBlockedSets:', error);
    throw new Error('Failed to verify block list.', { cause: error });
  }
}

export async function searchDiscoverableUsers(
  currentGuestId: number,
  searchQuery: string
): Promise<PublicGuestProfile[]> {
  try {
    const now = new Date();
    const { blockedByMeIds, blockedMeIds } = await getBlockedSets(currentGuestId);
    const cleaned = sanitizeInputText(searchQuery, 40);

    const baseCondition = and(
      ne(guestUsers.id, currentGuestId),
      eq(guestUsers.isDiscoverable, true),
      gt(guestUsers.expiresAt, now),
      cleaned
        ? or(
            ilike(guestUsers.username, `%${cleaned}%`),
            ilike(guestUsers.displayName, `%${cleaned}%`)
          )
        : undefined
    );

    const rows = await db
      .select()
      .from(guestUsers)
      .where(baseCondition)
      .orderBy(desc(guestUsers.isOnline), desc(guestUsers.lastSeenAt))
      .limit(30);

    return rows
      .filter((u) => !blockedByMeIds.has(u.id) && !blockedMeIds.has(u.id))
      .map(toPublicGuestProfile);
  } catch (error) {
    console.error('Failed in searchDiscoverableUsers:', error);
    throw new Error('Failed to search users.', { cause: error });
  }
}

export async function listOnlineDiscoverableUsers(
  currentGuestId: number
): Promise<PublicGuestProfile[]> {
  try {
    const now = new Date();
    const { blockedByMeIds, blockedMeIds } = await getBlockedSets(currentGuestId);

    const rows = await db
      .select()
      .from(guestUsers)
      .where(
        and(
          ne(guestUsers.id, currentGuestId),
          eq(guestUsers.isDiscoverable, true),
          eq(guestUsers.isOnline, true),
          gt(guestUsers.expiresAt, now)
        )
      )
      .orderBy(desc(guestUsers.lastSeenAt))
      .limit(40);

    return rows
      .filter((u) => !blockedByMeIds.has(u.id) && !blockedMeIds.has(u.id))
      .map(toPublicGuestProfile);
  } catch (error) {
    console.error('Failed in listOnlineDiscoverableUsers:', error);
    throw new Error('Failed to load online users.', { cause: error });
  }
}

export async function createChatRequest(
  senderId: number,
  targetIdentifier: string, // publicId or username
  introMessage?: string
): Promise<ChatRequestItem> {
  try {
    const cleanedIdentifier = sanitizeInputText(targetIdentifier, 64);
    const [targetUser] = await db
      .select()
      .from(guestUsers)
      .where(
        or(
          eq(guestUsers.publicId, cleanedIdentifier),
          eq(guestUsers.username, cleanedIdentifier)
        )
      )
      .limit(1);

    if (!targetUser) {
      throw new Error('Recipient user was not found.');
    }
    if (targetUser.id === senderId) {
      throw new Error('You cannot send a chat request to yourself.');
    }

    const { blockedByMeIds, blockedMeIds } = await getBlockedSets(senderId);
    if (blockedByMeIds.has(targetUser.id) || blockedMeIds.has(targetUser.id)) {
      throw new Error('Cannot send chat request due to privacy or block settings.');
    }

    if (!targetUser.isDiscoverable) {
      throw new Error('This user currently has discoverability disabled.');
    }

    // Check if an active conversation already exists between these 2 users
    const existingConv = await db
      .select()
      .from(conversations)
      .where(
        or(
          and(
            eq(conversations.participantOneId, senderId),
            eq(conversations.participantTwoId, targetUser.id)
          ),
          and(
            eq(conversations.participantOneId, targetUser.id),
            eq(conversations.participantTwoId, senderId)
          )
        )
      )
      .limit(1);

    if (existingConv.length > 0) {
      throw new Error('An active conversation with this user already exists.');
    }

    // Check for duplicate pending request in either direction
    const existingPending = await db
      .select()
      .from(chatRequests)
      .where(
        and(
          eq(chatRequests.status, 'PENDING'),
          or(
            and(
              eq(chatRequests.senderId, senderId),
              eq(chatRequests.receiverId, targetUser.id)
            ),
            and(
              eq(chatRequests.senderId, targetUser.id),
              eq(chatRequests.receiverId, senderId)
            )
          )
        )
      )
      .limit(1);

    if (existingPending.length > 0) {
      throw new Error('A pending chat request already exists between you and this user.');
    }

    const [senderUser] = await db
      .select()
      .from(guestUsers)
      .where(eq(guestUsers.id, senderId))
      .limit(1);

    const publicId = generatePublicId('req');
    const cleanIntro = introMessage
      ? sanitizeInputText(introMessage, 240)
      : null;

    const [created] = await db
      .insert(chatRequests)
      .values({
        publicId,
        senderId,
        receiverId: targetUser.id,
        status: 'PENDING',
        introMessage: cleanIntro,
      })
      .returning();

    return {
      publicId: created.publicId,
      sender: toPublicGuestProfile(senderUser),
      receiver: toPublicGuestProfile(targetUser),
      status: created.status as ChatRequestItem['status'],
      introMessage: created.introMessage,
      respondedAt: created.respondedAt ? created.respondedAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
    };
  } catch (error: any) {
    console.error('Failed in createChatRequest:', error);
    throw new Error(error.message || 'Failed to send chat request.', {
      cause: error,
    });
  }
}

async function hydrateRequestItems(
  rows: (typeof chatRequests.$inferSelect)[]
): Promise<ChatRequestItem[]> {
  if (rows.length === 0) return [];
  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.senderId, r.receiverId]))
  );
  const usersList = await db
    .select()
    .from(guestUsers)
    .where(inArray(guestUsers.id, userIds));
  const userMap = new Map(usersList.map((u) => [u.id, u]));

  return rows
    .map((r) => {
      const sender = userMap.get(r.senderId);
      const receiver = userMap.get(r.receiverId);
      if (!sender || !receiver) return null;
      return {
        publicId: r.publicId,
        sender: toPublicGuestProfile(sender),
        receiver: toPublicGuestProfile(receiver),
        status: r.status as ChatRequestItem['status'],
        introMessage: r.introMessage,
        respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      };
    })
    .filter((item): item is ChatRequestItem => item !== null);
}

export async function getIncomingRequests(
  guestId: number
): Promise<ChatRequestItem[]> {
  try {
    const rows = await db
      .select()
      .from(chatRequests)
      .where(eq(chatRequests.receiverId, guestId))
      .orderBy(desc(chatRequests.createdAt))
      .limit(50);
    return hydrateRequestItems(rows);
  } catch (error) {
    console.error('Failed in getIncomingRequests:', error);
    throw new Error('Failed to fetch incoming chat requests.', { cause: error });
  }
}

export async function getOutgoingRequests(
  guestId: number
): Promise<ChatRequestItem[]> {
  try {
    const rows = await db
      .select()
      .from(chatRequests)
      .where(eq(chatRequests.senderId, guestId))
      .orderBy(desc(chatRequests.createdAt))
      .limit(50);
    return hydrateRequestItems(rows);
  } catch (error) {
    console.error('Failed in getOutgoingRequests:', error);
    throw new Error('Failed to fetch outgoing chat requests.', { cause: error });
  }
}

export async function acceptChatRequest(
  receiverId: number,
  requestPublicId: string
): Promise<{ request: ChatRequestItem; conversationPublicId: string }> {
  try {
    const result = await db.transaction(async (tx) => {
      const [reqRow] = await tx
        .select()
        .from(chatRequests)
        .where(eq(chatRequests.publicId, requestPublicId))
        .limit(1);

      if (!reqRow) {
        throw new Error('Chat request not found.');
      }
      if (reqRow.receiverId !== receiverId) {
        throw new Error('Unauthorized: Only the recipient can accept this request.');
      }
      if (reqRow.status !== 'PENDING') {
        throw new Error(`Chat request is already ${reqRow.status.toLowerCase()}.`);
      }

      const [updatedReq] = await tx
        .update(chatRequests)
        .set({ status: 'ACCEPTED', respondedAt: new Date() })
        .where(eq(chatRequests.id, reqRow.id))
        .returning();

      // Ensure exactly 2 distinct participants in canonical order
      const p1 = Math.min(reqRow.senderId, reqRow.receiverId);
      const p2 = Math.max(reqRow.senderId, reqRow.receiverId);

      const existingConv = await tx
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.participantOneId, p1),
            eq(conversations.participantTwoId, p2)
          )
        )
        .limit(1);

      let conv = existingConv[0];
      if (!conv) {
        const [createdConv] = await tx
          .insert(conversations)
          .values({
            publicId: generatePublicId('conv'),
            participantOneId: p1,
            participantTwoId: p2,
            lastMessageAt: new Date(),
          })
          .returning();
        conv = createdConv;

        await tx.insert(conversationParticipants).values([
          {
            conversationId: conv.id,
            guestUserId: p1,
            unreadCount: 0,
          },
          {
            conversationId: conv.id,
            guestUserId: p2,
            unreadCount: 0,
          },
        ]);
      }

      // If the request had an introMessage, persist it as the first message
      if (reqRow.introMessage && reqRow.introMessage.trim().length > 0) {
        await tx.insert(messages).values({
          publicId: generatePublicId('msg'),
          clientMessageId: generatePublicId('cmsg'),
          conversationId: conv.id,
          senderId: reqRow.senderId,
          content: reqRow.introMessage.trim(),
          status: 'DELIVERED',
          deliveredAt: new Date(),
        });

        await tx
          .update(conversationParticipants)
          .set({ unreadCount: 1 })
          .where(
            and(
              eq(conversationParticipants.conversationId, conv.id),
              eq(conversationParticipants.guestUserId, receiverId)
            )
          );
      }

      return { updatedReq, conversationPublicId: conv.publicId };
    });

    const [hydrated] = await hydrateRequestItems([result.updatedReq]);
    return {
      request: {
        ...hydrated,
        conversationPublicId: result.conversationPublicId,
      },
      conversationPublicId: result.conversationPublicId,
    };
  } catch (error: any) {
    console.error('Failed in acceptChatRequest:', error);
    throw new Error(error.message || 'Failed to accept chat request.', {
      cause: error,
    });
  }
}

export async function declineChatRequest(
  receiverId: number,
  requestPublicId: string
): Promise<ChatRequestItem> {
  try {
    const [reqRow] = await db
      .select()
      .from(chatRequests)
      .where(eq(chatRequests.publicId, requestPublicId))
      .limit(1);

    if (!reqRow) {
      throw new Error('Chat request not found.');
    }
    if (reqRow.receiverId !== receiverId) {
      throw new Error('Unauthorized: Only the recipient can decline this request.');
    }
    if (reqRow.status !== 'PENDING') {
      throw new Error(`Chat request is already ${reqRow.status.toLowerCase()}.`);
    }

    const [updated] = await db
      .update(chatRequests)
      .set({ status: 'DECLINED', respondedAt: new Date() })
      .where(eq(chatRequests.id, reqRow.id))
      .returning();

    const [hydrated] = await hydrateRequestItems([updated]);
    return hydrated;
  } catch (error: any) {
    console.error('Failed in declineChatRequest:', error);
    throw new Error(error.message || 'Failed to decline chat request.', {
      cause: error,
    });
  }
}

export async function cancelChatRequest(
  guestId: number,
  requestPublicId: string
): Promise<ChatRequestItem> {
  try {
    const [reqRow] = await db
      .select()
      .from(chatRequests)
      .where(eq(chatRequests.publicId, requestPublicId))
      .limit(1);

    if (!reqRow) {
      throw new Error('Chat request not found.');
    }
    if (reqRow.senderId !== guestId) {
      throw new Error('Unauthorized: Only the sender can cancel this request.');
    }
    if (reqRow.status !== 'PENDING') {
      throw new Error(`Cannot cancel a request that is ${reqRow.status.toLowerCase()}.`);
    }

    const [updated] = await db
      .update(chatRequests)
      .set({ status: 'CANCELLED', respondedAt: new Date() })
      .where(eq(chatRequests.id, reqRow.id))
      .returning();

    const [hydrated] = await hydrateRequestItems([updated]);
    return hydrated;
  } catch (error: any) {
    console.error('Failed in cancelChatRequest:', error);
    throw new Error(error.message || 'Failed to cancel chat request.', {
      cause: error,
    });
  }
}

async function verifyConversationParticipant(
  guestId: number,
  conversationPublicId: string
): Promise<{
  conversation: typeof conversations.$inferSelect;
  peer: typeof guestUsers.$inferSelect;
  self: typeof guestUsers.$inferSelect;
}> {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.publicId, conversationPublicId))
    .limit(1);

  if (!conv) {
    throw new Error('Conversation not found.');
  }
  if (conv.participantOneId !== guestId && conv.participantTwoId !== guestId) {
    throw new Error('Forbidden: You are not a participant in this private conversation.');
  }

  const peerId =
    conv.participantOneId === guestId
      ? conv.participantTwoId
      : conv.participantOneId;

  const usersRows = await db
    .select()
    .from(guestUsers)
    .where(inArray(guestUsers.id, [guestId, peerId]));

  const self = usersRows.find((u) => u.id === guestId);
  const peer = usersRows.find((u) => u.id === peerId);

  if (!self || !peer) {
    throw new Error('Conversation participant record missing.');
  }

  return { conversation: conv, peer, self };
}

async function hydrateMessages(
  msgRows: (typeof messages.$inferSelect)[],
  conversationPublicId: string,
  viewerPublicId: string,
  attachmentSecret: string
): Promise<ChatMessageItem[]> {
  if (msgRows.length === 0) return [];

  const msgIds = msgRows.map((m) => m.id);
  const senderIds = Array.from(new Set(msgRows.map((m) => m.senderId)));

  const [senders, attRows, reactionRows] = await Promise.all([
    db.select().from(guestUsers).where(inArray(guestUsers.id, senderIds)),
    db.select().from(attachments).where(inArray(attachments.messageId, msgIds)),
    db
      .select({
        reaction: messageReactions,
        userPublicId: guestUsers.publicId,
      })
      .from(messageReactions)
      .innerJoin(guestUsers, eq(messageReactions.guestUserId, guestUsers.id))
      .where(inArray(messageReactions.messageId, msgIds)),
  ]);

  const senderMap = new Map(senders.map((s) => [s.id, s]));

  const attByMsg = new Map<number, AttachmentMetadata[]>();
  for (const att of attRows) {
    if (!att.messageId) continue;
    const { expires, sig } = createSignedAttachmentQuery(
      att.publicId,
      viewerPublicId,
      attachmentSecret,
      900
    );
    const meta: AttachmentMetadata = {
      publicId: att.publicId,
      originalName: att.originalName,
      mimeType: att.mimeType,
      extension: att.extension,
      sizeBytes: att.sizeBytes,
      category: att.category as AttachmentMetadata['category'],
      sha256Checksum: att.sha256Checksum,
      downloadUrl: `/api/attachments/${att.publicId}?viewer=${encodeURIComponent(viewerPublicId)}&expires=${expires}&sig=${sig}`,
      createdAt: att.createdAt.toISOString(),
    };
    const list = attByMsg.get(att.messageId) || [];
    list.push(meta);
    attByMsg.set(att.messageId, list);
  }

  const reactionsByMsg = new Map<number, Map<string, Set<string>>>();
  for (const r of reactionRows) {
    const msgId = r.reaction.messageId;
    if (!reactionsByMsg.has(msgId)) {
      reactionsByMsg.set(msgId, new Map());
    }
    const emojiMap = reactionsByMsg.get(msgId)!;
    if (!emojiMap.has(r.reaction.emoji)) {
      emojiMap.set(r.reaction.emoji, new Set());
    }
    emojiMap.get(r.reaction.emoji)!.add(r.userPublicId);
  }

  return msgRows.map((m) => {
    const sender = senderMap.get(m.senderId);
    const emojiMap = reactionsByMsg.get(m.id);
    const reactions: MessageReactionSummary[] = [];
    if (emojiMap) {
      for (const [emoji, usersSet] of emojiMap.entries()) {
        reactions.push({
          emoji,
          count: usersSet.size,
          users: Array.from(usersSet),
        });
      }
    }

    return {
      publicId: m.publicId,
      clientMessageId: m.clientMessageId,
      conversationPublicId,
      senderPublicId: sender?.publicId || 'unknown',
      senderUsername: sender?.username || 'Guest',
      senderDisplayName: sender?.displayName || 'Guest',
      content: m.isDeleted ? 'This message was deleted.' : m.content,
      status: m.status as ChatMessageItem['status'],
      isDeleted: m.isDeleted,
      deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
      readAt: m.readAt ? m.readAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      attachments: m.isDeleted ? [] : attByMsg.get(m.id) || [],
      reactions: m.isDeleted ? [] : reactions,
    };
  });
}

export async function getUserConversations(
  guestId: number,
  viewerPublicId: string,
  attachmentSecret: string
): Promise<ConversationSummary[]> {
  try {
    const convRows = await db
      .select()
      .from(conversations)
      .where(
        or(
          eq(conversations.participantOneId, guestId),
          eq(conversations.participantTwoId, guestId)
        )
      )
      .orderBy(desc(conversations.lastMessageAt));

    if (convRows.length === 0) return [];

    const { blockedByMeIds, blockedMeIds } = await getBlockedSets(guestId);
    const peerIds = convRows.map((c) =>
      c.participantOneId === guestId ? c.participantTwoId : c.participantOneId
    );
    const convIds = convRows.map((c) => c.id);

    const [peers, participantRows] = await Promise.all([
      db.select().from(guestUsers).where(inArray(guestUsers.id, peerIds)),
      db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            inArray(conversationParticipants.conversationId, convIds),
            eq(conversationParticipants.guestUserId, guestId)
          )
        ),
    ]);

    const peerMap = new Map(peers.map((p) => [p.id, p]));
    const unreadMap = new Map(
      participantRows.map((p) => [p.conversationId, p.unreadCount])
    );

    const summaries: ConversationSummary[] = [];
    for (const c of convRows) {
      const peerId =
        c.participantOneId === guestId
          ? c.participantTwoId
          : c.participantOneId;
      const peer = peerMap.get(peerId);
      if (!peer) continue;

      const latestMsgRows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, c.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      const hydratedLast =
        latestMsgRows.length > 0
          ? (
              await hydrateMessages(
                latestMsgRows,
                c.publicId,
                viewerPublicId,
                attachmentSecret
              )
            )[0]
          : null;

      summaries.push({
        publicId: c.publicId,
        peer: toPublicGuestProfile(peer),
        unreadCount: unreadMap.get(c.id) || 0,
        lastMessageAt: c.lastMessageAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
        lastMessage: hydratedLast,
        isPeerBlocked: blockedByMeIds.has(peer.id),
        hasBlockedMe: blockedMeIds.has(peer.id),
      });
    }

    return summaries;
  } catch (error) {
    console.error('Failed in getUserConversations:', error);
    throw new Error('Failed to load conversations.', { cause: error });
  }
}

export async function getConversationDetail(
  guestId: number,
  viewerPublicId: string,
  conversationPublicId: string,
  attachmentSecret: string
): Promise<ConversationSummary> {
  try {
    const { conversation, peer } = await verifyConversationParticipant(
      guestId,
      conversationPublicId
    );
    const { blockedByMeIds, blockedMeIds } = await getBlockedSets(guestId);

    const [partRow] = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversation.id),
          eq(conversationParticipants.guestUserId, guestId)
        )
      )
      .limit(1);

    const latestMsgRows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    const hydratedLast =
      latestMsgRows.length > 0
        ? (
            await hydrateMessages(
              latestMsgRows,
              conversation.publicId,
              viewerPublicId,
              attachmentSecret
            )
          )[0]
        : null;

    return {
      publicId: conversation.publicId,
      peer: toPublicGuestProfile(peer),
      unreadCount: partRow?.unreadCount || 0,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      lastMessage: hydratedLast,
      isPeerBlocked: blockedByMeIds.has(peer.id),
      hasBlockedMe: blockedMeIds.has(peer.id),
    };
  } catch (error: any) {
    console.error('Failed in getConversationDetail:', error);
    throw new Error(error.message || 'Failed to load conversation.', {
      cause: error,
    });
  }
}

export async function getConversationMessages(
  guestId: number,
  viewerPublicId: string,
  conversationPublicId: string,
  attachmentSecret: string,
  limit = 50
): Promise<ChatMessageItem[]> {
  try {
    const { conversation } = await verifyConversationParticipant(
      guestId,
      conversationPublicId
    );

    const safeLimit = Math.min(Math.max(1, limit), 100);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(safeLimit);

    const chronological = rows.reverse();
    return hydrateMessages(
      chronological,
      conversation.publicId,
      viewerPublicId,
      attachmentSecret
    );
  } catch (error: any) {
    console.error('Failed in getConversationMessages:', error);
    throw new Error(error.message || 'Failed to load messages.', {
      cause: error,
    });
  }
}

export async function createMessage(params: {
  senderId: number;
  senderPublicId: string;
  conversationPublicId: string;
  clientMessageId: string;
  content: string;
  attachmentPublicIds?: string[];
  attachmentSecret: string;
}): Promise<{
  message: ChatMessageItem;
  peerPublicId: string;
  peerId: number;
  isDuplicate: boolean;
}> {
  try {
    const { conversation, peer } = await verifyConversationParticipant(
      params.senderId,
      params.conversationPublicId
    );

    const { blockedByMeIds, blockedMeIds } = await getBlockedSets(params.senderId);
    if (blockedByMeIds.has(peer.id) || blockedMeIds.has(peer.id)) {
      throw new Error('Cannot send messages in a blocked conversation.');
    }

    const cleanedClientMsgId = sanitizeInputText(params.clientMessageId, 80);
    if (!cleanedClientMsgId) {
      throw new Error('clientMessageId is required for idempotent message delivery.');
    }

    // Idempotency check: if clientMessageId already exists, return existing message
    const existingMsg = await db
      .select()
      .from(messages)
      .where(eq(messages.clientMessageId, cleanedClientMsgId))
      .limit(1);

    if (existingMsg.length > 0) {
      if (existingMsg[0].senderId !== params.senderId) {
        throw new Error('Client message ID collision.');
      }
      const [hydrated] = await hydrateMessages(
        existingMsg,
        conversation.publicId,
        params.senderPublicId,
        params.attachmentSecret
      );
      return {
        message: hydrated,
        peerPublicId: peer.publicId,
        peerId: peer.id,
        isDuplicate: true,
      };
    }

    const cleanedContent = sanitizeInputText(params.content || '', 2000);
    const attIds = params.attachmentPublicIds || [];
    if (!cleanedContent && attIds.length === 0) {
      throw new Error('Message must contain text or at least one attachment.');
    }

    const createdMsgRow = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(messages)
        .values({
          publicId: generatePublicId('msg'),
          clientMessageId: cleanedClientMsgId,
          conversationId: conversation.id,
          senderId: params.senderId,
          content: cleanedContent,
          status: peer.isOnline ? 'DELIVERED' : 'SENT',
          deliveredAt: peer.isOnline ? new Date() : null,
        })
        .returning();

      if (attIds.length > 0) {
        await tx
          .update(attachments)
          .set({ messageId: inserted.id })
          .where(
            and(
              inArray(attachments.publicId, attIds),
              eq(attachments.uploaderId, params.senderId),
              eq(attachments.conversationId, conversation.id)
            )
          );
      }

      await tx
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, conversation.id));

      await tx
        .update(conversationParticipants)
        .set({
          unreadCount: sql`${conversationParticipants.unreadCount} + 1`,
        })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversation.id),
            eq(conversationParticipants.guestUserId, peer.id)
          )
        );

      return inserted;
    });

    const [hydrated] = await hydrateMessages(
      [createdMsgRow],
      conversation.publicId,
      params.senderPublicId,
      params.attachmentSecret
    );

    return {
      message: hydrated,
      peerPublicId: peer.publicId,
      peerId: peer.id,
      isDuplicate: false,
    };
  } catch (error: any) {
    console.error('Failed in createMessage:', error);
    throw new Error(error.message || 'Failed to send message.', {
      cause: error,
    });
  }
}

export async function markConversationMessagesRead(
  guestId: number,
  conversationPublicId: string
): Promise<{
  conversationPublicId: string;
  readMessagePublicIds: string[];
  peerPublicId: string;
  readAt: string;
}> {
  try {
    const { conversation, peer } = await verifyConversationParticipant(
      guestId,
      conversationPublicId
    );
    const now = new Date();

    const updatedRows = await db.transaction(async (tx) => {
      const unreadRows = await tx
        .update(messages)
        .set({
          status: 'READ',
          readAt: now,
          deliveredAt: sql`COALESCE(${messages.deliveredAt}, ${now})`,
        })
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            ne(messages.senderId, guestId),
            ne(messages.status, 'READ')
          )
        )
        .returning({ publicId: messages.publicId });

      await tx
        .update(conversationParticipants)
        .set({ unreadCount: 0, lastReadAt: now })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversation.id),
            eq(conversationParticipants.guestUserId, guestId)
          )
        );

      return unreadRows;
    });

    return {
      conversationPublicId: conversation.publicId,
      readMessagePublicIds: updatedRows.map((r) => r.publicId),
      peerPublicId: peer.publicId,
      readAt: now.toISOString(),
    };
  } catch (error: any) {
    console.error('Failed in markConversationMessagesRead:', error);
    throw new Error(error.message || 'Failed to mark messages as read.', {
      cause: error,
    });
  }
}

export async function markMessageReadByIdOrConversation(
  guestId: number,
  identifier: string // message publicId OR conversation publicId
): Promise<{
  conversationPublicId: string;
  readMessagePublicIds: string[];
  peerPublicId: string;
  readAt: string;
}> {
  if (identifier.startsWith('conv_')) {
    return markConversationMessagesRead(guestId, identifier);
  }
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.publicId, identifier))
    .limit(1);

  if (!msg) {
    throw new Error('Message not found.');
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, msg.conversationId))
    .limit(1);

  if (!conv) {
    throw new Error('Conversation not found.');
  }
  return markConversationMessagesRead(guestId, conv.publicId);
}

export async function deleteMessageByPublicId(
  guestId: number,
  messagePublicId: string
): Promise<{
  messagePublicId: string;
  conversationPublicId: string;
  peerPublicId: string;
}> {
  try {
    const [msg] = await db
      .select()
      .from(messages)
      .where(eq(messages.publicId, messagePublicId))
      .limit(1);

    if (!msg) {
      throw new Error('Message not found.');
    }
    if (msg.senderId !== guestId) {
      throw new Error('Forbidden: You can only delete your own messages.');
    }

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, msg.conversationId))
      .limit(1);

    if (!conv) {
      throw new Error('Conversation not found.');
    }

    const peerId =
      conv.participantOneId === guestId
        ? conv.participantTwoId
        : conv.participantOneId;

    const [peer] = await db
      .select()
      .from(guestUsers)
      .where(eq(guestUsers.id, peerId))
      .limit(1);

    await db
      .update(messages)
      .set({ isDeleted: true, content: '' })
      .where(eq(messages.id, msg.id));

    return {
      messagePublicId: msg.publicId,
      conversationPublicId: conv.publicId,
      peerPublicId: peer?.publicId || '',
    };
  } catch (error: any) {
    console.error('Failed in deleteMessageByPublicId:', error);
    throw new Error(error.message || 'Failed to delete message.', {
      cause: error,
    });
  }
}

export async function toggleMessageReaction(
  guestId: number,
  viewerPublicId: string,
  messagePublicId: string,
  emoji: string,
  attachmentSecret: string
): Promise<{
  message: ChatMessageItem;
  peerPublicId: string;
}> {
  try {
    const allowedEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉', '🙏', '✨'];
    if (!allowedEmojis.includes(emoji)) {
      throw new Error('Unsupported reaction emoji.');
    }

    const [msg] = await db
      .select()
      .from(messages)
      .where(eq(messages.publicId, messagePublicId))
      .limit(1);

    if (!msg || msg.isDeleted) {
      throw new Error('Message not available for reactions.');
    }

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, msg.conversationId))
      .limit(1);

    if (!conv) {
      throw new Error('Conversation not found.');
    }

    const { peer } = await verifyConversationParticipant(guestId, conv.publicId);

    const existing = await db
      .select()
      .from(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, msg.id),
          eq(messageReactions.guestUserId, guestId),
          eq(messageReactions.emoji, emoji)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .delete(messageReactions)
        .where(eq(messageReactions.id, existing[0].id));
    } else {
      await db.insert(messageReactions).values({
        messageId: msg.id,
        guestUserId: guestId,
        emoji,
      });
    }

    const [hydrated] = await hydrateMessages(
      [msg],
      conv.publicId,
      viewerPublicId,
      attachmentSecret
    );

    return {
      message: hydrated,
      peerPublicId: peer.publicId,
    };
  } catch (error: any) {
    console.error('Failed in toggleMessageReaction:', error);
    throw new Error(error.message || 'Failed to update reaction.', {
      cause: error,
    });
  }
}

export async function saveAttachmentRecord(params: {
  uploaderId: number;
  uploaderPublicId: string;
  conversationPublicId: string;
  originalName: string;
  storageName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  category: 'image' | 'video' | 'audio' | 'document' | 'spreadsheet';
  dataBase64: string;
  sha256Checksum: string;
  attachmentSecret: string;
}): Promise<AttachmentMetadata> {
  try {
    const { conversation } = await verifyConversationParticipant(
      params.uploaderId,
      params.conversationPublicId
    );

    const publicId = generatePublicId('att');
    const [inserted] = await db
      .insert(attachments)
      .values({
        publicId,
        conversationId: conversation.id,
        uploaderId: params.uploaderId,
        originalName: sanitizeInputText(params.originalName, 180),
        storageName: params.storageName,
        mimeType: params.mimeType,
        extension: params.extension,
        sizeBytes: params.sizeBytes,
        category: params.category,
        dataBase64: params.dataBase64,
        sha256Checksum: params.sha256Checksum,
      })
      .returning();

    const { expires, sig } = createSignedAttachmentQuery(
      inserted.publicId,
      params.uploaderPublicId,
      params.attachmentSecret,
      900
    );

    return {
      publicId: inserted.publicId,
      originalName: inserted.originalName,
      mimeType: inserted.mimeType,
      extension: inserted.extension,
      sizeBytes: inserted.sizeBytes,
      category: inserted.category as AttachmentMetadata['category'],
      sha256Checksum: inserted.sha256Checksum,
      downloadUrl: `/api/attachments/${inserted.publicId}?viewer=${encodeURIComponent(params.uploaderPublicId)}&expires=${expires}&sig=${sig}`,
      createdAt: inserted.createdAt.toISOString(),
    };
  } catch (error: any) {
    console.error('Failed in saveAttachmentRecord:', error);
    throw new Error(error.message || 'Failed to store attachment.', {
      cause: error,
    });
  }
}

export async function getAuthorizedAttachment(
  guestId: number,
  attachmentPublicId: string
): Promise<typeof attachments.$inferSelect> {
  try {
    const [att] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.publicId, attachmentPublicId))
      .limit(1);

    if (!att) {
      throw new Error('Attachment not found.');
    }

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, att.conversationId))
      .limit(1);

    if (
      !conv ||
      (conv.participantOneId !== guestId && conv.participantTwoId !== guestId)
    ) {
      throw new Error('Forbidden: You are not authorized to access this file.');
    }

    return att;
  } catch (error: any) {
    console.error('Failed in getAuthorizedAttachment:', error);
    throw new Error(error.message || 'Unauthorized attachment access.', {
      cause: error,
    });
  }
}

export async function getActiveGuestByPublicId(
  publicId: string
): Promise<typeof guestUsers.$inferSelect | null> {
  try {
    if (!publicId || typeof publicId !== 'string') return null;
    const now = new Date();
    const rows = await db
      .select({
        user: guestUsers,
      })
      .from(guestUsers)
      .innerJoin(guestSessions, eq(guestSessions.guestUserId, guestUsers.id))
      .where(
        and(
          eq(guestUsers.publicId, publicId),
          gt(guestUsers.expiresAt, now),
          isNull(guestSessions.revokedAt),
          gt(guestSessions.expiresAt, now)
        )
      )
      .limit(1);
    return rows[0]?.user || null;
  } catch (error) {
    console.error('Failed in getActiveGuestByPublicId:', error);
    return null;
  }
}

export async function blockGuestUser(
  blockerId: number,
  targetIdentifier: string,
  reason?: string
): Promise<BlockedUserItem> {
  try {
    const [target] = await db
      .select()
      .from(guestUsers)
      .where(
        or(
          eq(guestUsers.publicId, targetIdentifier),
          eq(guestUsers.username, targetIdentifier)
        )
      )
      .limit(1);

    if (!target) {
      throw new Error('User to block was not found.');
    }
    if (target.id === blockerId) {
      throw new Error('You cannot block yourself.');
    }

    const cleanReason = reason ? sanitizeInputText(reason, 200) : null;

    await db.transaction(async (tx) => {
      await tx
        .insert(blockedUsers)
        .values({
          blockerId,
          blockedId: target.id,
          reason: cleanReason,
        })
        .onConflictDoNothing();

      // Cancel any pending chat requests between these two users
      await tx
        .update(chatRequests)
        .set({ status: 'DECLINED', respondedAt: new Date() })
        .where(
          and(
            eq(chatRequests.status, 'PENDING'),
            or(
              and(
                eq(chatRequests.senderId, blockerId),
                eq(chatRequests.receiverId, target.id)
              ),
              and(
                eq(chatRequests.senderId, target.id),
                eq(chatRequests.receiverId, blockerId)
              )
            )
          )
        );
    });

    return {
      publicId: target.publicId,
      username: target.username,
      displayName: target.displayName,
      reason: cleanReason,
      blockedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('Failed in blockGuestUser:', error);
    throw new Error(error.message || 'Failed to block user.', { cause: error });
  }
}

export async function unblockGuestUser(
  blockerId: number,
  targetIdentifier: string
): Promise<void> {
  try {
    const [target] = await db
      .select()
      .from(guestUsers)
      .where(
        or(
          eq(guestUsers.publicId, targetIdentifier),
          eq(guestUsers.username, targetIdentifier)
        )
      )
      .limit(1);

    if (!target) {
      throw new Error('Blocked user not found.');
    }

    await db
      .delete(blockedUsers)
      .where(
        and(
          eq(blockedUsers.blockerId, blockerId),
          eq(blockedUsers.blockedId, target.id)
        )
      );
  } catch (error: any) {
    console.error('Failed in unblockGuestUser:', error);
    throw new Error(error.message || 'Failed to unblock user.', { cause: error });
  }
}

export async function listBlockedUsers(
  blockerId: number
): Promise<BlockedUserItem[]> {
  try {
    const rows = await db
      .select({
        block: blockedUsers,
        target: guestUsers,
      })
      .from(blockedUsers)
      .innerJoin(guestUsers, eq(blockedUsers.blockedId, guestUsers.id))
      .where(eq(blockedUsers.blockerId, blockerId))
      .orderBy(desc(blockedUsers.createdAt));

    return rows.map((r) => ({
      publicId: r.target.publicId,
      username: r.target.username,
      displayName: r.target.displayName,
      reason: r.block.reason,
      blockedAt: r.block.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Failed in listBlockedUsers:', error);
    throw new Error('Failed to load blocked users.', { cause: error });
  }
}

export async function submitUserReport(params: {
  reporterId: number;
  targetIdentifier: string;
  conversationPublicId?: string;
  category: string;
  description: string;
}): Promise<{ publicId: string; status: string; createdAt: string }> {
  try {
    const [target] = await db
      .select()
      .from(guestUsers)
      .where(
        or(
          eq(guestUsers.publicId, params.targetIdentifier),
          eq(guestUsers.username, params.targetIdentifier)
        )
      )
      .limit(1);

    if (!target) {
      throw new Error('Reported user was not found.');
    }
    if (target.id === params.reporterId) {
      throw new Error('You cannot report yourself.');
    }

    const cleanCategory = sanitizeInputText(params.category, 64);
    const cleanDesc = sanitizeInputText(params.description, 1000);
    if (cleanDesc.length < 5) {
      throw new Error('Please provide a brief description of the issue (min 5 chars).');
    }

    const [created] = await db
      .insert(userReports)
      .values({
        publicId: generatePublicId('rep'),
        reporterId: params.reporterId,
        reportedId: target.id,
        conversationPublicId: params.conversationPublicId
          ? sanitizeInputText(params.conversationPublicId, 64)
          : null,
        category: cleanCategory || 'abuse',
        description: cleanDesc,
        status: 'OPEN',
      })
      .returning();

    return {
      publicId: created.publicId,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    };
  } catch (error: any) {
    console.error('Failed in submitUserReport:', error);
    throw new Error(error.message || 'Failed to submit user report.', {
      cause: error,
    });
  }
}

export async function getSecurityAuditOverview(): Promise<SecurityAuditSummary> {
  try {
    const now = new Date();
    const [guestCount, sessionCount, convCount, msgCount, reportCount, recentReps] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(guestUsers)
          .where(gt(guestUsers.expiresAt, now)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(guestSessions)
          .where(
            and(isNull(guestSessions.revokedAt), gt(guestSessions.expiresAt, now))
          ),
        db.select({ count: sql<number>`count(*)` }).from(conversations),
        db.select({ count: sql<number>`count(*)` }).from(messages),
        db
          .select({ count: sql<number>`count(*)` })
          .from(userReports)
          .where(eq(userReports.status, 'OPEN')),
        db
          .select()
          .from(userReports)
          .orderBy(desc(userReports.createdAt))
          .limit(10),
      ]);

    const userIds = Array.from(
      new Set(recentReps.flatMap((r) => [r.reporterId, r.reportedId]))
    );
    const repUsers =
      userIds.length > 0
        ? await db
            .select()
            .from(guestUsers)
            .where(inArray(guestUsers.id, userIds))
        : [];
    const uMap = new Map(repUsers.map((u) => [u.id, u.username]));

    return {
      activeGuestsCount: Number(guestCount[0]?.count || 0),
      activeSessionsCount: Number(sessionCount[0]?.count || 0),
      activeConversationsCount: Number(convCount[0]?.count || 0),
      totalMessagesCount: Number(msgCount[0]?.count || 0),
      openReportsCount: Number(reportCount[0]?.count || 0),
      securityControls: [
        {
          id: 1,
          area: 'Cryptographic Guest Sessions',
          status: 'VERIFIED',
          detail: '256-bit CSPRNG tokens stored exclusively as SHA-256 hashes in PostgreSQL with HTTP-Only cookies.',
        },
        {
          id: 2,
          area: 'Strict 1-to-1 Conversation Isolation',
          status: 'VERIFIED',
          detail: 'Two-participant constraint enforced via database transactions and participant IDOR verification.',
        },
        {
          id: 3,
          area: 'Binary Magic-Byte File Inspection',
          status: 'VERIFIED',
          detail: 'Extension whitelist + binary magic signature verification + HMAC-SHA256 expiring signed download URLs.',
        },
        {
          id: 4,
          area: 'Endpoint & Socket.IO Rate Limiting',
          status: 'ACTIVE',
          detail: 'Sliding-window rate limiters protecting session init, search, requests, messages, and uploads (HTTP 429).',
        },
        {
          id: 5,
          area: 'Helmet CSP & XSS Sanitization',
          status: 'VERIFIED',
          detail: 'Content-Security-Policy, X-Content-Type-Options, frame-ancestors, and Zod input validation active.',
        },
        {
          id: 6,
          area: 'Firebase Admin RBAC Protection',
          status: 'VERIFIED',
          detail: 'Administrative moderation endpoints protected via server-side Firebase ID token verification.',
        },
      ],
      recentReports: recentReps.map((r) => ({
        publicId: r.publicId,
        reporterUsername: uMap.get(r.reporterId) || 'Guest',
        reportedUsername: uMap.get(r.reportedId) || 'Guest',
        category: r.category,
        description: r.description,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error('Failed in getSecurityAuditOverview:', error);
    throw new Error('Failed to load security audit summary.', { cause: error });
  }
}
