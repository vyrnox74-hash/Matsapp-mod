/**
 * Phone / country-code helpers – E.164 style normalization
 */
const Phone = (() => {
  // dial code → country meta (common set; extend as needed)
  const COUNTRIES = [
    { code: '+256', iso: 'UG', name: 'Uganda', flag: '🇺🇬', localLen: 9 },
    { code: '+254', iso: 'KE', name: 'Kenya', flag: '🇰🇪', localLen: 9 },
    { code: '+255', iso: 'TZ', name: 'Tanzania', flag: '🇹🇿', localLen: 9 },
    { code: '+250', iso: 'RW', name: 'Rwanda', flag: '🇷🇼', localLen: 9 },
    { code: '+257', iso: 'BI', name: 'Burundi', flag: '🇧🇮', localLen: 8 },
    { code: '+211', iso: 'SS', name: 'South Sudan', flag: '🇸🇸', localLen: 9 },
    { code: '+251', iso: 'ET', name: 'Ethiopia', flag: '🇪🇹', localLen: 9 },
    { code: '+234', iso: 'NG', name: 'Nigeria', flag: '🇳🇬', localLen: 10 },
    { code: '+27', iso: 'ZA', name: 'South Africa', flag: '🇿🇦', localLen: 9 },
    { code: '+233', iso: 'GH', name: 'Ghana', flag: '🇬🇭', localLen: 9 },
    { code: '+1', iso: 'US', name: 'United States', flag: '🇺🇸', localLen: 10 },
    { code: '+44', iso: 'GB', name: 'United Kingdom', flag: '🇬🇧', localLen: 10 },
    { code: '+91', iso: 'IN', name: 'India', flag: '🇮🇳', localLen: 10 },
    { code: '+971', iso: 'AE', name: 'UAE', flag: '🇦🇪', localLen: 9 },
    { code: '+86', iso: 'CN', name: 'China', flag: '🇨🇳', localLen: 11 },
    { code: '+49', iso: 'DE', name: 'Germany', flag: '🇩🇪', localLen: 10 },
    { code: '+33', iso: 'FR', name: 'France', flag: '🇫🇷', localLen: 9 },
    { code: '+61', iso: 'AU', name: 'Australia', flag: '🇦🇺', localLen: 9 },
    { code: '+55', iso: 'BR', name: 'Brazil', flag: '🇧🇷', localLen: 11 },
    { code: '+20', iso: 'EG', name: 'Egypt', flag: '🇪🇬', localLen: 10 }
  ];

  const DEFAULT_CODE = '+256';

  function digitsOnly(s) {
    return String(s || '').replace(/\D/g, '');
  }

  function getDefaultCode() {
    try {
      return localStorage.getItem('matsapp_default_cc') || DEFAULT_CODE;
    } catch {
      return DEFAULT_CODE;
    }
  }

  function setDefaultCode(code) {
    localStorage.setItem('matsapp_default_cc', code);
  }

  /**
   * Normalize any input to E.164-like: +<country><national>
   * Handles: 07..., 7..., 2567..., +2567..., 00256...
   */
  function normalize(input, fallbackCode) {
    if (!input) return '';
    let raw = String(input).trim();
    // already has +
    if (raw.startsWith('+')) {
      const d = digitsOnly(raw);
      return d ? '+' + d : '';
    }
    // 00 international prefix
    if (raw.startsWith('00')) {
      const d = digitsOnly(raw.slice(2));
      return d ? '+' + d : '';
    }
    let d = digitsOnly(raw);
    if (!d) return '';

    // starts with known country digits without +
    const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
    for (const c of sorted) {
      const cc = c.code.slice(1); // without +
      if (d.startsWith(cc) && d.length >= cc.length + c.localLen - 1) {
        return '+' + d;
      }
    }

    // local leading 0 → drop 0 and prepend default country
    const cc = fallbackCode || getDefaultCode();
    if (d.startsWith('0')) d = d.slice(1);
    return cc + d;
  }

  function isValid(e164) {
    const n = normalize(e164);
    return /^\+[1-9]\d{7,14}$/.test(n);
  }

  function formatDisplay(e164) {
    const n = normalize(e164);
    if (!n) return e164 || '';
    // simple spacing: +256 7XX XXX XXX for UG-like
    if (n.startsWith('+256') && n.length === 13) {
      return '+256 ' + n.slice(4, 7) + ' ' + n.slice(7, 10) + ' ' + n.slice(10);
    }
    return n;
  }

  function detectCountry(e164) {
    const n = normalize(e164);
    const sorted = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length);
    for (const c of sorted) {
      if (n.startsWith(c.code)) return c;
    }
    return null;
  }

  function listCountries() {
    return COUNTRIES.slice();
  }

  return {
    COUNTRIES,
    normalize,
    isValid,
    formatDisplay,
    detectCountry,
    listCountries,
    getDefaultCode,
    setDefaultCode
  };
})();
