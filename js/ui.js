/**
 * UI helpers – screen navigation, toasts, rendering
 */
const UI = (() => {
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function toast(msg, ms = 2500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  function avatarInitial(name) {
    return (name || '?').trim().charAt(0).toUpperCase();
  }

  function avatarHtml(name, avatarUrl, sizeClass = '') {
    const initial = avatarInitial(name);
    if (avatarUrl) {
      return `<div class="avatar ${sizeClass}"><img src="${avatarUrl}" alt="${escapeHtml(name || '')}" /></div>`;
    }
    return `<div class="avatar ${sizeClass}">${initial}</div>`;
  }

  function renderChatList(conversations, currentUserId) {
    const list = document.getElementById('chat-list');
    if (!conversations || conversations.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fa-solid fa-comments"></i></div>
          <h3>Start chatting on MAtSapp</h3>
          <p>Tap the chat button below to message a phone number.</p>
        </div>`;
      return;
    }

    list.innerHTML = conversations.map(c => {
      const name = c.title || c.id;
      const preview = c.lastMessage || 'Start a conversation';
      const time = c.lastMessageAt ? formatTime(c.lastMessageAt) : '';
      const unread = c.unread || 0;
      return `
        <div class="chat-item" data-id="${c.id}" data-title="${name}">
          <div class="avatar">${avatarInitial(name)}</div>
          <div class="chat-meta">
            <div class="chat-meta-top">
              <span class="chat-name">${escapeHtml(name)}</span>
              <span class="chat-time ${unread ? 'unread' : ''}">${time}</span>
            </div>
            <div class="chat-meta-bottom">
              <span class="chat-preview">${escapeHtml(preview)}</span>
              ${unread ? `<span class="badge">${unread}</span>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.chat-item').forEach(item => {
      item.addEventListener('click', () => {
        Chat.open(item.dataset.id, item.dataset.title);
      });
    });
  }

  function ticksHtml(status) {
    // sent = one grey, delivered = two grey, read = two blue
    if (status === 'read') return '<span class="ticks read"><i class="fa-solid fa-check-double"></i></span>';
    if (status === 'delivered') return '<span class="ticks delivered"><i class="fa-solid fa-check-double"></i></span>';
    return '<span class="ticks sent"><i class="fa-solid fa-check"></i></span>';
  }

  function mediaBody(m) {
    const url = m.media_url;
    if (!url) return escapeHtml(m.content || '');
    const t = m.type || '';
    if (t === 'image' || (m.media_mime && m.media_mime.startsWith('image/'))) {
      return '<a href="' + url + '" target="_blank" rel="noopener" class="msg-media-link">' +
        '<img class="msg-image" src="' + url + '" alt="image" loading="lazy" />' +
        '</a>' + (m.content ? '<div class="msg-caption">' + escapeHtml(m.content) + '</div>' : '');
    }
    if (t === 'voice' || (m.media_mime && m.media_mime.startsWith('audio/'))) {
      const dur = m.media_duration ? (m.media_duration + 's') : '';
      return '<div class="msg-voice"><i class="fa-solid fa-microphone"></i> ' +
        '<audio controls preload="metadata" src="' + url + '"></audio> ' +
        '<span class="voice-dur">' + dur + '</span></div>' +
        (m.content ? '<div class="msg-caption">' + escapeHtml(m.content) + '</div>' : '');
    }
    // document / other
    const label = m.content || 'Document';
    return '<a class="msg-doc" href="' + url + '" target="_blank" rel="noopener">' +
      '<i class="fa-solid fa-file"></i> <span>' + escapeHtml(label) + '</span></a>';
  }

  function renderMessages(messages, currentUserId) {
    const box = document.getElementById('messages');
    if (!box) return;
    box.innerHTML = messages.map(m => {
      const mine = m.sender_id === currentUserId;
      const time = formatTime(m.created_at);
      const ticks = mine ? ticksHtml(m.status || 'sent') : '';
      return (
        '<div class="message ' + (mine ? 'out' : 'in') + '" data-id="' + (m.id || '') + '">' +
          mediaBody(m) +
          '<span class="time">' + time + ' ' + ticks + '</span>' +
        '</div>'
      );
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setTab(name) {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  }

  return {
    showScreen,
    toast,
    formatTime,
    avatarInitial,
    renderChatList,
    renderMessages,
    setTab,
    escapeHtml
  };
})();
