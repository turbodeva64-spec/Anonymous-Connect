import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Paperclip,
  Send,
  Smile,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { api } from '../services/api.ts';
import { WorkspaceLayout } from '../components/WorkspaceLayout.tsx';
import type {
  AttachmentMetadata,
  ChatMessageItem,
  ConversationSummary,
} from '../types/index.ts';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉', '🙏', '✨'];
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉', '🙏', '✨'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const PrivateChatPage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();

  const {
    user,
    loadingSession,
    initializeOrRestoreSession,
    typingByConversation,
    emitTyping,
    joinConversationRoom,
    leaveConversationRoom,
    blockUser,
    unblockUser,
    addToast,
    refreshAllData,
  } = useApp();

  const [conversation, setConversation] =
    useState<ConversationSummary | null>(null);
  const [messagesList, setMessagesList] = useState<ChatMessageItem[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeReactionMsgId, setActiveReactionMsgId] = useState<string | null>(
    null
  );

  const [pendingAttachments, setPendingAttachments] = useState<
    AttachmentMetadata[]
  >([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState<
    'harassment' | 'spam' | 'malicious_file' | 'impersonation' | 'other'
  >('harassment');
  const [reportDescription, setReportDescription] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loadingSession && !user) {
      initializeOrRestoreSession(false);
    }
  }, [loadingSession, user, initializeOrRestoreSession]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const loadConversationAndMessages = useCallback(async () => {
    if (!conversationId || !user) return;
    setLoadingChat(true);
    setErrorMsg(null);
    try {
      const [convRes, msgRes] = await Promise.all([
        api.getConversation(conversationId),
        api.getMessages(conversationId, 80),
      ]);
      setConversation(convRes.conversation);
      setMessagesList(msgRes.messages);

      // Mark unread messages as read
      await api.markMessagesRead(conversationId).catch(() => {});
      refreshAllData();
    } catch (err: any) {
      setErrorMsg(err.message || 'Unable to load private conversation.');
    } finally {
      setLoadingChat(false);
    }
  }, [conversationId, user, refreshAllData]);

  useEffect(() => {
    if (user && conversationId) {
      loadConversationAndMessages();
      joinConversationRoom(conversationId);
      return () => {
        leaveConversationRoom(conversationId);
      };
    }
  }, [
    user,
    conversationId,
    loadConversationAndMessages,
    joinConversationRoom,
    leaveConversationRoom,
  ]);

  useEffect(() => {
    scrollToBottom();
  }, [messagesList.length, scrollToBottom]);

  // Listen for real-time message events dispatched from AppContext
  useEffect(() => {
    if (!conversationId) return;

    const onNewMessage = (e: Event) => {
      const msg = (e as CustomEvent<ChatMessageItem>).detail;
      if (msg.conversationPublicId !== conversationId) return;

      setMessagesList((prev) => {
        if (
          prev.some(
            (m) =>
              m.publicId === msg.publicId ||
              m.clientMessageId === msg.clientMessageId
          )
        ) {
          return prev.map((m) =>
            m.clientMessageId === msg.clientMessageId ? msg : m
          );
        }
        return [...prev, msg];
      });

      if (user && msg.senderPublicId !== user.publicId) {
        api.markMessagesRead(conversationId).catch(() => {});
      }
    };

    const onReadReceipt = (e: Event) => {
      const payload = (
        e as CustomEvent<{
          conversationId: string;
          messageIds: string[];
          readAt: string;
        }>
      ).detail;
      if (payload.conversationId !== conversationId) return;
      const idSet = new Set(payload.messageIds);
      setMessagesList((prev) =>
        prev.map((m) =>
          idSet.has(m.publicId)
            ? { ...m, status: 'READ', readAt: payload.readAt }
            : m
        )
      );
    };

    const onDeletedMessage = (e: Event) => {
      const payload = (
        e as CustomEvent<{
          messagePublicId: string;
          conversationPublicId: string;
        }>
      ).detail;
      if (payload.conversationPublicId !== conversationId) return;
      setMessagesList((prev) =>
        prev.map((m) =>
          m.publicId === payload.messagePublicId
            ? {
                ...m,
                isDeleted: true,
                content: 'This message was deleted.',
                attachments: [],
                reactions: [],
              }
            : m
        )
      );
    };

    const onReactionUpdate = (e: Event) => {
      const payload = (
        e as CustomEvent<{
          conversationPublicId: string;
          messagePublicId: string;
          reactions: ChatMessageItem['reactions'];
        }>
      ).detail;
      if (payload.conversationPublicId !== conversationId) return;
      setMessagesList((prev) =>
        prev.map((m) =>
          m.publicId === payload.messagePublicId
            ? { ...m, reactions: payload.reactions }
            : m
        )
      );
    };

    const onBlockChanged = () => {
      loadConversationAndMessages();
    };

    window.addEventListener('ac:message:new', onNewMessage);
    window.addEventListener('ac:message:read', onReadReceipt);
    window.addEventListener('ac:message:deleted', onDeletedMessage);
    window.addEventListener('ac:message:reaction', onReactionUpdate);
    window.addEventListener('ac:block:changed', onBlockChanged);

    return () => {
      window.removeEventListener('ac:message:new', onNewMessage);
      window.removeEventListener('ac:message:read', onReadReceipt);
      window.removeEventListener('ac:message:deleted', onDeletedMessage);
      window.removeEventListener('ac:message:reaction', onReactionUpdate);
      window.removeEventListener('ac:block:changed', onBlockChanged);
    };
  }, [conversationId, user, loadConversationAndMessages]);

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (!conversationId) return;

    emitTyping(conversationId, val.trim().length > 0);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      emitTyping(conversationId, false);
    }, 2000);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversationId || !user) return;
    const text = draft.trim();
    if (!text && pendingAttachments.length === 0) return;

    const clientMessageId = `cmsg_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const attIds = pendingAttachments.map((a) => a.publicId);

    setSending(true);
    try {
      const res = await api.sendMessage({
        conversationId,
        clientMessageId,
        content: text,
        attachmentIds: attIds,
      });

      setMessagesList((prev) => {
        if (
          prev.some(
            (m) =>
              m.publicId === res.message.publicId ||
              m.clientMessageId === res.message.clientMessageId
          )
        ) {
          return prev;
        }
        return [...prev, res.message];
      });

      setDraft('');
      setPendingAttachments([]);
      setShowEmojiPicker(false);
      emitTyping(conversationId, false);
    } catch (err: any) {
      addToast('error', 'Message Failed', err.message);
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !conversationId) return;
    e.target.value = '';

    setUploadProgress(1);
    try {
      const res = await api.uploadAttachment(conversationId, file, (pct) => {
        setUploadProgress(pct);
      });
      setPendingAttachments((prev) => [...prev, res.attachment]);
      addToast(
        'success',
        'Attachment Ready',
        `${res.attachment.originalName} passed binary verification.`
      );
    } catch (err: any) {
      addToast('error', 'Upload Rejected', err.message);
    } finally {
      setUploadProgress(null);
    }
  };

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      addToast('info', 'Copied', 'Message copied to clipboard.');
    } catch {
      addToast('error', 'Copy Failed', 'Could not access clipboard.');
    }
  };

  const handleDeleteMessage = async (messagePublicId: string) => {
    try {
      await api.deleteMessage(messagePublicId);
      setMessagesList((prev) =>
        prev.map((m) =>
          m.publicId === messagePublicId
            ? {
                ...m,
                isDeleted: true,
                content: 'This message was deleted.',
                attachments: [],
                reactions: [],
              }
            : m
        )
      );
    } catch (err: any) {
      addToast('error', 'Delete Failed', err.message);
    }
  };

  const handleToggleReaction = async (
    messagePublicId: string,
    emoji: string
  ) => {
    try {
      const res = await api.toggleReaction(messagePublicId, emoji);
      setMessagesList((prev) =>
        prev.map((m) => (m.publicId === messagePublicId ? res.message : m))
      );
      setActiveReactionMsgId(null);
    } catch (err: any) {
      addToast('error', 'Reaction Failed', err.message);
    }
  };

  const handleToggleBlockPeer = async () => {
    if (!conversation) return;
    if (conversation.isPeerBlocked) {
      await unblockUser(conversation.peer.username);
    } else {
      await blockUser(conversation.peer.username, 'Blocked from private chat');
    }
    loadConversationAndMessages();
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversation) return;
    setSubmittingReport(true);
    try {
      await api.submitReport({
        reportedUser: conversation.peer.username,
        conversationId: conversation.publicId,
        category: reportCategory,
        description: reportDescription.trim(),
      });
      addToast(
        'success',
        'Report Submitted',
        'Our safety team has logged your report for review.'
      );
      setShowReportModal(false);
      setReportDescription('');
    } catch (err: any) {
      addToast('error', 'Report Error', err.message);
    } finally {
      setSubmittingReport(false);
    }
  };

  const typingUsername = conversationId
    ? typingByConversation[conversationId]
    : null;

  return (
    <WorkspaceLayout
      title={
        conversation
          ? `Chat with ${conversation.peer.displayName}`
          : 'Private Chat'
      }
      subtitle="Isolated two-participant real-time conversation"
    >
      <div className="max-w-5xl mx-auto h-[calc(100vh-73px)] flex flex-col">
        {loadingChat ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Loading private conversation history...
            </p>
          </div>
        ) : errorMsg || !conversation ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <p className="text-base font-semibold text-slate-900 dark:text-white">
              {errorMsg || 'Conversation unavailable'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              Only the two authorized participants can view or send messages in
              this channel.
            </p>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg"
            >
              Return to Dashboard
            </button>
          </div>
        ) : (
          <>
            {/* Conversation Peer Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-slate-900 dark:text-white truncate">
                    {conversation.peer.displayName}
                  </h1>
                  <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400">
                    @{conversation.peer.username}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                  <span
                    className={
                      conversation.peer.isOnline
                        ? 'text-emerald-600 dark:text-emerald-400 font-sans font-medium'
                        : 'text-slate-500 font-sans'
                    }
                  >
                    {conversation.peer.isOnline ? 'Online' : 'Offline'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>2-Participant Private Channel</span>
                  {typingUsername && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-sans font-medium">
                        @{typingUsername} is typing...
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleBlockPeer}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>
                    {conversation.isPeerBlocked ? 'Unblock User' : 'Block User'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowReportModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Report</span>
                </button>
              </div>
            </div>

            {/* Messages Scroll Viewport */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {messagesList.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Private channel established with @{conversation.peer.username}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Messages and file attachments sent here are accessible only
                    to you and @{conversation.peer.username}.
                  </p>
                </div>
              ) : (
                messagesList.map((msg) => {
                  const isMine = user?.publicId === msg.senderPublicId;
                  return (
                    <div
                      key={msg.publicId}
                      className={`flex flex-col ${
                        isMine ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`max-w-xl w-fit rounded-2xl px-4 py-3 border ${
                          msg.isDeleted
                            ? 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400 italic'
                            : isMine
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {/* Message Text */}
                        {msg.content && (
                          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                            {msg.content}
                          </p>
                        )}

                        {/* Attachments */}
                        {!msg.isDeleted &&
                          msg.attachments &&
                          msg.attachments.length > 0 && (
                            <div className="mt-2.5 space-y-2">
                              {msg.attachments.map((att) => (
                                <div
                                  key={att.publicId}
                                  className={`p-3 rounded-xl border ${
                                    isMine
                                      ? 'bg-indigo-700/60 border-indigo-400/30 text-white'
                                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                                  }`}
                                >
                                  {att.category === 'image' && (
                                    <img
                                      src={att.downloadUrl}
                                      alt={att.originalName}
                                      referrerPolicy="no-referrer"
                                      className="max-h-60 rounded-lg object-cover mb-2"
                                    />
                                  )}
                                  {att.category === 'video' && (
                                    <video
                                      src={att.downloadUrl}
                                      controls
                                      className="max-h-60 rounded-lg mb-2 w-full"
                                    />
                                  )}
                                  {att.category === 'audio' && (
                                    <audio
                                      src={att.downloadUrl}
                                      controls
                                      className="w-full mb-2"
                                    />
                                  )}

                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {att.category === 'image' ? (
                                        <ImageIcon className="w-4 h-4 shrink-0" />
                                      ) : att.category === 'video' ? (
                                        <Film className="w-4 h-4 shrink-0" />
                                      ) : att.category === 'audio' ? (
                                        <Music className="w-4 h-4 shrink-0" />
                                      ) : att.category === 'spreadsheet' ? (
                                        <FileSpreadsheet className="w-4 h-4 shrink-0" />
                                      ) : (
                                        <FileText className="w-4 h-4 shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium truncate">
                                          {att.originalName}
                                        </p>
                                        <p className="text-[11px] opacity-80 font-mono tabular-nums">
                                          {formatFileSize(att.sizeBytes)} ·{' '}
                                          {att.extension.toUpperCase()}
                                        </p>
                                      </div>
                                    </div>

                                    <a
                                      href={att.downloadUrl}
                                      download={att.originalName}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label={`Download ${att.originalName}`}
                                      className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 transition-colors shrink-0"
                                    >
                                      <Download className="w-4 h-4" />
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                        {/* Message Footer: Timestamp + Delivery/Read Receipt + Actions */}
                        <div
                          className={`mt-2 flex items-center justify-between gap-3 text-[11px] font-mono tabular-nums ${
                            isMine
                              ? 'text-indigo-100/90'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {isMine && !msg.isDeleted && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-0.5">
                                  {msg.status === 'READ' ? (
                                    <>
                                      <CheckCheck className="w-3.5 h-3.5" />
                                      <span>Read</span>
                                    </>
                                  ) : msg.status === 'DELIVERED' ? (
                                    <>
                                      <CheckCheck className="w-3.5 h-3.5 opacity-80" />
                                      <span>Delivered</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-3.5 h-3.5 opacity-80" />
                                      <span>Sent</span>
                                    </>
                                  )}
                                </span>
                              </>
                            )}
                          </div>

                          {!msg.isDeleted && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveReactionMsgId(
                                    activeReactionMsgId === msg.publicId
                                      ? null
                                      : msg.publicId
                                  )
                                }
                                aria-label="React to message"
                                className="hover:opacity-100 opacity-75 transition-opacity"
                              >
                                <Smile className="w-3.5 h-3.5" />
                              </button>
                              {msg.content && (
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(msg.content)}
                                  aria-label="Copy message text"
                                  className="hover:opacity-100 opacity-75 transition-opacity"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isMine && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteMessage(msg.publicId)
                                  }
                                  aria-label="Delete message"
                                  className="hover:opacity-100 opacity-75 transition-opacity"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Reaction Picker Popover */}
                      {activeReactionMsgId === msg.publicId && (
                        <div className="mt-1 flex items-center gap-1 p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() =>
                                handleToggleReaction(msg.publicId, emoji)
                              }
                              className="px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Existing Reactions Display */}
                      {msg.reactions && msg.reactions.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                          {msg.reactions.map((r) => (
                            <button
                              key={r.emoji}
                              type="button"
                              onClick={() =>
                                handleToggleReaction(msg.publicId, r.emoji)
                              }
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums"
                            >
                              <span>{r.emoji}</span>
                              <span>{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer Area */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
              {conversation.isPeerBlocked || conversation.hasBlockedMe ? (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 text-center">
                  Messaging is disabled because a block is active on this
                  conversation.
                </div>
              ) : (
                <>
                  {/* Pending Uploaded Attachments Preview */}
                  {pendingAttachments.length > 0 && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {pendingAttachments.map((att) => (
                        <div
                          key={att.publicId}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs"
                        >
                          <span className="font-medium truncate max-w-[180px]">
                            {att.originalName}
                          </span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            ({formatFileSize(att.sizeBytes)})
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${att.originalName}`}
                            onClick={() =>
                              setPendingAttachments((prev) =>
                                prev.filter((a) => a.publicId !== att.publicId)
                              )
                            }
                            className="text-slate-400 hover:text-rose-500"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload Progress Indicator */}
                  {uploadProgress !== null && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-1 font-mono tabular-nums">
                        <span>Inspecting magic bytes & uploading file...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 transition-all"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Quick Emoji Picker Bar */}
                  {showEmojiPicker && (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setDraft((d) => `${d}${emoji}`)}
                          className="px-2.5 py-1 text-base hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  <form
                    onSubmit={handleSendMessage}
                    className="flex items-center gap-2.5"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.mp4,.webm,.mp3,.wav,.m4a,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach file"
                      className="p-2.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowEmojiPicker((v) => !v)}
                      aria-label="Toggle emoji picker"
                      className="p-2.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
                    >
                      <Smile className="w-4 h-4" />
                    </button>

                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => handleDraftChange(e.target.value)}
                      maxLength={2000}
                      aria-label="Write a private message"
                      placeholder={`Message @${conversation.peer.username}...`}
                      className="flex-1 px-4 py-2.5 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />

                    <button
                      type="submit"
                      disabled={
                        sending ||
                        (!draft.trim() && pendingAttachments.length === 0)
                      }
                      aria-label="Send message"
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{sending ? 'Sending...' : 'Send'}</span>
                    </button>
                  </form>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Report User Modal */}
      {showReportModal && conversation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70"
        >
          <div className="max-w-md w-full rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h2
                id="report-dialog-title"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                Report @{conversation.peer.username}
              </h2>
              <button
                type="button"
                aria-label="Close report dialog"
                onClick={() => setShowReportModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReportSubmit} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="report-category"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Violation Category
                </label>
                <select
                  id="report-category"
                  value={reportCategory}
                  onChange={(e) =>
                    setReportCategory(e.target.value as typeof reportCategory)
                  }
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="harassment">Harassment or Abuse</option>
                  <option value="spam">Unsolicited Spam / Flooding</option>
                  <option value="malicious_file">Suspicious File Attachment</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="other">Other Safety Concern</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="report-description"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Details
                </label>
                <textarea
                  id="report-description"
                  rows={3}
                  required
                  minLength={5}
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder="Describe what happened..."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg disabled:opacity-50"
                >
                  {submittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
};
