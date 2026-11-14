/**
 * Chat logic – Phase 2: realtime, ticks, typing, presence
 */
const Chat = (() => {
  let currentConvId = null;
  let currentTitle = '';
  let currentUser = null;
  let otherPhone = null;
  let subscription = null;
  let statusSub = null;
  let typingSub = null;
  let listSubscription = null;
  let typingTimer = null;
  let isTyping = false;

  async function init(user) {
    currentUser = user;
    const me = user.id || user.phone;
    await DB.setPresence(me, true);
    // heartbeat presence
    if (window._presenceBeat) clearInterval(window._presenceBeat);
    window._presenceBeat = setInterval(() => DB.setPresence(me, true), 30000);
    window.addEventListener('beforeunload', () => DB.setPresence(me, false));

    await refreshList();
    if (listSubscription) listSubscription.unsubscribe();
    listSubscription = DB.subscribeConversations(me, () => refreshList());
  }

  async function refreshList() {
    if (!currentUser) return;
    try {
      const convs = await DB.getConversations(currentUser.id || currentUser.phone);
      UI.renderChatList(convs, currentUser.id || currentUser.phone);
    } catch (e) {
      console.error('refreshList failed', e);
    }
  }

  function peerFromConvId(convId, me) {
    if (!convId || !me) return null;
    const parts = String(convId).split('_');
    if (parts.length < 2) return null;
    // conv id is sorted phones joined by _
    // phones may contain + so split carefully: we used sort join with _
    // format: phoneA_phoneB where both may start with +
    const idx = convId.indexOf(me);
    if (idx === -1) {
      // try match either side
      return parts[parts.length - 1] === me ? parts.slice(0, -1).join('_') : parts.slice(1).join('_');
    }
    // simpler: members are the two phones
    if (convId.startsWith(me + '_')) return convId.slice(me.length + 1);
    if (convId.endsWith('_' + me)) return convId.slice(0, -(me.length + 1));
    return null;
  }

  async function resolveMessageMedia(messages) {
    if (!messages || !messages.length || typeof Media === 'undefined') return messages;
    const out = [];
    for (const m of messages) {
      if (m.media_url || m.media_path) {
        const path = m.media_path || m.media_url;
        try {
          const url = await Media.resolveUrl(path);
          out.push(Object.assign({}, m, { media_url: url || m.media_url }));
        } catch {
          out.push(m);
        }
      } else {
        out.push(m);
      }
    }
    return out;
  }

  async function open(conversationId, title) {
    currentConvId = conversationId;
    currentTitle = title || conversationId;
    const me = currentUser.id || currentUser.phone;
    otherPhone = peerFromConvId(conversationId, me);

    document.getElementById('chat-title').textContent = currentTitle;
    document.getElementById('chat-avatar').textContent = UI.avatarInitial(currentTitle);

    // Presence subtitle
    const sub = document.getElementById('chat-subtitle');
    sub.textContent = '…';
    sub.classList.remove('typing');
    if (otherPhone) {
      const p = await DB.getPresence(otherPhone);
      if (p.is_online) sub.textContent = 'online';
      else if (p.last_seen) sub.textContent = 'last seen ' + UI.formatTime(p.last_seen);
      else sub.textContent = 'tap here for info';
    } else {
      sub.textContent = 'tap here for info';
    }

    // Load messages + mark delivered/read
    let messages = await resolveMessageMedia(await DB.getMessages(conversationId));
    UI.renderMessages(messages, me);
    await DB.markMessagesDelivered(conversationId, me);
    await DB.markMessagesRead(conversationId, me);

    // Poll backup while open
    if (window._msgPoll) clearInterval(window._msgPoll);
    window._msgPoll = setInterval(async () => {
      if (!currentConvId) return;
      const msgs = await resolveMessageMedia(await DB.getMessages(currentConvId));
      UI.renderMessages(msgs, me);
      await DB.markMessagesRead(currentConvId, me);
    }, 4000);

    // Realtime new messages
    if (subscription) subscription.unsubscribe();
    subscription = DB.subscribeMessages(conversationId, async (msg) => {
      if (msg.sender_id === me) return;
      const msgs = await DB.getMessages(conversationId);
      UI.renderMessages(msgs, me);
      await DB.markMessagesDelivered(conversationId, me);
      await DB.markMessagesRead(conversationId, me);
      refreshList();
    });

    // Status updates (ticks turning blue)
    if (statusSub) statusSub.unsubscribe();
    statusSub = DB.subscribeMessageStatus(conversationId, async () => {
      const msgs = await DB.getMessages(conversationId);
      UI.renderMessages(msgs, me);
    });

    // Typing indicator
    if (typingSub) typingSub.unsubscribe();
    typingSub = DB.subscribeTyping(conversationId, me, (phones) => {
      if (phones && phones.length) {
        sub.textContent = 'typing…';
        sub.classList.add('typing');
      } else {
        sub.classList.remove('typing');
        DB.getPresence(otherPhone || '').then(p => {
          if (p.is_online) sub.textContent = 'online';
          else if (p.last_seen) sub.textContent = 'last seen ' + UI.formatTime(p.last_seen);
          else sub.textContent = 'tap here for info';
        });
      }
    });

    UI.showScreen('chat-detail');
    const input = document.getElementById('message-input');
    input.focus();

    // Typing events on input
    input.oninput = () => {
      if (!currentConvId) return;
      if (!isTyping) {
        isTyping = true;
        DB.setTyping(currentConvId, me, true);
      }
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        isTyping = false;
        DB.setTyping(currentConvId, me, false);
      }, 2000);
    };
  }

  async function send(text) {
    if (!text || !text.trim() || !currentConvId) return;
    const content = text.trim();
    const input = document.getElementById('message-input');
    input.value = '';
    const me = currentUser.id || currentUser.phone;

    // stop typing
    isTyping = false;
    DB.setTyping(currentConvId, me, false);

    try {
      await DB.sendMessage({
        conversationId: currentConvId,
        senderId: me,
        content
      });
      const msgs = await resolveMessageMedia(await DB.getMessages(currentConvId));
      UI.renderMessages(msgs, me);
      await refreshList();
    } catch (e) {
      console.error(e);
      UI.toast('Failed to send: ' + (e.message || 'error'));
    }
  }

  async function sendMedia({ file, type, caption, duration }) {
    if (!currentConvId || !file) return;
    const me = currentUser.id || currentUser.phone;
    const bar = document.getElementById('upload-bar');
    const fill = document.getElementById('upload-bar-fill');
    const text = document.getElementById('upload-bar-text');
    try {
      if (bar) bar.classList.remove('hidden');
      if (text) text.textContent = 'Uploading…';
      if (fill) fill.style.width = '15%';

      let toUpload = file;
      if (type === 'image') {
        toUpload = await Media.compressImage(file);
      }
      if (fill) fill.style.width = '40%';

      const folder = (me || 'user').replace(/\+/g, '') + '/' + currentConvId;
      const uploaded = await Media.uploadFile(toUpload, folder, (p) => {
        if (fill) fill.style.width = Math.round(40 + p * 50) + '%';
      });

      await DB.sendMessage({
        conversationId: currentConvId,
        senderId: me,
        content: caption || (type === 'document' ? file.name : ''),
        type: type || uploaded.type,
        media_url: uploaded.path || uploaded.url,
        media_mime: uploaded.mime,
        media_size: uploaded.size,
        media_duration: duration || null
      });

      if (fill) fill.style.width = '100%';
      const msgs = await resolveMessageMedia(await DB.getMessages(currentConvId));
      UI.renderMessages(msgs, me);
      await refreshList();
      UI.toast('Sent');
    } catch (e) {
      console.error(e);
      UI.toast(e.message || 'Upload failed');
    } finally {
      setTimeout(() => {
        if (bar) bar.classList.add('hidden');
        if (fill) fill.style.width = '0%';
      }, 500);
    }
  }

  async function startChatWithPhone(phone, name) {
    const myId = typeof Phone !== 'undefined' ? Phone.normalize(currentUser.id || currentUser.phone) : (currentUser.id || currentUser.phone);
    phone = typeof Phone !== 'undefined' ? Phone.normalize(phone) : phone;
    UI.toast('Opening chat...');
    try {
      const conv = await DB.getOrCreatePrivateConversation(myId, phone, name || phone);
      await open(conv.id, conv.title || name || phone);
    } catch (e) {
      console.error(e);
      UI.toast('Could not start chat: ' + (e.message || ''));
    }
  }

  function close() {
    const me = currentUser && (currentUser.id || currentUser.phone);
    if (currentConvId && me) DB.setTyping(currentConvId, me, false);
    if (subscription) { subscription.unsubscribe(); subscription = null; }
    if (statusSub) { statusSub.unsubscribe(); statusSub = null; }
    if (typingSub) { typingSub.unsubscribe(); typingSub = null; }
    if (window._msgPoll) { clearInterval(window._msgPoll); window._msgPoll = null; }
    currentConvId = null;
    otherPhone = null;
    UI.showScreen('app');
    refreshList();
  }

  return {
    init,
    open,
    send,
    sendMedia,
    startChatWithPhone,
    close,
    refreshList,
    get currentConvId() { return currentConvId; }
  };
})();
