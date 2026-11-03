export interface PublicGuestProfile {
  publicId: string;
  username: string;
  displayName: string;
  isDiscoverable: boolean;
  isOnline: boolean;
  lastSeenAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface GuestSessionInfo {
  user: PublicGuestProfile;
  csrfToken: string;
  sessionExpiresAt: string;
}

export interface ChatRequestItem {
  publicId: string;
  sender: PublicGuestProfile;
  receiver: PublicGuestProfile;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  introMessage: string | null;
  respondedAt: string | null;
  createdAt: string;
  conversationPublicId?: string;
}

export interface AttachmentMetadata {
  publicId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  category: 'image' | 'video' | 'audio' | 'document' | 'spreadsheet';
  sha256Checksum: string;
  downloadUrl: string;
  createdAt: string;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  users: string[]; // publicIds of reactors
}

export interface ChatMessageItem {
  publicId: string;
  clientMessageId: string;
  conversationPublicId: string;
  senderPublicId: string;
  senderUsername: string;
  senderDisplayName: string;
  content: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  isDeleted: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  attachments: AttachmentMetadata[];
  reactions: MessageReactionSummary[];
}

export interface ConversationSummary {
  publicId: string;
  peer: PublicGuestProfile;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
  lastMessage: ChatMessageItem | null;
  isPeerBlocked: boolean;
  hasBlockedMe: boolean;
}

export interface BlockedUserItem {
  publicId: string;
  username: string;
  displayName: string;
  reason: string | null;
  blockedAt: string;
}

export interface SecurityAuditSummary {
  activeGuestsCount: number;
  activeSessionsCount: number;
  activeConversationsCount: number;
  totalMessagesCount: number;
  openReportsCount: number;
  securityControls: {
    id: number;
    area: string;
    status: 'VERIFIED' | 'ACTIVE';
    detail: string;
  }[];
  recentReports: {
    publicId: string;
    reporterUsername: string;
    reportedUsername: string;
    category: string;
    description: string;
    status: string;
    createdAt: string;
  }[];
}
