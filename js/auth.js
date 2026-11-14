/**
 * MAtSapp Auth
 * AUTH_MODE=simple   → local code (no SMS)
 * AUTH_MODE=supabase → real Phone OTP + JWT session
 */
const Auth = (() => {
  let pendingPhone = null;

  async function assertNotSuspended(phone) {
    if (!DB.supabase || !phone) return;
    const { data } = await DB.supabase
      .from('profiles')
      .select('is_suspended')
      .eq('phone', phone)
      .maybeSingle();
    if (data && data.is_suspended) {
      throw new Error('This account has been suspended. Contact support.');
    }
  }

  function normalizePhone(code, number) {
    if (typeof Phone !== 'undefined') {
      const combined = (number || '').trim().startsWith('+')
        ? number
        : (code || '') + (number || '');
      return Phone.normalize(combined, code);
    }
    const digits = (number || '').replace(/\D/g, '');
    return (code || '') + digits;
  }

  async function requestOtp(countryCode, phoneNumber) {
    const phone = normalizePhone(countryCode, phoneNumber);
    if (phone.length < 10) throw new Error('Please enter a valid phone number');
    pendingPhone = phone;

    if (CONFIG.AUTH_MODE === 'supabase' && DB.supabase) {
      const { error } = await DB.supabase.auth.signInWithOtp({ phone });
      if (error) {
        // Common: SMS provider not configured
        throw new Error(
          error.message ||
            'SMS OTP failed. Enable Phone auth + SMS provider in Supabase, or set AUTH_MODE to "simple".'
        );
      }
      return { phone, demo: false, mode: 'supabase' };
    }

    console.log('%c[MAtSapp] Simple login – no SMS provider', 'color:#25D366');
    return { phone, demo: true, mode: 'simple' };
  }

  async function verifyOtp(otp) {
    if (!pendingPhone) throw new Error('Please enter your phone number first');
    const code = String(otp || '').trim();
    if (code.length < 4) throw new Error('Enter the verification code');

    let user = null;

    if (CONFIG.AUTH_MODE === 'supabase' && DB.supabase) {
      const { data, error } = await DB.supabase.auth.verifyOtp({
        phone: pendingPhone,
        token: code,
        type: 'sms'
      });
      if (error) throw new Error(error.message || 'Invalid or expired code');

      const session = data.session;
      const authUser = data.user;
      if (!session || !authUser) throw new Error('No session returned');

      await assertNotSuspended(pendingPhone);

      // Upsert profile linked to auth user
      const profile = {
        phone: pendingPhone,
        user_id: authUser.id,
        display_name: pendingPhone,
        status_text: 'Hey there! I am using MAtSapp.',
        updated_at: new Date().toISOString()
      };
      // Prefer phone unique key
      await DB.supabase.from('profiles').upsert(profile, { onConflict: 'phone' });

      let existing = await DB.findUserByPhone(pendingPhone);
      user = existing || {
        id: pendingPhone,
        phone: pendingPhone,
        display_name: pendingPhone,
        status_text: 'Hey there! I am using MAtSapp.',
        avatar_url: null,
        user_id: authUser.id,
        is_admin: false
      };
      user.user_id = authUser.id;
      user.id = pendingPhone;
      await DB.saveUser(user);
      return user;
    }

    // ---- simple mode ----
    if (code.length < 4) throw new Error('Enter any 4+ digit code (example: 123456)');

    user = await DB.findUserByPhone(pendingPhone);
    if (!user) {
      user = {
        id: pendingPhone,
        phone: pendingPhone,
        display_name: pendingPhone,
        status_text: 'Hey there! I am using MAtSapp.',
        avatar_url: null,
        is_admin: pendingPhone.endsWith('0000')
      };
    } else {
      user.id = user.phone || pendingPhone;
    }

    await assertNotSuspended(pendingPhone);
    if (user.is_suspended) {
      throw new Error('This account has been suspended. Contact support.');
    }

    await DB.saveUser(user);
    return user;
  }

  async function completeProfile({ displayName, avatarDataUrl }) {
    const user = await DB.getCurrentUser();
    if (!user) throw new Error('Not logged in');
    user.display_name = displayName || user.phone;
    user.id = user.phone;
    if (avatarDataUrl) user.avatar_url = avatarDataUrl;
    await DB.saveUser(user);
    return user;
  }

  async function logout() {
    try {
      if (CONFIG.AUTH_MODE === 'supabase' && DB.supabase) {
        await DB.supabase.auth.signOut();
      }
    } catch (_) {}
    localStorage.removeItem('matsapp_currentUser');
    location.reload();
  }

  async function isLoggedIn() {
    if (CONFIG.AUTH_MODE === 'supabase' && DB.supabase) {
      const { data } = await DB.supabase.auth.getSession();
      if (data && data.session) return true;
    }
    const u = await DB.getCurrentUser();
    return !!u;
  }

  /** Restore JWT session on boot (supabase mode) */
  async function restoreSession() {
    if (CONFIG.AUTH_MODE !== 'supabase' || !DB.supabase) return null;
    const { data } = await DB.supabase.auth.getSession();
    if (!data || !data.session) return null;
    const phone =
      data.session.user.phone ||
      data.session.user.user_metadata?.phone ||
      null;
    if (!phone) return null;
    await assertNotSuspended(phone);
    let user = await DB.findUserByPhone(phone);
    if (!user) {
      user = {
        id: phone,
        phone,
        display_name: phone,
        user_id: data.session.user.id
      };
      await DB.saveUser(user);
    }
    return user;
  }

  return {
    requestOtp,
    verifyOtp,
    completeProfile,
    logout,
    isLoggedIn,
    restoreSession,
    normalizePhone
  };
})();
