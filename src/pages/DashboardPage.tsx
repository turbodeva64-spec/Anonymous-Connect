import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Check,
  Compass,
  Eye,
  EyeOff,
  Inbox,
  MessageSquare,
  Search,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { WorkspaceLayout } from '../components/WorkspaceLayout.tsx';

export const DashboardPage: React.FC = () => {
  const {
    user,
    loadingSession,
    initializeOrRestoreSession,
    onlineUsers,
    conversations,
    incomingRequests,
    outgoingRequests,
    sendChatRequest,
    acceptChatRequest,
    declineChatRequest,
    updateProfile,
  } = useApp();

  const navigate = useNavigate();
  const [quickSearch, setQuickSearch] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [processingReq, setProcessingReq] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingSession && !user) {
      initializeOrRestoreSession(false);
    }
  }, [loadingSession, user, initializeOrRestoreSession]);

  const pendingIncoming = incomingRequests.filter(
    (r) => r.status === 'PENDING'
  );
  const pendingOutgoing = outgoingRequests.filter(
    (r) => r.status === 'PENDING'
  );

  const totalUnread = conversations.reduce(
    (sum, c) => sum + (c.unreadCount || 0),
    0
  );

  const handleQuickSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/discover?q=${encodeURIComponent(quickSearch.trim())}`);
  };

  const handleAccept = async (reqPublicId: string) => {
    setProcessingReq(reqPublicId);
    try {
      const convId = await acceptChatRequest(reqPublicId);
      navigate(`/chat/${convId}`);
    } finally {
      setProcessingReq(null);
    }
  };

  const handleDecline = async (reqPublicId: string) => {
    setProcessingReq(reqPublicId);
    try {
      await declineChatRequest(reqPublicId);
    } finally {
      setProcessingReq(null);
    }
  };

  const handleSendRequest = async (username: string) => {
    setSendingTo(username);
    try {
      await sendChatRequest(
        username,
        'Hello! Would you like to start a private 1-to-1 conversation?'
      );
    } catch {
      // Error handled by toast
    } finally {
      setSendingTo(null);
    }
  };

  return (
    <WorkspaceLayout
      title="Dashboard"
      subtitle="Overview of your temporary guest identity, incoming requests, and private conversations"
    >
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Top Summary Strip (No nested cards, clean hairline grid) */}
        <section
          aria-label="Session and messaging metrics"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800"
        >
          <div className="p-5">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Active Guest Handle
            </p>
            <p
              data-testid="dashboard-username"
              className="text-lg font-mono font-bold text-slate-900 dark:text-white mt-1 tabular-nums truncate"
            >
              {user ? `@${user.username}` : 'Initializing...'}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
              <span>{user?.displayName || 'Guest'}</span>
              <span aria-hidden="true">·</span>
              <Link
                to="/settings"
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Edit Profile
              </Link>
            </div>
          </div>

          <div className="p-5">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Private Conversations
            </p>
            <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
              {conversations.length}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
              {totalUnread} unread {totalUnread === 1 ? 'message' : 'messages'}
            </p>
          </div>

          <div className="p-5">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Incoming Chat Requests
            </p>
            <p className="text-2xl font-mono font-bold text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums">
              {pendingIncoming.length}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
              <span>{pendingOutgoing.length} outgoing</span>
              <span aria-hidden="true">·</span>
              <Link
                to="/requests"
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Manage
              </Link>
            </div>
          </div>

          <div className="p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Discovery Visibility
              </p>
              {!user ? (
                <Eye className="w-4 h-4 text-slate-400" />
              ) : user.isDiscoverable ? (
                <Eye className="w-4 h-4 text-emerald-500" />
              ) : (
                <EyeOff className="w-4 h-4 text-amber-500" />
              )}
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                {!user
                  ? 'Loading...'
                  : user.isDiscoverable
                  ? 'Discoverable'
                  : 'Hidden'}
              </span>
              {user && (
                <button
                  type="button"
                  onClick={() =>
                    updateProfile({ isDiscoverable: !user.isDiscoverable })
                  }
                  className="px-3 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
                >
                  {user.isDiscoverable ? 'Hide Profile' : 'Make Public'}
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Quick Username Search Bar */}
        <section aria-label="Quick username search">
          <form
            onSubmit={handleQuickSearchSubmit}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                aria-label="Search for users by username"
                placeholder="Search users by exact or partial username (e.g. Guest_84291)..."
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Search Directory
            </button>
          </form>
        </section>

        {/* Main 2-Column Workspace Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Incoming Requests + Active Conversations */}
          <div className="lg:col-span-7 space-y-8">
            {/* Incoming Chat Requests */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Incoming Chat Requests
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Accept a request to open an isolated one-to-one conversation
                  </p>
                </div>
                <Link
                  to="/requests"
                  className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                >
                  View All ({incomingRequests.length})
                </Link>
              </div>

              {pendingIncoming.length === 0 ? (
                <div className="p-8 text-center">
                  <Inbox className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    No pending incoming requests
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    When another guest invites you to chat privately, their
                    request will appear here immediately.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {pendingIncoming.map((req) => (
                    <div
                      key={req.publicId}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {req.sender.displayName}
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            @{req.sender.username}
                          </span>
                        </div>
                        {req.introMessage && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                            “{req.introMessage}”
                          </p>
                        )}
                        <p className="text-xs font-mono text-slate-400 mt-1 tabular-nums">
                          Received{' '}
                          {new Date(req.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={processingReq === req.publicId}
                          onClick={() => handleAccept(req.publicId)}
                          aria-label={`Accept request from ${req.sender.username}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Accept</span>
                        </button>
                        <button
                          type="button"
                          disabled={processingReq === req.publicId}
                          onClick={() => handleDecline(req.publicId)}
                          aria-label={`Decline request from ${req.sender.username}`}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Recent Private Conversations */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Recent Private Conversations
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Strictly two-participant private messaging channels
                  </p>
                </div>
              </div>

              {conversations.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageSquare className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    No active conversations yet
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                    Accept an incoming chat request above or send a request to
                    an online user to start chatting.
                  </p>
                  <Link
                    to="/discover"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Discover Online Users</span>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {conversations.map((conv) => (
                    <Link
                      key={conv.publicId}
                      to={`/chat/${conv.publicId}`}
                      className="flex items-center justify-between gap-4 p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {conv.peer.displayName}
                          </span>
                          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                            @{conv.peer.username}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              conv.peer.isOnline
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-500'
                            }`}
                          >
                            {conv.peer.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 truncate mt-1">
                          {conv.lastMessage
                            ? conv.lastMessage.content ||
                              'Shared a file attachment'
                            : 'Conversation established — send the first message'}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {conv.unreadCount > 0 && (
                          <span className="text-xs font-mono tabular-nums font-bold text-indigo-600 dark:text-indigo-400">
                            {conv.unreadCount} unread
                          </span>
                        )}
                        <span className="text-xs font-mono text-slate-400 tabular-nums">
                          {new Date(conv.lastMessageAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Online Users Directory */}
          <div className="lg:col-span-5">
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Online Users ({onlineUsers.length})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Discoverable guests currently active on the platform
                  </p>
                </div>
                <Link
                  to="/discover"
                  className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                >
                  Full Directory
                </Link>
              </div>

              {onlineUsers.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No other discoverable users are online right now.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {onlineUsers.slice(0, 8).map((peer) => {
                    const existingConv = conversations.find(
                      (c) => c.peer.publicId === peer.publicId
                    );
                    const hasOutgoing = outgoingRequests.some(
                      (r) =>
                        r.receiver.publicId === peer.publicId &&
                        r.status === 'PENDING'
                    );
                    const hasIncoming = incomingRequests.find(
                      (r) =>
                        r.sender.publicId === peer.publicId &&
                        r.status === 'PENDING'
                    );

                    return (
                      <div
                        key={peer.publicId}
                        className="p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {peer.displayName}
                          </p>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            <span className="font-mono truncate">
                              @{peer.username}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              Online
                            </span>
                          </div>
                        </div>

                        <div className="shrink-0">
                          {existingConv ? (
                            <Link
                              to={`/chat/${existingConv.publicId}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors whitespace-nowrap"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              <span>Open Chat</span>
                            </Link>
                          ) : hasIncoming ? (
                            <button
                              type="button"
                              onClick={() => handleAccept(hasIncoming.publicId)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Accept Request</span>
                            </button>
                          ) : hasOutgoing ? (
                            <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
                              Request Sent
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={sendingTo === peer.username}
                              onClick={() => handleSendRequest(peer.username)}
                              aria-label={`Send chat request to ${peer.username}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>
                                {sendingTo === peer.username
                                  ? 'Sending...'
                                  : 'Send Request'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
};
