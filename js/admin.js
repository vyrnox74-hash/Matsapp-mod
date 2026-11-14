/**
 * MAtSapp Phase 7 – Admin dashboard data layer
 */
const Admin = (() => {
  function isAdminUser(user) {
    if (!user) return false;
    if (user.is_admin) return true;
    const phone = user.phone || user.id || '';
    return phone.endsWith('0000') || phone.endsWith('00000');
  }

  async function getStats() {
    const stats = {
      users: 0,
      messages: 0,
      conversations: 0,
      groups: 0,
      statuses: 0,
      reportsOpen: 0
    };
    if (!DB.supabase) return stats;
    try {
      const sb = DB.supabase;
      const [u, m, c, g, s, r] = await Promise.all([
        sb.from('profiles').select('*', { count: 'exact', head: true }),
        sb.from('messages').select('*', { count: 'exact', head: true }),
        sb.from('conversations').select('*', { count: 'exact', head: true }),
        sb.from('conversations').select('*', { count: 'exact', head: true }).eq('type', 'group'),
        sb.from('statuses').select('*', { count: 'exact', head: true }),
        sb.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open')
      ]);
      stats.users = u.count || 0;
      stats.messages = m.count || 0;
      stats.conversations = c.count || 0;
      stats.groups = g.count || 0;
      stats.statuses = s.count || 0;
      stats.reportsOpen = r.count || 0;
    } catch (e) {
      console.warn('admin stats', e);
    }
    return stats;
  }

  async function listUsers(search, limit = 50) {
    if (!DB.supabase) return [];
    let q = DB.supabase.from('profiles').select('*').order('updated_at', { ascending: false }).limit(limit);
    if (search && search.trim()) {
      const s = search.trim();
      q = q.or('phone.ilike.%' + s + '%,display_name.ilike.%' + s + '%');
    }
    const { data, error } = await q;
    if (error) {
      console.warn(error);
      return [];
    }
    return data || [];
  }

  async function setSuspended(phone, suspended) {
    if (!DB.supabase) throw new Error('No database');
    const { error } = await DB.supabase.from('profiles')
      .update({ is_suspended: !!suspended, updated_at: new Date().toISOString() })
      .eq('phone', phone);
    if (error) throw error;
  }

  async function setAdminFlag(phone, isAdmin) {
    if (!DB.supabase) throw new Error('No database');
    const { error } = await DB.supabase.from('profiles')
      .update({ is_admin: !!isAdmin, updated_at: new Date().toISOString() })
      .eq('phone', phone);
    if (error) throw error;
  }

  async function listReports(limit = 30) {
    if (!DB.supabase) return [];
    const { data } = await DB.supabase.from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }

  async function updateReportStatus(id, status) {
    if (!DB.supabase) return;
    await DB.supabase.from('reports').update({ status }).eq('id', id);
  }

  async function postAnnouncement(title, body, createdBy) {
    if (!DB.supabase) throw new Error('No database');
    const { data, error } = await DB.supabase.from('admin_announcements')
      .insert({ title, body, created_by: createdBy, active: true })
      .select()
      .single();
    if (error) throw error;
    // also store on app_config for simple clients
    await DB.supabase.from('app_config').upsert({
      id: 1,
      welcome_message: body,
      updated_at: new Date().toISOString()
    });
    return data;
  }

  async function getConfig() {
    return DB.getAppConfig();
  }

  async function saveConfig(cfg) {
    return DB.saveAppConfig(cfg);
  }

  async function setMaintenance(on) {
    const cfg = await getConfig();
    cfg.maintenance = !!on;
    await saveConfig(cfg);
    return cfg;
  }

  return {
    isAdminUser,
    getStats,
    listUsers,
    setSuspended,
    setAdminFlag,
    listReports,
    updateReportStatus,
    postAnnouncement,
    getConfig,
    saveConfig,
    setMaintenance
  };
})();
