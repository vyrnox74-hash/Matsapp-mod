/**
 * MAtSapp Web Push / FCM-ready subscriptions
 * Uses Web Push API + VAPID. Store subscription in Supabase.
 * Server send: Edge Function `push-notify` with VAPID_PRIVATE_KEY.
 */
const Push = (() => {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function permissionState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  async function subscribe(userPhone) {
    if (!(await isSupported())) throw new Error('Push not supported on this browser');
    if (!CONFIG.VAPID_PUBLIC_KEY) {
      throw new Error('Set CONFIG.VAPID_PUBLIC_KEY (see PRODUCTION_PUSH_TURN_AUTH.md)');
    }

    let perm = Notification.permission;
    if (perm !== 'granted') {
      perm = await Notification.requestPermission();
    }
    if (perm !== 'granted') throw new Error('Notification permission denied');

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY)
      });
    }

    const json = sub.toJSON();
    if (DB.supabase && userPhone) {
      await DB.supabase.from('push_subscriptions').upsert(
        {
          user_phone: userPhone,
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh || '',
          auth: json.keys?.auth || '',
          user_agent: navigator.userAgent
        },
        { onConflict: 'user_phone,endpoint' }
      );
    }
    localStorage.setItem('matsapp_push', JSON.stringify({ endpoint: json.endpoint, at: Date.now() }));
    return sub;
  }

  async function unsubscribe(userPhone) {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      if (DB.supabase && userPhone) {
        await DB.supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
    }
    localStorage.removeItem('matsapp_push');
  }

  return { isSupported, permissionState, subscribe, unsubscribe };
})();
