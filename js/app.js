/**
 * MAtSapp main application bootstrap
 * MAT KAI STUDIOS · Mataaxion
 */
(async function App() {
  DB.init();

  let currentUser = null;

  // ---------- Boot ----------
  async function boot() {
    const bar = document.getElementById('splash-progress-bar');
    const status = document.getElementById('splash-status');
    // Vortex logo loops while loading (at least one full cycle ~2.4s)
    const splashStart = Date.now();
    if (bar) bar.style.width = '25%';
    if (status) status.textContent = 'Loading…';
    await delay(400);
    if (bar) bar.style.width = '55%';
    if (status) status.textContent = 'Connecting…';
    await delay(500);
    if (bar) bar.style.width = '80%';
    if (status) status.textContent = 'Almost ready…';

    // Local session first (instant) – don't wait on network to show UI
    currentUser = await DB.getCurrentUser();

    // Optional JWT restore in background (supabase mode)
    if (!currentUser && typeof Auth.restoreSession === 'function') {
      try {
        const restored = await Promise.race([
          Auth.restoreSession(),
          delay(1200).then(() => null) // don't hang splash >1.2s on bad network
        ]);
        if (restored) currentUser = restored;
      } catch (e) { console.warn('session restore', e); }
    }

    // Finish progress; keep vortex until min duration for one full loop
    if (bar) bar.style.width = '100%';
    if (status) status.textContent = 'Ready';
    const elapsed = Date.now() - splashStart;
    const minSplash = 2400;
    if (elapsed < minSplash) await delay(minSplash - elapsed);

    const splashEl = document.getElementById('splash');
    if (splashEl) splashEl.classList.add('splash-exit');
    await delay(320);

    if (currentUser && currentUser.display_name && currentUser.display_name !== currentUser.phone) {
      await enterApp();
    } else if (currentUser) {
      UI.showScreen('profile-setup');
    } else {
      UI.showScreen('login-screen');
    }
  }

  async function enterApp() {
    currentUser = await DB.getCurrentUser();
    if (currentUser && currentUser.is_suspended) {
      localStorage.removeItem('matsapp_currentUser');
      UI.toast('Account suspended');
      UI.showScreen('login-screen');
      return;
    }

    // Paint settings shell from local data (instant)
    document.getElementById('settings-name').textContent = currentUser.display_name || currentUser.phone;
    document.getElementById('settings-status').textContent = currentUser.status_text || 'Hey there! I am using MAtSapp.';
    const settingsAvatar = document.getElementById('settings-avatar');
    if (currentUser.avatar_url) {
      settingsAvatar.innerHTML = '<img src="' + currentUser.avatar_url + '" alt="profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />';
    } else {
      settingsAvatar.textContent = UI.avatarInitial(currentUser.display_name);
    }
    if (typeof Admin !== 'undefined' && Admin.isAdminUser(currentUser)) {
      document.getElementById('menu-admin')?.classList.remove('hidden');
    }

    // FIRST PAINT – do not wait for network
    UI.showScreen('app');

    // Background: chats, calls, push, config, suspended check
    Promise.resolve().then(() => Chat.init(currentUser)).catch((e) => console.warn('chat init', e));
    Promise.resolve().then(() => initCalls()).catch((e) => console.warn('calls init', e));

    if (CONFIG.FEATURES && CONFIG.FEATURES.push && CONFIG.VAPID_PUBLIC_KEY) {
      const phone = currentUser.phone || currentUser.id;
      if (phone && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        Promise.resolve().then(() => Push.subscribe(phone)).catch((e) => console.warn('push', e));
      }
    }

    if (window._matsappPoll) clearInterval(window._matsappPoll);
    window._matsappPoll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (document.getElementById('app')?.classList.contains('active')) Chat.refreshList();
    }, 5000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') Chat.refreshList();
    });

    if (DB.supabase) {
      Promise.race([
        DB.supabase.from('profiles').select('is_suspended,is_admin').eq('phone', currentUser.phone || currentUser.id).maybeSingle(),
        new Promise((r) => setTimeout(() => r({ data: null }), 1500))
      ]).then((res) => {
        const data = res && res.data;
        if (!data) return;
        if (data.is_suspended) {
          localStorage.removeItem('matsapp_currentUser');
          UI.toast('Account suspended');
          UI.showScreen('login-screen');
          return;
        }
        if (data.is_admin) {
          currentUser.is_admin = true;
          document.getElementById('menu-admin')?.classList.remove('hidden');
        }
      }).catch(() => {});

      Promise.resolve().then(() => DB.getAppConfig()).then((cfg) => {
        if (!cfg) return;
        if (cfg.app_name) {
          const title = document.getElementById('app-bar-title');
          if (title) title.textContent = cfg.app_name;
          document.title = cfg.app_name;
        }
        if (cfg.maintenance === true || cfg.maintenance === 'true') {
          UI.toast('App is in maintenance mode', 5000);
        }
      }).catch(() => {});
    }
  }

  // ---------- Login flow ----------
  const btnContinue = document.getElementById('btn-continue');
  const otpSection = document.getElementById('otp-section');
  let otpMode = false;

  btnContinue.addEventListener('click', async () => {
    try {
      btnContinue.disabled = true;
      if (!otpMode) {
        const code = document.getElementById('country-code').value;
      if (typeof Phone !== 'undefined') Phone.setDefaultCode(code);
        const num = document.getElementById('phone-input').value.trim();
        await Auth.requestOtp(code, num);
        otpSection.classList.remove('hidden');
        otpMode = true;
        btnContinue.textContent = 'Verify';
        UI.toast(CONFIG.DEMO_MODE ? 'Demo mode: enter any 6 digits (e.g. 123456)' : 'Code sent');
      } else {
        const otp = document.getElementById('otp-input').value.trim();
        const user = await Auth.verifyOtp(otp);
        currentUser = user;
        if (!user.display_name || user.display_name === user.phone) {
          UI.showScreen('profile-setup');
        } else {
          await enterApp();
        }
      }
    } catch (e) {
      console.error('Login error:', e);
      const msg = (e && e.message) ? e.message : 'Something went wrong';
      // Never show raw Supabase provider errors
      if (msg.toLowerCase().includes('phone provider') || msg.toLowerCase().includes('unsupported')) {
        UI.toast('Login system updated. Please hard-refresh the page (clear cache) and try again with code 123456');
      } else {
        UI.toast(msg);
      }
    } finally {
      btnContinue.disabled = false;
    }
  });

  // Profile setup
  document.getElementById('avatar-picker').addEventListener('click', () => {
    document.getElementById('avatar-file').click();
  });
  document.getElementById('avatar-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const preview = document.getElementById('avatar-preview');
      preview.innerHTML = `<img src="${reader.result}" alt="avatar">`;
      preview.dataset.url = reader.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-finish-setup').addEventListener('click', async () => {
    const name = document.getElementById('display-name').value.trim();
    if (!name) {
      UI.toast('Please enter your name');
      return;
    }
    const avatar = document.getElementById('avatar-preview').dataset.url || null;
    await Auth.completeProfile({ displayName: name, avatarDataUrl: avatar });
    await enterApp();
  });

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => UI.setTab(tab.dataset.tab));
  });

  // ---------- Overflow menu ----------
  const menu = document.getElementById('overflow-menu');
  document.getElementById('btn-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => menu.classList.add('hidden'));

  menu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    menu.classList.add('hidden');
    switch (action) {
      case 'settings':
        UI.showScreen('settings');
        break;
      case 'admin':
        openAdmin();
        break;
      case 'new-group':
        UI.showScreen('new-group');
        break;
      case 'ai':
        UI.showScreen('mataax-ai');
        if (typeof renderAiHistory === 'function') renderAiHistory();
        break;
      default:
        UI.toast(action + ' – coming soon');
    }
  });

  // ---------- Navigation ----------
  document.getElementById('btn-back-chat').addEventListener('click', () => Chat.close());
  document.getElementById('btn-back-settings').addEventListener('click', () => UI.showScreen('app'));
  document.getElementById('btn-back-newchat').addEventListener('click', () => UI.showScreen('app'));
  document.getElementById('btn-back-ai').addEventListener('click', () => UI.showScreen('app'));
  document.getElementById('btn-back-admin').addEventListener('click', () => UI.showScreen('app'));

  document.getElementById('btn-logout').addEventListener('click', () => Auth.logout());

  // New chat FAB
  document.getElementById('fab-new-chat').addEventListener('click', () => {
    UI.showScreen('new-chat');
    renderContacts();
  });

  document.getElementById('btn-new-contact').addEventListener('click', async () => {
    const phone = prompt('Enter phone number with country code\n(e.g. +2567XXXXXXX)');
    if (!phone) return;
    const name = prompt('Contact name (optional)') || phone;
    const owner = currentUser.phone || currentUser.id;
    const normalized = Contacts.normalizePhone(phone);
    await Contacts.addOne(owner, normalized, name);
    await renderContacts();
    await Chat.startChatWithPhone(normalized, name);
  });

  document.getElementById('btn-sync-contacts')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const owner = currentUser.phone || currentUser.id;
    try {
      UI.toast('Select contacts to import...');
      const list = await Contacts.syncFromDevice(owner);
      UI.toast('Synced ' + list.length + ' contacts');
      await renderContacts();
    } catch (e) {
      console.warn(e);
      const raw = prompt(
        'Contact picker not available on this browser.\n\n' +
        'Paste numbers (one per line). Optional name after comma:\n' +
        '+2567XXXXXXX, Ada\n+2567YYYYYYY'
      );
      if (!raw) {
        UI.toast(e.message || 'Could not sync contacts');
        return;
      }
      const lines = raw.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
      const parsed = lines.map(function (line) {
        const parts = line.split(',').map(function (s) { return s.trim(); });
        return { phone: parts[0], name: parts[1] || parts[0] };
      });
      const list = await Contacts.saveMany(owner, parsed);
      UI.toast('Saved ' + list.length + ' contacts');
      await renderContacts();
    }
  });

  async function renderContacts() {
    const list = document.getElementById('contact-list');
    if (!list || !currentUser) return;
    const owner = currentUser.phone || currentUser.id;
    const contacts = await Contacts.getAll(owner);
    const label = document.getElementById('contacts-section-label');
    if (label) label.textContent = contacts.length ? ('Contacts (' + contacts.length + ')') : 'Contacts on MAtSapp';

    if (!contacts.length) {
      list.innerHTML = '<p style="padding:20px;color:#8696A0;text-align:center;line-height:1.5">No contacts yet.<br/>Tap <strong>Sync phone contacts</strong> or <strong>New contact</strong>.</p>';
      return;
    }
    list.innerHTML = contacts.map(function (c) {
      return '<div class="chat-item" data-phone="' + UI.escapeHtml(c.phone) + '" data-name="' + UI.escapeHtml(c.name || c.phone) + '">' +
        '<div class="avatar">' + UI.avatarInitial(c.name || c.phone) + '</div>' +
        '<div class="chat-meta">' +
          '<div class="chat-meta-top"><span class="chat-name">' + UI.escapeHtml(c.name || c.phone) + '</span></div>' +
          '<div class="chat-meta-bottom"><span class="chat-preview">' + UI.escapeHtml(c.phone) + '</span></div>' +
        '</div></div>';
    }).join('');
    list.querySelectorAll('.chat-item').forEach(function (el) {
      el.addEventListener('click', function () {
        Chat.startChatWithPhone(el.dataset.phone, el.dataset.name);
      });
    });
  }

  // Send message
  document.getElementById('btn-send').addEventListener('click', () => {
    Chat.send(document.getElementById('message-input').value);
  });
  document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') Chat.send(e.target.value);
  });

  // Status
  document.getElementById('my-status').addEventListener('click', async () => {
    const text = prompt('Status update (visible 24h)');
    if (!text) return;
    await DB.addStatus(currentUser.id, text);
    UI.toast('Status added');
    // simple refresh
    const list = document.getElementById('status-list');
    list.innerHTML = `<div class="chat-item"><div class="avatar">${UI.avatarInitial(currentUser.display_name)}</div>
      <div class="chat-meta"><div class="chat-meta-top"><span class="chat-name">You</span></div>
      <div class="chat-meta-bottom"><span class="chat-preview">${UI.escapeHtml(text)}</span></div></div></div>` + list.innerHTML;
  });

  // Communities
  document.getElementById('btn-new-community').addEventListener('click', () => {
    UI.toast('Community creation will be available after backend connection');
  });

  // Mataax AI (simple local responses + future API hook)
  // ---------- Search: chats, messages, contacts ----------
  let searchMode = 'chats';
  let cachedConversations = [];

  // Keep a copy whenever chat list refreshes
  const _origRefreshList = Chat.refreshList.bind(Chat);
  Chat.refreshList = async function () {
    await _origRefreshList();
    try {
      if (currentUser) {
        cachedConversations = await DB.getConversations(currentUser.id || currentUser.phone);
      }
    } catch (_) {}
  };

  function highlight(text, q) {
    if (!q) return UI.escapeHtml(text || '');
    const safe = UI.escapeHtml(text || '');
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function filterChats(q) {
    const list = document.getElementById('chat-list');
    const resultsBox = document.getElementById('message-search-results');
    if (resultsBox) resultsBox.classList.add('hidden');
    if (!list) return;
    const query = (q || '').trim().toLowerCase();
    if (!query) {
      UI.renderChatList(cachedConversations, currentUser && (currentUser.id || currentUser.phone));
      return;
    }
    const filtered = (cachedConversations || []).filter(c => {
      const title = (c.title || '').toLowerCase();
      const last = (c.lastMessage || '').toLowerCase();
      return title.includes(query) || last.includes(query);
    });
    UI.renderChatList(filtered, currentUser && (currentUser.id || currentUser.phone));
  }

  async function searchInMessages(q) {
    const resultsBox = document.getElementById('message-search-results');
    const list = document.getElementById('chat-list');
    if (!resultsBox) return;
    const query = (q || '').trim();
    if (!query) {
      resultsBox.classList.add('hidden');
      resultsBox.innerHTML = '';
      return;
    }
    resultsBox.classList.remove('hidden');
    resultsBox.innerHTML = '<p style="padding:12px 16px;color:#8696A0">Searching…</p>';
    const rows = await DB.searchMessages(query, 40);
    if (!rows.length) {
      resultsBox.innerHTML = '<p style="padding:12px 16px;color:#8696A0">No messages found</p>';
      return;
    }
    // map conv titles
    const titleById = {};
    (cachedConversations || []).forEach(c => { titleById[c.id] = c.title; });
    resultsBox.innerHTML = rows.map(m => {
      const title = titleById[m.conversation_id] || m.conversation_id || 'Chat';
      const snippet = (m.content || '').slice(0, 120);
      return '<div class="msg-search-item" data-conv="' + UI.escapeHtml(m.conversation_id) + '" data-title="' + UI.escapeHtml(title) + '">' +
        '<strong>' + UI.escapeHtml(title) + '</strong>' +
        '<span>' + highlight(snippet, query) + ' · ' + UI.formatTime(m.created_at) + '</span></div>';
    }).join('');
    resultsBox.querySelectorAll('.msg-search-item').forEach(el => {
      el.addEventListener('click', () => {
        Chat.open(el.dataset.conv, el.dataset.title);
      });
    });
  }

  document.getElementById('btn-search')?.addEventListener('click', () => {
    const bar = document.getElementById('chat-search-bar');
    if (!bar) return;
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) {
      document.getElementById('chat-search')?.focus();
      // refresh cache
      if (currentUser) {
        DB.getConversations(currentUser.id || currentUser.phone).then(c => { cachedConversations = c || []; });
      }
    } else {
      document.getElementById('chat-search').value = '';
      document.getElementById('message-search-results')?.classList.add('hidden');
      filterChats('');
    }
  });

  document.getElementById('chat-search')?.addEventListener('input', (e) => {
    const q = e.target.value;
    const clearBtn = document.getElementById('chat-search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);
    if (searchMode === 'messages') searchInMessages(q);
    else filterChats(q);
  });

  document.getElementById('chat-search-clear')?.addEventListener('click', () => {
    const input = document.getElementById('chat-search');
    if (input) input.value = '';
    document.getElementById('chat-search-clear')?.classList.add('hidden');
    document.getElementById('message-search-results')?.classList.add('hidden');
    filterChats('');
  });

  document.querySelectorAll('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.search-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      searchMode = tab.dataset.searchMode || 'chats';
      const q = document.getElementById('chat-search')?.value || '';
      if (searchMode === 'messages') {
        document.getElementById('chat-list').style.opacity = '0.35';
        searchInMessages(q);
      } else {
        document.getElementById('chat-list').style.opacity = '1';
        document.getElementById('message-search-results')?.classList.add('hidden');
        filterChats(q);
      }
    });
  });

  // Contact search
  let allContactsCache = [];
  const _origRenderContacts = typeof renderContacts === 'function' ? renderContacts : null;

  async function filterContacts(q) {
    const list = document.getElementById('contact-list');
    if (!list || !currentUser) return;
    if (!allContactsCache.length) {
      allContactsCache = await Contacts.getAll(currentUser.phone || currentUser.id);
    }
    const query = (q || '').trim().toLowerCase();
    const filtered = !query ? allContactsCache : allContactsCache.filter(c => {
      return (c.name || '').toLowerCase().includes(query) ||
        (c.phone || '').toLowerCase().includes(query) ||
        (c.phone || '').replace(/\s/g, '').includes(query.replace(/\s/g, ''));
    });
    const label = document.getElementById('contacts-section-label');
    if (label) label.textContent = filtered.length ? ('Contacts (' + filtered.length + ')') : 'No matches';
    if (!filtered.length) {
      list.innerHTML = '<p style="padding:20px;color:#8696A0;text-align:center">No contacts match your search</p>';
      return;
    }
    list.innerHTML = filtered.map(function (c) {
      return '<div class="chat-item" data-phone="' + UI.escapeHtml(c.phone) + '" data-name="' + UI.escapeHtml(c.name || c.phone) + '">' +
        '<div class="avatar">' + UI.avatarInitial(c.name || c.phone) + '</div>' +
        '<div class="chat-meta">' +
          '<div class="chat-meta-top"><span class="chat-name">' + UI.escapeHtml(c.name || c.phone) + '</span></div>' +
          '<div class="chat-meta-bottom"><span class="chat-preview">' + UI.escapeHtml(c.phone) + '</span></div>' +
        '</div></div>';
    }).join('');
    list.querySelectorAll('.chat-item').forEach(function (el) {
      el.addEventListener('click', function () {
        Chat.startChatWithPhone(el.dataset.phone, el.dataset.name);
      });
    });
  }

  document.getElementById('btn-search-contacts')?.addEventListener('click', () => {
    document.getElementById('contact-search')?.focus();
  });
  document.getElementById('contact-search')?.addEventListener('input', (e) => {
    const q = e.target.value;
    document.getElementById('contact-search-clear')?.classList.toggle('hidden', !q);
    filterContacts(q);
  });
  document.getElementById('contact-search-clear')?.addEventListener('click', () => {
    const input = document.getElementById('contact-search');
    if (input) input.value = '';
    document.getElementById('contact-search-clear')?.classList.add('hidden');
    filterContacts('');
  });

  // Refresh contact cache when opening new chat
  document.getElementById('fab-new-chat')?.addEventListener('click', async () => {
    if (currentUser) {
      allContactsCache = await Contacts.getAll(currentUser.phone || currentUser.id);
    }
  });

  // Also expose via menu later; for now add a long-press or just open from settings
  document.getElementById('btn-ai-send').addEventListener('click', sendToAI);
  document.getElementById('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendToAI();
  });

  function sendToAI() {
    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const box = document.getElementById('ai-messages');
    box.innerHTML += `<div class="ai-bubble user">${UI.escapeHtml(text)}</div>`;
    // Simple local replies (replace with real LLM endpoint later)
    setTimeout(() => {
      const reply = mataaxReply(text);
      box.innerHTML += `<div class="ai-bubble assistant">${reply}</div>`;
      box.scrollTop = box.scrollHeight;
    }, 600);
  }

  function mataaxReply(q) {
    const lower = q.toLowerCase();
    if (lower.includes('hello') || lower.includes('hi')) return 'Hello! I am Mataax AI, built into MAtSapp by Mataaxion. How can I help you today?';
    if (lower.includes('who are you')) return 'I am Mataax AI – the intelligent assistant of MAtSapp, created by MAT KAI STUDIOS / Mataaxion.';
    if (lower.includes('whatsapp')) return 'MAtSapp is an independent messaging platform inspired by familiar patterns, engineered by Mataaxion.';
    return 'Thanks for your message. Full Mataax AI cloud intelligence can be connected via an API key in a future update. For now I run locally inside the app.';
  }

  // ---------- Admin ----------

  async function openAdmin() {
    if (!currentUser || !Admin.isAdminUser(currentUser)) {
      UI.toast('Admin access only');
      return;
    }
    UI.showScreen('admin-panel');
    await refreshAdminDashboard();
  }

  async function refreshAdminDashboard() {
    const stats = await Admin.getStats();
    const el = (id) => document.getElementById(id);
    if (el('stat-users')) el('stat-users').textContent = stats.users;
    if (el('stat-messages')) el('stat-messages').textContent = stats.messages;
    if (el('stat-chats')) el('stat-chats').textContent = stats.conversations;
    if (el('stat-groups')) el('stat-groups').textContent = stats.groups;

    const cfg = await Admin.getConfig();
    if (el('admin-app-name')) el('admin-app-name').value = cfg.app_name || 'MAtSapp';
    if (el('admin-tagline')) el('admin-tagline').value = cfg.tagline || 'Connect Beyond Limits';
    if (el('admin-welcome')) el('admin-welcome').value = cfg.welcome_message || '';
    if (el('admin-maintenance')) el('admin-maintenance').checked = !!cfg.maintenance;

    await renderAdminUsers('');
    await renderAdminReports();
  }

  async function renderAdminUsers(search) {
    const list = document.getElementById('admin-user-list');
    if (!list) return;
    list.innerHTML = '<p style="color:#8696A0;padding:8px 0">Loading…</p>';
    const users = await Admin.listUsers(search);
    if (!users.length) {
      list.innerHTML = '<p style="color:#8696A0;padding:8px 0">No users found</p>';
      return;
    }
    list.innerHTML = users.map(u => {
      const name = UI.escapeHtml(u.display_name || u.phone || '');
      const phone = UI.escapeHtml(u.phone || '');
      const suspended = !!u.is_suspended;
      const isAdm = !!u.is_admin;
      return '<div class="admin-user-row" data-phone="' + phone + '">' +
        '<div class="avatar">' + UI.avatarInitial(u.display_name || u.phone) + '</div>' +
        '<div class="meta"><strong>' + name + (isAdm ? ' · admin' : '') + '</strong><small>' + phone +
        (suspended ? ' · suspended' : '') + '</small></div>' +
        '<div class="actions">' +
          '<button type="button" class="' + (suspended ? 'ok' : 'danger') + '" data-act="suspend">' +
            (suspended ? 'Reinstate' : 'Suspend') + '</button>' +
          '<button type="button" data-act="make-admin">' + (isAdm ? 'Revoke admin' : 'Make admin') + '</button>' +
        '</div></div>';
    }).join('');

    list.querySelectorAll('.admin-user-row').forEach(row => {
      row.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async () => {
          const phone = row.dataset.phone;
          try {
            if (btn.dataset.act === 'suspend') {
              const suspend = btn.textContent.trim() === 'Suspend';
              await Admin.setSuspended(phone, suspend);
              UI.toast(suspend ? 'User suspended' : 'User reinstated');
            } else {
              const make = btn.textContent.indexOf('Make') !== -1;
              await Admin.setAdminFlag(phone, make);
              UI.toast(make ? 'Admin granted' : 'Admin revoked');
            }
            await renderAdminUsers(document.getElementById('admin-user-search')?.value || '');
          } catch (e) {
            UI.toast(e.message || 'Action failed');
          }
        });
      });
    });
  }

  async function renderAdminReports() {
    const list = document.getElementById('admin-report-list');
    if (!list) return;
    const reports = await Admin.listReports();
    if (!reports.length) {
      list.innerHTML = '<p style="color:#8696A0;padding:8px 0">No reports</p>';
      return;
    }
    list.innerHTML = reports.map(r => {
      return '<div class="admin-user-row" data-id="' + r.id + '">' +
        '<div class="meta"><strong>' + UI.escapeHtml(r.reason || 'Report') + '</strong>' +
        '<small>' + UI.escapeHtml((r.reporter_phone || '') + ' → ' + (r.reported_phone || '')) +
        ' · ' + UI.escapeHtml(r.status || '') + '</small></div>' +
        '<div class="actions"><button type="button" data-act="close">Close</button></div></div>';
    }).join('');
    list.querySelectorAll('button[data-act="close"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('.admin-user-row').dataset.id;
        await Admin.updateReportStatus(id, 'closed');
        UI.toast('Report closed');
        renderAdminReports();
      });
    });
  }

  document.getElementById('btn-admin-save-config')?.addEventListener('click', async () => {
    const config = {
      app_name: document.getElementById('admin-app-name').value.trim(),
      tagline: document.getElementById('admin-tagline').value.trim(),
      welcome_message: document.getElementById('admin-welcome').value.trim(),
      maintenance: document.getElementById('admin-maintenance').checked
    };
    await Admin.saveConfig(config);
    const title = document.getElementById('app-bar-title');
    if (title) title.textContent = config.app_name || 'MAtSapp';
    UI.toast('Configuration saved');
  });

  document.getElementById('btn-admin-announce')?.addEventListener('click', async () => {
    const title = document.getElementById('admin-ann-title')?.value.trim() || '';
    const body = document.getElementById('admin-ann-body')?.value.trim() || '';
    if (!body) { UI.toast('Enter announcement text'); return; }
    try {
      await Admin.postAnnouncement(title, body, currentUser.phone || currentUser.id);
      UI.toast('Announcement posted');
      document.getElementById('admin-ann-body').value = '';
    } catch (e) {
      UI.toast(e.message || 'Failed');
    }
  });

  document.getElementById('admin-user-search')?.addEventListener('input', (e) => {
    renderAdminUsers(e.target.value);
  });

  document.getElementById('admin-maintenance')?.addEventListener('change', async (e) => {
    try {
      await Admin.setMaintenance(e.target.checked);
      UI.toast(e.target.checked ? 'Maintenance ON' : 'Maintenance OFF');
    } catch (err) {
      UI.toast('Could not update maintenance');
    }
  });


  document.getElementById('btn-broadcast').addEventListener('click', () => {
    const msg = document.getElementById('admin-broadcast').value.trim();
    if (!msg) return;
    UI.toast('Broadcast queued (connect Supabase + Edge Function for real push)');
  });

  // Clear cache
  document.getElementById('btn-clear-cache').addEventListener('click', () => {
    if (confirm('Clear local cache and demo data? You will stay logged in.')) {
      // keep current user
      const user = localStorage.getItem('matsapp_currentUser');
      const keys = Object.keys(localStorage).filter(k => k.startsWith('matsapp_') && k !== 'matsapp_currentUser');
      keys.forEach(k => localStorage.removeItem(k));
      if (user) localStorage.setItem('matsapp_currentUser', user);
      UI.toast('Cache cleared');
      Chat.refreshList();
    }
  });

  // PWA install prompt helper
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Start

  // ---------- Full Settings navigation ----------
  const settingsPages = {
    account: {
      title: 'Account',
      html: `
        <div class="section-head">Login and security</div>
        <div class="sub-item" data-action="passkeys"><strong>Passkeys</strong><small>Passwordless sign-in (coming with secure backend)</small></div>
        <div class="sub-item" data-action="email"><strong>Email address</strong><small>Add email for recovery</small></div>
        <div class="sub-item" data-action="2fa"><strong>Two-step verification</strong><small>Extra security for your account</small></div>
        <div class="sub-item" data-action="security-notif"><strong>Security notifications</strong><small>Get notified of security events</small></div>
        <div class="section-head">Your account</div>
        <div class="sub-item" data-action="username"><strong>Username</strong><small>Set a unique username</small></div>
        <div class="sub-item" data-action="change-number"><strong>Change phone number</strong><small>Move account to a new number</small></div>
        <div class="sub-item" data-action="request-info"><strong>Request account info</strong><small>Create a report of your account information</small></div>
        <div class="sub-item" data-action="delete-account"><strong>Delete account</strong><small>Permanently remove your account</small></div>
      `
    },
    privacy: {
      title: 'Privacy',
      html: `
        <div class="section-head">Who can see my personal info</div>
        <div class="sub-item" data-action="last-seen"><strong>Last seen and online</strong><small>Everyone</small></div>
        <div class="sub-item" data-action="profile-photo"><strong>Profile photo</strong><small>Everyone</small></div>
        <div class="sub-item" data-action="about"><strong>About</strong><small>Everyone</small></div>
        <div class="sub-item" data-action="status"><strong>Status</strong><small>My contacts</small></div>
        <div class="toggle-row">
          <div class="label"><strong>Read receipts</strong><small>If turned off, you won't send or receive read receipts</small></div>
          <label class="switch"><input type="checkbox" id="toggle-read-receipts" checked><span class="slider"></span></label>
        </div>
        <div class="section-head">Disappearing messages</div>
        <div class="sub-item" data-action="default-message-timer"><strong>Default message timer</strong><small>Off</small></div>
        <div class="section-head">Advanced</div>
        <div class="sub-item" data-action="blocked"><strong>Blocked contacts</strong><small>None</small></div>
        <div class="sub-item" data-action="applock"><strong>App lock</strong><small>Disabled</small></div>
      `
    },
    chats: {
      title: 'Chats',
      html: `
        <div class="section-head">Display</div>
        <div class="sub-item" data-action="theme"><strong>Theme</strong><small>System default</small></div>
        <div class="sub-item" data-action="wallpaper"><strong>Default chat theme</strong><small>Wallpaper &amp; colours</small></div>
        <div class="section-head">Chat settings</div>
        <div class="toggle-row">
          <div class="label"><strong>Enter is send</strong><small>Enter key will send your message</small></div>
          <label class="switch"><input type="checkbox" id="toggle-enter-send"><span class="slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="label"><strong>Media visibility</strong><small>Show newly downloaded media in gallery</small></div>
          <label class="switch"><input type="checkbox" id="toggle-media-vis" checked><span class="slider"></span></label>
        </div>
        <div class="sub-item" data-action="font-size"><strong>Font size</strong><small>Medium</small></div>
        <div class="section-head">Chat history</div>
        <div class="sub-item" data-action="export-chat"><strong>Export chat</strong></div>
        <div class="sub-item" data-action="clear-chats"><strong>Clear all chats</strong></div>
        <div class="sub-item" data-action="archive-chats"><strong>Archive all chats</strong></div>
      `
    },
    notifications: {
      title: 'Notifications',
      html: `
        <div class="section-head">Messages</div>
        <div class="toggle-row">
          <div class="label"><strong>Conversation tones</strong><small>Play sounds for incoming and outgoing messages</small></div>
          <label class="switch"><input type="checkbox" id="toggle-conv-tones" checked><span class="slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="label"><strong>Reminders</strong><small>Occasional reminders about unread messages</small></div>
          <label class="switch"><input type="checkbox" id="toggle-reminders" checked><span class="slider"></span></label>
        </div>
        <div class="sub-item" data-action="notif-tone"><strong>Notification tone</strong><small>Default</small></div>
        <div class="sub-item" data-action="vibrate"><strong>Vibrate</strong><small>Default</small></div>
        <div class="section-head">Groups</div>
        <div class="toggle-row">
          <div class="label"><strong>Group notifications</strong></div>
          <label class="switch"><input type="checkbox" id="toggle-group-notif" checked><span class="slider"></span></label>
        </div>
        <div class="section-head">Calls</div>
        <div class="toggle-row">
          <div class="label"><strong>Call notifications</strong></div>
          <label class="switch"><input type="checkbox" id="toggle-call-notif" checked><span class="slider"></span></label>
        </div>
      `
    },
    storage: {
      title: 'Storage and data',
      html: `
        <div class="sub-item" data-action="manage-storage"><strong>Manage storage</strong><small>See storage used by chats and media</small></div>
        <div class="sub-item" data-action="network-usage"><strong>Network usage</strong><small>Bytes sent and received</small></div>
        <div class="toggle-row">
          <div class="label"><strong>Use less data for calls</strong></div>
          <label class="switch"><input type="checkbox" id="toggle-less-data"><span class="slider"></span></label>
        </div>
        <div class="section-head">Media auto-download</div>
        <div class="sub-item" data-action="auto-dl-mobile"><strong>When using mobile data</strong><small>Photos</small></div>
        <div class="sub-item" data-action="auto-dl-wifi"><strong>When connected on Wi-Fi</strong><small>All</small></div>
        <div class="sub-item" data-action="auto-dl-roaming"><strong>When roaming</strong><small>No media</small></div>
      `
    },
    accessibility: {
      title: 'Accessibility',
      html: `
        <div class="toggle-row">
          <div class="label"><strong>Increase contrast</strong><small>Darken key colours for easier visibility</small></div>
          <label class="switch"><input type="checkbox" id="toggle-contrast"><span class="slider"></span></label>
        </div>
        <div class="sub-item" data-action="animation"><strong>Animation</strong><small>Enabled</small></div>
      `
    },
    language: {
      title: 'App language',
      html: `
        <div class="sub-item" data-action="lang-en"><strong>English</strong><small>Device language</small></div>
        <div class="sub-item" data-action="lang-sw"><strong>Kiswahili</strong><small>Swahili</small></div>
        <div class="sub-item" data-action="lang-fr"><strong>Français</strong><small>French</small></div>
        <div class="sub-item" data-action="lang-ar"><strong>العربية</strong><small>Arabic</small></div>
      `
    },
    help: {
      title: 'Help',
      html: `
        <div class="sub-item" data-action="help-centre"><strong>Help Centre</strong></div>
        <div class="sub-item" data-action="contact-us"><strong>Contact us</strong><small>Questions or feedback</small></div>
        <div class="sub-item" data-action="terms"><strong>Terms and Privacy Policy</strong></div>
        <div class="sub-item" data-action="channel"><strong>App info</strong><small>MAtSapp · MAT KAI STUDIOS · Mataaxion</small></div>
      `
    }
  };

  function openSettingsPage(key) {
    const page = settingsPages[key];
    if (!page) return;
    document.getElementById('settings-sub-title').textContent = page.title;
    document.getElementById('settings-sub-body').innerHTML = page.html;
    UI.showScreen('settings-sub');

    // Wire toggles to localStorage
    document.querySelectorAll('#settings-sub-body input[type=checkbox]').forEach(el => {
      const saved = localStorage.getItem('matsapp_pref_' + el.id);
      if (saved !== null) el.checked = saved === 'true';
      el.addEventListener('change', () => {
        localStorage.setItem('matsapp_pref_' + el.id, el.checked);
        UI.toast(el.checked ? 'Enabled' : 'Disabled');
      });
    });

    document.querySelectorAll('#settings-sub-body .sub-item').forEach(el => {
      el.addEventListener('click', () => {
        const action = el.dataset.action;
        if (action === 'delete-account') {
          if (confirm('Delete account? This cannot be undone.')) {
            UI.toast('Account deletion will be available after full backend auth');
          }
        } else if (action === 'clear-chats') {
          if (confirm('Clear all chats on this device?')) {
            Object.keys(localStorage).filter(k => k.startsWith('matsapp_messages') || k.startsWith('matsapp_conversations')).forEach(k => localStorage.removeItem(k));
            Chat.refreshList();
            UI.toast('Chats cleared on this device');
          }
        } else {
          UI.toast('This option will connect to full account services in the next phase');
        }
      });
    });
  }

  document.querySelectorAll('#settings .settings-item[data-settings]').forEach(btn => {
    btn.addEventListener('click', () => openSettingsPage(btn.dataset.settings));
  });

  document.getElementById('btn-back-settings-sub')?.addEventListener('click', () => UI.showScreen('settings'));

  // Profile edit
  document.getElementById('settings-profile')?.addEventListener('click', async () => {
    const user = await DB.getCurrentUser();
    if (!user) return;
    document.getElementById('edit-display-name').value = user.display_name || '';
    document.getElementById('edit-about').value = user.status_text || '';
    document.getElementById('edit-phone').value = user.phone || '';
    const prev = document.getElementById('edit-avatar-preview');
    if (user.avatar_url) {
      prev.innerHTML = `<img src="${user.avatar_url}" alt="avatar" />`;
      prev.dataset.url = user.avatar_url;
    } else {
      prev.innerHTML = `<i class="fa-solid fa-user"></i>`;
      delete prev.dataset.url;
    }
    UI.showScreen('edit-profile');
  });

  document.getElementById('btn-back-edit-profile')?.addEventListener('click', () => UI.showScreen('settings'));

  document.getElementById('edit-avatar-picker')?.addEventListener('click', () => {
    document.getElementById('edit-avatar-file').click();
  });
  document.getElementById('edit-avatar-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const prev = document.getElementById('edit-avatar-preview');
      prev.innerHTML = `<img src="${reader.result}" alt="avatar" />`;
      prev.dataset.url = reader.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    const name = document.getElementById('edit-display-name').value.trim();
    const about = document.getElementById('edit-about').value.trim();
    const avatar = document.getElementById('edit-avatar-preview').dataset.url || null;
    if (!name) { UI.toast('Name is required'); return; }
    await Auth.completeProfile({ displayName: name, avatarDataUrl: avatar });
    const user = await DB.getCurrentUser();
    if (user) {
      user.status_text = about || user.status_text;
      await DB.saveUser(user);
    }
    document.getElementById('settings-name').textContent = name;
    document.getElementById('settings-status').textContent = about || 'Hey there! I am using MAtSapp.';
    const sa = document.getElementById('settings-avatar');
    if (avatar) sa.innerHTML = `<img src="${avatar}" alt="profile" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    UI.toast('Profile updated');
    UI.showScreen('settings');
  });

  document.getElementById('btn-invite')?.addEventListener('click', async () => {
    const url = location.href.split('#')[0];
    const text = 'Chat with me on MAtSapp – Connect Beyond Limits: ' + url;
    if (navigator.share) {
      try { await navigator.share({ title: 'MAtSapp', text, url }); } catch (_) {}
    } else {
      await navigator.clipboard?.writeText(text);
      UI.toast('Invite link copied');
    }
  });

  // ---------- Phase 3: media attach + voice ----------
  const attachSheet = document.getElementById('attach-sheet');
  document.getElementById('btn-attach')?.addEventListener('click', () => {
    attachSheet?.classList.toggle('hidden');
  });

  document.querySelectorAll('#attach-sheet button').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.attach;
      attachSheet?.classList.add('hidden');
      if (kind === 'image') document.getElementById('file-image')?.click();
      if (kind === 'camera') document.getElementById('file-camera')?.click();
      if (kind === 'document') document.getElementById('file-document')?.click();
    });
  });

  async function handlePickedFile(file, type) {
    if (!file) return;
    if (!Chat.currentConvId) {
      UI.toast('Open a chat first');
      return;
    }
    await Chat.sendMedia({ file, type });
  }

  document.getElementById('file-image')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    handlePickedFile(f, 'image');
  });
  document.getElementById('file-camera')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    handlePickedFile(f, 'image');
  });
  document.getElementById('file-document')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    handlePickedFile(f, 'document');
  });

  document.getElementById('btn-voice')?.addEventListener('click', async () => {
    if (!Chat.currentConvId) {
      UI.toast('Open a chat first');
      return;
    }
    const btn = document.getElementById('btn-voice');
    try {
      if (!Media.isRecording()) {
        await Media.startVoice();
        btn?.classList.add('recording');
        UI.toast('Recording… tap mic to stop');
      } else {
        const { file, duration } = await Media.stopVoice();
        btn?.classList.remove('recording');
        if (duration < 1) {
          UI.toast('Hold a bit longer');
          return;
        }
        await Chat.sendMedia({ file, type: 'voice', duration });
      }
    } catch (e) {
      btn?.classList.remove('recording');
      UI.toast(e.message || 'Microphone permission needed');
    }
  });

  // ---------- Phase 4: Status, Groups, Communities ----------
  async function refreshStatuses() {
    if (!currentUser) return;
    const me = currentUser.phone || currentUser.id;
    const list = document.getElementById('status-list');
    if (!list) return;
    try {
      const statuses = await Social.listStatuses(me);
      // group by user
      const byUser = {};
      statuses.forEach(s => {
        if (!byUser[s.user_phone]) byUser[s.user_phone] = [];
        byUser[s.user_phone].push(s);
      });
      const phones = Object.keys(byUser);
      if (!phones.length) {
        list.innerHTML = '<p style="padding:16px;color:#8696A0;text-align:center">No recent updates</p>';
        return;
      }
      list.innerHTML = phones.map(phone => {
        const items = byUser[phone];
        const latest = items[0];
        const name = phone === me ? 'You' : phone;
        const preview = latest.type === 'image' ? 'Photo' : (latest.content || 'Status');
        return '<div class="status-item" data-phone="' + phone + '">' +
          '<div class="status-ring">' + UI.avatarInitial(name) + '</div>' +
          '<div class="chat-meta"><div class="chat-meta-top"><span class="chat-name">' + UI.escapeHtml(name) + '</span></div>' +
          '<div class="chat-meta-bottom"><span class="chat-preview">' + UI.escapeHtml(preview) + ' · ' + UI.formatTime(latest.created_at) + '</span></div></div></div>';
      }).join('');

      list.querySelectorAll('.status-item').forEach(el => {
        el.addEventListener('click', () => {
          const phone = el.dataset.phone;
          const items = byUser[phone];
          if (!items || !items.length) return;
          openStatusViewer(phone === me ? 'You' : phone, items[0]);
          Social.markStatusViewed(items[0].id, me);
        });
      });
    } catch (e) {
      console.warn(e);
    }
  }

  function openStatusViewer(name, status) {
    document.getElementById('status-viewer-name').textContent = name;
    const body = document.getElementById('status-viewer-body');
    if (status.type === 'image' && status.media_url) {
      body.innerHTML = '<img src="' + status.media_url + '" alt="status" />' +
        (status.content ? '<p style="margin-top:12px">' + UI.escapeHtml(status.content) + '</p>' : '');
    } else {
      body.textContent = status.content || '';
    }
    document.getElementById('status-viewer').classList.remove('hidden');
  }

  document.getElementById('btn-close-status')?.addEventListener('click', () => {
    document.getElementById('status-viewer').classList.add('hidden');
  });

  async function postTextStatus() {
    const text = prompt('Status update (visible 24 hours)');
    if (!text || !text.trim()) return;
    const me = currentUser.phone || currentUser.id;
    await Social.addStatus({ userPhone: me, type: 'text', content: text.trim() });
    UI.toast('Status posted');
    refreshStatuses();
  }

  document.getElementById('my-status')?.addEventListener('click', postTextStatus);
  document.getElementById('btn-status-text')?.addEventListener('click', postTextStatus);
  document.getElementById('fab-new-status')?.addEventListener('click', () => {
    document.getElementById('status-image-file')?.click();
  });
  document.getElementById('btn-status-image')?.addEventListener('click', () => {
    document.getElementById('status-image-file')?.click();
  });

  document.getElementById('status-image-file')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !currentUser) return;
    try {
      UI.toast('Uploading status…');
      const me = currentUser.phone || currentUser.id;
      const compressed = await Media.compressImage(file);
      const uploaded = await Media.uploadFile(compressed, 'status/' + me.replace(/\+/g, ''));
      const caption = prompt('Caption (optional)') || '';
      await Social.addStatus({
        userPhone: me,
        type: 'image',
        content: caption,
        mediaUrl: uploaded.url
      });
      UI.toast('Status posted');
      refreshStatuses();
    } catch (err) {
      UI.toast(err.message || 'Failed to post status');
    }
  });

  // Refresh statuses when opening Updates tab
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'updates') refreshStatuses();
      if (tab.dataset.tab === 'communities') refreshCommunities();
    });
  });

  // Groups
  document.getElementById('btn-new-group-from-contacts')?.addEventListener('click', () => {
    UI.showScreen('new-group');
  });
  // overflow menu new-group
  const menuNewGroup = document.querySelector('#overflow-menu [data-action="new-group"]');
  if (menuNewGroup) {
    menuNewGroup.addEventListener('click', () => UI.showScreen('new-group'));
  }

  document.getElementById('btn-back-newgroup')?.addEventListener('click', () => UI.showScreen('new-chat'));

  document.getElementById('btn-create-group')?.addEventListener('click', async () => {
    const title = document.getElementById('group-title').value.trim();
    const raw = document.getElementById('group-members').value.trim();
    if (!title) { UI.toast('Enter a group name'); return; }
    const me = currentUser.phone || currentUser.id;
    const members = raw ? raw.split(/[,;\s]+/).map(s => Contacts.normalizePhone(s)).filter(Boolean) : [];
    try {
      const group = await Social.createGroup({ creatorPhone: me, title, memberPhones: members });
      UI.toast('Group created');
      document.getElementById('group-title').value = '';
      document.getElementById('group-members').value = '';
      await Chat.refreshList();
      await Chat.open(group.id, group.title);
    } catch (e) {
      UI.toast(e.message || 'Could not create group');
    }
  });

  // Communities
  async function refreshCommunities() {
    if (!currentUser) return;
    const me = currentUser.phone || currentUser.id;
    const list = document.getElementById('communities-list');
    const empty = document.getElementById('communities-empty');
    try {
      const items = await Social.listCommunities(me);
      if (!items.length) {
        if (empty) empty.style.display = '';
        if (list) list.innerHTML = '';
        return;
      }
      if (empty) empty.style.display = 'none';
      list.innerHTML = items.map(c =>
        '<div class="community-card"><h4>' + UI.escapeHtml(c.name) + '</h4>' +
        '<p>' + UI.escapeHtml(c.description || 'Community') + '</p></div>'
      ).join('');
    } catch (e) {
      console.warn(e);
    }
  }

  async function createCommunityFlow() {
    const name = prompt('Community name');
    if (!name || !name.trim()) return;
    const description = prompt('Description (optional)') || '';
    const me = currentUser.phone || currentUser.id;
    try {
      await Social.createCommunity({ creatorPhone: me, name: name.trim(), description });
      UI.toast('Community created');
      refreshCommunities();
    } catch (e) {
      UI.toast(e.message || 'Failed');
    }
  }

  document.getElementById('btn-new-community')?.addEventListener('click', createCommunityFlow);
  document.getElementById('fab-new-community')?.addEventListener('click', createCommunityFlow);

  // ---------- Phase 5: Voice / Video calls ----------
  let pendingIncoming = null;

  function showCallScreen(show) {
    document.getElementById('call-screen').classList.toggle('hidden', !show);
  }

  function formatCallTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function bindCallStreams(local, remote, isVideo) {
    const lv = document.getElementById('call-local-video');
    const rv = document.getElementById('call-remote-video');
    if (local && lv) {
      lv.srcObject = local;
      lv.classList.toggle('hidden', !isVideo);
    }
    if (remote && rv) {
      rv.srcObject = remote;
    }
  }

  async function initCalls() {
    if (!currentUser) return;
    const me = currentUser.phone || currentUser.id;
    await Calls.init(me, (state, extra) => {
      const statusEl = document.getElementById('call-status');
      const timerEl = document.getElementById('call-timer');
      const incomingActions = document.getElementById('call-actions-incoming');
      const activeActions = document.getElementById('call-actions-active');

      if (state === 'outgoing') {
        showCallScreen(true);
        document.getElementById('call-peer-name').textContent = extra.to;
        document.getElementById('call-avatar').textContent = UI.avatarInitial(extra.to);
        statusEl.textContent = extra.type === 'video' ? 'Video calling…' : 'Calling…';
        timerEl.classList.add('hidden');
        incomingActions.classList.add('hidden');
        activeActions.classList.remove('hidden');
        bindCallStreams(extra.localStream, null, extra.type === 'video');
      }
      if (state === 'incoming') {
        pendingIncoming = extra;
        showCallScreen(true);
        document.getElementById('call-peer-name').textContent = extra.from;
        document.getElementById('call-avatar').textContent = UI.avatarInitial(extra.from);
        statusEl.textContent = (extra.type === 'video' ? 'Incoming video call' : 'Incoming voice call');
        timerEl.classList.add('hidden');
        incomingActions.classList.remove('hidden');
        activeActions.classList.add('hidden');
      }
      if (state === 'accepted' || state === 'connected') {
        statusEl.textContent = 'Connected';
        timerEl.classList.remove('hidden');
        incomingActions.classList.add('hidden');
        activeActions.classList.remove('hidden');
      }
      if (state === 'remote-stream') {
        bindCallStreams(Calls.localStream, extra.stream, true);
        document.getElementById('call-remote-video').srcObject = extra.stream;
      }
      if (state === 'tick') {
        timerEl.textContent = formatCallTime(extra.seconds);
      }
      if (state === 'ended') {
        showCallScreen(false);
        pendingIncoming = null;
        const reason = (extra && extra.reason) || '';
        if (reason === 'rejected') UI.toast('Call declined');
        else if (reason === 'remote-hangup') UI.toast('Call ended');
        document.getElementById('call-local-video').srcObject = null;
        document.getElementById('call-remote-video').srcObject = null;
      }
    });
  }

  // re-init calls after login
  const _origEnterApp = typeof enterApp === 'function' ? enterApp : null;

  async function startCallFromChat(type) {
    if (!currentUser || !Chat.currentConvId) {
      UI.toast('Open a chat first');
      return;
    }
    const me = currentUser.phone || currentUser.id;
    const convId = Chat.currentConvId;
    // derive peer from conv id
    let peer = null;
    if (convId.startsWith(me + '_')) peer = convId.slice(me.length + 1);
    else if (convId.endsWith('_' + me)) peer = convId.slice(0, -(me.length + 1));
    if (!peer || convId.startsWith('g_')) {
      UI.toast('Calls work in 1:1 chats for now');
      return;
    }
    try {
      await Calls.startCall({ me, peerPhone: peer, type });
    } catch (e) {
      UI.toast(e.message || 'Could not start call');
    }
  }

  document.getElementById('btn-chat-voice')?.addEventListener('click', () => startCallFromChat('voice'));
  document.getElementById('btn-chat-video')?.addEventListener('click', () => startCallFromChat('video'));
  document.getElementById('fab-new-call')?.addEventListener('click', () => {
    UI.toast('Open a chat, then tap the phone icon to call');
  });

  document.getElementById('btn-call-hangup')?.addEventListener('click', async () => {
    await Calls.endCall(true);
    showCallScreen(false);
  });
  document.getElementById('btn-call-reject')?.addEventListener('click', async () => {
    if (pendingIncoming) {
      await Calls.rejectCall({
        me: currentUser.phone || currentUser.id,
        callId: pendingIncoming.callId,
        from: pendingIncoming.from
      });
    }
    showCallScreen(false);
    pendingIncoming = null;
  });
  document.getElementById('btn-call-accept')?.addEventListener('click', async () => {
    if (!pendingIncoming || !currentUser) return;
    try {
      await Calls.acceptCall({
        me: currentUser.phone || currentUser.id,
        offer: pendingIncoming.offer,
        callId: pendingIncoming.callId,
        from: pendingIncoming.from,
        type: pendingIncoming.type
      });
      pendingIncoming = null;
    } catch (e) {
      UI.toast(e.message || 'Accept failed');
    }
  });
  document.getElementById('btn-call-mute')?.addEventListener('click', () => {
    const muted = Calls.toggleMute();
    document.getElementById('btn-call-mute').classList.toggle('active-mute', muted);
    document.getElementById('btn-call-mute').innerHTML = muted
      ? '<i class="fa-solid fa-microphone-slash"></i>'
      : '<i class="fa-solid fa-microphone"></i>';
  });
  document.getElementById('btn-call-camera')?.addEventListener('click', () => {
    const off = Calls.toggleCamera();
    document.getElementById('btn-call-camera').innerHTML = off
      ? '<i class="fa-solid fa-video-slash"></i>'
      : '<i class="fa-solid fa-video"></i>';
  });

  // ---------- Phase 6: Mataax AI ----------
  function renderAiHistory() {
    const box = document.getElementById('ai-messages');
    if (!box) return;
    const hist = MataaxAI.loadHistory();
    if (!hist.length) {
      box.innerHTML = '<div class="ai-welcome"><div class="ai-logo"><i class="fa-solid fa-sparkles"></i></div>' +
        '<h3>Mataax AI</h3><p>Ask about anything — study, coding, writing, or MAtSapp tips.<br/>Cloud replies need the Edge Function + API key.</p></div>';
      return;
    }
    box.innerHTML = hist.map(function (m) {
      const cls = m.role === 'user' ? 'ai-msg user' : 'ai-msg bot';
      return '<div class="' + cls + '">' + UI.escapeHtml(m.content).replace(/\\n/g, '<br/>') + '</div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  async function sendAiMessage() {
    const input = document.getElementById('ai-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const box = document.getElementById('ai-messages');
    if (box) {
      box.innerHTML += '<div class="ai-msg user">' + UI.escapeHtml(text) + '</div>';
      box.innerHTML += '<div class="ai-msg bot" id="ai-typing"><i class="fa-solid fa-circle-notch fa-spin"></i> Mataax AI is thinking…</div>';
      box.scrollTop = box.scrollHeight;
    }
    try {
      const { reply, source } = await MataaxAI.ask(text);
      const typing = document.getElementById('ai-typing');
      if (typing) typing.remove();
      if (box) {
        const label = source === 'local' ? '<small class="ai-source">local mode</small>' : '';
        box.innerHTML += '<div class="ai-msg bot">' + UI.escapeHtml(reply).replace(/\\n/g, '<br/>') + label + '</div>';
        box.scrollTop = box.scrollHeight;
      }
    } catch (e) {
      const typing = document.getElementById('ai-typing');
      if (typing) typing.remove();
      UI.toast(e.message || 'AI error');
    }
  }

  document.getElementById('btn-ai-send')?.addEventListener('click', sendAiMessage);
  document.getElementById('ai-input')?.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAiMessage();
    }
  });

  // Open AI from menu
  const menuAi = document.querySelector('#overflow-menu [data-action="ai"]');
  if (menuAi) {
    menuAi.addEventListener('click', function () {
      UI.showScreen('mataax-ai');
      renderAiHistory();
    });
  }
  // Also common id
  document.getElementById('btn-open-ai')?.addEventListener('click', function () {
    UI.showScreen('mataax-ai');
    renderAiHistory();
  });

  document.getElementById('btn-enable-push')?.addEventListener('click', async () => {
    if (!currentUser) return;
    try {
      await Push.subscribe(currentUser.phone || currentUser.id);
      UI.toast('Notifications enabled');
    } catch (e) {
      UI.toast(e.message || 'Could not enable notifications');
    }
  });

  boot();
})();
