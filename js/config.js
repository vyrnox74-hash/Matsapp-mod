/**
 * MAtSapp Configuration
 * MAT KAI STUDIOS · Mataaxion
 */
const CONFIG = {
  APP_VERSION: '1.9.0',
  PHASE: 9,

  SUPABASE_URL: 'https://ulpuafxqtzmobapseytd.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVscHVhZnhxdHptb2JhcHNleXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM4OTU1NDIsImV4cCI6MjEwOTQ3MTU0Mn0.vHt03w3YRBbTzRLeBg89goSv-iVfrXzXIfbRxrIOsHw',

  APP_NAME: 'MAtSapp',
  TAGLINE: 'Connect Beyond Limits',
  WATERMARK: 'by Mataaxion',

  /**
   * AUTH_MODE:
   *  - 'simple'   : local OTP (any 4+ digits) – works without SMS provider
   *  - 'supabase' : real Supabase Phone OTP + JWT (requires SMS provider in Dashboard)
   */
  AUTH_MODE: 'simple',

  /** Private storage: use signed URLs instead of public bucket URLs */
  PRIVATE_MEDIA: true,
  SIGNED_URL_EXPIRES: 3600, // seconds

  /**
   * WebRTC ICE – add TURN for mobile networks that fail with STUN-only.
   * Get free/paid credentials from https://www.metered.ca/tools/openrelay/
   * or Twilio Network Traversal / self-hosted coturn.
   */
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
    // Example TURN (uncomment and fill):
    // {
    //   urls: 'turn:openrelay.metered.ca:80',
    //   username: 'openrelayproject',
    //   credential: 'openrelayproject'
    // },
    // {
    //   urls: 'turn:openrelay.metered.ca:443',
    //   username: 'openrelayproject',
    //   credential: 'openrelayproject'
    // }
  ],

  /**
   * Web Push (VAPID public key). Generate with:
   *   npx web-push generate-vapid-keys
   * Put private key only in Edge Function secret VAPID_PRIVATE_KEY.
   */
  VAPID_PUBLIC_KEY: '',

  FEATURES: {
    status: true,
    communities: true,
    calls: true,
    mataaxAI: true,
    adminPanel: true,
    push: true
  },

  DEMO_MODE: false
};

console.info(
  '%cMAtSapp v' + CONFIG.APP_VERSION + ' · auth=' + CONFIG.AUTH_MODE + ' · privateMedia=' + CONFIG.PRIVATE_MEDIA,
  'color:#25D366; font-weight:bold'
);
