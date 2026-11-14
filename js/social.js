/**
 * MAtSapp Phase 4 – Groups, Status, Communities
 */
const Social = (() => {
  // ---------- STATUS ----------
  async function addStatus({ userPhone, type, content, mediaUrl }) {
    const row = {
      user_phone: userPhone,
      type: type || 'text',
      content: content || '',
      media_url: mediaUrl || null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
    if (DB.supabase) {
      const { data, error } = await DB.supabase.from('statuses').insert(row).select().single();
      if (error) throw error;
      return data;
    }
    const list = JSON.parse(localStorage.getItem('matsapp_statuses') || '[]');
    row.id = 's_' + Date.now();
    list.unshift(row);
    localStorage.setItem('matsapp_statuses', JSON.stringify(list));
    return row;
  }

  async function listStatuses(myPhone) {
    const now = new Date().toISOString();
    if (DB.supabase) {
      // Own + contacts' statuses that are not expired
      const { data, error } = await DB.supabase
        .from('statuses')
        .select('*')
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) {
        console.warn(error);
        return [];
      }
      return data || [];
    }
    const list = JSON.parse(localStorage.getItem('matsapp_statuses') || '[]');
    return list.filter(s => s.expires_at > now);
  }

  async function markStatusViewed(statusId, viewerPhone) {
    if (!DB.supabase || !statusId) return;
    await DB.supabase.from('status_views').upsert({
      status_id: statusId,
      viewer_phone: viewerPhone,
      viewed_at: new Date().toISOString()
    });
  }

  // ---------- GROUPS ----------
  async function createGroup({ creatorPhone, title, memberPhones }) {
    const id = 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const members = Array.from(new Set([creatorPhone, ...(memberPhones || [])]));

    if (DB.supabase) {
      const { error: cErr } = await DB.supabase.from('conversations').insert({
        id,
        type: 'group',
        title: title || 'New group',
        created_by: creatorPhone,
        last_message: '',
        last_message_at: new Date().toISOString()
      });
      if (cErr) throw cErr;

      const rows = members.map(p => ({
        conversation_id: id,
        user_phone: p,
        // creator as admin-like via role if column exists – store in pinned false
      }));
      const { error: mErr } = await DB.supabase.from('conversation_members').upsert(rows);
      if (mErr) throw mErr;

      // system message
      await DB.supabase.from('messages').insert({
        conversation_id: id,
        sender_id: creatorPhone,
        content: 'Group "' + (title || 'New group') + '" created',
        type: 'system',
        status: 'sent'
      });

      return { id, title: title || 'New group', type: 'group' };
    }

    // local fallback
    const all = JSON.parse(localStorage.getItem('matsapp_conversations') || '{}');
    all[id] = {
      id,
      type: 'group',
      title: title || 'New group',
      members,
      lastMessageAt: Date.now(),
      lastMessage: 'Group created',
      unread: 0
    };
    localStorage.setItem('matsapp_conversations', JSON.stringify(all));
    return all[id];
  }

  // ---------- COMMUNITIES ----------
  async function createCommunity({ creatorPhone, name, description }) {
    if (DB.supabase) {
      const { data, error } = await DB.supabase.from('communities').insert({
        name,
        description: description || '',
        created_by: creatorPhone
      }).select().single();
      if (error) throw error;
      await DB.supabase.from('community_members').insert({
        community_id: data.id,
        user_phone: creatorPhone,
        role: 'owner'
      });
      return data;
    }
    const list = JSON.parse(localStorage.getItem('matsapp_communities') || '[]');
    const row = {
      id: 'c_' + Date.now(),
      name,
      description: description || '',
      created_by: creatorPhone
    };
    list.unshift(row);
    localStorage.setItem('matsapp_communities', JSON.stringify(list));
    return row;
  }

  async function listCommunities(userPhone) {
    if (DB.supabase) {
      const { data } = await DB.supabase
        .from('community_members')
        .select('community_id, communities(id, name, description, avatar_url, created_by)')
        .eq('user_phone', userPhone);
      return (data || []).map(r => r.communities).filter(Boolean);
    }
    return JSON.parse(localStorage.getItem('matsapp_communities') || '[]');
  }

  return {
    addStatus,
    listStatuses,
    markStatusViewed,
    createGroup,
    createCommunity,
    listCommunities
  };
})();
