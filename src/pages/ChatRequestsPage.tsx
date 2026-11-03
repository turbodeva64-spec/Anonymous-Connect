import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Ban,
  Check,
  Inbox,
  MessageSquare,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { WorkspaceLayout } from '../components/WorkspaceLayout.tsx';

export const ChatRequestsPage: React.FC = () => {
  const {
    user,
    loadingSession,
    initializeOrRestoreSession,
    incomingRequests,
    outgoingRequests,
    acceptChatRequest,
    declineChatRequest,
    cancelChatRequest,
    blockUser,
  } = useApp();

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'incoming' | 'outgoing'>(
    'incoming'
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingSession && !user) {
      initializeOrRestoreSession(false);
    }
  }, [loadingSession, user, initializeOrRestoreSession]);

  const handleAccept = async (publicId: string) => {
    setBusyId(publicId);
    try {
      const convId = await acceptChatRequest(publicId);
      navigate(`/chat/${convId}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (publicId: string) => {
    setBusyId(publicId);
    try {
      await declineChatRequest(publicId);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (publicId: string) => {
    setBusyId(publicId);
    try {
      await cancelChatRequest(publicId);
    } finally {
      setBusyId(null);
    }
  };

  const handleBlock = async (username: string) => {
    setBusyId(username);
    try {
      await blockUser(username, 'Blocked from chat requests');
    } finally {
      setBusyId(null);
    }
  };

  const pendingIncomingCount = incomingRequests.filter(
    (r) => r.status === 'PENDING'
  ).length;
  const pendingOutgoingCount = outgoingRequests.filter(
    (r) => r.status === 'PENDING'
  ).length;

  return (
    <WorkspaceLayout
      title="Chat Requests"
      subtitle="Review incoming private chat invitations and manage your outgoing requests"
    >
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header & Segmented Tab Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Consent-Gated Chat Requests
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              No private conversation begins until the recipient explicitly
              accepts the request.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveTab('incoming')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap font-mono tabular-nums ${
                activeTab === 'incoming'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Incoming ({pendingIncomingCount} pending)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('outgoing')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap font-mono tabular-nums ${
                activeTab === 'outgoing'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Outgoing ({pendingOutgoingCount} pending)
            </button>
          </div>
        </div>

        {/* Incoming Requests View */}
        {activeTab === 'incoming' ? (
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {incomingRequests.length === 0 ? (
              <div className="p-12 text-center">
                <Inbox className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  No incoming chat requests
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Share your temporary username{' '}
                  <span className="font-mono">
                    @{user?.username || 'Guest'}
                  </span>{' '}
                  or browse the user directory to connect.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {incomingRequests.map((req) => (
                  <div
                    key={req.publicId}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {req.sender.displayName}
                        </span>
                        <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                          @{req.sender.username}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">
                          ·
                        </span>
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Status: {req.status}
                        </span>
                      </div>

                      {req.introMessage && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5">
                          “{req.introMessage}”
                        </p>
                      )}

                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-1.5 font-mono tabular-nums">
                        <span>
                          Sent {new Date(req.createdAt).toLocaleString()}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {req.sender.isOnline ? 'Sender Online' : 'Sender Offline'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {req.status === 'PENDING' ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === req.publicId}
                            onClick={() => handleAccept(req.publicId)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept Request</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === req.publicId}
                            onClick={() => handleDecline(req.publicId)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Decline</span>
                          </button>
                        </>
                      ) : req.status === 'ACCEPTED' &&
                        req.conversationPublicId ? (
                        <Link
                          to={`/chat/${req.conversationPublicId}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Open Conversation</span>
                        </Link>
                      ) : null}

                      <button
                        type="button"
                        disabled={busyId === req.sender.username}
                        onClick={() => handleBlock(req.sender.username)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Block User</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          /* Outgoing Requests View */
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {outgoingRequests.length === 0 ? (
              <div className="p-12 text-center">
                <Send className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  No outgoing chat requests
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                  Discover online users to send a private chat invitation.
                </p>
                <Link
                  to="/discover"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                >
                  <span>Discover Users</span>
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {outgoingRequests.map((req) => (
                  <div
                    key={req.publicId}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          To: {req.receiver.displayName}
                        </span>
                        <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                          @{req.receiver.username}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">
                          ·
                        </span>
                        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          Status: {req.status}
                        </span>
                      </div>

                      {req.introMessage && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5">
                          “{req.introMessage}”
                        </p>
                      )}

                      <p className="text-xs font-mono text-slate-400 mt-1.5 tabular-nums">
                        Sent {new Date(req.createdAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {req.status === 'PENDING' && (
                        <button
                          type="button"
                          disabled={busyId === req.publicId}
                          onClick={() => handleCancel(req.publicId)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Cancel Request</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={busyId === req.receiver.username}
                        onClick={() => handleBlock(req.receiver.username)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Block User</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </WorkspaceLayout>
  );
};
