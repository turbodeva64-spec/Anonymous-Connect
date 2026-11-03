import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { api, getIsolatedSessionToken } from '../services/api.ts';
import type {
  BlockedUserItem,
  ChatMessageItem,
  ChatRequestItem,
  ConversationSummary,
  PublicGuestProfile,
} from '../types/index.ts';

export interface ToastNotice {
  id: string;
  type: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
}

interface AppContextValue {
  user: PublicGuestProfile | null;
  sessionExpiresAt: string | null;
  loadingSession: boolean;
  socketConnected: boolean;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onlineUsers: PublicGuestProfile[];
  conversations: ConversationSummary[];
  incomingRequests: ChatRequestItem[];
  outgoingRequests: ChatRequestItem[];
  blockedUsers: BlockedUserItem[];
  typingByConversation: Record<string, string | null>;
  toasts: ToastNotice[];
  addToast: (type: ToastNotice['type'], title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  initializeOrRestoreSession: (forceNew?: boolean) => Promise<PublicGuestProfile | null>;
  refreshAllData: () => Promise<void>;
  updateProfile: (updates: {
    displayName?: string;
    isDiscoverable?: boolean;
  }) => Promise<PublicGuestProfile>;
  endCurrentSession: () => Promise<void>;
  sendChatRequest: (targetUser: string, introMessage?: string) => Promise<void>;
  acceptChatRequest: (requestPublicId: string) => Promise<string>;
  declineChatRequest: (requestPublicId: string) => Promise<void>;
  cancelChatRequest: (requestPublicId: string) => Promise<void>;
  blockUser: (targetUser: string, reason?: string) => Promise<void>;
  unblockUser: (targetUser: string) => Promise<void>;
  emitTyping: (conversationId: string, isTyping: boolean) => void;
  joinConversationRoom: (conversationId: string) => void;
  leaveConversationRoom: (conversationId: string) => void;
  socketRef: React.MutableRefObject<Socket | null>;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<PublicGuestProfile | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved =
      typeof window !== 'undefined' ? localStorage.getItem('ac_theme') : null;
    return saved === 'light' ? 'light' : 'dark';
  });

  const [onlineUsers, setOnlineUsers] = useState<PublicGuestProfile[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<ChatRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<ChatRequestItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [typingByConversation, setTypingByConversation] = useState<
    Record<string, string | null>
  >({});
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  const socketRef = useRef<Socket | null>(null);

  // Sync dark/light class on <html> and <body>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      document.body.className =
        'bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white';
    } else {
      root.classList.remove('dark');
      document.body.className =
        'bg-slate-50 text-slate-900 antialiased selection:bg-indigo-600 selection:text-white';
    }
    try {
      localStorage.setItem('ac_theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastNotice['type'], title: string, detail?: string) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const refreshAllData = useCallback(async () => {
    try {
      const [onlineRes, convRes, incRes, outRes, blkRes] = await Promise.all([
        api.getOnlineUsers(),
        api.getConversations(),
        api.getIncomingRequests(),
        api.getOutgoingRequests(),
        api.getBlockedUsers(),
      ]);
      setOnlineUsers(onlineRes.users);
      setConversations(convRes.conversations);
      setIncomingRequests(incRes.requests);
      setOutgoingRequests(outRes.requests);
      setBlockedUsers(blkRes.blockedUsers);
    } catch (err) {
      // Quietly handle if session not ready
    }
  }, []);

  const initializeOrRestoreSession = useCallback(
    async (forceNew = false): Promise<PublicGuestProfile | null> => {
      setLoadingSession(true);
      try {
        const res = await api.initializeGuest({ forceNew });
        setUser(res.user);
        setSessionExpiresAt(res.sessionExpiresAt);
        await refreshAllData();
        return res.user;
      } catch (err: any) {
        addToast('error', 'Session Error', err.message);
        return null;
      } finally {
        setLoadingSession(false);
      }
    },
    [refreshAllData, addToast]
  );

  // Restore existing session or initialize new temporary guest identity on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.initializeGuest({ forceNew: false });
        if (!mounted) return;
        setUser(res.user);
        setSessionExpiresAt(res.sessionExpiresAt);
        await refreshAllData();
      } catch {
        // Handled quietly
      } finally {
        if (mounted) {
          setLoadingSession(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshAllData]);

  // Connect Socket.IO whenever a valid guest session is active
  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocketConnected(false);
      return;
    }

    const isolatedToken = getIsolatedSessionToken();
    const socket = io({
      withCredentials: true,
      auth: isolatedToken ? { sessionToken: isolatedToken } : undefined,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      refreshAllData();
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on(
      'user:presence',
      (payload: {
        publicId: string;
        username: string;
        displayName: string;
        isOnline: boolean;
        lastSeenAt: string;
      }) => {
        if (payload.publicId === user.publicId) return;
        setOnlineUsers((prev) => {
          const exists = prev.some((u) => u.publicId === payload.publicId);
          if (!payload.isOnline) {
            return prev.filter((u) => u.publicId !== payload.publicId);
          }
          if (exists) {
            return prev.map((u) =>
              u.publicId === payload.publicId
                ? { ...u, ...payload, isOnline: true }
                : u
            );
          }
          return [
            {
              publicId: payload.publicId,
              username: payload.username,
              displayName: payload.displayName,
              isDiscoverable: true,
              isOnline: true,
              lastSeenAt: payload.lastSeenAt,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ];
        });

        setConversations((prev) =>
          prev.map((c) =>
            c.peer.publicId === payload.publicId
              ? {
                  ...c,
                  peer: {
                    ...c.peer,
                    isOnline: payload.isOnline,
                    lastSeenAt: payload.lastSeenAt,
                    displayName: payload.displayName,
                  },
                }
              : c
          )
        );
      }
    );

    socket.on('user:updated', (updatedPeer: PublicGuestProfile) => {
      setOnlineUsers((prev) =>
        prev.map((u) =>
          u.publicId === updatedPeer.publicId ? updatedPeer : u
        )
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.peer.publicId === updatedPeer.publicId
            ? { ...c, peer: updatedPeer }
            : c
        )
      );
    });

    socket.on('request:incoming', (newReq: ChatRequestItem) => {
      setIncomingRequests((prev) => {
        if (prev.some((r) => r.publicId === newReq.publicId)) return prev;
        return [newReq, ...prev];
      });
      addToast(
        'info',
        'New Chat Request',
        `${newReq.sender.displayName} (@${newReq.sender.username}) wants to chat privately.`
      );
    });

    socket.on(
      'request:accepted',
      (payload: { request: ChatRequestItem; conversationPublicId: string }) => {
        setIncomingRequests((prev) =>
          prev.map((r) =>
            r.publicId === payload.request.publicId ? payload.request : r
          )
        );
        setOutgoingRequests((prev) =>
          prev.map((r) =>
            r.publicId === payload.request.publicId ? payload.request : r
          )
        );
        refreshAllData();
        if (payload.request.sender.publicId === user.publicId) {
          addToast(
            'success',
            'Chat Request Accepted',
            `${payload.request.receiver.displayName} accepted your private chat request.`
          );
        }
      }
    );

    socket.on('request:declined', (updatedReq: ChatRequestItem) => {
      setOutgoingRequests((prev) =>
        prev.map((r) =>
          r.publicId === updatedReq.publicId ? updatedReq : r
        )
      );
    });

    socket.on('request:cancelled', (updatedReq: ChatRequestItem) => {
      setIncomingRequests((prev) =>
        prev.map((r) =>
          r.publicId === updatedReq.publicId ? updatedReq : r
        )
      );
    });

    socket.on('message:new', (msg: ChatMessageItem) => {
      setConversations((prev) => {
        const exists = prev.some(
          (c) => c.publicId === msg.conversationPublicId
        );
        if (!exists) {
          refreshAllData();
          return prev;
        }
        return prev
          .map((c) => {
            if (c.publicId !== msg.conversationPublicId) return c;
            const isFromPeer = msg.senderPublicId !== user.publicId;
            const isViewingConv = window.location.pathname.includes(
              msg.conversationPublicId
            );
            return {
              ...c,
              lastMessage: msg,
              lastMessageAt: msg.createdAt,
              unreadCount:
                isFromPeer && !isViewingConv ? c.unreadCount + 1 : c.unreadCount,
            };
          })
          .sort(
            (a, b) =>
              new Date(b.lastMessageAt).getTime() -
              new Date(a.lastMessageAt).getTime()
          );
      });

      window.dispatchEvent(
        new CustomEvent('ac:message:new', { detail: msg })
      );
    });

    socket.on(
      'message:read',
      (payload: {
        conversationId: string;
        messageIds: string[];
        readAt: string;
      }) => {
        window.dispatchEvent(
          new CustomEvent('ac:message:read', { detail: payload })
        );
      }
    );

    socket.on(
      'message:deleted',
      (payload: { messagePublicId: string; conversationPublicId: string }) => {
        window.dispatchEvent(
          new CustomEvent('ac:message:deleted', { detail: payload })
        );
        refreshAllData();
      }
    );

    socket.on(
      'message:reaction',
      (payload: {
        conversationPublicId: string;
        messagePublicId: string;
        reactions: any[];
      }) => {
        window.dispatchEvent(
          new CustomEvent('ac:message:reaction', { detail: payload })
        );
      }
    );

    socket.on(
      'typing:indicator',
      (payload: {
        conversationId: string;
        userPublicId: string;
        username: string;
        isTyping: boolean;
      }) => {
        setTypingByConversation((prev) => ({
          ...prev,
          [payload.conversationId]: payload.isTyping ? payload.username : null,
        }));
      }
    );

    socket.on('user:block-changed', (payload: any) => {
      refreshAllData();
      window.dispatchEvent(
        new CustomEvent('ac:block:changed', { detail: payload })
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, refreshAllData, addToast]);

  const updateProfile = useCallback(
    async (updates: { displayName?: string; isDiscoverable?: boolean }) => {
      try {
        const res = await api.updateProfile(updates);
        setUser(res.user);
        addToast(
          'success',
          'Profile Updated',
          'Your temporary identity preferences were saved.'
        );
        return res.user;
      } catch (err: any) {
        addToast(
          'error',
          'Profile Update Error',
          err?.message || 'Could not update profile.'
        );
        throw err;
      }
    },
    [addToast]
  );

  const endCurrentSession = useCallback(async () => {
    try {
      await api.endSession();
    } catch {
      // Ignore network/session errors when ending session
    } finally {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setUser(null);
      setSessionExpiresAt(null);
      setConversations([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setBlockedUsers([]);
      addToast(
        'info',
        'Session Ended',
        'Your temporary guest session has been revoked.'
      );
    }
  }, [addToast]);

  const sendChatRequest = useCallback(
    async (targetUser: string, introMessage?: string) => {
      try {
        const res = await api.sendChatRequest(targetUser, introMessage);
        setOutgoingRequests((prev) => [
          res.request,
          ...prev.filter((r) => r.publicId !== res.request.publicId),
        ]);
        addToast(
          'success',
          'Chat Request Sent',
          `Request sent to @${res.request.receiver.username}.`
        );
      } catch (err: any) {
        addToast(
          'error',
          'Request Failed',
          err?.message || 'Could not send chat request.'
        );
      }
    },
    [addToast]
  );

  const acceptChatRequest = useCallback(
    async (requestPublicId: string): Promise<string> => {
      const res = await api.acceptRequest(requestPublicId);
      setIncomingRequests((prev) =>
        prev.map((r) => (r.publicId === requestPublicId ? res.request : r))
      );
      await refreshAllData();
      addToast(
        'success',
        'Request Accepted',
        'Private 1-to-1 channel is now open.'
      );
      return res.conversationPublicId;
    },
    [refreshAllData, addToast]
  );

  const declineChatRequest = useCallback(
    async (requestPublicId: string) => {
      try {
        const res = await api.declineRequest(requestPublicId);
        setIncomingRequests((prev) =>
          prev.map((r) => (r.publicId === requestPublicId ? res.request : r))
        );
        addToast('info', 'Request Declined', 'The chat request was declined.');
      } catch (err: any) {
        addToast(
          'error',
          'Action Failed',
          err?.message || 'Could not decline request.'
        );
      }
    },
    [addToast]
  );

  const cancelChatRequest = useCallback(
    async (requestPublicId: string) => {
      try {
        const res = await api.cancelRequest(requestPublicId);
        setOutgoingRequests((prev) =>
          prev.map((r) => (r.publicId === requestPublicId ? res.request : r))
        );
        addToast(
          'info',
          'Request Cancelled',
          'Your outgoing request was cancelled.'
        );
      } catch (err: any) {
        addToast(
          'error',
          'Action Failed',
          err?.message || 'Could not cancel request.'
        );
      }
    },
    [addToast]
  );

  const blockUser = useCallback(
    async (targetUser: string, reason?: string) => {
      try {
        const res = await api.blockUser(targetUser, reason);
        setBlockedUsers((prev) => [
          res.blockedUser,
          ...prev.filter((b) => b.publicId !== res.blockedUser.publicId),
        ]);
        await refreshAllData();
        addToast(
          'info',
          'User Blocked',
          `@${res.blockedUser.username} has been blocked.`
        );
      } catch (err: any) {
        addToast(
          'error',
          'Block Error',
          err?.message || 'Could not block user.'
        );
        throw err;
      }
    },
    [refreshAllData, addToast]
  );

  const unblockUser = useCallback(
    async (targetUser: string) => {
      try {
        await api.unblockUser(targetUser);
        setBlockedUsers((prev) =>
          prev.filter(
            (b) => b.publicId !== targetUser && b.username !== targetUser
          )
        );
        await refreshAllData();
        addToast(
          'info',
          'User Unblocked',
          'User has been removed from your block list.'
        );
      } catch (err: any) {
        addToast(
          'error',
          'Unblock Error',
          err?.message || 'Could not unblock user.'
        );
      }
    },
    [refreshAllData, addToast]
  );

  const emitTyping = useCallback((conversationId: string, isTyping: boolean) => {
    socketRef.current?.emit('typing:update', { conversationId, isTyping });
  }, []);

  const joinConversationRoom = useCallback((conversationId: string) => {
    socketRef.current?.emit('conversation:join', { conversationId });
  }, []);

  const leaveConversationRoom = useCallback((conversationId: string) => {
    socketRef.current?.emit('conversation:leave', { conversationId });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      sessionExpiresAt,
      loadingSession,
      socketConnected,
      theme,
      toggleTheme,
      onlineUsers,
      conversations,
      incomingRequests,
      outgoingRequests,
      blockedUsers,
      typingByConversation,
      toasts,
      addToast,
      dismissToast,
      initializeOrRestoreSession,
      refreshAllData,
      updateProfile,
      endCurrentSession,
      sendChatRequest,
      acceptChatRequest,
      declineChatRequest,
      cancelChatRequest,
      blockUser,
      unblockUser,
      emitTyping,
      joinConversationRoom,
      leaveConversationRoom,
      socketRef,
    }),
    [
      user,
      sessionExpiresAt,
      loadingSession,
      socketConnected,
      theme,
      toggleTheme,
      onlineUsers,
      conversations,
      incomingRequests,
      outgoingRequests,
      blockedUsers,
      typingByConversation,
      toasts,
      addToast,
      dismissToast,
      initializeOrRestoreSession,
      refreshAllData,
      updateProfile,
      endCurrentSession,
      sendChatRequest,
      acceptChatRequest,
      declineChatRequest,
      cancelChatRequest,
      blockUser,
      unblockUser,
      emitTyping,
      joinConversationRoom,
      leaveConversationRoom,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
}
