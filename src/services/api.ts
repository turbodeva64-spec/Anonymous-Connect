import type {
  AttachmentMetadata,
  BlockedUserItem,
  ChatMessageItem,
  ChatRequestItem,
  ConversationSummary,
  GuestSessionInfo,
  PublicGuestProfile,
  SecurityAuditSummary,
} from '../types/index.ts';

const ISOLATED_TOKEN_KEY = 'ac_isolated_session_token';
const PERSISTED_TOKEN_KEY = 'ac_guest_session_token';
const PERSISTED_CSRF_KEY = 'ac_guest_csrf_token';

let inMemorySessionToken = '';
let inMemoryCsrfToken = '';

export function isIsolatedTabMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('isolated') === '1' ||
      Boolean(window.sessionStorage.getItem(ISOLATED_TOKEN_KEY))
    );
  } catch {
    return false;
  }
}

export function getActiveSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  if (typeof window === 'undefined') return null;
  try {
    const isolated = window.sessionStorage.getItem(ISOLATED_TOKEN_KEY);
    if (isolated) {
      inMemorySessionToken = isolated;
      return isolated;
    }
    const persisted = window.localStorage.getItem(PERSISTED_TOKEN_KEY);
    if (persisted) {
      inMemorySessionToken = persisted;
      return persisted;
    }
  } catch {
    // Ignore storage access errors in restricted iframes
  }
  return null;
}

export function getIsolatedSessionToken(): string | null {
  return getActiveSessionToken();
}

export function setActiveSessionToken(
  token: string | null,
  isolated = false
): void {
  inMemorySessionToken = token || '';
  if (typeof window === 'undefined') return;
  try {
    if (!token) {
      window.sessionStorage.removeItem(ISOLATED_TOKEN_KEY);
      window.localStorage.removeItem(PERSISTED_TOKEN_KEY);
      return;
    }
    if (isolated || isIsolatedTabMode()) {
      window.sessionStorage.setItem(ISOLATED_TOKEN_KEY, token);
    } else {
      window.localStorage.setItem(PERSISTED_TOKEN_KEY, token);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getCsrfToken(): string {
  if (inMemoryCsrfToken) return inMemoryCsrfToken;
  if (typeof window === 'undefined') return '';
  try {
    const saved = window.localStorage.getItem(PERSISTED_CSRF_KEY);
    if (saved) {
      inMemoryCsrfToken = saved;
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return '';
}

export function setCsrfToken(token: string): void {
  inMemoryCsrfToken = token || '';
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(PERSISTED_CSRF_KEY, token);
    } else {
      window.localStorage.removeItem(PERSISTED_CSRF_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

async function performRawFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const csrf = getCsrfToken();
  if (csrf && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', csrf);
  }
  const sessionToken = getActiveSessionToken();
  if (sessionToken && !headers.has('X-Guest-Session')) {
    headers.set('X-Guest-Session', sessionToken);
  }

  return fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const response = await performRawFetch(path, options);

  // If guest session expired or cookie was blocked in iframe, auto-reinitialize once
  if (
    response.status === 401 &&
    !isRetry &&
    !path.startsWith('/api/guest/initialize') &&
    !path.startsWith('/api/guest/me') &&
    !path.startsWith('/api/admin/')
  ) {
    try {
      await api.initializeGuest({ forceNew: false });
      return requestJson<T>(path, options, true);
    } catch {
      // Fall through to standard error handling
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  async initializeGuest(options?: {
    forceNew?: boolean;
    isolatedMode?: boolean;
  }): Promise<
    GuestSessionInfo & {
      isNew: boolean;
      sessionToken?: string;
      isolatedSessionHeader?: string;
    }
  > {
    const isolated = options?.isolatedMode ?? isIsolatedTabMode();
    if (options?.forceNew) {
      setActiveSessionToken(null, isolated);
      setCsrfToken('');
    }
    const res = await requestJson<
      GuestSessionInfo & {
        isNew: boolean;
        sessionToken?: string;
        isolatedSessionHeader?: string;
      }
    >(
      '/api/guest/initialize',
      {
        method: 'POST',
        body: JSON.stringify({
          forceNew: Boolean(options?.forceNew),
          isolatedMode: isolated,
        }),
      },
      true
    );

    setCsrfToken(res.csrfToken);
    const tokenToStore = res.isolatedSessionHeader || res.sessionToken;
    if (tokenToStore) {
      setActiveSessionToken(tokenToStore, isolated);
    }
    return res;
  },

  async getMe(): Promise<GuestSessionInfo> {
    const res = await requestJson<GuestSessionInfo>('/api/guest/me', {}, true);
    setCsrfToken(res.csrfToken);
    return res;
  },

  async updateProfile(payload: {
    displayName?: string;
    isDiscoverable?: boolean;
  }): Promise<{ user: PublicGuestProfile }> {
    return requestJson<{ user: PublicGuestProfile }>('/api/guest/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async updateDiscoverability(
    isDiscoverable: boolean
  ): Promise<{ user: PublicGuestProfile }> {
    return requestJson<{ user: PublicGuestProfile }>(
      '/api/users/discoverability',
      {
        method: 'PATCH',
        body: JSON.stringify({ isDiscoverable }),
      }
    );
  },

  async endSession(): Promise<{ ok: boolean }> {
    try {
      const res = await requestJson<{ ok: boolean }>(
        '/api/guest/end-session',
        {
          method: 'POST',
        },
        true
      );
      return res;
    } catch {
      return { ok: true };
    } finally {
      setCsrfToken('');
      setActiveSessionToken(null);
    }
  },

  async searchUsers(query: string): Promise<{ users: PublicGuestProfile[] }> {
    return requestJson<{ users: PublicGuestProfile[] }>(
      `/api/users/search?q=${encodeURIComponent(query)}`
    );
  },

  async getOnlineUsers(): Promise<{ users: PublicGuestProfile[] }> {
    return requestJson<{ users: PublicGuestProfile[] }>('/api/users/online');
  },

  async sendChatRequest(
    targetUser: string,
    introMessage?: string
  ): Promise<{ request: ChatRequestItem }> {
    return requestJson<{ request: ChatRequestItem }>('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ targetUser, introMessage }),
    });
  },

  async getIncomingRequests(): Promise<{ requests: ChatRequestItem[] }> {
    return requestJson<{ requests: ChatRequestItem[] }>(
      '/api/requests/incoming'
    );
  },

  async getOutgoingRequests(): Promise<{ requests: ChatRequestItem[] }> {
    return requestJson<{ requests: ChatRequestItem[] }>(
      '/api/requests/outgoing'
    );
  },

  async acceptRequest(
    requestPublicId: string
  ): Promise<{ request: ChatRequestItem; conversationPublicId: string }> {
    return requestJson<{
      request: ChatRequestItem;
      conversationPublicId: string;
    }>(`/api/requests/${encodeURIComponent(requestPublicId)}/accept`, {
      method: 'POST',
    });
  },

  async declineRequest(
    requestPublicId: string
  ): Promise<{ request: ChatRequestItem }> {
    return requestJson<{ request: ChatRequestItem }>(
      `/api/requests/${encodeURIComponent(requestPublicId)}/decline`,
      {
        method: 'POST',
      }
    );
  },

  async cancelRequest(
    requestPublicId: string
  ): Promise<{ request: ChatRequestItem }> {
    return requestJson<{ request: ChatRequestItem }>(
      `/api/requests/${encodeURIComponent(requestPublicId)}`,
      {
        method: 'DELETE',
      }
    );
  },

  async getConversations(): Promise<{ conversations: ConversationSummary[] }> {
    return requestJson<{ conversations: ConversationSummary[] }>(
      '/api/conversations'
    );
  },

  async getConversation(
    conversationPublicId: string
  ): Promise<{ conversation: ConversationSummary }> {
    return requestJson<{ conversation: ConversationSummary }>(
      `/api/conversations/${encodeURIComponent(conversationPublicId)}`
    );
  },

  async getMessages(
    conversationPublicId: string,
    limit = 60
  ): Promise<{ messages: ChatMessageItem[] }> {
    return requestJson<{ messages: ChatMessageItem[] }>(
      `/api/conversations/${encodeURIComponent(conversationPublicId)}/messages?limit=${limit}`
    );
  },

  async sendMessage(payload: {
    conversationId: string;
    clientMessageId: string;
    content: string;
    attachmentIds?: string[];
  }): Promise<{ message: ChatMessageItem }> {
    return requestJson<{ message: ChatMessageItem }>('/api/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteMessage(messagePublicId: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(
      `/api/messages/${encodeURIComponent(messagePublicId)}`,
      {
        method: 'DELETE',
      }
    );
  },

  async markMessagesRead(
    idOrConvPublicId: string
  ): Promise<{ ok: boolean; readMessagePublicIds: string[] }> {
    return requestJson<{ ok: boolean; readMessagePublicIds: string[] }>(
      `/api/messages/${encodeURIComponent(idOrConvPublicId)}/read`,
      {
        method: 'POST',
      }
    );
  },

  async toggleReaction(
    messagePublicId: string,
    emoji: string
  ): Promise<{ message: ChatMessageItem }> {
    return requestJson<{ message: ChatMessageItem }>(
      `/api/messages/${encodeURIComponent(messagePublicId)}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }
    );
  },

  async uploadAttachment(
    conversationId: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<{ attachment: AttachmentMetadata }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('conversationId', conversationId);
      formData.append('file', file);

      xhr.open('POST', '/api/attachments/upload', true);
      xhr.withCredentials = true;

      const csrf = getCsrfToken();
      if (csrf) {
        xhr.setRequestHeader('X-CSRF-Token', csrf);
      }
      const sessionToken = getActiveSessionToken();
      if (sessionToken) {
        xhr.setRequestHeader('X-Guest-Session', sessionToken);
      }

      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
      }

      xhr.onload = () => {
        try {
          const parsed = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed);
          } else {
            reject(
              new Error(parsed.error || `Upload failed (${xhr.status})`)
            );
          }
        } catch {
          reject(new Error('Invalid server response during file upload.'));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error while uploading attachment.'));
      };

      xhr.send(formData);
    });
  },

  async getBlockedUsers(): Promise<{ blockedUsers: BlockedUserItem[] }> {
    return requestJson<{ blockedUsers: BlockedUserItem[] }>(
      '/api/users/blocked'
    );
  },

  async blockUser(
    targetUser: string,
    reason?: string
  ): Promise<{ blockedUser: BlockedUserItem }> {
    return requestJson<{ blockedUser: BlockedUserItem }>(
      `/api/users/${encodeURIComponent(targetUser)}/block`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    );
  },

  async unblockUser(targetUser: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(
      `/api/users/${encodeURIComponent(targetUser)}/block`,
      {
        method: 'DELETE',
      }
    );
  },

  async submitReport(payload: {
    reportedUser: string;
    conversationId?: string;
    category:
      | 'harassment'
      | 'spam'
      | 'malicious_file'
      | 'impersonation'
      | 'other';
    description: string;
  }): Promise<{ report: { publicId: string; status: string } }> {
    return requestJson<{ report: { publicId: string; status: string } }>(
      '/api/reports',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  async getAdminSecurityAudit(
    firebaseIdToken: string
  ): Promise<{ audit: SecurityAuditSummary }> {
    return requestJson<{ audit: SecurityAuditSummary }>(
      '/api/admin/audit',
      {
        headers: {
          Authorization: `Bearer ${firebaseIdToken}`,
        },
      },
      true
    );
  },
};
