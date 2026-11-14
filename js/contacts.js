/**
 * MAtSapp Contacts Sync
 * - Contact Picker API (Chrome Android)
 * - Manual add
 * - Sync to Supabase + localStorage
 */
const Contacts = (() => {
  const LS_KEY = 'matsapp_contacts';

  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveLocal(list) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  }

  function normalizePhone(phone) {
    if (typeof Phone !== 'undefined') return Phone.normalize(phone);
    if (!phone) return '';
    let p = String(phone).replace(/[^\d+]/g, '');
    if (p.startsWith('0') && p.length >= 9) p = '+256' + p.slice(1);
    if (!p.startsWith('+') && p.length >= 9) p = '+' + p;
    return p;
  }

  function mergeContacts(existing, incoming) {
    const map = new Map();
    existing.forEach(c => map.set(c.phone, c));
    incoming.forEach(c => {
      if (!c.phone) return;
      const prev = map.get(c.phone);
      map.set(c.phone, {
        phone: c.phone,
        name: c.name || (prev && prev.name) || c.phone,
        syncedAt: Date.now()
      });
    });
    return Array.from(map.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    );
  }

  async function getAll(ownerPhone) {
    let list = loadLocal();

    if (DB.supabase && ownerPhone) {
      try {
        const { data, error } = await DB.supabase
          .from('user_contacts')
          .select('contact_phone, contact_name')
          .eq('owner_phone', ownerPhone);
        if (!error && data) {
          const remote = data.map(r => ({
            phone: r.contact_phone,
            name: r.contact_name || r.contact_phone
          }));
          list = mergeContacts(list, remote);
          saveLocal(list);
        }
      } catch (e) {
        console.warn('contacts remote fetch', e);
      }
    }
    return list;
  }

  async function saveMany(ownerPhone, contacts) {
    const cleaned = contacts
      .map(c => ({
        phone: normalizePhone(c.phone),
        name: (c.name || '').trim() || normalizePhone(c.phone)
      }))
      .filter(c => c.phone.length >= 10);

    const merged = mergeContacts(loadLocal(), cleaned);
    saveLocal(merged);

    if (DB.supabase && ownerPhone && cleaned.length) {
      const rows = cleaned.map(c => ({
        owner_phone: ownerPhone,
        contact_phone: c.phone,
        contact_name: c.name
      }));
      // upsert in chunks
      const chunk = 50;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const { error } = await DB.supabase
          .from('user_contacts')
          .upsert(slice, { onConflict: 'owner_phone,contact_phone' });
        if (error) console.warn('contacts upsert', error.message);
      }
    }
    return merged;
  }

  async function addOne(ownerPhone, phone, name) {
    return saveMany(ownerPhone, [{ phone, name }]);
  }

  /** Native contact picker (Chrome Android / supported browsers) */
  async function pickFromDevice() {
    if (!('contacts' in navigator && 'ContactsManager' in window)) {
      throw new Error('Contact picker not supported on this browser. Use Add contact or Chrome on Android.');
    }
    const props = ['name', 'tel'];
    const opts = { multiple: true };
    const selected = await navigator.contacts.select(props, opts);
    const out = [];
    for (const c of selected) {
      const name = (c.name && c.name[0]) || '';
      const tels = c.tel || [];
      for (const t of tels) {
        const phone = normalizePhone(t);
        if (phone) out.push({ phone, name: name || phone });
      }
    }
    return out;
  }

  async function syncFromDevice(ownerPhone) {
    const picked = await pickFromDevice();
    if (!picked.length) return loadLocal();
    return saveMany(ownerPhone, picked);
  }

  return {
    getAll,
    saveMany,
    addOne,
    pickFromDevice,
    syncFromDevice,
    normalizePhone,
    loadLocal
  };
})();
