// LynkWell AI — LinkedIn content script: read public profile sections for AI context.
// Passive: debounced DOM updates → chrome.storage.session for faster side panel reads.
// Scrapes: identity, about, location, degree, channels, mutuals, open profile,
// multiple experience roles, education, skills, certifications, languages.

(() => {
  if (window.hasRunContentScript) return;
  window.hasRunContentScript = true;

  const SESSION_KEY = 'reachai_profile_v1';
  /** DOM-driven live sync — tight for scroll/lazy sections; throttled elsewhere. */
  const PASSIVE_DEBOUNCE_MS = 70;
  /** Two-pass scrape delays (ms) — keep low for snappy auto-draft; merge still catches lazy DOM. */
  const SCRAPE_PASS1_MS = 35;
  const SCRAPE_PASS2_MS = 200;

  let lastSeenProfileUrl = '';
  /** After SPA /in/ URL change, LinkedIn often keeps the previous member in the DOM briefly — skip passive pushes until then. */
  let suppressProfilePushUntil = 0;
  try {
    lastSeenProfileUrl = normalizeProfileUrl(location.href);
  } catch (_) {
    lastSeenProfileUrl = '';
  }
  setInterval(() => pingProfileUrlForSidePanel(), 200);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PING') {
      sendResponse({ status: 'OK' });
      return true;
    }

    if (message.action === 'FETCH_PROFILE_PHOTO') {
      (async () => {
        const url = String(message.url || '').trim();
        if (!url || !/^https:\/\//i.test(url)) {
          sendResponse({ success: false, error: 'bad url' });
          return;
        }
        try {
          let r = await fetch(url, {
            credentials: 'include',
            mode: 'cors',
            referrerPolicy: 'strict-origin-when-cross-origin',
            cache: 'force-cache'
          });
          if (!r.ok) {
            r = await fetch(url, { credentials: 'omit', mode: 'cors', cache: 'force-cache' });
          }
          if (!r.ok) {
            sendResponse({ success: false, error: `http ${r.status}` });
            return;
          }
          const blob = await r.blob();
          if (!blob || blob.size < 80 || blob.size > 900000) {
            sendResponse({ success: false, error: 'bad blob' });
            return;
          }
          const fr = new FileReader();
          fr.onloadend = () => {
            const du = String(fr.result || '');
            if (du.startsWith('data:image')) sendResponse({ success: true, dataUrl: du });
            else sendResponse({ success: false, error: 'read fail' });
          };
          fr.onerror = () => sendResponse({ success: false, error: 'reader' });
          fr.readAsDataURL(blob);
        } catch (e) {
          sendResponse({ success: false, error: e.message || String(e) });
        }
      })();
      return true;
    }

    if (message.action === 'SCRAPE_PROFILE') {
      (async () => {
        try {
          await new Promise((r) => setTimeout(r, SCRAPE_PASS1_MS));
          let data = scrapeProfile();
          await new Promise((r) => setTimeout(r, SCRAPE_PASS2_MS));
          data = mergeProfileSnapshots(data, scrapeProfile());
          pushSnapshot(data, true);
          sendResponse({ success: true, data });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });

  function pushSnapshot(data, force) {
    if (!/\/in\//.test(location.pathname)) return;
    if (!force && Date.now() < suppressProfilePushUntil) return;
    try {
      chrome.storage.session.set({
        [SESSION_KEY]: {
          url: normalizeProfileUrl(location.href),
          data,
          at: Date.now()
        }
      });
    } catch (_) {
      /* ignore */
    }
    void refreshInstantlyBannerOnPage();
  }

  function normalizeProfileUrlForBridge(href) {
    try {
      const u = new URL(href);
      u.hash = '';
      u.search = '';
      return `${u.origin}${u.pathname}`.replace(/\/$/, '').toLowerCase();
    } catch {
      return String(href || '')
        .split('?')[0]
        .replace(/\/$/, '')
        .toLowerCase();
    }
  }

  function removeInstantlyBanner() {
    const el = document.getElementById('lynkwell-dp-sent-banner');
    if (el) el.remove();
  }

  async function refreshInstantlyBannerOnPage() {
    if (!/\/in\//.test(location.pathname)) {
      removeInstantlyBanner();
      return;
    }
    try {
      const { webBridgeV1 } = await chrome.storage.local.get('webBridgeV1');
      if (!webBridgeV1 || webBridgeV1.mongoOk === false || !Array.isArray(webBridgeV1.sentLog)) {
        removeInstantlyBanner();
        return;
      }
      const cur = normalizeProfileUrlForBridge(location.href);
      const hit = webBridgeV1.sentLog.find(
        (e) => e && typeof e.linkedin_url === 'string' && normalizeProfileUrlForBridge(e.linkedin_url) === cur
      );
      if (!hit) {
        removeInstantlyBanner();
        return;
      }
      let el = document.getElementById('lynkwell-dp-sent-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'lynkwell-dp-sent-banner';
        el.setAttribute('role', 'status');
        el.style.cssText =
          'position:fixed;z-index:99999;top:12px;right:12px;max-width:min(340px,calc(100vw - 24px));padding:10px 14px;border-radius:10px;background:#fff5f5;border:1px solid #fecaca;color:#991b1b;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.12);';
        document.documentElement.appendChild(el);
      }
      const iso = hit.sent_at ? String(hit.sent_at) : '';
      el.textContent = `LynkWell: Already emailed (Command Center)${iso ? ' · ' + iso : ''}`;
      el.title = hit.instantly_campaign_id ? `Campaign: ${String(hit.instantly_campaign_id)}` : '';
    } catch (_) {
      removeInstantlyBanner();
    }
  }

  setInterval(() => void refreshInstantlyBannerOnPage(), 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshInstantlyBannerOnPage();
  });

  function normalizeProfileUrl(href) {
    try {
      const u = new URL(href);
      return `${u.origin}${u.pathname}`.replace(/\/$/, '');
    } catch {
      return href.split('?')[0];
    }
  }

  /**
   * Messaging / compose overlays reuse the same classes as the member profile (h1.text-heading-xlarge).
   * Scope reads to the top card for the URL in the address bar, and skip dialog/overlay subtrees.
   */
  function isInsideMessagingOrDialog(el) {
    if (!el || el.nodeType !== 1) return false;
    return !!el.closest(
      [
        '[role="dialog"]',
        '[aria-modal="true"]',
        '.msg-overlay-list-bulk',
        '.msg-overlay-conversation-bubble',
        '.msg-overlay-bubble-header',
        '.msg-overlay-bubble',
        '.msg-overlay__conversation-bubble',
        '.msg-overlay',
        '.artdeco-modal',
        '[data-test-modal]',
        '.global-create-artdeco-modal-create-flow'
      ].join(',')
    );
  }

  function canonicalMemberProfileUrlLower() {
    const link = document.querySelector('link[rel="canonical"]');
    if (link && link.href && /\/in\//i.test(link.href)) {
      try {
        return normalizeProfileUrl(link.href).toLowerCase();
      } catch (_) {
        /* fall through */
      }
    }
    return normalizeProfileUrl(location.href).toLowerCase();
  }

  function vanitySlugFromProfilePath() {
    try {
      const p = new URL(canonicalMemberProfileUrlLower()).pathname;
      const m = p.match(/\/in\/([^/]+)/i);
      return m ? decodeURIComponent(m[1]).replace(/\/$/, '').toLowerCase() : '';
    } catch (_) {
      return '';
    }
  }

  function profileTopCardHrefMatchesCurrentProfile(aHref) {
    try {
      const nu = normalizeProfileUrl(aHref).toLowerCase();
      const full = canonicalMemberProfileUrlLower();
      if (nu === full) return true;
      const slug = vanitySlugFromProfilePath();
      if (!slug) return false;
      const path = new URL(nu).pathname.replace(/\/$/, '').toLowerCase();
      return path.endsWith(`/in/${slug}`);
    } catch (_) {
      return false;
    }
  }

  function getProfileTopCardRoot() {
    const cards = [...document.querySelectorAll('[data-view-name="profile-top-card"]')].filter(
      (c) => !isInsideMessagingOrDialog(c)
    );
    if (cards.length) {
      const slug = vanitySlugFromProfilePath();
      if (slug) {
        for (const card of cards) {
          for (const a of card.querySelectorAll('a[href*="/in/"]')) {
            if (profileTopCardHrefMatchesCurrentProfile(a.href)) return card;
          }
        }
      }
      return cards[0];
    }
    const main = document.querySelector('main.scaffold-layout__main, main[id="workspace"], main');
    if (main && !isInsideMessagingOrDialog(main) && /\/in\//.test(location.pathname)) return main;
    return null;
  }

  function getProfileContentRoot() {
    const top = getProfileTopCardRoot();
    if (top) {
      const main = top.closest('main');
      if (main) return main;
      const shell = top.closest('.scaffold-layout__list-detail-inner, .scaffold-layout__list-detail');
      if (shell) return shell;
    }
    return (
      document.querySelector('main.scaffold-layout__list-detail-inner') ||
      document.querySelector('main.scaffold-layout__main') ||
      document.querySelector('main[id="workspace"]') ||
      document.querySelector('main') ||
      null
    );
  }

  function firstElementMatchingOutsideOverlays(selector) {
    for (const el of document.querySelectorAll(selector)) {
      if (isInsideMessagingOrDialog(el)) continue;
      const t = clean(el.innerText || '');
      if (t) return el;
    }
    return null;
  }

  function debounce(fn, ms) {
    let t;
    const debounced = function debounced() {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
    debounced.flush = function flush() {
      clearTimeout(t);
      try {
        fn();
      } catch (_) {
        /* ignore */
      }
    };
    return debounced;
  }

  const passiveUpdate = debounce(() => {
    if (!/\/in\//.test(location.pathname)) return;
    try {
      pushSnapshot(scrapeProfile());
    } catch (_) {
      /* ignore */
    }
  }, PASSIVE_DEBOUNCE_MS);

  function pingProfileUrlForSidePanel() {
    if (!/\/in\//.test(location.pathname)) return;
    let u = '';
    try {
      u = normalizeProfileUrl(location.href);
    } catch {
      return;
    }
    if (!u || u === lastSeenProfileUrl) return;
    lastSeenProfileUrl = u;
    suppressProfilePushUntil = Date.now() + 360;
    try {
      chrome.storage.session.set({
        reachai_tab_profile_url: u,
        reachai_tab_profile_changed_at: Date.now(),
        [SESSION_KEY]: {
          url: u,
          data: {
            profileUrl: u,
            name: '',
            headline: '',
            about: '',
            company: '',
            location: '',
            experiences: [],
            education: [],
            skills: []
          },
          at: Date.now(),
          stale: true
        }
      });
    } catch (_) {
      /* ignore */
    }
  }

  function onLinkedInSpaLocationMaybeChanged() {
    pingProfileUrlForSidePanel();
    passiveUpdate.flush();
    setTimeout(() => passiveUpdate.flush(), 140);
    setTimeout(() => passiveUpdate.flush(), 420);
    setTimeout(() => passiveUpdate.flush(), 780);
    setTimeout(() => passiveUpdate.flush(), 1600);
  }

  (function hookLinkedInSpaNavigation() {
    const wrap = (key) => {
      const orig = history[key].bind(history);
      return function patchedHistory() {
        const ret = orig(...arguments);
        onLinkedInSpaLocationMaybeChanged();
        return ret;
      };
    };
    try {
      history.pushState = wrap('pushState');
      history.replaceState = wrap('replaceState');
    } catch (_) {
      /* ignore */
    }
    window.addEventListener('popstate', onLinkedInSpaLocationMaybeChanged);
  })();

  if (document.body) {
    const mo = new MutationObserver(() => passiveUpdate());
    mo.observe(document.body, { childList: true, subtree: true });
  }
  passiveUpdate();

  /** Scroll / wheel = lazy-loaded LinkedIn sections; flush scrape immediately (throttled). */
  let lastScrollFlushAt = 0;
  const SCROLL_FLUSH_MIN_MS = 45;
  function throttledFlushFromScroll() {
    if (!/\/in\//.test(location.pathname)) return;
    const now = Date.now();
    if (now - lastScrollFlushAt < SCROLL_FLUSH_MIN_MS) return;
    lastScrollFlushAt = now;
    passiveUpdate.flush();
  }
  document.addEventListener('scroll', throttledFlushFromScroll, { capture: true, passive: true });
  document.addEventListener('wheel', throttledFlushFromScroll, { capture: true, passive: true });
  if (typeof document.addEventListener === 'function' && 'onscrollend' in window) {
    document.addEventListener('scrollend', () => passiveUpdate.flush(), { capture: true, passive: true });
  }

  function mergeProfileSnapshots(a, b) {
    if (!b || typeof b !== 'object') return a;
    const longer = (x, y) => ((y && String(y).length) || 0) > ((x && String(x).length) || 0) ? y : x;
    const out = { ...a };
    out.profileUrl = b.profileUrl || a.profileUrl || normalizeProfileUrl(location.href);
    out.name = longer(a.name, b.name) || b.name || a.name;
    out.headline = longer(a.headline, b.headline);
    out.about = longer(a.about, b.about);
    out.location = longer(a.location, b.location) || b.location || a.location;
    out.company = longer(a.company, b.company) || b.company || a.company;
    out.profilePhotoUrl = (b.profilePhotoUrl || '').trim() || (a.profilePhotoUrl || '').trim() || '';

    const expKey = (e) => `${(e.title || '').toLowerCase()}|${(e.company || '').toLowerCase()}`;
    const expMap = new Map();
    for (const e of [...(a.experiences || []), ...(b.experiences || [])]) {
      if (!e || (!e.title && !e.company)) continue;
      const k = expKey(e);
      const prev = expMap.get(k);
      if (!prev) expMap.set(k, { ...e });
      else {
        const merged = { ...prev };
        merged.description = longer(prev.description, e.description);
        merged.summary = longer(prev.summary, e.summary);
        merged.dateRange = longer(prev.dateRange, e.dateRange) || e.dateRange;
        merged.location = longer(prev.location, e.location) || e.location;
        expMap.set(k, merged);
      }
    }
    out.experiences = [...expMap.values()].slice(0, 14);

    const top = out.experiences[0] || scrapeTopExperienceFromLegacySection() || emptyExperience();
    out.topExperience = top;
    out.company = top.company || out.company || scrapeLegacyCompanyLine();

    out.industry = longer(a.industry, b.industry) || b.industry || a.industry;
    out.currentPosition = longer(a.currentPosition, b.currentPosition) || b.currentPosition || a.currentPosition;
    out.contactSummary = longer(a.contactSummary, b.contactSummary);
    out.websites = mergeWebsiteLists(a.websites, b.websites, 14);
    out.followers = longer(a.followers, b.followers) || b.followers || a.followers;
    out.connections = longer(a.connections, b.connections) || b.connections || a.connections;
    out.volunteerSummary = longer(a.volunteerSummary, b.volunteerSummary);
    out.honorsSummary = longer(a.honorsSummary, b.honorsSummary);
    out.recommendationsSummary = longer(a.recommendationsSummary, b.recommendationsSummary);
    out.currentPosition = longer(out.currentPosition, top.title || '') || out.currentPosition;

    out.education = mergeEducationLists(a.education, b.education, 10);
    out.skills = mergeUniquePrefLonger(a.skills, b.skills, 45);
    out.certifications = mergeUniquePrefLonger(a.certifications, b.certifications, 10);
    out.languages = mergeUniquePrefLonger(a.languages, b.languages, 12);

    out.degree = b.degree && b.degree !== 'unknown' ? b.degree : a.degree;
    out.mutualConnections = Math.max(
      Number(a.mutualConnections) || 0,
      Number(b.mutualConnections) || 0
    );
    out.isOpenProfile = !!(a.isOpenProfile || b.isOpenProfile);
    out.availableChannels = {
      connect: !!(a.availableChannels?.connect || b.availableChannels?.connect),
      message: !!(a.availableChannels?.message || b.availableChannels?.message),
      inmail: !!(a.availableChannels?.inmail || b.availableChannels?.inmail)
    };
    return out;
  }

  function mergeEducationLists(x, y, max) {
    const ax = Array.isArray(x) ? x : [];
    const by = Array.isArray(y) ? y : [];
    const key = (e) => `${(e.school || '').toLowerCase()}|${(e.degree || '').toLowerCase()}`;
    const map = new Map();
    for (const e of [...ax, ...by]) {
      if (!e || (!e.school && !e.degree)) continue;
      const k = key(e);
      const prev = map.get(k);
      if (!prev || (e.summary || '').length > (prev.summary || '').length) map.set(k, e);
    }
    return [...map.values()].slice(0, max);
  }

  function mergeUniquePrefLonger(a, b, max) {
    const ax = Array.isArray(a) ? a : [];
    const by = Array.isArray(b) ? b : [];
    const map = new Map();
    for (const t of [...ax, ...by]) {
      const s = clean(String(t || ''));
      if (!s || s.length < 2) continue;
      const k = s.toLowerCase();
      const prev = map.get(k);
      if (!prev || s.length > prev.length) map.set(k, s);
    }
    return [...map.values()].slice(0, max);
  }

  function mergeWebsiteLists(a, b, max) {
    const seen = new Set();
    const out = [];
    for (const u of [...(a || []), ...(b || [])]) {
      const s = String(u || '').trim().split('?')[0];
      if (!s || s.length < 6) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }

  function scrapeFollowersConnections() {
    const card = getProfileTopCardRoot() || document.querySelector('main');
    if (!card) return { followers: '', connections: '' };
    const t = card.innerText || '';
    let followers = '';
    const fm = t.match(/([\d,.]+(?:\.\d+)?[KkMm]?\+?)\s+followers/i);
    if (fm) followers = clean(fm[1]);
    let connections = '';
    const cm = t.match(/([\d,.]+(?:\.\d+)?[KkMm]?\+?)\s*connections?/i);
    if (cm) connections = clean(cm[1]);
    return { followers, connections };
  }

  function scrapeIndustry() {
    const root = getProfileContentRoot() || getProfileTopCardRoot() || document.querySelector('main');
    if (root) {
      for (const el of root.querySelectorAll('dt, h3, .text-body-small')) {
        const label = clean(el.innerText || '');
        if (!/^industry$/i.test(label)) continue;
        const sib = el.nextElementSibling;
        if (sib) {
          const v = clean(sib.innerText);
          if (v && v.length < 200) return v;
        }
      }
    }
    const top = getProfileTopCardRoot();
    const hay = (top?.innerText || '') + '\n' + (root?.innerText || '');
    const m = hay.match(/\bindustry\b[:\s·|]+([^\n]+?)(?:\n|$)/i);
    if (m) return clean(m[1]).slice(0, 180);
    return '';
  }

  function scrapeContactInfoBundle() {
    const websites = [];
    const bits = [];
    const section = [...document.querySelectorAll('section.artdeco-card')].find((sec) => {
      if (isInsideMessagingOrDialog(sec)) return false;
      const h2 = sec.querySelector('h2, .pvs-header__title, span.pvs-header__title-text');
      return /contact\s*info/i.test(((h2 && h2.textContent) || '').trim());
    });
    const roots = [
      section,
      document.querySelector('#top-card-text-details-contact-info'),
      document.querySelector('[data-section="contact-info"]'),
      getProfileTopCardRoot()
    ].filter(Boolean);
    for (const root of roots) {
      root.querySelectorAll('a[href^="mailto:"]').forEach((a) => {
        const e = (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0];
        if (e && e.includes('@')) bits.push(`Email: ${e}`);
      });
      root.querySelectorAll('a[href^="tel:"]').forEach((a) => {
        const p = clean(a.innerText || a.getAttribute('href') || '').replace(/^tel:/i, '');
        if (p) bits.push(`Phone: ${p}`);
      });
      root.querySelectorAll('a[href^="http"]').forEach((a) => {
        const h = a.href || '';
        if (!h || /linkedin\.com\/(in\/|feed|messaging|notifications)/i.test(h)) return;
        if (/google\.com\/maps|google\.com\/calendar/i.test(h)) return;
        websites.push(h.split('?')[0]);
      });
    }
    return {
      contactSummary: truncate([...new Set(bits)].join(' · '), 450),
      websites: [...new Set(websites)].slice(0, 14)
    };
  }

  function scrapeSectionSummaryByTitle(re, maxLen) {
    const section = getSectionByTitle(re);
    if (!section) return '';
    const lines = [];
    section.querySelectorAll('span[aria-hidden="true"]').forEach((sp) => {
      const t = clean(sp.innerText);
      if (t.length > 10 && t.length < 260) lines.push(t);
    });
    if (!lines.length) {
      const t = clean(section.innerText || '');
      if (t.length > 20) return truncate(t.replace(/^[^\n]+\n/, '').trim(), maxLen || 400);
    }
    return truncate(lines.slice(0, 6).join(' | '), maxLen || 400);
  }

  function looksLikeProfilePhotoUrl(raw) {
    const u = String(raw || '').trim();
    if (!u || !/^https:\/\//i.test(u)) return false;
    const base = u.split('?')[0];
    if (/data:image|placeholder|spacer|1x1|pixel|blank\.svg|ghost|flagship/i.test(u)) return false;
    return (
      /licdn\.com/i.test(base) ||
      /linkedin\.com\/dms\/image/i.test(base) ||
      /\/dms\/image\//i.test(base) ||
      /profile-displayphoto|displayphoto/i.test(base)
    );
  }

  function pickBestImgUrlFromSrcset(srcset) {
    if (!srcset || typeof srcset !== 'string') return '';
    let best = '';
    let bestW = 0;
    for (const part of srcset.split(',')) {
      const bits = part.trim().split(/\s+/);
      const u = (bits[0] || '').trim();
      if (!u || !/^https?:/i.test(u)) continue;
      const w = parseInt((bits[1] || '').replace('w', ''), 10) || 0;
      if (w >= bestW) {
        bestW = w;
        best = u;
      }
    }
    return best || srcset.split(',')[0].trim().split(/\s+/)[0] || '';
  }

  function scrapeProfilePhotoUrl() {
    const pickFromImg = (img) => {
      if (!img || isInsideMessagingOrDialog(img)) return '';
      let src =
        img.getAttribute('data-delayed-url') ||
        img.getAttribute('data-ghost-url') ||
        img.getAttribute('data-src') ||
        '';
      if (!src) {
        const ss = img.getAttribute('srcset');
        if (ss) src = pickBestImgUrlFromSrcset(ss);
      }
      if (!src) src = img.getAttribute('src') || img.currentSrc || '';
      const raw = String(src).trim();
      if (!raw || !looksLikeProfilePhotoUrl(raw)) return '';
      return raw;
    };

    const bgUrlFromEl = (el) => {
      if (!el || isInsideMessagingOrDialog(el)) return '';
      try {
        const bi = getComputedStyle(el).backgroundImage || '';
        const m = bi.match(/url\(["']?(https:[^"')]+)/i);
        if (m && looksLikeProfilePhotoUrl(m[1])) return m[1].trim();
      } catch (_) {
        /* ignore */
      }
      return '';
    };

    const card = getProfileTopCardRoot();
    const roots = [card, document.querySelector('main')].filter(Boolean);
    for (const root of roots) {
      const preferred = root.querySelectorAll(
        'img[data-test-profile-photo], img.pv-top-card-profile-picture__image, img[class*="profile-photo"], img[class*="PresenceAvatar"], img[class*="presence-entity"]'
      );
      for (const img of preferred) {
        const u = pickFromImg(img);
        if (u) return u;
      }
      for (const sel of [
        '[class*="profile-photo"]',
        '[class*="top-card"] [class*="photo"]',
        '[data-view-name="profile-photo"]',
        'button[aria-label*="photo" i] img',
        'a[href*="/overlay/photo"] img'
      ]) {
        const el = root.querySelector(sel);
        const u = el && el.tagName === 'IMG' ? pickFromImg(el) : bgUrlFromEl(el);
        if (u) return u;
      }
      for (const img of root.querySelectorAll('img')) {
        const u = pickFromImg(img);
        if (u) return u;
      }
    }
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content && looksLikeProfilePhotoUrl(og.content)) return String(og.content).trim();
    return '';
  }

  /** LinkedIn embeds Person JSON-LD and large `application/json` Voyager-style blobs — use when DOM scrape is thin. */
  function vectorImageUrlFromPictureField(pic) {
    if (!pic || typeof pic !== 'object') return '';
    const vi = pic['com.linkedin.common.VectorImage'] || pic.comLinkedinCommonVectorImage;
    if (!vi || !vi.rootUrl || !Array.isArray(vi.artifacts) || !vi.artifacts.length) return '';
    const sorted = [...vi.artifacts].filter((a) => a && a.fileIdentifyingUrlPathSegment);
    sorted.sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
    const art = sorted[0] || vi.artifacts[vi.artifacts.length - 1];
    const seg = art && art.fileIdentifyingUrlPathSegment;
    if (!seg) return '';
    const u = `${vi.rootUrl}${seg}`;
    return looksLikeProfilePhotoUrl(u) ? u : '';
  }

  function deepCollectMiniProfiles(node, out, depth, seen) {
    if (depth > 14 || out.length > 100) return;
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node.miniProfile && typeof node.miniProfile === 'object') out.push(node.miniProfile);
    if (
      typeof node.publicIdentifier === 'string' &&
      (node.firstName || node.lastName || node.occupation || node.headline)
    ) {
      out.push(node);
    }
    if (Array.isArray(node)) {
      const lim = Math.min(node.length, 500);
      for (let i = 0; i < lim; i++) deepCollectMiniProfiles(node[i], out, depth + 1, seen);
      return;
    }
    let n = 0;
    for (const k of Object.keys(node)) {
      if (++n > 300) break;
      deepCollectMiniProfiles(node[k], out, depth + 1, seen);
    }
  }

  function enrichProfileFromEmbeddedBundles(base) {
    const slug = (vanitySlugFromProfilePath() || '').toLowerCase();
    const out = { ...base };
    const longer = (a, b) =>
      ((b && String(b).length) || 0) > ((a && String(a).length) || 0) ? String(b).trim() : String(a || '').trim();
    const fill = (key, val) => {
      const v = val == null ? '' : clean(String(val));
      if (!v) return;
      const cur = out[key];
      const cs = cur == null ? '' : String(cur).trim();
      if (!cs) out[key] = v;
      else if (key === 'headline' || key === 'about') out[key] = longer(cur, v);
    };

    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
      let j;
      try {
        j = JSON.parse(sc.textContent || '');
      } catch {
        continue;
      }
      const items = [];
      if (Array.isArray(j)) items.push(...j);
      else items.push(j);
      if (j && Array.isArray(j['@graph'])) items.push(...j['@graph']);
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const ty = it['@type'];
        const isPerson = ty === 'Person' || (Array.isArray(ty) && ty.includes('Person'));
        if (!isPerson) continue;
        const nameFromParts = [it.givenName, it.additionalName, it.familyName].filter(Boolean).join(' ').trim();
        fill('name', clean(nameFromParts || it.name));
        fill('headline', clean(it.jobTitle || (typeof it.description === 'string' ? it.description : '')));
        if (typeof it.image === 'string' && looksLikeProfilePhotoUrl(it.image)) fill('profilePhotoUrl', it.image.trim());
        else if (it.image && typeof it.image === 'object' && it.image.url)
          fill('profilePhotoUrl', String(it.image.url).trim());
        if (it.worksFor && it.worksFor.name) fill('company', clean(it.worksFor.name));
        if (it.address && typeof it.address === 'object') {
          const ad = it.address;
          const loc = [ad.addressLocality, ad.addressRegion, ad.addressCountry].filter(Boolean).join(', ');
          fill('location', clean(loc || ad.name));
        }
      }
    }

    for (const sc of document.querySelectorAll('script[type="application/json"]')) {
      const raw = sc.textContent || '';
      if (raw.length < 200 || raw.length > 2_500_000) continue;
      if (!/publicIdentifier|miniProfile|"headline"|occupation/i.test(raw.slice(0, 12000))) continue;
      let j;
      try {
        j = JSON.parse(raw);
      } catch {
        continue;
      }
      const cands = [];
      deepCollectMiniProfiles(j, cands, 0, new WeakSet());
      let picks = cands;
      if (slug) {
        const exact = cands.filter((m) => (m.publicIdentifier || '').toLowerCase() === slug);
        if (exact.length) picks = exact;
      }
      for (const mp of picks.slice(0, 12)) {
        const nm = [mp.firstName, mp.lastName].filter(Boolean).join(' ').trim();
        fill('name', clean(nm || mp.name));
        fill('headline', clean(mp.occupation || mp.headline));
        fill('location', clean(mp.geoLocationName || mp.locationName));
        fill('company', clean(mp.companyName || mp.localizedCompanyName));
        const pu = vectorImageUrlFromPictureField(mp.picture);
        if (pu) fill('profilePhotoUrl', pu);
      }
    }

    return out;
  }

  function scrapeProfile() {
    const experiences = scrapeExperiences(14);
    const topExperience =
      experiences[0] || scrapeTopExperienceFromLegacySection() || emptyExperience();
    const fc = scrapeFollowersConnections();
    const contact = scrapeContactInfoBundle();
    const degree = scrapeDegree();
    const isOpenProfile = scrapeOpenProfile();
    let ch = scrapeChannels();
    ch = mergeChannelFlags(ch, inferChannelsFromJsonScripts());
    ch = inferChannelsWhenDomMissed(degree, isOpenProfile, ch);
    const raw = {
      profileUrl: normalizeProfileUrl(location.href),
      profilePhotoUrl: scrapeProfilePhotoUrl(),
      name: scrapeName(),
      headline: scrapeHeadline(),
      about: scrapeAbout(),
      company: topExperience.company || scrapeCompanyFromTopCard() || scrapeLegacyCompanyLine(),
      location: scrapeLocation(),
      industry: scrapeIndustry(),
      currentPosition: clean(topExperience.title || ''),
      contactSummary: contact.contactSummary,
      websites: contact.websites,
      followers: fc.followers,
      connections: fc.connections,
      degree,
      mutualConnections: scrapeMutualConnections(),
      availableChannels: ch,
      isOpenProfile,
      topExperience,
      experiences,
      education: scrapeEducation(10),
      skills: scrapeSkills(45),
      certifications: scrapeCertifications(8),
      languages: scrapeLanguages(12),
      volunteerSummary: scrapeSectionSummaryByTitle(/\bvolunteer(ing)?\b|\bvolunteer experience\b/i, 420),
      honorsSummary: scrapeSectionSummaryByTitle(/\b(honors?|awards?)\b/i, 420),
      recommendationsSummary: scrapeSectionSummaryByTitle(/\brecommendations?\b/i, 360)
    };
    return enrichProfileFromEmbeddedBundles(raw);
  }

  function emptyExperience() {
    return { title: '', company: '', employmentType: '', dateRange: '', location: '', description: '', summary: '' };
  }

  function getSectionByTitle(re) {
    return [...document.querySelectorAll('section.artdeco-card')].find((sec) => {
      if (isInsideMessagingOrDialog(sec)) return false;
      const h2 = sec.querySelector('h2, .pvs-header__title, span.pvs-header__title-text');
      const t = ((h2 && h2.textContent) || '').trim();
      return re.test(t);
    });
  }

  /** Work experience only — skip "Volunteer experience" and similar. */
  function getWorkExperienceSection() {
    for (const sec of document.querySelectorAll('section.artdeco-card')) {
      if (isInsideMessagingOrDialog(sec)) continue;
      const h2 = sec.querySelector('h2, .pvs-header__title, span.pvs-header__title-text');
      const t = ((h2 && h2.textContent) || '').trim();
      if (!t) continue;
      if (/volunteer/i.test(t)) continue;
      if (/\bexperience\b/i.test(t)) return sec;
    }
    return document.querySelector('#experience')?.closest('section') || null;
  }

  function largestDirectList(section) {
    if (!section) return null;
    const uls = [...section.querySelectorAll('ul')];
    let best = null;
    let bestN = 0;
    for (const ul of uls) {
      const lis = [...ul.children].filter((n) => n.tagName === 'LI');
      if (lis.length > bestN) {
        bestN = lis.length;
        best = ul;
      }
    }
    return best;
  }

  function scrapeExperiences(max) {
    const section = getWorkExperienceSection();
    if (!section) return [];
    const ul = largestDirectList(section);
    let lis = [];
    if (ul) lis = [...ul.children].filter((n) => n.tagName === 'LI');
    if (!lis.length) {
      lis = [
        ...section.querySelectorAll(
          'li.artdeco-list__item, li[class*="pvs-list__paged-list-item"], li.pvs-list__item--line-separated'
        )
      ].slice(0, max);
    }
    const seen = new Set();
    const out = [];
    for (const li of lis) {
      const e = parseExperienceItem(li);
      if (!e.title && !e.company) continue;
      const k = `${e.title}|${e.company}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Fallback when list layout differs (single block). */
  function scrapeTopExperienceFromLegacySection() {
    const section = getWorkExperienceSection();
    if (!section) return null;
    const item =
      section.querySelector('li.artdeco-list__item') ||
      section.querySelector('.pvs-list__paged-list-item') ||
      section.querySelector('li[class*="pvs"]');
    if (!item) return null;
    return parseExperienceItem(item);
  }

  function parseExperienceItem(item) {
    const empty = emptyExperience();
    const spans = [...item.querySelectorAll('span[aria-hidden="true"]')]
      .map((s) => clean(s.innerText))
      .filter((t) => t.length > 0);

    const lines = String(item.innerText || '')
      .split(/\n+/)
      .map((l) => clean(l))
      .filter((l) => l.length > 0 && !/^(show more|see more|see less)$/i.test(l));

    const out = { ...empty };
    if (spans.length) {
      out.title = spans[0];
      if (spans.length > 1) {
        const line2 = spans[1];
        if (/·/.test(line2)) {
          const parts = line2.split('·').map((p) => p.trim());
          out.company = parts[0] || line2;
          if (parts[1]) out.employmentType = parts[1];
        } else {
          out.company = line2;
        }
      }
      let idx = 2;
      if (spans[idx] && /\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present/i.test(spans[idx])) {
        out.dateRange = spans[idx];
        idx++;
      }
      if (spans[idx] && (/,/.test(spans[idx]) || /on-?site|remote|hybrid/i.test(spans[idx]))) {
        out.location = spans[idx];
        idx++;
      }
      if (spans[idx]) {
        out.description = spans.slice(idx).join(' ');
      }
    }

    if (!out.title && lines[0]) out.title = lines[0];
    if (!out.company && lines[1] && lines[1] !== out.title) {
      const line2 = lines[1];
      if (/·/.test(line2)) {
        const parts = line2.split('·').map((p) => p.trim());
        out.company = parts[0] || line2;
        if (parts[1]) out.employmentType = parts[1];
      } else {
        out.company = line2;
      }
    }
    if (!out.dateRange) {
      const dr = lines.find((l) => /\d{4}|Present|mo\.|yr\.|mos|yrs/i.test(l) && l.length < 80);
      if (dr) out.dateRange = dr;
    }
    const descFromLines = lines
      .filter((l) => l !== out.title && l !== out.company && l !== out.dateRange && l !== out.location)
      .join(' ');
    if ((!out.description || out.description.length < 40) && descFromLines.length > (out.description || '').length) {
      out.description = truncate(descFromLines, 950);
    }

    out.summary = [out.title, out.company, out.dateRange, out.location, out.description].filter(Boolean).join(' — ');
    out.summary = truncate(out.summary, 720);
    return out;
  }

  function scrapeLegacyCompanyLine() {
    const expRow = document.querySelector('#experience')?.closest('section')?.querySelector('.pvs-entity');
    if (!expRow) return '';
    const spans = expRow.querySelectorAll('span[aria-hidden="true"]');
    for (const span of spans) {
      const text = clean(span.innerText);
      if (text && text.length > 2) return text;
    }
    return '';
  }

  function scrapeOpenProfile() {
    const hay = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 6000) : '';
    if (/\bopen profile\b/i.test(hay)) return true;
    const nodes = document.querySelectorAll(
      '.pv-top-card--list span, .pv-top-card-v2-section__entity-name, .artdeco-entity-lockup__subtitle, .text-body-small, span[class*="dist"], button, a'
    );
    for (const badge of nodes) {
      const t = (badge.innerText || '').toLowerCase();
      if (t.includes('open profile')) return true;
    }
    return false;
  }

  function parseOgTitleParts(raw) {
    let c = (raw || '').trim();
    if (!c) return { name: '', headline: '' };
    const li = c.toLowerCase().lastIndexOf('| linkedin');
    if (li > 0) c = c.slice(0, li).trim();
    const dash = c.indexOf(' - ');
    if (dash > 1 && dash < 100) {
      const name = c.slice(0, dash).trim();
      const headline = c.slice(dash + 3).trim();
      if (name.length >= 2 && name.length <= 90) return { name: clean(name), headline: clean(headline) };
    }
    const pipe = c.indexOf(' | ');
    if (pipe > 1) {
      const first = c.slice(0, pipe).trim();
      if (first.length >= 2 && first.length <= 90) return { name: clean(first), headline: '' };
    }
    if (c.length >= 2 && c.length <= 90) return { name: clean(c), headline: '' };
    return { name: '', headline: '' };
  }

  function scrapeNameFromMeta() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) {
      const { name } = parseOgTitleParts(og.content);
      if (name) return name;
    }
    const t = document.title || '';
    const m = t.match(/^(.+?)\s*\|\s*LinkedIn/i);
    if (m && m[1]) {
      const { name } = parseOgTitleParts(m[1]);
      if (name) return name;
      return clean(m[1]);
    }
    return '';
  }

  function scrapeName() {
    const selectors = [
      'h1.text-heading-xlarge',
      'h1.inline.break-words',
      'h1.break-words',
      'h1'
    ];
    const card = getProfileTopCardRoot();
    if (card) {
      for (const sel of selectors) {
        const el = card.querySelector(sel);
        if (el && el.innerText.trim()) return clean(el.innerText);
      }
    }
    for (const sel of selectors) {
      const el = firstElementMatchingOutsideOverlays(sel);
      if (el) return clean(el.innerText);
    }
    const metaName = scrapeNameFromMeta();
    if (metaName) return metaName;
    return '';
  }

  function scrapeHeadlineFromMeta() {
    const ogd = document.querySelector('meta[property="og:description"]');
    if (ogd && ogd.content) {
      const d = clean(ogd.content.trim());
      if (d.length > 5 && d.length < 500) return d;
    }
    const og = document.querySelector('meta[property="og:title"]')?.content || '';
    const { headline: fromOg } = parseOgTitleParts(og);
    if (fromOg && fromOg.length > 3) return fromOg;
    const t = document.title || '';
    const m = t.match(/^(.+?)\s*\|\s*LinkedIn/i);
    if (m && m[1]) {
      const { headline } = parseOgTitleParts(m[1]);
      if (headline && headline.length > 3) return headline;
    }
    return '';
  }

  function scrapeHeadline() {
    const selectors = [
      '.text-body-medium.break-words',
      'div.mt2.relative > div > .text-body-medium',
      '.text-body-medium'
    ];
    const extraHeadSelectors = [
      '.mt2.relative .text-body-medium',
      '.ph5 .text-body-medium',
      '[data-field="headline"] + div .text-body-medium',
      'div[class*="top-card-layout"] .text-body-medium'
    ];
    const card = getProfileTopCardRoot();
    if (card) {
      for (const sel of selectors) {
        const el = card.querySelector(sel);
        if (el && el.innerText.trim()) return clean(el.innerText);
      }
      for (const sel of extraHeadSelectors) {
        const el = card.querySelector(sel);
        if (!el || isInsideMessagingOrDialog(el)) continue;
        const t = clean((el.innerText || '').split('\n')[0] || '');
        if (t.length > 8 && t.length < 500) return t;
      }
    }
    for (const sel of selectors) {
      const el = firstElementMatchingOutsideOverlays(sel);
      if (el) return clean(el.innerText);
    }
    const metaHead = scrapeHeadlineFromMeta();
    if (metaHead) return metaHead;
    const h1 = card
      ? card.querySelector('h1.text-heading-xlarge, h1')
      : firstElementMatchingOutsideOverlays('h1.text-heading-xlarge, h1');
    if (h1 && h1.parentElement && h1.parentElement.nextElementSibling) {
      const t = clean(h1.parentElement.nextElementSibling.innerText);
      if (t.length > 3 && t.length < 500 && !isInsideMessagingOrDialog(h1.parentElement.nextElementSibling)) return t;
    }
    return '';
  }

  function scrapeAbout() {
    const section =
      document.getElementById('about')?.closest('section') ||
      document.querySelector('section[data-section-id="about"]') ||
      [...document.querySelectorAll('section.artdeco-card')].find((sec) => {
        if (isInsideMessagingOrDialog(sec)) return false;
        const h2 = sec.querySelector('h2, .pvs-header__title, span.pvs-header__title-text');
        const t = (h2 && h2.textContent) || '';
        return /\babout\b/i.test(t.trim());
      });
    if (!section) return '';

    const candidates = [];
    const push = (raw) => {
      const t = clean(raw || '');
      if (t.length < 42) return;
      if (/^(about|show all|see more|see less|…)$/i.test(t)) return;
      candidates.push(t);
    };

    section
      .querySelectorAll(
        '.inline-show-more-text--is-collapsed, .inline-show-more-text, span.break-words, [class*="inline-show-more"]'
      )
      .forEach((el) => push(el.innerText));

    for (const span of section.querySelectorAll('span[aria-hidden="true"]')) {
      push(span.innerText);
    }
    section.querySelectorAll('div.display-flex span, p.break-words').forEach((el) => push(el.innerText));

    const block = clean(section.innerText || '');
    if (block.length > 50) {
      const stripped = block
        .replace(/^[\s\S]*?\babout\b/i, '')
        .replace(/\bshow all\b/gi, '')
        .replace(/\bsee more\b/gi, '')
        .trim();
      if (stripped.length > 45) push(stripped);
    }

    let best = '';
    for (const c of candidates) {
      if (c.length > best.length) best = c;
    }
    return truncate(best, 2600);
  }

  function scrapeCompanyFromTopCard() {
    const card = getProfileTopCardRoot();
    if (!card) return '';
    const named =
      card.querySelector('[data-field="position_company_name"] a, [data-field="position_company_name"]') ||
      card.querySelector('button[aria-label*="Current company"]') ||
      card.querySelector('a[href*="/company/"]');
    if (named) {
      const aria = typeof named.getAttribute === 'function' ? named.getAttribute('aria-label') || '' : '';
      const t = clean(named.innerText || aria);
      if (t.length > 1 && t.length < 120) return t.replace(/^Current company:\s*/i, '').trim();
    }
    for (const a of card.querySelectorAll('a[href*="linkedin.com/company/"], a[href*="/company/"]')) {
      const t = clean(a.innerText);
      if (t.length > 1 && t.length < 120) return t;
    }
    const sch = card.querySelector('a[href*="/school/"]');
    if (sch) {
      const t = clean(sch.innerText);
      if (t.length > 1 && t.length < 120) return t;
    }
    return '';
  }

  function scrapeLocation() {
    const isNoise = (t) => {
      if (!t || t.length < 3 || t.length > 130) return true;
      if (/\b(1st|2nd|3rd)\b/i.test(t)) return true;
      if (/mutual connection/i.test(t)) return true;
      if (/contact info|followers|connections|following|follower/i.test(t)) return true;
      if (/^\d+\s*followers?$/i.test(t)) return true;
      if (/^follow\b/i.test(t)) return true;
      if (/^message\b|^more\b|^connect\b/i.test(t)) return true;
      return false;
    };

    const roots = [
      getProfileTopCardRoot(),
      getProfileContentRoot(),
      document.querySelector('main section:first-of-type'),
      document.querySelector('main')
    ].filter(Boolean);

    for (const root of roots) {
      const nodes = root.querySelectorAll(
        '.text-body-small, span.text-body-small, div.text-body-small, .t-black--light, span[class*="body-small"]'
      );
      for (const el of nodes) {
        if (isInsideMessagingOrDialog(el)) continue;
        const t = clean(el.innerText);
        if (isNoise(t)) continue;
        if (/,/.test(t) && t.length > 5 && t.length < 120) return t;
        if (
          /\b(Pakistan|India|United States|USA|U\.S\.|UK|United Kingdom|Canada|Germany|France|UAE|China|Australia|Spain|Italy|Brazil|Mexico|Singapore|Netherlands|Ireland|Poland|Turkey|Egypt|Nigeria|Kenya|South Africa|Indonesia|Philippines|Vietnam|Japan|South Korea|Saudi Arabia|Qatar|Kuwait|Oman|Bahrain|Jordan|Lebanon|Israel|Argentina|Colombia|Chile|Peru|Bangladesh|Sri Lanka|Nepal|Austria|Switzerland|Sweden|Norway|Denmark|Finland|Belgium|Portugal|Czech|Romania|Greece|Russia|Ukraine|Lahore|Karachi|Islamabad|Dubai|London|Toronto|New York|San Francisco|Los Angeles|Chicago|Seattle|Austin|Boston|Berlin|Paris|Amsterdam)\b/i.test(
            t
          ) &&
          t.length < 120
        ) {
          return t;
        }
      }
    }
    const card = getProfileTopCardRoot();
    if (card) {
      const lines = String(card.innerText || '')
        .split(/\n+/)
        .map((l) => clean(l))
        .filter(Boolean);
      for (const line of lines) {
        if (line.length < 5 || line.length > 130) continue;
        if (isNoise(line)) continue;
        if (/,/.test(line) && !/·{2,}/.test(line) && line.split(',').length <= 4) return line;
      }
    }
    return '';
  }

  function scrapeEducation(max) {
    const section = getSectionByTitle(/\beducation\b/i);
    if (!section) return [];
    const ul = largestDirectList(section);
    let lis = [];
    if (ul) lis = [...ul.children].filter((n) => n.tagName === 'LI');
    if (!lis.length) lis = [...section.querySelectorAll('li.artdeco-list__item')].slice(0, max);
    return lis
      .slice(0, max)
      .map(parseEducationItem)
      .filter((e) => e.school || e.degree);
  }

  function parseEducationItem(li) {
    const spans = [...li.querySelectorAll('span[aria-hidden="true"]')]
      .map((s) => clean(s.innerText))
      .filter((t) => t.length > 0);
    return {
      school: spans[0] || '',
      degree: spans[1] || '',
      dates: spans[2] || '',
      summary: truncate(spans.slice(0, 4).join(' — '), 320)
    };
  }

  function scrapeSkills(max) {
    const section = getSectionByTitle(/\bskills\b/i);
    const out = [];
    const add = (t) => {
      const s = clean(t);
      if (!s || s.length > 90 || out.includes(s)) return;
      if (/^(show all|see all|endorse|skills)/i.test(s)) return;
      out.push(s);
    };
    if (section) {
      section.querySelectorAll('a[href*="/details/skills/"], a[href*="/skills/"]').forEach((a) => add(a.innerText));
      if (out.length < 4) {
        section.querySelectorAll('span[aria-hidden="true"]').forEach((sp) => {
          const t = clean(sp.innerText);
          if (t.length > 2 && t.length < 70) add(t);
        });
      }
    }
    if (out.length < 4) {
      document.querySelectorAll('a[href*="/details/skills/"]').forEach((a) => add(a.innerText));
    }
    return out.slice(0, max);
  }

  function scrapeCertifications(max) {
    const section = getSectionByTitle(/\b(licenses?\s*&?\s*)?certifications?\b|\blicenses\b/i);
    if (!section) return [];
    const ul = largestDirectList(section);
    if (!ul) return [];
    return [...ul.children]
      .filter((n) => n.tagName === 'LI')
      .slice(0, max)
      .map((li) => {
        const spans = [...li.querySelectorAll('span[aria-hidden="true"]')]
          .map((s) => clean(s.innerText))
          .filter(Boolean);
        return truncate(spans.slice(0, 3).join(' — '), 240);
      })
      .filter(Boolean);
  }

  function scrapeLanguages(max) {
    const section = getSectionByTitle(/\blanguages?\b/i);
    if (!section) return [];
    const ul = largestDirectList(section);
    if (!ul) {
      const spans = [...section.querySelectorAll('span[aria-hidden="true"]')]
        .map((s) => clean(s.innerText))
        .filter((t) => t.length > 2 && t.length < 100);
      return [...new Set(spans)].slice(0, max);
    }
    return [...ul.children]
      .filter((n) => n.tagName === 'LI')
      .slice(0, max)
      .map((li) => {
        const spans = [...li.querySelectorAll('span[aria-hidden="true"]')]
          .map((s) => clean(s.innerText))
          .filter(Boolean);
        return truncate(spans.slice(0, 2).join(' — '), 120);
      })
      .filter(Boolean);
  }

  function scrapeDegree() {
    const main = getProfileContentRoot() || document.querySelector('main');
    const slice = (main && main.innerText) ? main.innerText.slice(0, 5000) : document.body.innerText.slice(0, 5000);
    const m = slice.match(/\b(1st|2nd|3rd)\b/i);
    if (m) {
      const g = m[1].toLowerCase();
      if (g.startsWith('1')) return '1st';
      if (g.startsWith('2')) return '2nd';
      if (g.startsWith('3')) return '3rd';
    }
    const badge = main
      ? main.querySelector('span.dist-value, span[class*="dist-value"]')
      : document.querySelector('span.dist-value, span[class*="dist-value"]');
    if (badge && !isInsideMessagingOrDialog(badge)) {
      const t = badge.innerText.toLowerCase();
      if (t.includes('1st')) return '1st';
      if (t.includes('2nd')) return '2nd';
      if (t.includes('3rd')) return '3rd';
    }
    return 'unknown';
  }

  function mergeChannelFlags(a, b) {
    return {
      connect: !!(a && a.connect) || !!(b && b.connect),
      message: !!(a && a.message) || !!(b && b.message),
      inmail: !!(a && a.inmail) || !!(b && b.inmail)
    };
  }

  /** Voyager-style JSON often encodes which actions exist before buttons render. */
  function inferChannelsFromJsonScripts() {
    const out = { connect: false, message: false, inmail: false };
    for (const sc of document.querySelectorAll('script[type="application/json"]')) {
      let raw = sc.textContent || '';
      if (raw.length < 800) continue;
      if (raw.length > 500000) raw = raw.slice(0, 500000);
      if (!/MemberRelationship|messaging|inmail|invite|CONNECTION/i.test(raw)) continue;
      if (/canSendInmail\s*:\s*true|canSendInMail\s*:\s*true|"canSendInmail"\s*:\s*true/i.test(raw)) out.inmail = true;
      if (/canSendMessage\s*:\s*true|showMessagingButton\s*:\s*true/i.test(raw)) out.message = true;
      if (
        /canInvite\s*:\s*true|NON_SELF_VIEWER_CAN_SEND_INVITE|invitationAvailability["']?\s*:\s*["']?CAN/i.test(raw)
      ) {
        out.connect = true;
      }
      if (out.connect && out.message && out.inmail) break;
    }
    return out;
  }

  /** Last-resort when no buttons matched the DOM (lazy UI, overlays, A/B tests). */
  function inferChannelsWhenDomMissed(degree, isOpen, domCh) {
    const base = {
      connect: !!domCh.connect,
      message: !!domCh.message,
      inmail: !!domCh.inmail
    };
    if (base.connect || base.message || base.inmail) return base;
    const deg = String(degree || '').toLowerCase();
    const open = !!isOpen;
    if (deg.includes('1st')) {
      return { connect: true, message: true, inmail: open };
    }
    return { connect: true, message: false, inmail: open };
  }

  function scrapeMutualConnections() {
    const parseHay = (hay) => {
      if (!hay || hay.length < 8) return null;
      const h = hay.replace(/\u00a0/g, ' ');
      const patterns = [
        /([\d,]+)\s*\+\s*mutual/i,
        /(\d+)\s*(?:other\s+)?mutual connections?/i,
        /(\d+)\s+shared connections?/i,
        /([\d,]+)\s+mutuals?/i,
        /(?:^|\s)(\d+)\s+mutual\b/i
      ];
      for (const re of patterns) {
        const m = h.match(re);
        if (m) {
          const n = parseInt(String(m[1]).replace(/,/g, ''), 10);
          if (!Number.isNaN(n) && n >= 0 && n < 500000) return n;
        }
      }
      return null;
    };
    const roots = [getProfileTopCardRoot(), getProfileContentRoot()].filter(Boolean);
    for (const root of roots.length ? roots : [document.querySelector('main')]) {
      if (!root || isInsideMessagingOrDialog(root)) continue;
      const n = parseHay(root.innerText || '');
      if (n != null) return n;
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = tw.nextNode())) {
        const v = node.nodeValue || '';
        if (!/mutual/i.test(v)) continue;
        const match = v.match(/(\d+)\s*\+?\s*mutual/i) || v.match(/(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!Number.isNaN(num)) return num;
        }
      }
    }
    return 0;
  }

  function scrapeChannels() {
    const channels = { connect: false, message: false, inmail: false };
    const actRoot =
      getProfileTopCardRoot()?.closest('section, .pv-top-card, .ph5') ||
      getProfileContentRoot() ||
      document.querySelector('main');
    const nodes = (actRoot || document).querySelectorAll(
      'button, a[role="button"], a.pvs-profile-actions__action, button.artdeco-button, a.artdeco-button'
    );
    for (const el of nodes) {
      if (isInsideMessagingOrDialog(el)) continue;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const text = (el.innerText || '').toLowerCase();
      const blob = `${aria} ${text}`;
      if (/inmail/.test(blob)) channels.inmail = true;
      if (/\bmessage\b/.test(blob) && !/inmail/.test(blob)) channels.message = true;
      if (/connect|invitation|invite\b/.test(blob) && !/disconnect/.test(blob)) channels.connect = true;
    }
    return channels;
  }

  function clean(str) {
    if (!str) return '';
    return str.replace(/\s+/g, ' ').replace(/…see more/gi, '').replace(/see more/gi, '').trim();
  }

  function truncate(str, max) {
    return str.length > max ? str.substring(0, max) + '…' : str;
  }
})();
