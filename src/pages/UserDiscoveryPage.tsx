import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Check,
  Eye,
  EyeOff,
  MessageSquare,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { api } from '../services/api.ts';
import { WorkspaceLayout } from '../components/WorkspaceLayout.tsx';
import type { PublicGuestProfile } from '../types/index.ts';

export const UserDiscoveryPage: React.FC = () => {
  const {
    user,
    loadingSession,
    initializeOrRestoreSession,
    conversations,
    incomingRequests,
    outgoingRequests,
    sendChatRequest,
    acceptChatRequest,
    updateProfile,
  } = useApp();

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [filterMode, setFilterMode] = useState<'all' | 'online'>('all');
  const [results, setResults] = useState<PublicGuestProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [introNote, setIntroNote] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (!loadingSession && !user) {
      initializeOrRestoreSession(false);
    }
  }, [loadingSession, user, initializeOrRestoreSession]);

  const executeSearch = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const res = await api.searchUsers(q);
      setResults(res.users);
    } catch {
      // Handled quietly
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      executeSearch(query);
    }
  }, [user, query, executeSearch]);

  const handleSearchFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(query ? { q: query } : {});
    executeSearch(query);
  };

  const handleSendRequest = async (targetUsername: string) => {
    setSendingTo(targetUsername);
    try {
      await sendChatRequest(
        targetUsername,
        introNote.trim() ||
          'Hello! Would you like to start a private 1-to-1 chat?'
      );
      setIntroNote('');
    } catch {
      // Toast shown by AppContext
    } finally {
      setSendingTo(null);
    }
  };

  const handleAcceptExisting = async (requestPublicId: string) => {
    const convId = await acceptChatRequest(requestPublicId);
    navigate(`/chat/${convId}`);
  };

  const filteredUsers = results.filter((u) =>
    filterMode === 'online' ? u.isOnline : true
  );

  return (
    <WorkspaceLayout
      title="User Discovery"
      subtitle="Search by exact or partial username and send private 1-to-1 chat requests"
    >
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Search & Discoverability Header Panel */}
        <section className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Discover Guests by Username
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Find available users and initiate a consent-gated private
                conversation.
              </p>
            </div>

            {/* Discoverability Control */}
            {user && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  {user.isDiscoverable ? (
                    <Eye className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-amber-500" />
                  )}
                  <span>
                    Your status:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {user.isDiscoverable ? 'Discoverable' : 'Hidden'}
                    </strong>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateProfile({ isDiscoverable: !user.isDiscoverable })
                  }
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap"
                >
                  {user.isDiscoverable
                    ? 'Hide from Search'
                    : 'Enable Discovery'}
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSearchFormSubmit}
            className="grid grid-cols-1 md:grid-cols-12 gap-3"
          >
            <div className="md:col-span-6 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search username"
                placeholder="Search exact or partial username (e.g. Guest_84291)..."
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-4">
              <input
                type="text"
                value={introNote}
                onChange={(e) => setIntroNote(e.target.value)}
                maxLength={140}
                aria-label="Optional introductory note for chat requests"
                placeholder="Optional intro note with your request..."
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="w-full h-full px-4 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap"
              >
                Search
              </button>
            </div>
          </form>

          {/* Interactive Filter Controls & Search Suggestions */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                Suggestions:
              </span>
              {['Guest_84291', 'Guest_51902', 'Guest_30488'].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setQuery(sample)}
                  className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  @{sample}
                </button>
              ))}
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-slate-500 hover:text-slate-900 dark:hover:text-white underline ml-2"
                >
                  Clear filter
                </button>
              )}
            </div>

            {/* Segmented Filter Control */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterMode === 'all'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All Matching ({results.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('online')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterMode === 'online'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Online Now ({results.filter((u) => u.isOnline).length})
              </button>
            </div>
          </div>
        </section>

        {/* Results Table / List */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          {searching ? (
            <div className="p-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Searching discoverable users...
              </p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                No matching discoverable users found
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Try clearing the search query or checking another username.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredUsers.map((peer) => {
                const existingConv = conversations.find(
                  (c) => c.peer.publicId === peer.publicId
                );
                const pendingOut = outgoingRequests.find(
                  (r) =>
                    r.receiver.publicId === peer.publicId &&
                    r.status === 'PENDING'
                );
                const pendingIn = incomingRequests.find(
                  (r) =>
                    r.sender.publicId === peer.publicId &&
                    r.status === 'PENDING'
                );

                return (
                  <div
                    key={peer.publicId}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">
                          {peer.displayName}
                        </span>
                        <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                          @{peer.username}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                        <span
                          className={
                            peer.isOnline
                              ? 'text-emerald-600 dark:text-emerald-400 font-sans font-medium'
                              : 'text-slate-500 font-sans'
                          }
                        >
                          {peer.isOnline ? 'Online' : 'Offline'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Last active{' '}
                          {new Date(peer.lastSeenAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {existingConv ? (
                        <Link
                          to={`/chat/${existingConv.publicId}`}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Open Conversation</span>
                        </Link>
                      ) : pendingIn ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleAcceptExisting(pendingIn.publicId)
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Accept Incoming Request</span>
                        </button>
                      ) : pendingOut ? (
                        <Link
                          to="/requests"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                        >
                          <span>Request Pending</span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled={sendingTo === peer.username}
                          onClick={() => handleSendRequest(peer.username)}
                          aria-label={`Send request to ${peer.username}`}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap disabled:opacity-50"
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
    </WorkspaceLayout>
  );
};
