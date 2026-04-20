/**
 * LynkWell AI web app bridge — parse dp_config / dp_sent_log from Command Center localStorage.
 * Loaded in service worker (importScripts) and in the side panel (before storage-manager.js).
 *
 * COMMAND_CENTER_ORIGIN + DAILY_LINKEDIN_LIMIT must stay aligned with the Next.js Command Center
 * (manifest host_permissions + content_scripts matches for the same origin).
 */
(function initDpBridge(global) {
  const COMMAND_CENTER_ORIGIN = 'https://outreach-tool-nine-omega.vercel.app';

  const DAILY_LINKEDIN_LIMIT = Object.freeze({
    MAX: 30,
    RECOMMENDED: 20,
    /** Inclusive upper bound for the “Safe” band (1 … SAFE_MAX). */
    SAFE_MAX: 10,
    /** Inclusive upper bound for the “Moderate” band (SAFE_MAX+1 … MODERATE_MAX). */
    MODERATE_MAX: 20
  });

  function clampDailyLinkedinLimit(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return DAILY_LINKEDIN_LIMIT.RECOMMENDED;
    return Math.min(DAILY_LINKEDIN_LIMIT.MAX, Math.max(1, v));
  }

  function dailyLinkedinRiskLabel(n) {
    const v = clampDailyLinkedinLimit(n);
    if (v <= DAILY_LINKEDIN_LIMIT.SAFE_MAX) return 'Safe';
    if (v <= DAILY_LINKEDIN_LIMIT.MODERATE_MAX) return 'Moderate';
    return 'High risk';
  }
  function readDpConfigFromRaw(raw) {
    try {
      const s = String(raw || '').trim();
      if (!s) return null;
      const o = JSON.parse(s);
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  function readSentLogFromRaw(raw) {
    try {
      const s = String(raw || '').trim();
      if (!s) return [];
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function effectiveContext(cfg) {
    if (!cfg || typeof cfg !== 'object') return '';
    const a = cfg.global_context;
    const b = cfg.context;
    const pick =
      typeof a === 'string' && a.trim()
        ? a
        : typeof b === 'string' && b.trim()
          ? b
          : '';
    return pick.trim();
  }

  function normalizeLinkedInUrl(u) {
    if (!u || typeof u !== 'string') return '';
    try {
      const x = new URL(u);
      x.hash = '';
      x.search = '';
      let p = x.pathname.replace(/\/+$/, '') || '';
      return `${x.origin}${p}`.toLowerCase();
    } catch {
      return String(u)
        .split('?')[0]
        .replace(/\/$/, '')
        .toLowerCase();
    }
  }

  function decodeJwtSub(token) {
    try {
      const t = String(token || '').trim();
      if (!t) return null;
      const parts = t.split('.');
      if (parts.length < 2) return null;
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const json = atob(b64);
      const payload = JSON.parse(json);
      const sub = payload && (payload.sub || payload.user_id || payload.id);
      return sub != null ? String(sub) : null;
    } catch {
      return null;
    }
  }

  function findSentForProfile(sentLog, profileUrl) {
    const current = normalizeLinkedInUrl(profileUrl);
    if (!current || !/\/in\//i.test(current)) return null;
    const arr = Array.isArray(sentLog) ? sentLog : [];
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e || typeof e !== 'object') continue;
      const lu = e.linkedin_url;
      if (typeof lu !== 'string' || !lu.trim()) continue;
      if (normalizeLinkedInUrl(lu) === current) return e;
    }
    return null;
  }

  const api = {
    COMMAND_CENTER_ORIGIN,
    DAILY_LINKEDIN_LIMIT,
    clampDailyLinkedinLimit,
    dailyLinkedinRiskLabel,
    readDpConfigFromRaw,
    readSentLogFromRaw,
    effectiveContext,
    normalizeLinkedInUrl,
    decodeJwtSub,
    findSentForProfile
  };

  if (typeof global !== 'undefined') global.DpBridge = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
