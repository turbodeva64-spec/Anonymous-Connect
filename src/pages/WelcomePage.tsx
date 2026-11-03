import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  FileCheck,
  Lock,
  MessageSquare,
  Moon,
  Shield,
  Sun,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';

export const WelcomePage: React.FC = () => {
  const { user, initializeOrRestoreSession, theme, toggleTheme } = useApp();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  const handleStartChatting = async () => {
    setStarting(true);
    try {
      if (!user) {
        await initializeOrRestoreSession(false);
      }
      navigate('/identity');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 md:px-12 py-4 border-b border-slate-200 dark:border-slate-800">
        {/* Zone 1: Single text wordmark */}
        <a
          href="/"
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          Anonymous Connect
        </a>

        {/* Zone 2: 4 clean single-line text navigation links */}
        <nav
          aria-label="Landing navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400"
        >
          <a
            href="#how-it-works"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            How It Works
          </a>
          <a
            href="#privacy-model"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Privacy Scope
          </a>
          <a
            href="#media-support"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            File Sharing
          </a>
          <a
            href="#security-controls"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Security Controls
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => (user ? navigate('/dashboard') : handleStartChatting())}
            disabled={starting}
            className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {starting
              ? 'Initializing...'
              : user
              ? 'Enter Dashboard'
              : 'Start Chatting'}
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-6xl mx-auto px-6 md:px-12 pt-16 pb-20 md:pt-24 md:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-center">
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-3">
                Private One-to-One Ephemeral Messaging Platform
              </p>
              <h1
                style={{ textWrap: 'balance' }}
                className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight"
              >
                Connect Privately. Chat Freely. No Registration Required.
              </h1>
              <p className="mt-5 text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                Anonymous Connect generates a cryptographic 24-hour temporary
                guest identity the moment you arrive. Discover online peers by
                username, send consent-gated private chat requests, and exchange
                real-time messages and verified attachments without creating an
                account, providing an email address, or storing a password.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleStartChatting}
                  disabled={starting}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  <span>
                    {starting
                      ? 'Generating Guest Identity...'
                      : user
                      ? `Continue as @${user.username}`
                      : 'Start Chatting'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {user && (
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="px-5 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Open Dashboard Directly
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label="Toggle color theme"
                  className="inline-flex items-center gap-2 px-4 py-3 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap"
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-400" />
                      <span>Switch to Light Theme</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-slate-700" />
                      <span>Switch to Dark Theme</span>
                    </>
                  )}
                </button>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>Zero Email or Phone Required</span>
                <span aria-hidden="true">·</span>
                <span>24-Hour Session TTL</span>
                <span aria-hidden="true">·</span>
                <span>Strictly 2 Participants per Chat</span>
                <span aria-hidden="true">·</span>
                <span>Consent-Gated Requests</span>
              </div>
            </div>

            {/* Right Interactive Preview Card (Single-Elevation) */}
            <div className="lg:col-span-5 flex flex-col justify-between p-6 md:p-8 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      Temporary Identity Provisioning
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Automatic HTTP-Only Session Lifecycle
                    </p>
                  </div>
                  <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                </div>

                <dl className="mt-5 space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-200/70 dark:border-slate-800/70">
                    <dt className="text-slate-500 dark:text-slate-400 shrink-0">
                      Assigned Handle
                    </dt>
                    <dd className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums text-right">
                      {user ? `@${user.username}` : '@Guest_84291'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-200/70 dark:border-slate-800/70">
                    <dt className="text-slate-500 dark:text-slate-400 shrink-0">
                      Authentication Model
                    </dt>
                    <dd className="font-mono text-xs text-slate-800 dark:text-slate-200 text-right">
                      CSPRNG 256-bit + SHA-256 DB Hash
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-200/70 dark:border-slate-800/70">
                    <dt className="text-slate-500 dark:text-slate-400 shrink-0">
                      Conversation Topology
                    </dt>
                    <dd className="text-xs font-medium text-slate-800 dark:text-slate-200 text-right">
                      Private 1-to-1 Only (No Group Rooms)
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2">
                    <dt className="text-slate-500 dark:text-slate-400 shrink-0">
                      Attachment Verification
                    </dt>
                    <dd className="text-xs font-medium text-slate-800 dark:text-slate-200 text-right">
                      Magic-Byte Signature + Expiring HMAC URL
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  No unsolicited messages can reach you. Every conversation
                  requires an explicit chat request that you can accept, decline,
                  or block at any time.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section
          id="how-it-works"
          className="border-t border-slate-200 dark:border-slate-800 py-16 md:py-20 bg-slate-50/60 dark:bg-slate-900/40"
        >
          <div className="max-w-6xl mx-auto px-6 md:px-12">
            <div className="max-w-2xl">
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
                How Anonymous Connect Works
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Four deterministic steps from arrival to private real-time
                communication.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    01. Identity
                  </span>
                  <UserCheck className="w-4 h-4 text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Instant Guest Session
                </h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  A unique username like Guest_84291 is provisioned
                  automatically and bound to an HTTP-only browser cookie for 24
                  hours.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    02. Discovery
                  </span>
                  <Lock className="w-4 h-4 text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Controlled Discovery
                </h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Search exact or partial usernames or browse online users.
                  Toggle discoverability off whenever you want to remain
                  unlisted.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    03. Handshake
                  </span>
                  <MessageSquare className="w-4 h-4 text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Request & Acceptance
                </h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Send a private chat request. A 1-to-1 conversation is created
                  in PostgreSQL only after the recipient explicitly accepts.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    04. Exchange
                  </span>
                  <FileCheck className="w-4 h-4 text-slate-400" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Real-Time Chat & Files
                </h3>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Exchange instant messages with delivery/read receipts, typing
                  indicators, emoji reactions, and magic-byte validated media
                  attachments.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy Scope & Media Support Section */}
        <section
          id="privacy-model"
          className="border-t border-slate-200 dark:border-slate-800 py-16 md:py-20"
        >
          <div className="max-w-6xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                Transparent Privacy & Session Architecture
              </h2>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Anonymous Connect provides temporary guest identities without
                requiring personal account credentials. We believe in accurate,
                verifiable security disclosures rather than exaggerated claims:
              </p>
              <ul className="mt-5 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                <li>
                  <strong className="text-slate-900 dark:text-slate-200">
                    When you return in the same browser:
                  </strong>{' '}
                  Your active 24-hour guest session is automatically restored
                  via your HTTP-only session cookie.
                </li>
                <li>
                  <strong className="text-slate-900 dark:text-slate-200">
                    When cookies are cleared or you click End Session:
                  </strong>{' '}
                  Your session token is immediately revoked on the server, active
                  WebSocket connections are closed, and a fresh guest identity
                  can be generated.
                </li>
                <li>
                  <strong className="text-slate-900 dark:text-slate-200">
                    Scope of Anonymity:
                  </strong>{' '}
                  Temporary guest identities hide your personal identity from
                  other users, while messages and attachments are stored on the
                  server for conversation persistence during your session.
                </li>
              </ul>
            </div>

            <div
              id="media-support"
              className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
            >
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                Supported File & Media Attachments
              </h3>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Every uploaded file undergoes extension whitelisting, MIME
                verification, and binary magic-byte inspection (up to 10 MB per
                file). Executable files and scripts are strictly rejected.
              </p>

              <div className="mt-5 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                <div className="py-2.5 flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Images (Inline Preview)
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    JPG · JPEG · PNG · WEBP
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Video Attachments
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    MP4 · WEBM
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Audio Attachments
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    MP3 · WAV · M4A
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Documents
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    PDF · DOC · DOCX
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Spreadsheets
                  </span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    XLS · XLSX · CSV
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer
        id="security-controls"
        className="px-6 md:px-12 py-6 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-4"
      >
        <span>
          Anonymous Connect — Temporary-Identity Private One-to-One Messaging
        </span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleStartChatting}
            className="hover:text-slate-900 dark:hover:text-white underline"
          >
            Configure Guest Identity
          </button>
        </div>
      </footer>
    </div>
  );
};
