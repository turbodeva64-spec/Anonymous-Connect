import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3000';

async function apiCall(
  path: string,
  options: {
    method?: string;
    token?: string;
    csrf?: string;
    body?: any;
  } = {}
) {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers['X-Guest-Session'] = options.token;
  }
  if (options.csrf) {
    headers['X-CSRF-Token'] = options.csrf;
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body
        ? JSON.stringify(options.body)
        : undefined,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

test('End-to-End Multi-User Workflow & Security Verification (Guest A, Guest B, Intruder C)', async () => {
  // 1. Initialize two independent guest sessions (Guest A & Guest B) and an Intruder C
  const initA = await apiCall('/api/guest/initialize', {
    method: 'POST',
    body: { isolatedMode: true, forceNew: true },
  });
  const initB = await apiCall('/api/guest/initialize', {
    method: 'POST',
    body: { isolatedMode: true, forceNew: true },
  });
  const initC = await apiCall('/api/guest/initialize', {
    method: 'POST',
    body: { isolatedMode: true, forceNew: true },
  });

  assert.equal(initA.status, 201);
  assert.equal(initB.status, 201);
  assert.equal(initC.status, 201);

  const tokenA = initA.data.isolatedSessionHeader as string;
  const csrfA = initA.data.csrfToken as string;
  const userA = initA.data.user;

  const tokenB = initB.data.isolatedSessionHeader as string;
  const csrfB = initB.data.csrfToken as string;
  const userB = initB.data.user;

  const tokenC = initC.data.isolatedSessionHeader as string;
  const csrfC = initC.data.csrfToken as string;

  assert.notEqual(userA.publicId, userB.publicId);
  assert.notEqual(userA.username, userB.username);

  // 2. Both users can discover each other by username
  const searchRes = await apiCall(
    `/api/users/search?q=${encodeURIComponent(userB.username)}`,
    { token: tokenA }
  );
  assert.equal(searchRes.status, 200);
  assert.equal(
    searchRes.data.users.some((u: any) => u.publicId === userB.publicId),
    true
  );

  // 3. Guest A sends a private chat request to Guest B
  const reqRes = await apiCall('/api/requests', {
    method: 'POST',
    token: tokenA,
    csrf: csrfA,
    body: {
      targetUser: userB.username,
      introMessage: 'Hi Guest B, let us test our 1-to-1 channel!',
    },
  });
  assert.equal(reqRes.status, 201);
  const requestPublicId = reqRes.data.request.publicId;

  // Duplicate request prevention check
  const dupReq = await apiCall('/api/requests', {
    method: 'POST',
    token: tokenA,
    csrf: csrfA,
    body: { targetUser: userB.username },
  });
  assert.equal(dupReq.status, 400);

  // 4. Guest B sees the incoming request and accepts it
  const incomingB = await apiCall('/api/requests/incoming', { token: tokenB });
  assert.equal(incomingB.status, 200);
  assert.equal(
    incomingB.data.requests.some((r: any) => r.publicId === requestPublicId),
    true
  );

  const acceptRes = await apiCall(`/api/requests/${requestPublicId}/accept`, {
    method: 'POST',
    token: tokenB,
    csrf: csrfB,
  });
  assert.equal(acceptRes.status, 200);
  const conversationId = acceptRes.data.conversationPublicId as string;
  assert.match(conversationId, /^conv_/);

  // 5. Guest A and Guest B exchange real-time persisted messages with idempotency
  const clientMsgId = `cmsg_test_${Date.now()}`;
  const sendMsgA = await apiCall('/api/messages', {
    method: 'POST',
    token: tokenA,
    csrf: csrfA,
    body: {
      conversationId,
      clientMessageId: clientMsgId,
      content: 'Confidential message from Guest A to Guest B.',
    },
  });
  assert.equal(sendMsgA.status, 201);
  const messagePublicId = sendMsgA.data.message.publicId;

  // Idempotent retry with same clientMessageId returns 200 without duplicating
  const retryMsgA = await apiCall('/api/messages', {
    method: 'POST',
    token: tokenA,
    csrf: csrfA,
    body: {
      conversationId,
      clientMessageId: clientMsgId,
      content: 'Confidential message from Guest A to Guest B.',
    },
  });
  assert.equal(retryMsgA.status, 200);
  assert.equal(retryMsgA.data.message.publicId, messagePublicId);

  // 6. Guest B reads the conversation and marks messages as READ
  const readRes = await apiCall(`/api/messages/${conversationId}/read`, {
    method: 'POST',
    token: tokenB,
    csrf: csrfB,
  });
  assert.equal(readRes.status, 200);

  const historyA = await apiCall(`/api/conversations/${conversationId}/messages`, {
    token: tokenA,
  });
  assert.equal(historyA.status, 200);
  const verifiedMsg = historyA.data.messages.find(
    (m: any) => m.publicId === messagePublicId
  );
  assert.equal(verifiedMsg.status, 'READ');

  // 7. File upload & magic-byte validation + signed download verification
  const validPngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const formData = new FormData();
  formData.append('conversationId', conversationId);
  formData.append(
    'file',
    new Blob([validPngBytes], { type: 'image/png' }),
    'architecture.png'
  );

  const uploadRes = await apiCall('/api/attachments/upload', {
    method: 'POST',
    token: tokenA,
    csrf: csrfA,
    body: formData,
  });
  assert.equal(uploadRes.status, 201);
  const downloadUrl = uploadRes.data.attachment.downloadUrl as string;

  // Authorized participant can download via signed URL both with header AND via cookie-less native <img>/<a download>
  const dlResA = await fetch(`${BASE_URL}${downloadUrl}`, {
    headers: { 'X-Guest-Session': tokenA },
  });
  assert.equal(dlResA.status, 200);

  const dlCookieLess = await fetch(`${BASE_URL}${downloadUrl}`);
  assert.equal(dlCookieLess.status, 200);

  // Verify security headers (CSP & X-Content-Type-Options)
  assert.equal(dlCookieLess.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(
    Boolean(dlCookieLess.headers.get('content-security-policy')),
    true
  );

  // Emoji reaction test (including ✨ and 🙏)
  const reactRes = await apiCall(`/api/messages/${messagePublicId}/reactions`, {
    method: 'POST',
    token: tokenB,
    csrf: csrfB,
    body: { emoji: '✨' },
  });
  assert.equal(reactRes.status, 200);
  assert.equal(
    reactRes.data.message.reactions.some((r: any) => r.emoji === '✨'),
    true
  );

  // 8. Unauthorized Intruder C cannot access the private conversation or signed attachment (IDOR check)
  const intruderConv = await apiCall(`/api/conversations/${conversationId}`, {
    token: tokenC,
  });
  assert.equal(intruderConv.status, 403);

  const intruderDl = await fetch(`${BASE_URL}${downloadUrl}`, {
    headers: { 'X-Guest-Session': tokenC },
  });
  assert.equal(intruderDl.status, 403);

  // Cookie-only state-changing request WITHOUT X-CSRF-Token must be rejected (403)
  const cookieWithoutCsrf = await fetch(`${BASE_URL}/api/guest/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `ac_guest_session=${tokenC}`,
    },
    body: JSON.stringify({ displayName: 'CsrfBypassAttempt' }),
  });
  assert.equal(cookieWithoutCsrf.status, 403);

  // 9. Blocking prevents further communication
  const blockRes = await apiCall(`/api/users/${userA.username}/block`, {
    method: 'POST',
    token: tokenB,
    csrf: csrfB,
    body: { reason: 'Testing block enforcement' },
  });
  assert.equal(blockRes.status, 201);

  const blockedMsgAttempt = await apiCall('/api/messages', {
    method: 'POST',
    token: tokenA,
    csrf: csrfA,
    body: {
      conversationId,
      clientMessageId: `cmsg_blocked_${Date.now()}`,
      content: 'Should be rejected because blocked',
    },
  });
  assert.equal(blockedMsgAttempt.status, 400);

  // 10. Session rotation (forceNew) revokes the old session immediately
  const rotateRes = await fetch(`${BASE_URL}/api/guest/initialize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Guest-Session': tokenC,
    },
    body: JSON.stringify({ forceNew: true, isolatedMode: false }),
  });
  assert.equal(rotateRes.status, 201);
  const rotatedData = await rotateRes.json();
  const oldTokenCheck = await apiCall('/api/guest/me', { token: tokenC });
  assert.equal(oldTokenCheck.status, 401);

  // 11. Session termination revokes access immediately
  const endRes = await apiCall('/api/guest/end-session', {
    method: 'POST',
    token: rotatedData.sessionToken,
    csrf: rotatedData.csrfToken,
  });
  assert.equal(endRes.status, 200);

  const afterEndMe = await apiCall('/api/guest/me', {
    token: rotatedData.sessionToken,
  });
  assert.equal(afterEndMe.status, 401);
});
