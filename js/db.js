/**
 * Database layer – Supabase + localStorage fallback
 * Fixed for reliable multi-device messaging
 */
const DB = (() => {
  let supabase = null;
  const LS_PREFIX = 'matsapp_';

  function init() {
    if (!CONFIG.DEMO_MODE && window.supabase) {
      supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        realtime: {
          params: { eventsPerSecond: 10 }
        }
      });
      console.info('%c[MAtSapp] Supabase connected', 'color:#25D366');
    }
    return supabase;
  }

  function lsGet(key, fallback = null) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }
  function lsSet(key, value) {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  }

  // ---------- Users ----------
  async function getCurrentUser() {
    const local = lsGet('currentUser');
    if (!local) return null;

    if (supabase && local.phone) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('phone', local.phone)
          .maybeSingle();
        if (data) {
          const user = {
            id: data.phone,
            phone: data.phone,
            display_name: data.display_name || data.phone,
            avatar_url: data.avatar_url,
            status_text: data.status_text,
            is_admin: data.is_admin
          };
          lsSet('currentUser', user);
          return user;
        }
      } catch (e) {
        console.warn('getCurrentUser refresh failed', e);
      }
    }
    return local;
  }

  async function saveUser(user) {
    user.id = user.phone;
    lsSet('currentUser', user);

    const users = lsGet('users', {});
    users[user.phone] = user;
    lsSet('users', users);

    if (supabase) {
      const { error } = await supabase.from('profiles').upsert({
        phone: user.phone,
        display_name: user.display_name || user.phone,
        avatar_url: user.avatar_url || null,
        status_text: user.status_text || 'Hey there! I am using MAtSapp.',
        is_admin: !!user.is_admin,
        updated_at: new Date().toISOString()
      }, { onConflict: 'phone' });

      if (error) console.error('saveUser error:', error.message);
    }
    return user;
  }

  async function findUserByPhone(phone) {
    if (supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      if (error) console.warn(error);
      if (data) {
        return {
          id: data.phone,
          phone: data.phone,
          display_name: data.display_name,
          avatar_url: data.avatar_url,
          status_text: data.status_text,
          is_admin: data.is_admin
        };
      }
    }
    const users = lsGet('users', {});
    return users[phone] || null;
  }

  // ---------- Conversations ----------
  async function getConversations(userId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('conversation_members')
        .select(`
          unread_count,
          pinned,
          conversation_id,
          conversations (
            id,
            type,
            title,
            last_message,
            last_message_at
          )
        `)
        .eq('user_phone', userId);

      if (error) {
        console.error('getConversations error:', error);
        return [];
      }

      return (data || [])
        .filter(row => row.conversations)
        .map(row => {
          const cid = row.conversations.id;
          let title = row.conversations.title || cid;
          // For private chats, show the OTHER person's number (not a stale title)
          if (row.conversations.type !== 'group' && cid && cid.includes('_')) {
            const parts = cid.split('_');
            // rebuild peer: convId is sorted phones joined by _
            // phones start with + so split is tricky — use membership approach
            if (cid.startsWith(userId + '_')) {
              title = cid.slice(userId.length + 1);
            } else if (cid.endsWith('_' + userId)) {
              title = cid.slice(0, -(userId.length + 1));
            }
            if (typeof Phone !== 'undefined') title = Phone.formatDisplay(title);
          }
          return {
            id: cid,
            title: title,
            lastMessage: row.conversations.last_message || '',
            lastMessageAt: row.conversations.last_message_at
              ? new Date(row.conversations.last_message_at).getTime()
              : 0,
            unread: row.unread_count || 0,
            pinned: row.pinned
          };
        })
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    }

    // local fallback
    const all = lsGet('conversations', {});
    return Object.values(all)
      .filter(c => c.members && c.members.includes(userId))
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  }

  async function getOrCreatePrivateConversation(myId, otherPhone, otherName) {
    // Normalize both sides so +2567... and 07... land in the SAME conversation
    const me = (typeof Phone !== 'undefined' ? Phone.normalize(myId) : String(myId));
    const other = (typeof Phone !== 'undefined' ? Phone.normalize(otherPhone) : String(otherPhone));
    if (!me || !other) throw new Error('Invalid phone number');
    if (me === other) throw new Error('Cannot message yourself');

    const convId = [me, other].sort().join('_');
    const titleForMe = otherName || (typeof Phone !== 'undefined' ? Phone.formatDisplay(other) : other);

    if (supabase) {
      // 1. Ensure both profiles exist (recipient gets a shell profile so they appear in system)
      await supabase.from('profiles').upsert([
        { phone: me, display_name: me, updated_at: new Date().toISOString() },
        { phone: other, display_name: otherName || other, updated_at: new Date().toISOString() }
      ], { onConflict: 'phone' });

      // 2. Create conversation if missing
      let { data: existing } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .maybeSingle();

      if (!existing) {
        const { error: cErr } = await supabase.from('conversations').insert({
          id: convId,
          type: 'private',
          title: titleForMe,
          last_message: '',
          last_message_at: new Date().toISOString()
        });
        if (cErr) console.error('create conversation error:', cErr);
      }

      // 3. BOTH users as members — this is what makes YOUR chat appear on THEIR phone
      const { error: mErr } = await supabase.from('conversation_members').upsert([
        { conversation_id: convId, user_phone: me, unread_count: 0 },
        { conversation_id: convId, user_phone: other, unread_count: 0 }
      ], { onConflict: 'conversation_id,user_phone' });

      if (mErr) console.error('members upsert error:', mErr);

      const { data: conv } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', convId)
        .single();

      return {
        id: convId,
        title: titleForMe,
        peerPhone: other,
        lastMessage: (conv && conv.last_message) || '',
        lastMessageAt: conv && conv.last_message_at
          ? new Date(conv.last_message_at).getTime()
          : Date.now()
      };
    }

    // local fallback
    const all = lsGet('conversations', {});
    if (all[convId]) return all[convId];
    const conv = {
      id: convId,
      type: 'private',
      title: otherName || otherPhone,
      members: [myId, otherPhone],
      lastMessageAt: Date.now(),
      lastMessage: '',
      unread: 0
    };
    all[convId] = conv;
    lsSet('conversations', all);
    return conv;
  }

  // ---------- Messages ----------
  async function getMessages(conversationId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) {
        console.error('getMessages error:', error);
        return [];
      }
      return data || [];
    }

    const all = lsGet('messages', {});
    return all[conversationId] || [];
  }

  async function sendMessage({ conversationId, senderId, content, type = 'text', media_url, media_mime, media_size, media_duration }) {
    const payload = {
      conversation_id: conversationId,
      sender_id: senderId,
      content: content || '',
      type: type,
      status: 'sent',
      media_url: media_url || null,
      media_mime: media_mime || null,
      media_size: media_size || null,
      media_duration: media_duration || null,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('messages')
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error('sendMessage error:', error);
        throw new Error(error.message || 'Failed to send');
      }

      // Update conversation preview
      await supabase
        .from('conversations')
        .update({
          last_message: content || (payload.type === 'image' ? 'Photo' : 'Message'),
          last_message_at: new Date().toISOString()
        })
        .eq('id', conversationId);

      // Increment unread for everyone except sender (so it shows on recipient list)
      try {
        const { data: members } = await supabase
          .from('conversation_members')
          .select('user_phone, unread_count')
          .eq('conversation_id', conversationId);
        for (const m of (members || [])) {
          if (m.user_phone === senderId) continue;
          await supabase.from('conversation_members')
            .update({ unread_count: (m.unread_count || 0) + 1 })
            .eq('conversation_id', conversationId)
            .eq('user_phone', m.user_phone);
        }
      } catch (e) {
        console.warn('unread bump failed', e);
      }

      console.log('%c[MAtSapp] Message saved to Supabase', 'color:#25D366', data);
      return data;
    }

    // local
    payload.id = 'm_' + Date.now();
    const all = lsGet('messages', {});
    if (!all[conversationId]) all[conversationId] = [];
    all[conversationId].push(payload);
    lsSet('messages', all);

    const convs = lsGet('conversations', {});
    if (convs[conversationId]) {
      convs[conversationId].lastMessage = content;
      convs[conversationId].lastMessageAt = Date.now();
      lsSet('conversations', convs);
    }
    return payload;
  }

  // Realtime – listen for new messages in a conversation
  function subscribeMessages(conversationId, callback) {
    if (!supabase) {
      console.warn('No supabase – realtime disabled');
      return { unsubscribe: () => {} };
    }

    const channelName = 'chat:' + conversationId;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => {
          console.log('%c[MAtSapp] Realtime message received', 'color:#25D366', payload.new);
          callback(payload.new);
        }
      )
      .subscribe((status) => {
        console.log('[MAtSapp] Realtime status:', status);
      });

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      }
    };
  }

  // Also allow listening for any new conversations for a user (for chat list updates)
  function subscribeConversations(userPhone, callback) {
    if (!supabase) return { unsubscribe: () => {} };

    const channel = supabase
      .channel('user-convs:' + userPhone)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations'
        },
        () => callback()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        () => callback()
      )
      .subscribe();

    return {
      unsubscribe: () => supabase.removeChannel(channel)
    };
  }


  async function searchMessages(query, limit = 40) {
    const q = (query || '').trim();
    if (!q || q.length < 1) return [];
    if (supabase) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, type, created_at')
        .ilike('content', '%' + q + '%')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        console.warn('searchMessages', error);
        return [];
      }
      return data || [];
    }
    // local fallback
    const all = lsGet('messages', {});
    const out = [];
    const low = q.toLowerCase();
    Object.keys(all).forEach(cid => {
      (all[cid] || []).forEach(m => {
        if ((m.content || '').toLowerCase().includes(low)) {
          out.push({ ...m, conversation_id: cid });
        }
      });
    });
    return out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }

  // ---------- App config ----------
  async function getAppConfig() {
    if (supabase) {
      const { data } = await supabase.from('app_config').select('*').eq('id', 1).maybeSingle();
      return data || {};
    }
    return lsGet('appConfig', {
      app_name: CONFIG.APP_NAME,
      tagline: CONFIG.TAGLINE,
      welcome_message: '',
      maintenance: false
    });
  }

  async function saveAppConfig(config) {
    if (supabase) {
      await supabase.from('app_config').upsert({ id: 1, ...config, updated_at: new Date().toISOString() });
      return;
    }
    lsSet('appConfig', config);
  }

  async function getStatuses() { return lsGet('statuses', []); }
  async function addStatus(userId, text) {
    const status = { id: 's_' + Date.now(), user_id: userId, text, created_at: Date.now() };
    const list = lsGet('statuses', []);
    list.unshift(status);
    lsSet('statuses', list);
    return status;
  }


  // ---------- Phase 2: presence, typing, receipts ----------
  async function setPresence(phone, online) {
    if (!supabase || !phone) return;
    await supabase.from('presence').upsert({
      user_phone: phone,
      is_online: !!online,
      last_seen: new Date().toISOString()
    });
  }

  async function getPresence(phone) {
    if (!supabase || !phone) return { is_online: false, last_seen: null };
    const { data } = await supabase.from('presence').select('*').eq('user_phone', phone).maybeSingle();
    return data || { is_online: false, last_seen: null };
  }

  async function setTyping(conversationId, phone, isTyping) {
    if (!supabase || !conversationId || !phone) return;
    if (isTyping) {
      await supabase.from('typing').upsert({
        conversation_id: conversationId,
        user_phone: phone,
        updated_at: new Date().toISOString()
      });
    } else {
      await supabase.from('typing').delete()
        .eq('conversation_id', conversationId)
        .eq('user_phone', phone);
    }
  }

  function subscribeTyping(conversationId, myPhone, callback) {
    if (!supabase) return { unsubscribe: () => {} };
    const channel = supabase
      .channel('typing:' + conversationId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'typing', filter: 'conversation_id=eq.' + conversationId }, async () => {
        const { data } = await supabase.from('typing').select('user_phone, updated_at')
          .eq('conversation_id', conversationId)
          .neq('user_phone', myPhone);
        const active = (data || []).filter(r => Date.now() - new Date(r.updated_at).getTime() < 6000);
        callback(active.map(r => r.user_phone));
      })
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  }

  async function markMessagesDelivered(conversationId, readerPhone) {
    if (!supabase) return;
    // Mark others' messages as delivered
    await supabase.from('messages')
      .update({ status: 'delivered' })
      .eq('conversation_id', conversationId)
      .neq('sender_id', readerPhone)
      .eq('status', 'sent');
  }

  async function markMessagesRead(conversationId, readerPhone) {
    if (!supabase) return;
    await supabase.from('messages')
      .update({ status: 'read' })
      .eq('conversation_id', conversationId)
      .neq('sender_id', readerPhone)
      .in('status', ['sent', 'delivered']);
  }

  function subscribeMessageStatus(conversationId, callback) {
    if (!supabase) return { unsubscribe: () => {} };
    const channel = supabase
      .channel('msgstatus:' + conversationId)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: 'conversation_id=eq.' + conversationId
      }, payload => callback(payload.new))
      .subscribe();
    return { unsubscribe: () => supabase.removeChannel(channel) };
  }

  return {
    init,
    getCurrentUser,
    saveUser,
    findUserByPhone,
    getConversations,
    getOrCreatePrivateConversation,
    getMessages,
    sendMessage,
    subscribeMessages,
    subscribeConversations,
    getAppConfig,
    saveAppConfig,
    getStatuses,
    addStatus,
    setPresence,
    getPresence,
    setTyping,
    subscribeTyping,
    markMessagesDelivered,
    markMessagesRead,
    subscribeMessageStatus,
    searchMessages,
    get supabase() { return supabase; },
    searchMessages,
    get isDemo() { return CONFIG.DEMO_MODE; }
  };
})();
