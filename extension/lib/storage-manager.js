// ReachAI — Storage Manager
// Manages all chrome.storage.local operations for identity, context, feedback, and sessions

const StorageManager = {
  /** Single source for KB → prompt limits (UI + getFullContext + upload validation). */
  KNOWLEDGE_AI_LIMITS: Object.freeze({
    MAX_FILE_UPLOAD_BYTES: 5 * 1024 * 1024,
    MAX_FILE_EXCERPT_CHARS: 10000,
    MAX_MISSION_CHARS: 8000,
    MAX_NOTES_CHARS: 8000,
    MAX_WEB_BRIDGE_CONTEXT_CHARS: 8000
  }),

  // ═══════════════════════════════════════
  //  IDENTITY
  // ═══════════════════════════════════════

  async getIdentity() {
    const result = await chrome.storage.local.get('identity');
    return result.identity || null;
  },

  async saveIdentity(identity) {
    await chrome.storage.local.set({ identity });
  },

  // ═══════════════════════════════════════
  //  SETTINGS (Goal, Tone)
  // ═══════════════════════════════════════

  async getSettings() {
    const result = await chrome.storage.local.get('settings');
    const merged = { goal: 20, tone: 'professional', mission: '', ...(result.settings || {}) };
    const rec =
      typeof DpBridge !== 'undefined' && DpBridge.DAILY_LINKEDIN_LIMIT
        ? DpBridge.DAILY_LINKEDIN_LIMIT.RECOMMENDED
        : 20;
    if (typeof DpBridge !== 'undefined' && DpBridge.clampDailyLinkedinLimit) {
      merged.goal = DpBridge.clampDailyLinkedinLimit(merged.goal);
    } else {
      const g = Math.floor(Number(merged.goal));
      merged.goal = Number.isFinite(g) && g >= 1 ? Math.min(30, g) : rec;
    }
    return merged;
  },

  async saveSettings(settings) {
    const prev = await this.getSettings();
    const next = { ...prev, ...settings };
    if (next.goal != null) {
      if (typeof DpBridge !== 'undefined' && DpBridge.clampDailyLinkedinLimit) {
        next.goal = DpBridge.clampDailyLinkedinLimit(next.goal);
      } else {
        const g = Math.floor(Number(next.goal));
        const rec =
          typeof DpBridge !== 'undefined' && DpBridge.DAILY_LINKEDIN_LIMIT
            ? DpBridge.DAILY_LINKEDIN_LIMIT.RECOMMENDED
            : 20;
        next.goal = Number.isFinite(g) && g >= 1 ? Math.min(30, Math.max(1, g)) : rec;
      }
    }
    await chrome.storage.local.set({ settings: next });
  },

  // ═══════════════════════════════════════
  //  API KEY
  // ═══════════════════════════════════════

  async getApiKey() {
    const result = await chrome.storage.local.get('apiKey');
    return result.apiKey || '';
  },

  async saveApiKey(apiKey) {
    await chrome.storage.local.set({ apiKey });
  },

  // ═══════════════════════════════════════
  //  CLOUD (product-style: JWT + your API server)
  // ═══════════════════════════════════════

  async getAuthMode() {
    const result = await chrome.storage.local.get('authMode');
    return result.authMode === 'cloud' ? 'cloud' : 'local';
  },

  async setAuthMode(mode) {
    await chrome.storage.local.set({ authMode: mode === 'cloud' ? 'cloud' : 'local' });
  },

  async getCloudSession() {
    const result = await chrome.storage.local.get(['cloudApiBaseUrl', 'cloudAiApiBaseUrl', 'cloudAccessToken']);
    const baseUrl = (result.cloudApiBaseUrl || '').trim().replace(/\/$/, '');
    const aiStored = (result.cloudAiApiBaseUrl || '').trim().replace(/\/$/, '');
    const token = (result.cloudAccessToken || '').trim();
    if (!baseUrl || !token) return null;
    const aiBaseUrl = aiStored || baseUrl;
    return { baseUrl, aiBaseUrl, token };
  },

  /**
   * @param {string} authBaseUrl — JWT activation, LinkedIn token exchange, etc.
   * @param {string} token
   * @param {string} [aiBaseUrl] — Gemini /ai/complete; omit or same as auth to use one host only
   */
  async saveCloudSession(authBaseUrl, token, aiBaseUrl) {
    const auth = String(authBaseUrl || '').trim().replace(/\/$/, '');
    const aiRaw = String(aiBaseUrl != null ? aiBaseUrl : '').trim().replace(/\/$/, '');
    const aiOnly = aiRaw && aiRaw !== auth ? aiRaw : '';
    await chrome.storage.local.set({
      cloudApiBaseUrl: auth,
      cloudAiApiBaseUrl: aiOnly,
      cloudAccessToken: String(token || '').trim(),
      authMode: 'cloud'
    });
    await chrome.storage.local.remove('apiKey');
  },

  async clearCloudSession() {
    await chrome.storage.local.remove(['cloudApiBaseUrl', 'cloudAiApiBaseUrl', 'cloudAccessToken']);
    await this.setAuthMode('cloud');
  },

  /**
   * Team zip / default URL upgrades: if chrome.storage still points at local Docker but this build
   * defaults to another host (e.g. Vercel), drop the old session so auto-activate uses the bundle.
   */
  async migrateStaleLocalApiSession(bundledApiBase) {
    const next = String(bundledApiBase || '')
      .trim()
      .replace(/\/$/, '');
    if (!next) return;
    const sess = await this.getCloudSession();
    if (!sess?.baseUrl || !sess?.token) return;
    const cur = String(sess.baseUrl).trim().replace(/\/$/, '');
    const localDev = new Set(['http://127.0.0.1:3847', 'http://localhost:3847']);
    if (localDev.has(cur) && cur !== next) {
      await this.clearCloudSession();
    }
  },

  // ═══════════════════════════════════════
  //  LINKEDIN OAUTH (OpenID — access token + profile/email in extension)
  // ═══════════════════════════════════════════════════════════════

  async saveLinkedInOAuth({ accessToken, expiresAt, scope }) {
    await chrome.storage.local.set({
      linkedInOAuth: {
        accessToken: String(accessToken || ''),
        expiresAt: Number(expiresAt) || 0,
        scope: String(scope || '')
      }
    });
  },

  async getLinkedInOAuth() {
    const r = await chrome.storage.local.get('linkedInOAuth');
    const o = r.linkedInOAuth;
    if (!o || !o.accessToken) return null;
    return o;
  },

  async saveLinkedInProfile(profile) {
    await chrome.storage.local.set({
      linkedInProfile: {
        sub: String(profile?.sub || ''),
        name: String(profile?.name || ''),
        email: String(profile?.email || '')
      }
    });
  },

  async getLinkedInProfile() {
    const r = await chrome.storage.local.get('linkedInProfile');
    return r.linkedInProfile || null;
  },

  async clearLinkedInOAuth() {
    await chrome.storage.local.remove([
      'linkedInOAuth',
      'linkedInProfile',
      'linkedInConnectSkipped',
      'postLinkedinSetupActive'
    ]);
  },

  /** User chose “Continue without LinkedIn” on the connect screen — skip until they disconnect or reinstall. */
  async getLinkedInConnectSkipped() {
    const r = await chrome.storage.local.get('linkedInConnectSkipped');
    return !!r.linkedInConnectSkipped;
  },

  async setLinkedInConnectSkipped(skipped) {
    await chrome.storage.local.set({ linkedInConnectSkipped: !!skipped });
  },

  /** After LinkedIn OAuth, show the compact Knowledge center (setup) once before “Continue to Outreach”. */
  async getPostLinkedinSetupActive() {
    const r = await chrome.storage.local.get('postLinkedinSetupActive');
    return !!r.postLinkedinSetupActive;
  },

  async setPostLinkedinSetupActive(active) {
    await chrome.storage.local.set({ postLinkedinSetupActive: !!active });
  },

  // ═══════════════════════════════════════
  //  TRAINING CONTEXT
  // ═══════════════════════════════════════

  async getTrainingContext() {
    const result = await chrome.storage.local.get('trainingContext');
    return result.trainingContext || { files: [], text: '' };
  },

  async saveTrainingFiles(files) {
    const ctx = await this.getTrainingContext();
    ctx.files = files;
    await chrome.storage.local.set({ trainingContext: ctx });
  },

  async addTrainingFile(file) {
    const ctx = await this.getTrainingContext();
    ctx.files.push(file);
    await chrome.storage.local.set({ trainingContext: ctx });
  },

  async removeTrainingFile(index) {
    const ctx = await this.getTrainingContext();
    ctx.files.splice(index, 1);
    await chrome.storage.local.set({ trainingContext: ctx });
  },

  async saveTrainingText(text) {
    const ctx = await this.getTrainingContext();
    ctx.text = text;
    await chrome.storage.local.set({ trainingContext: ctx });
  },

  /**
   * Everything the AI should treat as the sender's "knowledge base" (mission, files, notes).
   * @param {{ name?: string, role?: string }} [identity] — included so drafts stay in-voice even if mission is empty.
   */
  async getFullContext(identity) {
    const L = this.KNOWLEDGE_AI_LIMITS;
    const MAX_FILE_CHARS = L.MAX_FILE_EXCERPT_CHARS;
    const MAX_TEXT_CHARS = L.MAX_MISSION_CHARS;
    const MAX_NOTES = L.MAX_NOTES_CHARS;
    const MAX_WEB = L.MAX_WEB_BRIDGE_CONTEXT_CHARS;
    const settings = await this.getSettings();
    const ctx = await this.getTrainingContext();
    let fullText = '';

    if (identity && (identity.name || identity.role)) {
      fullText += `--- SENDER (you write in this person's voice) ---\nName: ${String(identity.name || '').trim()}\nRole: ${String(identity.role || '').trim()}\n\n`;
    }

    if (settings.mission && String(settings.mission).trim()) {
      fullText += `--- STRATEGIC GOAL (MISSION) ---\n${String(settings.mission).trim().slice(0, MAX_TEXT_CHARS)}\n\n`;
    }

    if (ctx.files && ctx.files.length > 0) {
      for (const file of ctx.files) {
        const raw = String(file.content || '');
        const body =
          raw.length > MAX_FILE_CHARS ? `${raw.slice(0, MAX_FILE_CHARS)}\n[…truncated for length]` : raw;
        fullText += `--- KNOWLEDGE FILE: ${file.name} ---\n${body}\n\n`;
      }
    }

    if (ctx.text && ctx.text.trim()) {
      fullText += `--- ADDITIONAL NOTES (product, ICP, proof points) ---\n${String(ctx.text).trim().slice(0, MAX_NOTES)}\n`;
    }

    try {
      const wb = await this.getWebBridgeV1();
      if (wb && wb.mongoOk !== false && typeof wb.effectiveContext === 'string' && wb.effectiveContext.trim()) {
        fullText += `--- COMMAND CENTER (WEB APP — STRATEGIC CONTEXT) ---\n${wb.effectiveContext.trim().slice(0, MAX_WEB)}\n\n`;
      }
    } catch {
      /* ignore */
    }

    return fullText.trim();
  },

  /** True when mission, uploaded training files, additional-notes, or Command Center web context has content. */
  async hasKnowledgeBaseContent() {
    const settings = await this.getSettings();
    const ctx = await this.getTrainingContext();
    let webCtx = false;
    try {
      const wb = await this.getWebBridgeV1();
      webCtx = !!(wb && wb.mongoOk !== false && typeof wb.effectiveContext === 'string' && wb.effectiveContext.trim());
    } catch {
      webCtx = false;
    }
    return (
      !!(settings.mission && String(settings.mission).trim()) ||
      !!(ctx.files && ctx.files.length) ||
      !!(ctx.text && String(ctx.text).trim()) ||
      webCtx
    );
  },

  // ═══════════════════════════════════════
  //  FEEDBACK HISTORY
  // ═══════════════════════════════════════

  async getFeedback() {
    const result = await chrome.storage.local.get('feedback');
    return result.feedback || [];
  },

  async saveFeedback(entry) {
    const feedback = await this.getFeedback();
    feedback.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
      timestamp: Date.now(),
      ...entry
    });

    // Keep last 100 entries max
    if (feedback.length > 100) {
      feedback.length = 100;
    }

    await chrome.storage.local.set({ feedback });
  },

  async getPositiveExamples(messageType, tone, limit = 5) {
    const feedback = await this.getFeedback();
    const mt = String(messageType || '').toLowerCase();
    const tn = String(tone || '').toLowerCase();
    const match = feedback.filter(
      (f) => f.helpful === true && String(f.messageType || '').toLowerCase() === mt && String(f.tone || '').toLowerCase() === tn
    );
    if (match.length) return match.slice(0, limit);
    return feedback
      .filter((f) => f.helpful === true && String(f.messageType || '').toLowerCase() === mt)
      .slice(0, limit);
  },

  async getNegativeExamples(messageType, tone, limit = 5) {
    const feedback = await this.getFeedback();
    const mt = String(messageType || '').toLowerCase();
    const tn = String(tone || '').toLowerCase();
    const match = feedback.filter(
      (f) =>
        f.helpful === false && String(f.messageType || '').toLowerCase() === mt && String(f.tone || '').toLowerCase() === tn
    );
    if (match.length) return match.slice(0, limit);
    return feedback
      .filter((f) => f.helpful === false && String(f.messageType || '').toLowerCase() === mt)
      .slice(0, limit);
  },

  async clearFeedback() {
    await chrome.storage.local.set({ feedback: [] });
  },

  async getFeedbackStats() {
    const feedback = await this.getFeedback();
    return {
      total: feedback.length,
      helpful: feedback.filter(f => f.helpful).length,
      notHelpful: feedback.filter(f => !f.helpful).length
    };
  },

  // ═══════════════════════════════════════
  //  SESSION / DAILY COUNTER
  // ═══════════════════════════════════════

  async getWebBridgeV1() {
    const r = await chrome.storage.local.get('webBridgeV1');
    const v = r.webBridgeV1;
    if (!v || typeof v !== 'object') return null;
    return v;
  },

  async saveWebBridgeV1(snapshot) {
    await chrome.storage.local.set({ webBridgeV1: snapshot });
  },

  async getDailySession() {
    const result = await chrome.storage.local.get('dailySession');
    const session = result.dailySession || { date: '', count: 0 };
    const settings = await this.getSettings();
    const g = Number(settings.goal);
    const rec =
      typeof DpBridge !== 'undefined' && DpBridge.DAILY_LINKEDIN_LIMIT
        ? DpBridge.DAILY_LINKEDIN_LIMIT.RECOMMENDED
        : 20;
    const max =
      typeof DpBridge !== 'undefined' && DpBridge.DAILY_LINKEDIN_LIMIT
        ? DpBridge.DAILY_LINKEDIN_LIMIT.MAX
        : 30;
    let limit = Number.isFinite(g) && g >= 1 ? Math.min(max, Math.floor(g)) : rec;
    try {
      const wb = await this.getWebBridgeV1();
      if (wb && wb.mongoOk !== false && wb.config && Number.isFinite(Number(wb.config.daily_linkedin_limit))) {
        const dl = Math.floor(Number(wb.config.daily_linkedin_limit));
        if (dl >= 1) {
          limit =
            typeof DpBridge !== 'undefined' && DpBridge.clampDailyLinkedinLimit
              ? DpBridge.clampDailyLinkedinLimit(dl)
              : Math.min(max, dl);
        }
      }
    } catch {
      /* ignore */
    }
    session.limit = limit;

    // Reset if new day
    const today = new Date().toDateString();
    if (session.date !== today) {
      session.date = today;
      session.count = 0;
      await chrome.storage.local.set({ dailySession: session });
    }

    let c = Number(session.count) || 0;
    if (c > session.limit) {
      // Cap instead of zeroing — shrinking the daily limit (e.g. Command Center sync) must not wipe real usage.
      c = session.limit;
      session.count = c;
      await chrome.storage.local.set({ dailySession: session });
    }

    return session;
  },

  /** Zeros today's LinkedIn generate count (e.g. after testing or fixing a stuck counter). */
  async resetDailyLinkedInUsage() {
    const session = await this.getDailySession();
    session.count = 0;
    session.date = new Date().toDateString();
    await chrome.storage.local.set({ dailySession: session });
    return session;
  },

  async incrementDailyCount() {
    const session = await this.getDailySession();
    const c = Number(session.count) || 0;
    if (c >= session.limit) return session;
    session.count = c + 1;
    await chrome.storage.local.set({ dailySession: session });
    return session;
  },

  // ═══════════════════════════════════════
  //  SETUP STATE
  // ═══════════════════════════════════════

  /** Product build: only your backend JWT is required — identity is filled from LinkedIn or defaults. */
  async isSetupComplete() {
    const s = await this.getCloudSession();
    return !!(s && s.token);
  },

  /**
   * Sign out of the extension: API JWT, LinkedIn OAuth, saved identity, and live profile snapshot.
   * Keeps knowledge base (mission, files, notes) and feedback history.
   */
  async logOutExtension() {
    await this.clearCloudSession();
    await this.clearLinkedInOAuth();
    await chrome.storage.local.remove(['identity']);
    try {
      await chrome.storage.session.remove([
        'reachai_profile_v1',
        'reachai_tab_profile_url',
        'reachai_tab_profile_changed_at'
      ]);
    } catch (_) {
      /* session storage may be unavailable */
    }
  },

  async clearAll() {
    await chrome.storage.local.clear();
  },

  // ═══════════════════════════════════════
  //  OUTREACH SENT LOG + BRIDGE LOG (dp_sent_log / dp_bridge_log)
  // ═══════════════════════════════════════

  normalizeDpProfileKey(url) {
    if (typeof DpBridge !== 'undefined' && DpBridge.normalizeLinkedInUrl) {
      return DpBridge.normalizeLinkedInUrl(url);
    }
    const s = String(url || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      u.hash = '';
      u.search = '';
      const p = u.pathname.replace(/\/+$/, '') || '';
      return `${u.origin}${p}`.toLowerCase();
    } catch {
      return s.split('?')[0].replace(/\/$/, '').toLowerCase();
    }
  },

  async getDpSentLog() {
    const r = await chrome.storage.local.get('dpSentLog');
    return r.dpSentLog && typeof r.dpSentLog === 'object' && !Array.isArray(r.dpSentLog) ? r.dpSentLog : {};
  },

  /**
   * @returns {null | { lastSentAt: number, firstSentAt: number, sendCount: number }}
   */
  async getDpSentLogMatch(profileUrl) {
    const key = this.normalizeDpProfileKey(profileUrl);
    if (!key || !/\/in\//i.test(key)) return null;
    const log = await this.getDpSentLog();
    let hit = log[key];
    if (!hit) {
      const vanity = key.split(/\/in\//i)[1]?.split(/[/?#]/)[0]?.toLowerCase();
      if (vanity) {
        const hitKey = Object.keys(log).find(
          (k) => k.split(/\/in\//i)[1]?.split(/[/?#]/)[0]?.toLowerCase() === vanity
        );
        if (hitKey) hit = log[hitKey];
      }
    }
    let extTs = hit && hit.lastSentAt ? Number(hit.lastSentAt) : 0;

    let webEntry = null;
    try {
      const wb = await this.getWebBridgeV1();
      if (wb && wb.mongoOk !== false && Array.isArray(wb.sentLog)) {
        for (const e of wb.sentLog) {
          if (!e || typeof e !== 'object') continue;
          const lu = e.linkedin_url;
          if (typeof lu !== 'string' || !lu.trim()) continue;
          if (this.normalizeDpProfileKey(lu) === key) {
            webEntry = e;
            break;
          }
        }
      }
    } catch {
      webEntry = null;
    }
    const webTs = webEntry && webEntry.sent_at ? Date.parse(String(webEntry.sent_at)) : 0;

    if (webTs > 0 && webTs >= extTs) {
      return {
        lastSentAt: webTs,
        firstSentAt: webTs,
        sendCount: Math.max(1, Number(hit?.sendCount) || 1),
        webInstantly: true,
        webMeta: {
          sentAtISO: String(webEntry.sent_at || ''),
          campaignId: webEntry.instantly_campaign_id ? String(webEntry.instantly_campaign_id) : ''
        }
      };
    }

    if (!hit || !hit.lastSentAt) return null;
    return {
      lastSentAt: Number(hit.lastSentAt),
      firstSentAt: Number(hit.firstSentAt || hit.lastSentAt),
      sendCount: Math.max(1, Number(hit.sendCount) || 1)
    };
  },

  /** Tone from Command Center when bridge is valid (professional | casual | direct). */
  async getWebBridgeTone() {
    try {
      const wb = await this.getWebBridgeV1();
      if (!wb || wb.mongoOk === false || !wb.config) return null;
      const t = String(wb.config.tone || '').toLowerCase().trim();
      if (t === 'professional' || t === 'casual' || t === 'direct') return t;
    } catch {
      /* ignore */
    }
    return null;
  },

  async getDpBridgeLog() {
    const r = await chrome.storage.local.get('dpBridgeLog');
    return Array.isArray(r.dpBridgeLog) ? r.dpBridgeLog : [];
  },

  /**
   * Call after the user sends outreach on LinkedIn (they confirm in the panel).
   * Updates dp_sent_log for passive re-open detection; appends dp_bridge_log for history.
   */
  async recordDpSend({ profileUrl, channel, tone, mode }) {
    const key = this.normalizeDpProfileKey(profileUrl);
    if (!key || !/\/in\//i.test(key)) return { ok: false, error: 'bad profile url' };
    const at = Date.now();
    const sent = await this.getDpSentLog();
    const prev = sent[key] || {};
    sent[key] = {
      lastSentAt: at,
      firstSentAt: prev.firstSentAt || at,
      sendCount: (Number(prev.sendCount) || 0) + 1
    };
    await chrome.storage.local.set({ dpSentLog: sent });

    const bridge = await this.getDpBridgeLog();
    bridge.unshift({
      at,
      profileUrlNorm: key,
      channel: String(channel || ''),
      tone: String(tone || ''),
      mode: mode === 'bridge' ? 'bridge' : 'intro'
    });
    if (bridge.length > 600) bridge.length = 600;
    await chrome.storage.local.set({ dpBridgeLog: bridge });
    return { ok: true };
  }
};

// Export for use in sidepanel.js and background.js
if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}
