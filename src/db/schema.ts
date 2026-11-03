import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 0. Firebase Admin / Moderator Users Table (Mandatory for Cloud SQL Firebase Auth integration)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 1. GuestUser
export const guestUsers = pgTable(
  'guest_users',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull(),
    isDiscoverable: boolean('is_discoverable').notNull().default(true),
    isOnline: boolean('is_online').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_guest_users_username').on(table.username),
    uniqueIndex('idx_guest_users_public_id').on(table.publicId),
    index('idx_guest_users_online_discoverable').on(table.isOnline, table.isDiscoverable),
  ]
);

// 2. GuestSession
export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: serial('id').primaryKey(),
    guestUserId: integer('guest_user_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    userAgent: text('user_agent').notNull().default('unknown'),
    ipHash: text('ip_hash').notNull().default('unknown'),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_guest_sessions_token_hash').on(table.tokenHash),
    index('idx_guest_sessions_user_id').on(table.guestUserId),
  ]
);

// 3. Conversation (Strictly 2 distinct participants)
export const conversations = pgTable(
  'conversations',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    participantOneId: integer('participant_one_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    participantTwoId: integer('participant_two_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_conversations_public_id').on(table.publicId),
    index('idx_conversations_p1').on(table.participantOneId),
    index('idx_conversations_p2').on(table.participantTwoId),
  ]
);

// 4. ConversationParticipant
export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    guestUserId: integer('guest_user_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    unreadCount: integer('unread_count').notNull().default(0),
    lastReadAt: timestamp('last_read_at').defaultNow().notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_conv_participant_unique').on(table.conversationId, table.guestUserId),
    index('idx_conv_participant_user').on(table.guestUserId),
  ]
);

// 5. ChatRequest
export const chatRequests = pgTable(
  'chat_requests',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    senderId: integer('sender_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    receiverId: integer('receiver_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | ACCEPTED | DECLINED | CANCELLED
    introMessage: text('intro_message'),
    respondedAt: timestamp('responded_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_chat_requests_public_id').on(table.publicId),
    index('idx_chat_requests_sender').on(table.senderId, table.status),
    index('idx_chat_requests_receiver').on(table.receiverId, table.status),
  ]
);

// 6. Message
export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    clientMessageId: text('client_message_id').notNull().unique(),
    conversationId: integer('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    senderId: integer('sender_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    content: text('content').notNull().default(''),
    status: text('status').notNull().default('SENT'), // SENT | DELIVERED | READ
    isDeleted: boolean('is_deleted').notNull().default(false),
    deliveredAt: timestamp('delivered_at'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_messages_public_id').on(table.publicId),
    uniqueIndex('idx_messages_client_id').on(table.clientMessageId),
    index('idx_messages_conversation').on(table.conversationId, table.createdAt),
  ]
);

// 7. Attachment
export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    messageId: integer('message_id').references(() => messages.id, { onDelete: 'set null' }),
    conversationId: integer('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    uploaderId: integer('uploader_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    originalName: text('original_name').notNull(),
    storageName: text('storage_name').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    extension: text('extension').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    category: text('category').notNull(), // image | video | audio | document | spreadsheet
    dataBase64: text('data_base64').notNull(),
    sha256Checksum: text('sha256_checksum').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_attachments_public_id').on(table.publicId),
    index('idx_attachments_message_id').on(table.messageId),
    index('idx_attachments_conversation_id').on(table.conversationId),
  ]
);

// 8. MessageReaction
export const messageReactions = pgTable(
  'message_reactions',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    guestUserId: integer('guest_user_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_message_reactions_unique').on(
      table.messageId,
      table.guestUserId,
      table.emoji
    ),
    index('idx_message_reactions_message').on(table.messageId),
  ]
);

// 9. BlockedUser
export const blockedUsers = pgTable(
  'blocked_users',
  {
    id: serial('id').primaryKey(),
    blockerId: integer('blocker_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    blockedId: integer('blocked_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_blocked_users_unique').on(table.blockerId, table.blockedId),
    index('idx_blocked_users_blocker').on(table.blockerId),
    index('idx_blocked_users_blocked').on(table.blockedId),
  ]
);

// 10. UserReport
export const userReports = pgTable(
  'user_reports',
  {
    id: serial('id').primaryKey(),
    publicId: text('public_id').notNull().unique(),
    reporterId: integer('reporter_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    reportedId: integer('reported_id')
      .references(() => guestUsers.id, { onDelete: 'cascade' })
      .notNull(),
    conversationPublicId: text('conversation_public_id'),
    category: text('category').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN | REVIEWED | DISMISSED
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_user_reports_public_id').on(table.publicId),
    index('idx_user_reports_reported').on(table.reportedId),
  ]
);

// Relations
export const guestUsersRelations = relations(guestUsers, ({ many }) => ({
  sessions: many(guestSessions),
  participations: many(conversationParticipants),
  sentMessages: many(messages),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  participants: many(conversationParticipants),
  messages: many(messages),
  attachments: many(attachments),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(guestUsers, {
    fields: [messages.senderId],
    references: [guestUsers.id],
  }),
  attachments: many(attachments),
  reactions: many(messageReactions),
}));
