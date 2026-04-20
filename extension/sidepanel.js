// LynkWell AI — side panel

document.addEventListener('DOMContentLoaded', async () => {

  /** Chrome often does not return a real Promise from sendMessage — use callbacks. */
  function sendBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }
          if (response === undefined) {
            resolve({
              success: false,
              error:
                'No response from the extension background. Open chrome://extensions → LynkWell AI → Errors, reload the extension, and ensure your API server is running.'
            });
            return;
          }
          resolve(response);
        });
      } catch (e) {
        resolve({ success: false, error: e.message || String(e) });
      }
    });
  }
  
  // State
  let currentProfile = null;
  let currentDraft = "";
  let draftFeedbackId = null;
  let lastAutoDraftedProfileNorm = '';
  let generatingLock = false;
  /** Last successful GET_RECOMMENDATION payload — reapplied after generate so the panel does not look “empty”. */
  let lastRecommendationPayload = null;
  /** When true, show full reason + “Why this pick” (toggled via #recco-badge). */
  let reccoAnalysisExpanded = false;
  /** Last /auth/activate failure message for the API-unavailable screen. */
  let lastApiActivateError = '';
  /** `intro` = no saved send for this /in/ URL. `bridge` = user saved a prior send (local extension history only). */
  let currentOutreachMode = 'intro';
  let currentPriorSentAt = null;
  /** Correlates chrome.runtime progress messages with the current Generate click. */
  let activeGenerationRunId = null;
  let generationPhaseTicker = null;

  function dailyLimitL() {
    return DpBridge.DAILY_LINKEDIN_LIMIT;
  }

  function clampDailyLimit(n) {
    return DpBridge.clampDailyLinkedinLimit(n);
  }

  function wireCommandCenterLinks() {
    try {
      const origin = DpBridge.COMMAND_CENTER_ORIGIN;
      document.querySelectorAll('a[data-command-center-link]').forEach((a) => {
        a.href = `${origin}/`;
      });
    } catch (_) {
      /* ignore */
    }
  }

  // DOM Elements
  const screens = {
    linkedin: document.getElementById('screen-linkedin'),
    apiUnavailable: document.getElementById('screen-api-unavailable'),
    setup: document.getElementById('screen-setup'),
    confirm: document.getElementById('screen-confirm'),
    training: document.getElementById('screen-training'),
    generator: document.getElementById('screen-generator')
  };

  const els = {
    // Setup
    cloudBase: document.getElementById('input-cloud-base'),
    aiCloudBase: document.getElementById('input-ai-base'),
    activationCodeWrap: document.getElementById('activation-code-wrap'),
    activationCode: document.getElementById('input-activation-code'),
    name: document.getElementById('input-name'),
    role: document.getElementById('input-role'),
    goal: document.getElementById('input-goal'),
    tone: document.getElementById('input-tone'),
    mission: document.getElementById('input-mission'),
    safetyZone: document.getElementById('safety-zone-indicator'),
    btnSaveSetup: document.getElementById('btn-save-setup'),
    btnSaveSetupLabel: document.getElementById('btn-save-setup-label'),
    headerApiStatus: document.getElementById('header-api-status'),
    stepDot1: document.querySelector('.lw-dot--1'),
    stepDot2: document.querySelector('.lw-dot--2'),
    btnEnhanceMission: document.getElementById('btn-enhance-mission'),
    toneTilesSetup: document.getElementById('tone-tiles-setup'),
    uploadZoneSetup: document.getElementById('upload-zone-setup'),
    fileInputSetup: document.getElementById('file-input-setup'),
    fileListSetup: document.getElementById('file-list-setup'),
    uploadZoneStatusSetup: document.getElementById('upload-zone-status-setup'),
    btnLinkedinSkip: document.getElementById('btn-linkedin-skip'),
    btnEditSettingsFooter: document.getElementById('btn-edit-settings-footer'),
    uploadZoneStatus: document.getElementById('upload-zone-status'),
    
    // Confirm
    confirmName: document.getElementById('confirm-name-display'),
    confirmMsg: document.getElementById('confirm-ai-msg'),
    btnConfirmYes: document.getElementById('btn-confirm-yes'),
    btnConfirmEdit: document.getElementById('btn-confirm-edit'),

    // Global Top Bar
    btnLogOut: document.getElementById('btn-log-out'),
    btnBackTraining: document.getElementById('btn-back-training'),

    // Training
    uploadZone: document.getElementById('upload-zone'),
    fileInput: document.getElementById('file-input'),
    fileList: document.getElementById('file-list'),
    missionTraining: document.getElementById('input-mission-training'),
    missionSavedMsg: document.getElementById('mission-saved-msg'),
    toneTilesTraining: document.getElementById('tone-tiles-training'),
    toneTraining: document.getElementById('input-tone-training'),
    btnEnhanceMissionTraining: document.getElementById('btn-enhance-mission-training'),
    kbDailyLimitSlider: document.getElementById('kb-daily-limit-slider'),
    kbDailyLimitBadge: document.getElementById('kb-daily-limit-badge'),
    kbDailyLimitWebHint: document.getElementById('kb-daily-limit-web-hint'),
    kbDailyLimitReset: document.getElementById('kb-daily-limit-reset'),
    btnClearFeedback: document.getElementById('btn-clear-feedback'),
    btnDisconnectCloud: document.getElementById('btn-disconnect-cloud'),
    btnLinkedinConnect: document.getElementById('btn-linkedin-connect'),

    // Generator
    targetName: document.getElementById('target-name'),
    targetHeadline: document.getElementById('target-headline'),
    targetCompany: document.getElementById('target-company'),
    targetLocation: document.getElementById('target-location'),
    targetDegreeBadge: document.getElementById('target-degree-badge'),
    targetMutuals: document.getElementById('target-mutuals'),
    targetMutualsN: document.getElementById('target-mutuals-n'),
    targetAvatar: document.getElementById('target-avatar'),
    targetAvatarImg: document.getElementById('target-avatar-img'),
    sentLogBanner: document.getElementById('lw-sent-log-banner'),

    reccoBadge: document.getElementById('recco-badge'),
    reccoLoading: document.getElementById('recco-loading'),
    reccoLoadingText: document.getElementById('recco-loading-text'),
    reccoChannel: document.getElementById('recco-channel'),
    reccoReason: document.getElementById('recco-reason'),
    reccoDeep: document.getElementById('recco-deep'),
    reccoAnalysis: document.getElementById('recco-analysis'),
    reccoToneLine: document.getElementById('recco-tone-line'),
    reccoPlans: document.getElementById('recco-plans'),
    reccoAgentPick: document.getElementById('recco-agent-pick'),
    reccoToneCompare: document.getElementById('recco-tone-compare'),
    reccoToneUser: document.getElementById('recco-tone-user'),
    reccoToneAi: document.getElementById('recco-tone-ai'),
    btnReccoUseAiTone: document.getElementById('btn-recco-use-ai-tone'),

    channelTabs: document.getElementById('channel-tabs'),
    tonePills: document.getElementById('tone-pills'),

    btnGenerate: document.getElementById('btn-generate'),
    btnGenText: document.querySelector('#btn-generate .lw-btn__text'),
    btnGenSpinner: document.querySelector('#btn-generate .lw-spinner'),
    generateLiveStatus: document.getElementById('generate-live-status'),

    editorContainer: document.getElementById('editor-container'),
    subjectEditor: document.getElementById('subject-editor'),
    draftEditor: document.getElementById('draft-editor'),
    charCount: document.getElementById('char-count'),
    charLimit: document.getElementById('char-limit'),
    
    actionRowDefault: document.getElementById('action-row-default'),
    actionRowInmail: document.getElementById('action-row-inmail'),
    
    btnFeedbackYes: document.getElementById('btn-feedback-yes'),
    btnFeedbackNo: document.getElementById('btn-feedback-no'),
    btnRegenerate: document.getElementById('btn-regenerate'),
    btnRegenerateInmail: document.getElementById('btn-regenerate-inmail'),
    btnCopy: document.getElementById('btn-copy'),
    btnCopySubject: document.getElementById('btn-copy-subject'),
    btnCopyBody: document.getElementById('btn-copy-body'),
    handoffTooltip: document.getElementById('handoff-tooltip'),

    sessionCount: document.getElementById('session-count'),
    sessionLimit: document.getElementById('session-limit'),
    sessionProgress: document.getElementById('session-progress'),
    btnResetDailyUsage: document.getElementById('btn-reset-daily-usage'),
    goalBanner: document.getElementById('goal-achieved-banner'),
    toast: document.getElementById('toast'),
  };

  function clearGenerationPhaseTicker() {
    if (generationPhaseTicker) {
      clearInterval(generationPhaseTicker);
      generationPhaseTicker = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'LINKWELL_GENERATE_PROGRESS') return;
    if (!msg.runId || !activeGenerationRunId || msg.runId !== activeGenerationRunId) return;
    clearGenerationPhaseTicker();
    if (els.generateLiveStatus) {
      els.generateLiveStatus.classList.remove('hidden');
      const extra = msg.detail ? ` — ${msg.detail}` : '';
      els.generateLiveStatus.textContent = `${msg.label || ''}${extra}`;
    }
  });

  // ═══════════════════════════════════════
  //  APP INITIALIZATION
  // ═══════════════════════════════════════

  function getReachaiExtensionSecret() {
    return typeof REACHAI_EXTENSION_SECRET !== 'undefined' && REACHAI_EXTENSION_SECRET
      ? String(REACHAI_EXTENSION_SECRET).trim()
      : '';
  }

  /**
   * Uses bundled reach-api-default.js (API URL + activation code or 16+ char secret) so LinkedIn
   * and AI calls can authenticate without a separate setup screen.
   */
  async function ensureApiSessionQuietly() {
    const autoOn =
      typeof REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN !== 'undefined' && REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN;
    if (!autoOn) return false;
    const base =
      typeof REACHAI_DEFAULT_API_BASE !== 'undefined' && REACHAI_DEFAULT_API_BASE
        ? String(REACHAI_DEFAULT_API_BASE).trim().replace(/\/$/, '')
        : '';
    if (!base || !/^https?:\/\//i.test(base)) {
      lastApiActivateError = 'Missing or invalid API base URL (REACHAI_DEFAULT_API_BASE) in reach-api-default.js.';
      return false;
    }
    const extSecret = getReachaiExtensionSecret();
    const code =
      typeof REACHAI_DEFAULT_ACTIVATION_CODE !== 'undefined' && REACHAI_DEFAULT_ACTIVATION_CODE
        ? String(REACHAI_DEFAULT_ACTIVATION_CODE).trim()
        : '';
    if (extSecret.length < 16 && !code) {
      lastApiActivateError =
        'Add REACHAI_DEFAULT_ACTIVATION_CODE or a 16+ character REACHAI_EXTENSION_SECRET in reach-api-default.js to match server .env.';
      return false;
    }
    await StorageManager.migrateStaleLocalApiSession(base);
    const existing = await StorageManager.getCloudSession();
    if (existing?.token) {
      lastApiActivateError = '';
      return true;
    }
    const aiRaw =
      typeof REACHAI_DEFAULT_AI_API_BASE !== 'undefined' && REACHAI_DEFAULT_AI_API_BASE
        ? String(REACHAI_DEFAULT_AI_API_BASE).trim().replace(/\/$/, '')
        : '';
    try {
      const act = await sendBackground({
        action: 'ACTIVATE_CLOUD',
        payload: { baseUrl: base, aiBaseUrl: aiRaw || '', code, extensionSecret: extSecret }
      });
      if (!act || !act.success) {
        lastApiActivateError = String((act && act.error) || 'Activation failed').trim();
        console.warn('[LynkWell AI] Auto-activate failed:', lastApiActivateError);
        return false;
      }
      lastApiActivateError = '';
      await updateHeaderStatus();
      return true;
    } catch (e) {
      lastApiActivateError = String((e && e.message) || e || 'Network error').trim();
      console.warn('[LynkWell AI] Auto-activate error:', e);
      return false;
    }
  }

  async function refreshApiUnavailablePanel() {
    const el = document.getElementById('api-unavailable-detail');
    if (!el) return;
    const base =
      typeof REACHAI_DEFAULT_API_BASE !== 'undefined' && REACHAI_DEFAULT_API_BASE
        ? String(REACHAI_DEFAULT_API_BASE).trim().replace(/\/$/, '')
        : '';
    const autoOn =
      typeof REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN !== 'undefined' && REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN;
    const sess = await StorageManager.getCloudSession();
    const parts = [];
    if (!autoOn) {
      parts.push(
        'Bundled auto-activation is off. Set REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN to true in lib/reach-api-default.js so the extension can obtain a JWT from your backend.'
      );
    }
    if (!base || !/^https?:\/\//i.test(base)) {
      parts.push('Set a valid http(s) REACHAI_DEFAULT_API_BASE in reach-api-default.js (e.g. your local server).');
    } else if (autoOn && !sess?.token) {
      parts.push(
        'Could not obtain a JWT from /api/v1/auth/activate. The AI model runs only on your server — check GEMINI_API_KEY (or your provider), activation secret vs .env, and server logs.'
      );
    }
    if (lastApiActivateError) parts.push(`Last error: ${lastApiActivateError}`);
    if (base) parts.push(`Configured host: ${base}`);
    el.textContent = parts.filter(Boolean).join('\n\n') || 'No API session.';
  }

  async function ensureProductIdentity() {
    let id = await StorageManager.getIdentity();
    const name = (id && id.name && String(id.name).trim()) || '';
    const role = (id && id.role && String(id.role).trim()) || '';
    if (name && role) return;
    const prof = await StorageManager.getLinkedInProfile();
    const defName =
      (typeof REACHAI_DEFAULT_SENDER_NAME !== 'undefined' && String(REACHAI_DEFAULT_SENDER_NAME || '').trim()) ||
      (prof && prof.name && String(prof.name).trim()) ||
      'Member';
    const defRole =
      (typeof REACHAI_DEFAULT_SENDER_ROLE !== 'undefined' && String(REACHAI_DEFAULT_SENDER_ROLE || '').trim()) ||
      (prof && prof.email && String(prof.email).trim()) ||
      'Professional';
    await StorageManager.saveIdentity({
      name: name || defName,
      role: role || defRole
    });
  }

  function applyLinkedinSkipVisibility() {
    const req =
      typeof REACHAI_LINKEDIN_SIGNIN_REQUIRED !== 'undefined' && REACHAI_LINKEDIN_SIGNIN_REQUIRED;
    const en = typeof REACHAI_ENABLE_LINKEDIN_OAUTH !== 'undefined' && REACHAI_ENABLE_LINKEDIN_OAUTH;
    if (els.btnLinkedinSkip) els.btnLinkedinSkip.classList.toggle('hidden', !!(req && en));
  }

  /** When OAuth is handled by your API, hide developer “register this URL on LinkedIn” UI unless explicitly enabled for debugging. */
  function shouldShowLinkedInRedirectHelperUi() {
    const en = typeof REACHAI_ENABLE_LINKEDIN_OAUTH !== 'undefined' && REACHAI_ENABLE_LINKEDIN_OAUTH;
    if (!en) return false;
    const force =
      typeof REACHAI_SHOW_LINKEDIN_REDIRECT_HELPER !== 'undefined' && REACHAI_SHOW_LINKEDIN_REDIRECT_HELPER;
    if (force) return true;
    const via =
      typeof REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK !== 'undefined' && REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK;
    if (via) return false;
    return true;
  }

  function applyLinkedInRedirectHelperVisibility() {
    const box = document.getElementById('lw-li-redirect-box');
    if (box) box.classList.toggle('hidden', !shouldShowLinkedInRedirectHelperUi());
  }

  async function refreshLinkedinApiBanner() {
    const wrap = document.getElementById('lw-li-api-banner');
    const btn = document.getElementById('btn-li-open-setup');
    if (!wrap) return;
    const p = wrap.querySelector('.lw-li-api-banner__text');
    const sess = await StorageManager.getCloudSession();
    if (sess?.token) {
      wrap.classList.add('hidden');
      if (p) p.textContent = '';
      if (btn) btn.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    if (btn) btn.classList.remove('hidden');
    if (p) {
      const autoOn =
        typeof REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN !== 'undefined' && REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN;
      p.textContent = autoOn
        ? 'Could not reach your API automatically. Start the server, match activation code or extension secret in lib/reach-api-default.js with server .env, then tap “Connection help” or reload the extension.'
        : 'Set REACHAI_AUTO_ACTIVATE_FOR_LINKEDIN to true in lib/reach-api-default.js so the extension can authenticate with your backend.';
    }
  }

  function syncActivationCodeVisibility() {
    const useSecret = getReachaiExtensionSecret().length >= 16;
    if (els.activationCodeWrap) els.activationCodeWrap.classList.toggle('hidden', useSecret);
  }

  function refreshSafetyIndicator() {
    if (!els.safetyZone) return;
    const L = dailyLimitL();
    let g = parseInt(els.goal.value, 10);
    if (Number.isNaN(g)) g = L.RECOMMENDED;
    g = clampDailyLimit(g);
    els.safetyZone.innerText =
      `Your target: ${g}/${L.MAX} per day (${L.RECOMMENDED} recommended). Higher volume increases restriction risk.`;
  }

  async function populateSetupFromStorage() {
    const s = await StorageManager.getSettings();
    const identity = await StorageManager.getIdentity();
    if (els.name) els.name.value = (identity && identity.name) || '';
    if (els.role) els.role.value = (identity && identity.role) || '';
    const sess = await StorageManager.getCloudSession();
    if (sess && els.cloudBase) els.cloudBase.value = sess.baseUrl;
    else if (els.cloudBase && !els.cloudBase.value.trim()) {
      const fromConfig =
        typeof REACHAI_DEFAULT_API_BASE !== 'undefined' && REACHAI_DEFAULT_API_BASE
          ? String(REACHAI_DEFAULT_API_BASE).trim().replace(/\/$/, '')
          : '';
      const isProdProfile =
        typeof REACHAI_BUILD_PROFILE !== 'undefined' && REACHAI_BUILD_PROFILE === 'production';
      const d =
        fromConfig ||
        (isProdProfile ? '' : 'http://127.0.0.1:3847');
      els.cloudBase.value = d;
    }
    const aiStored = await chrome.storage.local.get('cloudAiApiBaseUrl');
    const aiOnly = (aiStored.cloudAiApiBaseUrl || '').trim().replace(/\/$/, '');
    if (els.aiCloudBase) {
      if (aiOnly) els.aiCloudBase.value = aiOnly;
      else if (
        typeof REACHAI_DEFAULT_AI_API_BASE !== 'undefined' &&
        String(REACHAI_DEFAULT_AI_API_BASE || '').trim()
      ) {
        els.aiCloudBase.value = String(REACHAI_DEFAULT_AI_API_BASE).trim().replace(/\/$/, '');
      } else {
        els.aiCloudBase.value = '';
      }
    }
    if (els.goal) {
      els.goal.value = s.goal;
      try {
        const L = DpBridge.DAILY_LINKEDIN_LIMIT;
        els.goal.max = String(L.MAX);
        els.goal.min = '1';
      } catch (_) {
        els.goal.max = '30';
        els.goal.min = '1';
      }
    }
    els.tone.value = s.tone || 'professional';
    if (els.mission) els.mission.value = s.mission || '';
    if (
      els.activationCode &&
      getReachaiExtensionSecret().length < 16 &&
      !els.activationCode.value.trim() &&
      typeof REACHAI_DEFAULT_ACTIVATION_CODE !== 'undefined' &&
      String(REACHAI_DEFAULT_ACTIVATION_CODE || '').trim()
    ) {
      els.activationCode.value = String(REACHAI_DEFAULT_ACTIVATION_CODE).trim();
    }
    refreshSafetyIndicator();
    syncActivationCodeVisibility();
    syncToneTilesFromSelect();
    void refreshSetupFileList();
    syncKbAiLimitsHints();
  }

  function syncToneTilesFromSelect() {
    const v = els.tone ? els.tone.value || 'professional' : 'professional';
    if (els.toneTilesSetup) {
      els.toneTilesSetup.querySelectorAll('.lw-tone-tile').forEach((b) => {
        b.classList.toggle('active', b.dataset.tone === v);
      });
    }
  }

  function syncToneSelectFromTilesSetup() {
    const active = els.toneTilesSetup && els.toneTilesSetup.querySelector('.lw-tone-tile.active');
    if (active && els.tone) els.tone.value = active.dataset.tone || 'professional';
  }

  function syncToneTilesTrainingFromSelect() {
    const v = els.toneTraining ? els.toneTraining.value || 'professional' : 'professional';
    if (els.toneTilesTraining) {
      els.toneTilesTraining.querySelectorAll('.lw-tone-tile').forEach((b) => {
        b.classList.toggle('active', b.dataset.tone === v);
      });
    }
  }

  function setKbSyncBadge(visible, label) {
    const b = document.getElementById('kb-sync-badge');
    if (!b) return;
    if (label) b.textContent = label;
    b.classList.toggle('hidden', !visible);
  }

  function paintDailyLimitBadge(n) {
    const badge = els.kbDailyLimitBadge;
    if (!badge) return;
    const L = dailyLimitL();
    const v = clampDailyLimit(n);
    const rec = v === L.RECOMMENDED ? ' · Recommended' : '';
    badge.textContent = `${v} / ${L.MAX} per day · ${DpBridge.dailyLinkedinRiskLabel(v)}${rec}`;
    badge.classList.remove('lw-daily-limit__badge--safe', 'lw-daily-limit__badge--mod', 'lw-daily-limit__badge--high');
    if (v <= L.SAFE_MAX) badge.classList.add('lw-daily-limit__badge--safe');
    else if (v <= L.MODERATE_MAX) badge.classList.add('lw-daily-limit__badge--mod');
    else badge.classList.add('lw-daily-limit__badge--high');
  }

  async function applyKbDailyLimitUi() {
    const slider = els.kbDailyLimitSlider;
    const hint = els.kbDailyLimitWebHint;
    const resetBtn = els.kbDailyLimitReset;
    if (!slider) return;
    const L = dailyLimitL();
    const settings = await StorageManager.getSettings();
    const wb = await StorageManager.getWebBridgeV1();
    const webLim =
      wb && wb.mongoOk !== false && wb.config && Number.isFinite(Number(wb.config.daily_linkedin_limit))
        ? clampDailyLimit(wb.config.daily_linkedin_limit)
        : null;
    const localLim = clampDailyLimit(settings.goal);
    const effective = webLim != null ? webLim : localLim;
    slider.max = String(L.MAX);
    slider.setAttribute('aria-valuemax', String(L.MAX));
    slider.min = '1';
    slider.setAttribute('aria-valuemin', '1');
    slider.value = String(effective);
    slider.disabled = webLim != null;
    if (hint) hint.classList.toggle('hidden', webLim == null);
    const elSafe = document.getElementById('kb-daily-legend-safe');
    if (elSafe) elSafe.textContent = `Safe (1–${L.SAFE_MAX})`;
    const elMod = document.getElementById('kb-daily-legend-mod');
    if (elMod) elMod.textContent = `Moderate (${L.SAFE_MAX + 1}–${L.MODERATE_MAX})`;
    const elHi = document.getElementById('kb-daily-legend-high');
    if (elHi) elHi.textContent = `High risk (${L.MODERATE_MAX + 1}–${L.MAX})`;
    const recLine = document.getElementById('kb-daily-limit-rec-line');
    if (recLine) {
      recLine.textContent = `Recommended: ${L.RECOMMENDED}/day · max ${L.MAX}/day — same scale as Daily Safety Limits in Command Center; this panel reads your saved limit when that tab syncs.`;
    }
    if (resetBtn) {
      resetBtn.textContent = `Reset to recommended (${L.RECOMMENDED})`;
      const locked = webLim != null;
      resetBtn.disabled = locked;
      resetBtn.title = locked
        ? 'Limit is synced from Command Center — change it there, then keep this tab open to refresh.'
        : `Set your local limit to ${L.RECOMMENDED}/day (recommended).`;
    }
    if (els.goal) {
      els.goal.max = String(L.MAX);
      els.goal.min = '1';
    }
    paintDailyLimitBadge(effective);
  }

  async function refreshSentLogBanner(profile) {
    const el = els.sentLogBanner;
    if (!el || !profile || !profile.profileUrl) {
      if (el) el.classList.add('hidden');
      return;
    }
    const m = await StorageManager.getDpSentLogMatch(normalizeSidepanelTabUrl(profile.profileUrl));
    if (m && m.webInstantly) {
      const iso = m.webMeta && m.webMeta.sentAtISO ? String(m.webMeta.sentAtISO) : '';
      el.textContent = `Already emailed via Command Center${iso ? ' · ' + iso : ''}`;
      el.title = m.webMeta && m.webMeta.campaignId ? `Campaign: ${m.webMeta.campaignId}` : '';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
      el.textContent = '';
      el.removeAttribute('title');
    }
  }

  async function syncToneUIFromWebBridge() {
    const wt = await StorageManager.getWebBridgeTone();
    if (!wt) return;
    if (els.tonePills) setActiveTab(els.tonePills, wt);
    updateGeneratorToneBadge(wt);
    if (els.toneTraining) els.toneTraining.value = wt;
    syncToneTilesTrainingFromSelect();
    if (els.tone) els.tone.value = wt;
    syncToneTilesFromSelect();
  }

  async function resolveUserOutreachTonePreference() {
    const wt = await StorageManager.getWebBridgeTone();
    if (wt) return { tone: wt, source: 'Command Center' };
    const settings = await StorageManager.getSettings();
    const t = String(settings.tone || 'professional').toLowerCase().trim();
    const tone = t === 'casual' || t === 'direct' || t === 'professional' ? t : 'professional';
    return { tone, source: 'Your setup' };
  }

  function syncReccoBadgeLabel() {
    const btn = els.reccoBadge;
    if (!btn) return;
    const label = btn.querySelector('.lw-ai-chip__label');
    if (label) label.textContent = reccoAnalysisExpanded ? 'Hide details' : 'AI Recommended';
    btn.setAttribute('aria-expanded', reccoAnalysisExpanded ? 'true' : 'false');
    btn.title = reccoAnalysisExpanded
      ? 'Hide full channel analysis'
      : 'Show why this channel and deeper analysis';
  }

  function syncReccoToneCompareStrip() {
    if (!els.reccoToneCompare || !els.reccoToneUser || !els.reccoToneAi) return;
    if (!lastRecommendationPayload || els.reccoToneCompare.classList.contains('hidden')) return;
    const cur = getActiveTone();
    els.reccoToneUser.textContent = formatToneWithEmoji(cur);
    const aiT = lastRecommendationPayload.aiRecommendedTone;
    const aiOk = aiT === 'professional' || aiT === 'casual' || aiT === 'direct';
    els.reccoToneAi.textContent = aiOk ? formatToneWithEmoji(aiT) : '—';
    if (els.btnReccoUseAiTone) {
      els.btnReccoUseAiTone.classList.toggle('hidden', !aiOk || cur === aiT);
    }
  }

  function toneMeta(t) {
    const k = String(t || 'professional').toLowerCase();
    if (k === 'casual') return { emoji: '☕', label: 'Casual' };
    if (k === 'direct') return { emoji: '⚡', label: 'Direct' };
    return { emoji: '💼', label: 'Professional' };
  }

  function formatToneWithEmoji(t) {
    const { emoji, label } = toneMeta(t);
    return `${emoji} ${label}`;
  }

  function updateGeneratorToneBadge(toneVal) {
    const el = document.getElementById('generator-tone-badge');
    if (!el) return;
    el.textContent = formatToneWithEmoji(toneVal);
  }

  async function updateHeaderStatus() {
    if (!els.headerApiStatus) return;
    const sess = await StorageManager.getCloudSession();
    const label = els.headerApiStatus.querySelector('.lw-status__text');
    if (sess && sess.token) {
      if (label) label.textContent = 'Connected';
      els.headerApiStatus.classList.remove('lw-status--off');
      els.headerApiStatus.classList.add('lw-status--on');
    } else {
      if (label) label.textContent = 'Not connected';
      els.headerApiStatus.classList.add('lw-status--off');
      els.headerApiStatus.classList.remove('lw-status--on');
    }
  }

  function updateStepDots(screenId) {
    const d1 = els.stepDot1;
    const d2 = els.stepDot2;
    if (!d1 || !d2) return;
    const phaseA =
      screenId === 'setup' ||
      screenId === 'linkedin' ||
      screenId === 'confirm' ||
      screenId === 'api-unavailable';
    d1.classList.toggle('active', phaseA);
    d2.classList.toggle('active', !phaseA);
  }

  /** Match final mock: hide tone + generate when AI message panel is showing with content. */
  function syncGeneratorDraftLayout() {
    const root = screens.generator;
    if (!root) return;
    const ed = els.editorContainer;
    const has =
      ed &&
      !ed.classList.contains('hidden') &&
      els.draftEditor &&
      String(els.draftEditor.value || '').trim().length > 0;
    root.classList.toggle('lw-generator--has-draft', !!has);
  }

  /** Populate setup UI, uploads, header — used after LinkedIn OAuth and when resuming Knowledge center (setup). */
  async function finalizePostLinkedinQuickSetupUI() {
    await populateSetupFromStorage();
    bindSetupUploadOnce();
    await refreshSetupFileList();
    await refreshLinkedInPanel();
    await updateHeaderStatus();
    const settings = await StorageManager.getSettings();
    setActiveTab(els.tonePills, settings.tone);
    updateGeneratorToneBadge(settings.tone);
    await syncToneUIFromWebBridge();
    await updateSessionCounter();
    await applyPostLinkedinSetupUi();
  }

  /** If user closed the panel mid Knowledge center (setup), reopen on the same screen. */
  async function resumePostLinkedinQuickSetupIfPending() {
    if (!(await StorageManager.getPostLinkedinSetupActive())) return false;
    await finalizePostLinkedinQuickSetupUI();
    showScreen('setup');
    return true;
  }

  async function init() {
    wireCommandCenterLinks();
    const linkedinEnabled =
      typeof REACHAI_ENABLE_LINKEDIN_OAUTH !== 'undefined' && REACHAI_ENABLE_LINKEDIN_OAUTH;

    await ensureApiSessionQuietly();
    await updateHeaderStatus();

    const sess = await StorageManager.getCloudSession();
    if (!sess?.token) {
      await refreshApiUnavailablePanel();
      showScreen('api-unavailable');
      return;
    }

    const needLi = linkedinEnabled && (await needsLinkedinConnectPrompt());
    if (needLi) {
      await refreshLinkedInPanel();
      await refreshLinkedinContinueLabel();
      void updateLinkedInRedirectForLinkedInUi();
      applyLinkedinSkipVisibility();
      showScreen('linkedin');
      return;
    }

    await ensureProductIdentity();
    if (await resumePostLinkedinQuickSetupIfPending()) return;

    const settings = await StorageManager.getSettings();
    setActiveTab(els.tonePills, settings.tone);
    updateGeneratorToneBadge(settings.tone);
    await syncToneUIFromWebBridge();
    await updateSessionCounter();
    syncKbAiLimitsHints();
    showScreen('generator');
    void scanProfile({ autoDraftAfterAnalysis: true });
  }

  let setupUploadBound = false;
  function bindSetupUploadOnce() {
    if (setupUploadBound || !els.uploadZoneSetup || !els.fileInputSetup) return;
    setupUploadBound = true;
    els.uploadZoneSetup.addEventListener('click', () => els.fileInputSetup.click());
    els.uploadZoneSetup.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.uploadZoneSetup.classList.add('dragover');
    });
    els.uploadZoneSetup.addEventListener('dragleave', () => els.uploadZoneSetup.classList.remove('dragover'));
    els.uploadZoneSetup.addEventListener('drop', (e) => {
      e.preventDefault();
      els.uploadZoneSetup.classList.remove('dragover');
      if (e.dataTransfer.files.length) void handleFilesSetup(e.dataTransfer.files);
    });
    els.fileInputSetup.addEventListener('change', () => void handleFilesSetup(els.fileInputSetup.files));
  }

  async function refreshSetupFileList() {
    if (!els.fileListSetup) return;
    const ctx = await StorageManager.getTrainingContext();
    renderFileListInto(
      els.fileListSetup,
      ctx.files || [],
      async () => {
        await refreshSetupFileList();
      },
      { showAiExcerpt: true }
    );
  }

  async function handleFilesSetup(files) {
    if (els.uploadZoneStatusSetup) els.uploadZoneStatusSetup.textContent = 'Extracting text…';
    for (const file of files) {
      const val = FileParser.validate(file);
      if (!val.valid) {
        alert(val.error);
        continue;
      }
      try {
        const parsed = await FileParser.parse(file);
        await StorageManager.addTrainingFile(parsed);
      } catch (err) {
        alert(`Failed to parse ${file.name}: ` + err.message);
      }
    }
    if (els.uploadZoneStatusSetup) els.uploadZoneStatusSetup.textContent = 'Upload PDF or Doc';
    await refreshSetupFileList();
  }

  async function applyPostLinkedinSetupUi() {
    const root = screens.setup;
    if (!root) return;
    const post = await StorageManager.getPostLinkedinSetupActive();
    root.classList.toggle('lw-setup--post-linkedin', post);
    const introD = document.getElementById('lw-setup-intro-default');
    const introP = document.getElementById('lw-setup-intro-post-li');
    if (introD) introD.classList.toggle('hidden', post);
    if (introP) introP.classList.toggle('hidden', !post);
    const signOut = document.getElementById('btn-signout-linkedin-setup');
    if (signOut) signOut.classList.toggle('hidden', !post);
    const badge = document.getElementById('setup-sync-badge');
    if (badge && post) badge.classList.remove('hidden');
    const d1 = els.stepDot1;
    const d2 = els.stepDot2;
    if (d1 && d2 && post) {
      d1.classList.remove('active');
      d2.classList.add('active');
    }
  }

  function syncKbAiLimitsHints() {
    const L = StorageManager.KNOWLEDGE_AI_LIMITS;
    if (!L) return;
    const mb = (L.MAX_FILE_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
    const msg = `Drafts send mission (first ${L.MAX_MISSION_CHARS.toLocaleString()} chars), each reference file (first ${L.MAX_FILE_EXCERPT_CHARS.toLocaleString()} chars of extracted text), additional notes (${L.MAX_NOTES_CHARS.toLocaleString()}), and Command Center synced context (${L.MAX_WEB_BRIDGE_CONTEXT_CHARS.toLocaleString()}) to your AI server with the LinkedIn profile. Reference uploads: up to ${mb}MB per file.`;
    ['kb-ai-limits-hint-setup', 'kb-ai-limits-hint-training'].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.textContent = msg;
    });
  }

  function showScreen(screenId) {
    Object.keys(screens).forEach((k) => {
      const st = screens[k];
      if (st) st.classList.add('hidden');
    });
    const s = screens[screenId];
    if (!s) {
      document.body.classList.remove('lw-body--linkedin-connect');
      return;
    }
    document.body.classList.toggle(
      'lw-body--linkedin-connect',
      screenId === 'linkedin' || screenId === 'api-unavailable'
    );
    s.classList.remove('hidden');
    if (screenId === 'linkedin') {
      void updateLinkedInRedirectForLinkedInUi();
      void refreshLinkedinContinueLabel();
      void refreshLinkedinApiBanner();
      applyLinkedinSkipVisibility();
    }
    if (screenId === 'api-unavailable') {
      void refreshApiUnavailablePanel();
    }
    if (els.btnLogOut) {
      const showLo = screenId === 'generator' || screenId === 'training';
      els.btnLogOut.classList.toggle('hidden', !showLo);
    }
    updateStepDots(screenId);
    if (screenId === 'setup') void applyPostLinkedinSetupUi();
    if (screenId === 'generator') {
      syncGeneratorDraftLayout();
      void pullLatestSessionProfileIntoUI();
      startGeneratorProfileWatch();
    } else {
      stopGeneratorProfileWatch();
    }
    void updateHeaderStatus();
  }

  // ═══════════════════════════════════════
  //  SETUP & CONFIRMATION
  // ═══════════════════════════════════════

  els.goal.addEventListener('input', refreshSafetyIndicator);
  els.goal.addEventListener('blur', () => {
    const v = clampDailyLimit(parseInt(els.goal.value, 10));
    els.goal.value = String(v);
    refreshSafetyIndicator();
  });

  async function mergeIdentityFromLinkedInProfile() {
    const prof = await StorageManager.getLinkedInProfile();
    const id = await StorageManager.getIdentity();
    const fromLiName = (prof && prof.name && String(prof.name).trim()) || '';
    const fromLiEmail = (prof && prof.email && String(prof.email).trim()) || '';
    const name = ((id && id.name) || '').trim() || fromLiName || 'You';
    const role = ((id && id.role) || '').trim() || fromLiEmail || 'LinkedIn';
    await StorageManager.saveIdentity({ name, role });
  }

  /** After setup save + CONFIRM_IDENTITY: skip the old “Almost there” screen and go to outreach. */
  async function finishSetupToOutreachAfterIdentityConfirm(syncSetupBadge) {
    await updateHeaderStatus();
    if (syncSetupBadge) {
      const badge = document.getElementById('setup-sync-badge');
      if (badge) badge.classList.remove('hidden');
    }
    if (await needsLinkedinConnectPrompt()) {
      showScreen('linkedin');
    } else {
      showScreen('generator');
      void scanProfile({ autoDraftAfterAnalysis: true });
    }
  }

  els.btnSaveSetup.addEventListener('click', async () => {
    syncToneSelectFromTilesSetup();
    const name = els.name.value.trim();
    const role = els.role.value.trim();
    let goal = parseInt(els.goal.value, 10);
    if (Number.isNaN(goal)) goal = dailyLimitL().RECOMMENDED;
    goal = clampDailyLimit(goal);
    const tone = els.tone.value || 'professional';
    const mission = (els.mission && els.mission.value) ? els.mission.value.trim() : '';

    if (!name || !role) {
      alert('Please enter your name and role.');
      return;
    }

    const postLi = await StorageManager.getPostLinkedinSetupActive();
    const already = await StorageManager.isSetupComplete();
    if (postLi && already) {
      els.btnSaveSetup.disabled = true;
      if (els.btnSaveSetupLabel) els.btnSaveSetupLabel.textContent = 'Saving…';
      try {
        await StorageManager.saveSettings({ goal, tone, mission });
        const resp = await sendBackground({
          action: 'CONFIRM_IDENTITY',
          payload: { name, headline: role }
        });
        if (resp && resp.success) {
          await StorageManager.setPostLinkedinSetupActive(false);
          await finishSetupToOutreachAfterIdentityConfirm(false);
        } else {
          throw new Error((resp && resp.error) || 'AI confirm failed.');
        }
      } catch (e) {
        console.error(e);
        alert(e.message || 'Save failed.');
      } finally {
        els.btnSaveSetup.disabled = false;
        if (els.btnSaveSetupLabel) els.btnSaveSetupLabel.textContent = 'Continue to Outreach →';
      }
      return;
    }

    const base = (els.cloudBase && els.cloudBase.value.trim()) || '';
    const aiRaw = (els.aiCloudBase && els.aiCloudBase.value.trim()) || '';
    if (aiRaw && !/^https?:\/\//i.test(aiRaw)) {
      alert('Gemini / AI API base URL must start with http:// or https://.');
      return;
    }
    const extSecret = getReachaiExtensionSecret();
    const code = (els.activationCode && els.activationCode.value.trim()) || '';
    if (!base) {
      alert('Enter your Auth API base URL.');
      return;
    }
    if (!/^https?:\/\//i.test(base)) {
      alert('Auth API base URL must start with http:// or https://.');
      return;
    }
    if (extSecret.length < 16 && !code) {
      alert(
        'Add the activation code (default LINKWELL-CHROME when server .env matches), or set a 16+ character REACHAI_EXTENSION_SECRET in server .env and the same in lib/reach-api-default.js.'
      );
      return;
    }

    els.btnSaveSetup.disabled = true;
    if (els.btnSaveSetupLabel) els.btnSaveSetupLabel.textContent = 'Connecting…';

    try {
      const baseNorm = els.cloudBase.value.trim().replace(/\/$/, '');
      const aiNorm = aiRaw.replace(/\/$/, '');
      const codeTrim = els.activationCode ? els.activationCode.value.trim() : '';
      const act = await sendBackground({
        action: 'ACTIVATE_CLOUD',
        payload: {
          baseUrl: baseNorm,
          aiBaseUrl: aiNorm || '',
          code: codeTrim,
          extensionSecret: extSecret
        }
      });
      if (!act || !act.success) throw new Error(act && act.error ? act.error : 'API activation failed');

      await StorageManager.saveIdentity({ name, role });
      await StorageManager.saveSettings({ goal, tone, mission });

      const resp = await sendBackground({
        action: 'CONFIRM_IDENTITY',
        payload: { name, headline: role }
      });
      if (resp && resp.success) {
        await StorageManager.setPostLinkedinSetupActive(false);
        await finishSetupToOutreachAfterIdentityConfirm(true);
      } else {
        throw new Error((resp && resp.error) || 'AI confirm failed. Check API URL, activation code, and server logs, then reload the extension.');
      }
    } catch (e) {
      console.error(e);
      lastApiActivateError = String((e && e.message) || e || 'Activation failed').trim();
      alert(e.message || 'Setup failed. Check your API server is running and try again.');
      await refreshApiUnavailablePanel();
      showScreen('api-unavailable');
    } finally {
      els.btnSaveSetup.disabled = false;
      if (els.btnSaveSetupLabel) els.btnSaveSetupLabel.textContent = 'Continue to Outreach →';
    }
  });

  els.btnConfirmYes.addEventListener('click', async () => {
    if (await needsLinkedinConnectPrompt()) {
      showScreen('linkedin');
    } else {
      showScreen('generator');
      void scanProfile({ autoDraftAfterAnalysis: true });
    }
  });

  els.btnConfirmEdit.addEventListener('click', async () => {
    await openTrainingScreen();
  });

  // ═══════════════════════════════════════
  //  TRAINING CONTEXT
  // ═══════════════════════════════════════

  if (els.btnLogOut) {
    els.btnLogOut.addEventListener('click', async () => {
      if (
        !confirm(
          'Log out of LynkWell AI? You will need your API activation (and LinkedIn again if your build requires it). Your knowledge base files and mission stay on this device.'
        )
      ) {
        return;
      }
      await StorageManager.logOutExtension();
      currentProfile = null;
      currentDraft = '';
      draftFeedbackId = null;
      lastRecommendationPayload = null;
      lastAutoDraftedProfileNorm = '';
      if (els.draftEditor) els.draftEditor.value = '';
      if (els.subjectEditor) els.subjectEditor.value = '';
      if (els.editorContainer) els.editorContainer.classList.add('hidden');
      syncGeneratorDraftLayout();
      clearRecommendationUI();
      stopGeneratorProfileWatch();
      await updateHeaderStatus();
      await refreshLinkedInPanel();
      if (els.btnDisconnectCloud) els.btnDisconnectCloud.classList.add('hidden');
      await init();
    });
  }

  els.btnBackTraining.addEventListener('click', () => {
    showScreen('generator');
    void scanProfile();
  });
  els.btnBackTraining.setAttribute('aria-label', 'Back to outreach');

  let missionTimeoutId;
  if (els.missionTraining) {
    els.missionTraining.addEventListener('input', () => {
      clearTimeout(missionTimeoutId);
      missionTimeoutId = setTimeout(async () => {
        await StorageManager.saveSettings({ mission: els.missionTraining.value.trim() });
        setKbSyncBadge(true, 'Synced');
      }, 600);
    });
  }

  if (els.toneTilesTraining) {
    els.toneTilesTraining.addEventListener('click', (e) => {
      const tile = e.target.closest('.lw-tone-tile');
      if (!tile || !tile.dataset.tone) return;
      els.toneTilesTraining.querySelectorAll('.lw-tone-tile').forEach((t) => t.classList.remove('active'));
      tile.classList.add('active');
      if (els.toneTraining) els.toneTraining.value = tile.dataset.tone || 'professional';
      void (async () => {
        const tone = els.toneTraining ? els.toneTraining.value : 'professional';
        await StorageManager.saveSettings({ tone });
        if (els.tone) els.tone.value = tone;
        syncToneTilesFromSelect();
        updateGeneratorToneBadge(tone);
        setKbSyncBadge(true, 'Synced');
      })();
    });
  }

  if (els.kbDailyLimitSlider) {
    els.kbDailyLimitSlider.addEventListener('input', () => {
      if (els.kbDailyLimitSlider.disabled) return;
      const v = clampDailyLimit(parseInt(els.kbDailyLimitSlider.value, 10));
      paintDailyLimitBadge(v);
    });
    els.kbDailyLimitSlider.addEventListener('change', async () => {
      if (els.kbDailyLimitSlider.disabled) return;
      const v = clampDailyLimit(parseInt(els.kbDailyLimitSlider.value, 10));
      await StorageManager.saveSettings({ goal: v });
      setKbSyncBadge(true, 'Synced');
      await updateSessionCounter();
    });
  }

  if (els.kbDailyLimitReset) {
    els.kbDailyLimitReset.addEventListener('click', async () => {
      if (els.kbDailyLimitReset.disabled) return;
      const v = dailyLimitL().RECOMMENDED;
      if (els.kbDailyLimitSlider && !els.kbDailyLimitSlider.disabled) {
        els.kbDailyLimitSlider.value = String(v);
      }
      paintDailyLimitBadge(v);
      await StorageManager.saveSettings({ goal: v });
      setKbSyncBadge(true, 'Synced');
      await updateSessionCounter();
    });
  }

  if (els.btnEnhanceMissionTraining) {
    els.btnEnhanceMissionTraining.addEventListener('click', async () => {
      const t = els.missionTraining && els.missionTraining.value.trim();
      if (!t) return alert('Add your context first.');
      els.btnEnhanceMissionTraining.disabled = true;
      const r = await sendBackground({ action: 'ENHANCE_MISSION', payload: { text: t } });
      els.btnEnhanceMissionTraining.disabled = false;
      if (r && r.success && r.text) {
        if (els.missionTraining) els.missionTraining.value = String(r.text).trim();
        await StorageManager.saveSettings({ mission: els.missionTraining.value.trim() });
        setKbSyncBadge(true, 'Synced');
      } else {
        alert((r && r.error) || 'Enhance failed. Ensure the API server is running and Gemini is configured in server/.env.');
      }
    });
  }

  function linkedinClientIdConfigured() {
    return typeof LINKEDIN_CLIENT_ID !== 'undefined' && String(LINKEDIN_CLIENT_ID || '').trim().length > 0;
  }

  function syncLinkedInRedirectUrlField() {
    const inp = document.getElementById('input-li-redirect-url');
    if (!inp || !chrome.identity || !chrome.identity.getRedirectURL) return;
    try {
      inp.value = chrome.identity.getRedirectURL('linkedin');
    } catch {
      inp.value = '';
    }
  }

  async function updateLinkedInRedirectForLinkedInUi() {
    if (!shouldShowLinkedInRedirectHelperUi()) return;
    const sub = document.getElementById('lw-li-redirect-sub');
    const inp = document.getElementById('input-li-redirect-url');
    if (!inp) return;
    const via =
      typeof REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK !== 'undefined' && REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK;
    if (sub) {
      sub.textContent = via
        ? 'This URL is on your LynkWell AI API server. LinkedIn redirects the browser here after approval (set REACHAI_PUBLIC_URL on the server to match).'
        : 'This URL is the Chrome extension callback (*.chromiumapp.org).';
    }
    if (via) {
      const base =
        typeof REACHAI_DEFAULT_API_BASE !== 'undefined' && REACHAI_DEFAULT_API_BASE
          ? String(REACHAI_DEFAULT_API_BASE).trim().replace(/\/$/, '')
          : '';
      if (!base) {
        inp.value = '';
        return;
      }
      try {
        const r = await fetch(`${base}/api/v1/oauth/linkedin/extension-flow/meta`);
        const j = await r.json().catch(() => ({}));
        inp.value = j.callback_url || '';
      } catch {
        inp.value = '';
      }
    } else {
      syncLinkedInRedirectUrlField();
    }
  }

  /** Show the LinkedIn connect screen until the member signs in or taps “Continue without LinkedIn”. */
  async function needsLinkedinConnectPrompt() {
    const li = await StorageManager.getLinkedInOAuth();
    if (li && li.accessToken) return false;
    if (await StorageManager.getLinkedInConnectSkipped()) return false;
    return true;
  }

  async function refreshLinkedinContinueLabel() {
    const done = await StorageManager.isSetupComplete();
    const sess = await StorageManager.getCloudSession();
    const lead = document.getElementById('lw-li-lead');
    if (lead) {
      if (done) {
        lead.textContent = 'Sign in to enable AI-powered outreach directly from LinkedIn profiles.';
      } else if (sess?.token) {
        lead.textContent = 'Sign in with LinkedIn to personalize outreach on this device.';
      } else {
        lead.textContent =
          'Sign in with LinkedIn after LynkWell AI connects (use “Connection help” if sign-in is not available).';
      }
    }
    if (!els.btnLinkedinSkip) return;
    els.btnLinkedinSkip.textContent = done
      ? 'Continue without LinkedIn'
      : 'Skip for now';
  }

  function applyLinkedinFeatureGate() {
    const card = document.getElementById('linkedin-oauth-card');
    if (card) card.classList.remove('hidden');
  }

  async function refreshLinkedInPanel() {
    document.querySelectorAll('.js-linkedin-connect').forEach((btn) => {
      btn.disabled = false;
    });
  }

  async function loadTrainingData() {
    const ctx = await StorageManager.getTrainingContext();
    const settings = await StorageManager.getSettings();
    if (els.missionTraining) els.missionTraining.value = settings.mission || '';
    if (els.toneTraining) els.toneTraining.value = settings.tone || 'professional';
    syncToneTilesTrainingFromSelect();
    const hasMission = !!(settings.mission && String(settings.mission).trim());
    const nFiles = (ctx.files && ctx.files.length) || 0;
    setKbSyncBadge(hasMission || nFiles > 0, 'Synced');
    renderFileList(ctx.files || []);
    syncKbAiLimitsHints();
    const sess = await StorageManager.getCloudSession();
    if (els.btnDisconnectCloud) els.btnDisconnectCloud.classList.toggle('hidden', !sess);
    await refreshLinkedInPanel();
    await applyKbDailyLimitUi();
    await syncToneUIFromWebBridge();
  }

  async function openTrainingScreen() {
    await loadTrainingData();
    showScreen('training');
  }

  document.querySelectorAll('.js-linkedin-connect').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!linkedinClientIdConfigured()) {
        alert(
          'LinkedIn sign-in needs your app Client ID. Set LINKEDIN_CLIENT_ID in lib/reach-api-default.js to match your LinkedIn Developer app, then reload the extension.'
        );
        return;
      }
      const viaLiApi =
        typeof REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK !== 'undefined' && REACHAI_LINKEDIN_LOGIN_VIA_API_CALLBACK;
      if (!viaLiApi) {
        await ensureApiSessionQuietly();
        await updateHeaderStatus();
        const sess = await StorageManager.getCloudSession();
        if (!sess?.token) {
          await refreshLinkedinApiBanner();
          alert(
            'No API session yet. Start your backend, align activation code or extension secret in lib/reach-api-default.js with server .env, then tap “Connection help” or Retry on the connection screen.'
          );
          return;
        }
      }
      btn.disabled = true;
      try {
        const r = await sendBackground({ action: 'LINKEDIN_OAUTH_START' });
        if (r && r.success) {
          await StorageManager.setLinkedInConnectSkipped(false);
          await mergeIdentityFromLinkedInProfile();
          await ensureProductIdentity();
          await StorageManager.setPostLinkedinSetupActive(true);
          await finalizePostLinkedinQuickSetupUI();
          showScreen('setup');
        } else {
          alert(r && r.error ? r.error : 'LinkedIn sign-in failed.');
        }
      } catch (e) {
        alert(e.message || String(e));
      } finally {
        document.querySelectorAll('.js-linkedin-connect').forEach((b) => {
          b.disabled = false;
        });
      }
    });
  });

  if (els.btnDisconnectCloud) {
    els.btnDisconnectCloud.addEventListener('click', async () => {
      if (!confirm('Disconnect from your API server? You will need your activation code again to use AI.')) return;
      await StorageManager.clearCloudSession();
      lastApiActivateError = 'Disconnected from API.';
      await populateSetupFromStorage();
      await refreshApiUnavailablePanel();
      showScreen('api-unavailable');
      alert('Disconnected from your API. Fix reach-api-default.js / server .env, then use Retry connection.');
    });
  }

  function renderFileListInto(listEl, files, onRemoved, opts) {
    if (!listEl) return;
    const showAiExcerpt = !!(opts && opts.showAiExcerpt);
    const excerptCap = StorageManager.KNOWLEDGE_AI_LIMITS?.MAX_FILE_EXCERPT_CHARS ?? 10000;
    listEl.innerHTML = '';
    files.forEach((file, index) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'ellipsis';
      span.style.flex = '1 1 auto';
      span.style.minWidth = '0';
      span.textContent = file.name || 'file';
      span.title = file.name || 'file';
      const btn = document.createElement('button');
      btn.setAttribute('data-index', String(index));
      btn.title = 'Remove file';
      btn.textContent = '✕';
      btn.style.flexShrink = '0';
      li.appendChild(span);
      li.appendChild(btn);
      if (showAiExcerpt) {
        const len = String(file.content || '').length;
        const sm = document.createElement('span');
        sm.className = 'lw-file-chars-hint';
        sm.textContent =
          len > excerptCap
            ? `${len.toLocaleString()} chars extracted · AI uses first ${excerptCap.toLocaleString()}`
            : len > 0
              ? `${len.toLocaleString()} chars in knowledge base`
              : '';
        if (sm.textContent) li.appendChild(sm);
      }
      listEl.appendChild(li);
    });

    listEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const index = parseInt(e.target.getAttribute('data-index'), 10);
        await StorageManager.removeTrainingFile(index);
        await onRemoved();
      });
    });
  }

  function renderFileList(files) {
    renderFileListInto(els.fileList, files, () => loadTrainingData(), { showAiExcerpt: true });
  }

  // File upload (training screen)
  if (els.uploadZone && els.fileInput) {
    els.uploadZone.addEventListener('click', () => els.fileInput.click());
    els.uploadZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.fileInput.click();
      }
    });
    els.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.uploadZone.classList.add('dragover');
    });
    els.uploadZone.addEventListener('dragleave', () => els.uploadZone.classList.remove('dragover'));
    els.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
    els.fileInput.addEventListener('change', () => handleFiles(els.fileInput.files));
  }

  async function handleFiles(files) {
    if (els.uploadZoneStatus) els.uploadZoneStatus.textContent = 'Extracting text…';
    for (const file of files) {
      const val = FileParser.validate(file);
      if (!val.valid) { alert(val.error); continue; }
      try {
        const parsed = await FileParser.parse(file);
        await StorageManager.addTrainingFile(parsed);
      } catch (err) {
        alert(`Failed to parse ${file.name}: ` + err.message);
      }
    }
    if (els.uploadZoneStatus) els.uploadZoneStatus.textContent = 'Upload PDF or Doc';
    setKbSyncBadge(true, 'Synced');
    loadTrainingData();
  }

  if (els.btnClearFeedback) {
    els.btnClearFeedback.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear AI feedback history?')) {
        await StorageManager.clearFeedback();
        alert('Feedback history cleared.');
      }
    });
  }


  // ═══════════════════════════════════════
  //  GENERATOR / PROFILE SCRAPING
  // ═══════════════════════════════════════

  function debounceTabProfileSwitch(fn, ms) {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => fn(), ms);
    };
  }

  const scheduleLiveRecommendAfterProfileSnapshot = debounceTabProfileSwitch(() => {
    if (!currentProfile || screens.generator?.classList.contains('hidden')) return;
    void getRecommendation(currentProfile, { refreshing: true });
  }, 380);

  function normalizeSidepanelTabUrl(u) {
    if (!u) return '';
    try {
      const x = new URL(u);
      return `${x.origin}${x.pathname}`.replace(/\/$/, '');
    } catch {
      return String(u).split('?')[0].replace(/\/$/, '');
    }
  }

  /** Local send history only (for AI prompts). No UI banner. */
  async function syncOutreachStateFromProfile(profile) {
    if (!profile || !profile.profileUrl) {
      currentPriorSentAt = null;
      currentOutreachMode = 'intro';
      return;
    }
    const norm = normalizeSidepanelTabUrl(profile.profileUrl);
    const match = await StorageManager.getDpSentLogMatch(norm);
    currentPriorSentAt = match ? match.lastSentAt : null;
    currentOutreachMode = match ? 'bridge' : 'intro';
    void refreshSentLogBanner(profile);
  }

  async function applyLiveProfileSnapshot(rec) {
    if (!rec || !rec.data) return;
    const tab = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
    if (!tab?.url || !tab.url.includes('linkedin.com/in/')) return;
    const tabNorm = normalizeSidepanelTabUrl(tab.url);
    const snapNorm = normalizeSidepanelTabUrl(rec.url || '');
    if (!snapNorm || snapNorm !== tabNorm) {
      if (
        snapNorm &&
        tabNorm.includes('linkedin.com/in/') &&
        screens.generator &&
        !screens.generator.classList.contains('hidden')
      ) {
        if (els.targetName) els.targetName.textContent = 'Waiting for profile data…';
        if (els.targetHeadline) {
          els.targetHeadline.textContent =
            'The saved snapshot is still for another /in/… URL. It should update as soon as the tab catches up.';
        }
      }
      return;
    }

    if (rec.stale) {
      if (screens.generator?.classList.contains('hidden')) return;
      if (els.targetName) els.targetName.textContent = 'Syncing profile…';
      if (els.targetHeadline) {
        els.targetHeadline.textContent = 'You moved to another member — pulling from the LinkedIn tab now.';
      }
      void scanProfile({ autoDraftAfterAnalysis: true });
      return;
    }

    currentProfile = rec.data;
    if (screens.generator?.classList.contains('hidden')) return;
    renderProfile(currentProfile);
    void syncOutreachStateFromProfile(currentProfile);
    scheduleLiveRecommendAfterProfileSnapshot();
  }

  /** Apply latest content-script snapshot without clearing the card (no “Scanning…” flash). */
  async function pullLatestSessionProfileIntoUI() {
    if (!screens.generator || screens.generator.classList.contains('hidden')) return;
    try {
      const snap = await chrome.storage.session.get('reachai_profile_v1');
      const rec = snap.reachai_profile_v1;
      if (rec && rec.data) await applyLiveProfileSnapshot(rec);
    } catch (_) {
      /* ignore */
    }
  }

  let generatorProfileWatchId = null;
  function stopGeneratorProfileWatch() {
    if (generatorProfileWatchId != null) {
      clearInterval(generatorProfileWatchId);
      generatorProfileWatchId = null;
    }
  }

  /** While Outreach is visible, periodically merge session storage so the card tracks the tab without manual refresh. */
  function startGeneratorProfileWatch() {
    stopGeneratorProfileWatch();
    generatorProfileWatchId = setInterval(() => {
      try {
        if (!screens.generator || screens.generator.classList.contains('hidden')) {
          stopGeneratorProfileWatch();
          return;
        }
        void pullLatestSessionProfileIntoUI();
      } catch (_) {
        /* ignore */
      }
    }, 1000);
  }

  function onSidepanelLinkedInTabUrlChanged(newUrl) {
    if (!screens.generator || screens.generator.classList.contains('hidden')) return;
    const nu = normalizeSidepanelTabUrl(newUrl || '');
    const cu = currentProfile ? normalizeSidepanelTabUrl(currentProfile.profileUrl || '') : '';
    if (nu && cu && nu !== cu) {
      if (els.targetName) els.targetName.textContent = 'Switching profile…';
      if (els.targetHeadline) {
        els.targetHeadline.textContent = 'You changed the /in/… URL — capturing this tab now.';
      }
    }
    void scanProfile({ autoDraftAfterAnalysis: true });
  }

  try {
    chrome.storage.session.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      if (changes.reachai_profile_v1 && changes.reachai_profile_v1.newValue) {
        void applyLiveProfileSnapshot(changes.reachai_profile_v1.newValue);
      }
      const urlCh = changes.reachai_tab_profile_url;
      if (urlCh && urlCh.newValue !== urlCh.oldValue) {
        onSidepanelLinkedInTabUrlChanged(urlCh.newValue);
      }
    });
  } catch (_) {
    /* ignore */
  }

  let focusProfileSyncTimer = null;
  window.addEventListener('focus', () => {
    if (!screens.generator || screens.generator.classList.contains('hidden')) return;
    clearTimeout(focusProfileSyncTimer);
    focusProfileSyncTimer = setTimeout(() => {
      void pullLatestSessionProfileIntoUI();
      void scanProfile({ autoDraftAfterAnalysis: false, preserveRecommendation: true });
    }, 180);
  });

  function setRecommendationLoading(on, message) {
    const wrap = els.reccoLoading || document.getElementById('recco-loading');
    const txt = els.reccoLoadingText || document.getElementById('recco-loading-text');
    const block = document.querySelector('.lw-channel-block');
    if (!wrap) return;
    if (on) {
      if (txt) txt.textContent = message || 'Getting AI channel recommendation…';
    } else if (txt) {
      txt.textContent = 'Analyzing profile for the best channel…';
    }
    wrap.classList.toggle('hidden', !on);
    if (block) block.classList.toggle('lw-channel-block--loading', !!on);
  }

  function clearRecommendationUI() {
    setRecommendationLoading(false);
    reccoAnalysisExpanded = false;
    syncReccoBadgeLabel();
    if (els.reccoBadge) els.reccoBadge.classList.add('hidden');
    if (els.reccoToneCompare) els.reccoToneCompare.classList.add('hidden');
    if (els.btnReccoUseAiTone) els.btnReccoUseAiTone.classList.add('hidden');
    if (els.reccoAgentPick) {
      els.reccoAgentPick.textContent = '';
      els.reccoAgentPick.classList.add('hidden');
    }
    if (els.reccoReason) {
      els.reccoReason.classList.add('hidden');
      els.reccoReason.textContent = '';
    }
    if (els.reccoDeep) els.reccoDeep.classList.add('hidden');
    if (els.reccoAnalysis) els.reccoAnalysis.textContent = '';
    if (els.reccoToneLine) {
      els.reccoToneLine.textContent = '';
      els.reccoToneLine.classList.add('hidden');
    }
    if (els.reccoPlans) {
      els.reccoPlans.innerHTML = '';
      els.reccoPlans.classList.add('hidden');
    }
    if (els.channelTabs) {
      els.channelTabs.querySelectorAll('.lw-channel-tile__best').forEach((b) => b.classList.add('hidden'));
    }
  }

  async function scanProfile(opts = {}) {
    const autoDraftAfterAnalysis = !!opts.autoDraftAfterAnalysis;
    const preserveRecommendation = !!opts.preserveRecommendation;
    if (!els.targetName || !els.channelTabs) return;

    const tab = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });

    const onProfilePath = !!(tab && tab.url && tab.url.includes('linkedin.com/in/'));
    const tabNorm = onProfilePath ? normalizeSidepanelTabUrl(tab.url) : '';
    const prevNorm = currentProfile ? normalizeSidepanelTabUrl(currentProfile.profileUrl || '') : '';
    const sameProfile = !!(tabNorm && prevNorm && tabNorm === prevNorm);
    const keepRecco = preserveRecommendation && sameProfile && onProfilePath;

    if (!keepRecco) {
      clearRecommendationUI();
    }

    els.targetName.innerText = 'Scanning profile…';
    if (els.targetHeadline) els.targetHeadline.innerText = '';
    if (els.targetAvatarImg) {
      els.targetAvatarImg.onload = null;
      els.targetAvatarImg.onerror = null;
      els.targetAvatarImg.removeAttribute('src');
      els.targetAvatarImg.alt = '';
      els.targetAvatarImg.classList.add('hidden');
    }
    if (els.targetAvatar) {
      els.targetAvatar.classList.remove('hidden');
      els.targetAvatar.textContent = '?';
    }

    if (!tab || !tab.url || !tab.url.includes('linkedin.com/in/')) {
      const u = tab?.url || '';
      const low = u.toLowerCase();
      if (u.includes('linkedin.com/messaging')) {
        els.targetName.innerText = 'Wrong tab for capture';
        if (els.targetHeadline) {
          els.targetHeadline.innerText =
            'DMs use /messaging/, but LynkWell AI reads the full profile from a /in/… URL. Open that member’s profile in this tab; the panel will sync automatically.';
        }
      } else if (low.includes('linkedin.com/company/')) {
        els.targetName.innerText = 'Company page — not a person';
        if (els.targetHeadline) {
          els.targetHeadline.innerText =
            'You’re on a company or organization URL (/company/…). LynkWell AI only reads a member’s profile from a personal URL like linkedin.com/in/firstname-lastname. Open their profile from search or “View profile.”';
        }
      } else if (low.includes('linkedin.com/school/')) {
        els.targetName.innerText = 'School page — not a person';
        if (els.targetHeadline) {
          els.targetHeadline.innerText =
            'School pages use /school/… . Open the person’s member profile (linkedin.com/in/…) in this tab to capture headline, About, and experience.';
        }
      } else if (u.includes('linkedin.com')) {
        els.targetName.innerText = 'Not a member profile';
        if (els.targetHeadline) {
          els.targetHeadline.innerText =
            'LynkWell AI needs a personal profile URL: linkedin.com/in/… (not feed, jobs, or search results). Open the member’s profile so the address bar shows /in/… .';
        }
      } else {
        els.targetName.innerText = 'No LinkedIn profile';
        if (els.targetHeadline) els.targetHeadline.innerText = 'Go to a LinkedIn profile (/in/…) to capture the target.';
      }
      return;
    }

    const norm = normalizeSidepanelTabUrl(tab.url);

    try {
      const snap = await chrome.storage.session.get('reachai_profile_v1');
      const rec = snap.reachai_profile_v1;
      if (
        rec &&
        rec.data &&
        rec.data.name &&
        rec.url === norm &&
        Date.now() - rec.at < 15000
      ) {
        currentProfile = rec.data;
        renderProfile(currentProfile);
        void syncOutreachStateFromProfile(currentProfile);
      }
    } catch (_) {
      /* optional warm read */
    }

    const resp = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_PROFILE' }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });

    if (!resp) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch {
        els.targetName.innerText = 'Refresh page';
        return;
      }
      await new Promise((r) => setTimeout(r, 450));
      return scanProfile(opts);
    }

    if (resp.success && resp.data) {
      currentProfile = resp.data;
      renderProfile(currentProfile);
      await syncOutreachStateFromProfile(currentProfile);
      const ok = await getRecommendation(currentProfile, { refreshing: keepRecco });
      const profNorm = normalizeSidepanelTabUrl(currentProfile.profileUrl || norm);
      const allowAuto =
        autoDraftAfterAnalysis &&
        (typeof REACHAI_AUTO_DRAFT_AFTER_NEW_PROFILE === 'undefined' ||
          REACHAI_AUTO_DRAFT_AFTER_NEW_PROFILE) &&
        ok &&
        profNorm &&
        profNorm !== lastAutoDraftedProfileNorm;
      if (allowAuto) {
        const id = await StorageManager.getIdentity();
        if (id && String(id.name || '').trim()) {
          const drafted = await generateNote({ silent: true });
          if (drafted) lastAutoDraftedProfileNorm = profNorm;
        }
      }
    } else {
      els.targetName.innerText = 'Scan Failed';
      if (keepRecco && lastRecommendationPayload) {
        applyChannelMatchUI(
          lastRecommendationPayload.channel,
          lastRecommendationPayload.reason,
          lastRecommendationPayload.scores,
          lastRecommendationPayload.deepInsight,
          {
            reccoDeepExpanded: reccoAnalysisExpanded,
            userPreferredTone: lastRecommendationPayload.userPreferredTone,
            userPreferredSource: lastRecommendationPayload.userPreferredSource
          }
        );
      }
    }
  }

  function initialsFromName(name) {
    if (!name || !name.trim()) return '?';
    const p = name.trim().split(/\s+/);
    if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }

  /**
   * LinkedIn CDN often blocks <img> in the extension panel (Referer / cookie). Try direct URL first,
   * then ask the LinkedIn tab’s content script to fetch the bytes (same-origin cookies) as a data URL.
   */
  async function loadProfileAvatarFromProfile(profile) {
    const photoUrl = String(profile?.profilePhotoUrl || '').trim();
    const imgEl = els.targetAvatarImg;
    const initialsEl = els.targetAvatar;
    if (!imgEl || !initialsEl) return;
    imgEl.onload = null;
    imgEl.onerror = null;
    if (!photoUrl) {
      imgEl.removeAttribute('src');
      imgEl.classList.add('hidden');
      initialsEl.classList.remove('hidden');
      return;
    }
    initialsEl.textContent = initialsFromName(profile.name);
    initialsEl.classList.remove('hidden');
    imgEl.classList.add('hidden');
    imgEl.alt = String(profile.name || 'Profile').slice(0, 80);
    let usedTabFetch = false;
    const showPhoto = () => {
      imgEl.classList.remove('hidden');
      initialsEl.classList.add('hidden');
    };
    const showInitialsOnly = () => {
      imgEl.classList.add('hidden');
      initialsEl.classList.remove('hidden');
      imgEl.removeAttribute('src');
    };
    const tryFetchFromLinkedInTab = async () => {
      if (usedTabFetch) return false;
      usedTabFetch = true;
      const tab = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      });
      if (!tab?.id || !String(tab.url || '').includes('linkedin.com')) return false;
      const resp = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { action: 'FETCH_PROFILE_PHOTO', url: photoUrl }, (r) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r);
        });
      });
      if (resp && resp.success && resp.dataUrl) {
        imgEl.onload = () => showPhoto();
        imgEl.onerror = () => showInitialsOnly();
        imgEl.referrerPolicy = '';
        imgEl.src = resp.dataUrl;
        if (imgEl.complete && imgEl.naturalWidth > 0) showPhoto();
        return true;
      }
      return false;
    };
    const fallbackTimer = setTimeout(() => {
      void (async () => {
        if (!imgEl.classList.contains('hidden')) return;
        const ok = await tryFetchFromLinkedInTab();
        if (!ok && imgEl.classList.contains('hidden')) showInitialsOnly();
      })();
    }, 3500);
    imgEl.onload = () => {
      clearTimeout(fallbackTimer);
      showPhoto();
    };
    imgEl.onerror = () => {
      clearTimeout(fallbackTimer);
      void (async () => {
        const ok = await tryFetchFromLinkedInTab();
        if (!ok) showInitialsOnly();
      })();
    };
    imgEl.referrerPolicy = 'no-referrer';
    imgEl.src = photoUrl;
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      clearTimeout(fallbackTimer);
      showPhoto();
    }
  }

  function renderProfile(profile) {
    if (!profile || typeof profile !== 'object') return;
    if (els.targetName) els.targetName.textContent = profile.name || 'Unknown';
    const te = profile.topExperience || {};
    const roleLine =
      String(profile.headline || '').trim() ||
      String(profile.currentPosition || '').trim() ||
      (te.title && te.company ? `${te.title} @ ${te.company}` : '') ||
      String(te.title || '').trim();
    if (els.targetHeadline) els.targetHeadline.textContent = roleLine || '—';
    if (els.targetAvatar) els.targetAvatar.textContent = initialsFromName(profile.name);
    void loadProfileAvatarFromProfile(profile);
    const companyLine =
      (profile.company && String(profile.company).trim()) ||
      (te.company && String(te.company).trim()) ||
      '';
    const locLine =
      (profile.location && String(profile.location).trim()) ||
      (te.location && String(te.location).trim()) ||
      '';
    if (els.targetCompany) els.targetCompany.textContent = companyLine || '—';
    if (els.targetLocation) els.targetLocation.textContent = locLine || '—';
    const deg = (profile.degree || 'unknown').toString().toLowerCase();
    if (els.targetDegreeBadge) {
      if (deg === 'unknown') {
        els.targetDegreeBadge.classList.add('hidden');
      } else {
        els.targetDegreeBadge.textContent = deg.replace(/^\w/, (c) => c.toUpperCase());
        els.targetDegreeBadge.classList.remove('hidden');
      }
    }
    let mutualCount = Number(profile.mutualConnections);
    if (!Number.isFinite(mutualCount) || mutualCount < 0) {
      const g = String(profile.mutualConnections ?? '').match(/(\d+)/);
      mutualCount = g ? parseInt(g[1], 10) : 0;
    }
    if (els.targetMutuals && els.targetMutualsN) {
      els.targetMutualsN.textContent = String(mutualCount);
      els.targetMutuals.classList.remove('hidden');
    }
  }

  function applyChannelMatchUI(bestChannel, reason, scores, deepInsight, uiOpts) {
    if (!els.channelTabs) return;
    const panelsOnly = !!(uiOpts && uiOpts.panelsOnly);
    const expanded = !!(uiOpts && uiOpts.reccoDeepExpanded);
    const userPrefToneRaw = uiOpts && uiOpts.userPreferredTone;
    const userPrefSrcRaw = uiOpts && uiOpts.userPreferredSource;
    const avail = (currentProfile && currentProfile.availableChannels) || {};
    let ch = String(bestChannel || 'connection').toLowerCase();
    if (ch !== 'connection' && ch !== 'message' && ch !== 'inmail') ch = 'connection';
    if (els.reccoChannel) els.reccoChannel.textContent = formatChannelName(ch);
    const reasonStr = String(reason || '').trim();
    if (els.reccoReason) {
      els.reccoReason.textContent = reasonStr;
      els.reccoReason.classList.toggle('hidden', !reasonStr || !expanded);
    }
    if (els.reccoBadge) {
      els.reccoBadge.classList.remove('hidden');
      syncReccoBadgeLabel();
    }
    if (!panelsOnly) {
      setActiveTab(els.channelTabs, ch);
    }
    const s = scores && typeof scores === 'object' ? scores : {};
    const dEarly = deepInsight && typeof deepInsight === 'object' ? deepInsight : {};
    const shadow =
      dEarly.shadowScores && typeof dEarly.shadowScores === 'object' ? dEarly.shadowScores : {};
    ['inmail', 'connection', 'message'].forEach((key) => {
      const el = document.querySelector(`[data-channel-match="${key}"]`);
      if (!el) return;
      const uiKey = key === 'connection' ? 'connect' : key === 'message' ? 'message' : 'inmail';
      const v = s[key];
      const sh = shadow[key];
      const primary = typeof v === 'number' && !Number.isNaN(v) ? Math.round(v) : null;
      const secondary = typeof sh === 'number' && !Number.isNaN(sh) ? Math.round(sh) : null;
      if (primary != null) {
        el.textContent = `${Math.max(1, Math.min(100, primary))}% match`;
      } else if (secondary != null) {
        const label = avail[uiKey] ? 'match' : 'fit';
        el.textContent = `${Math.max(1, Math.min(100, secondary))}% ${label}`;
      } else {
        el.textContent = '—';
      }
    });
    els.channelTabs.querySelectorAll('.lw-channel-tile').forEach((btn) => {
      btn.querySelectorAll('.lw-channel-tile__best').forEach((b) => b.classList.add('hidden'));
    });
    const bestBtn = els.channelTabs.querySelector(`button[data-val="${ch}"]`);
    if (bestBtn) {
      const badge = bestBtn.querySelector('.lw-channel-tile__best');
      if (badge) badge.classList.remove('hidden');
    }

    const d = dEarly;
    const ta = String(d.targetAnalysis || '').trim();
    const tone = String(d.recommendedTone || '').toLowerCase();
    const toneOk = tone === 'professional' || tone === 'casual' || tone === 'direct';
    const { label: toneLabel } = toneOk ? toneMeta(tone) : { label: '' };
    const tr = String(d.toneRationale || '').trim();
    let userPrefTone = String(userPrefToneRaw || '').toLowerCase().trim();
    if (userPrefTone !== 'professional' && userPrefTone !== 'casual' && userPrefTone !== 'direct') {
      userPrefTone = 'professional';
    }
    let agentLine = String(d.agentPick || '').trim();
    if (agentLine) {
      agentLine = agentLine.split(/\r?\n+/)[0].trim().slice(0, 220);
    }
    if (expanded && !agentLine && toneOk && toneLabel) {
      agentLine = `${formatChannelWithEmoji(ch)} + ${formatToneWithEmoji(tone)}`;
      const trOne = tr.split(/\r?\n+/)[0].trim().slice(0, 100);
      if (trOne) agentLine += `: ${trOne}`;
    }
    if (els.reccoAgentPick) {
      els.reccoAgentPick.textContent = agentLine || '';
      els.reccoAgentPick.classList.toggle('hidden', !agentLine || !expanded);
    }
    const plans = d.channelPlans && typeof d.channelPlans === 'object' ? d.channelPlans : {};
    const planRows = [
      ['inmail', 'InMail'],
      ['connection', 'Connect note'],
      ['message', 'DM']
    ].filter(([k]) => plans[k] && typeof plans[k] === 'object');
    const hasPlans = planRows.some(([k]) => {
      const p = plans[k];
      return p && (p.whenToUse || p.toneTip || p.avoid);
    });
    const showDeep = !!expanded;
    if (els.reccoDeep) els.reccoDeep.classList.toggle('hidden', !showDeep);
    if (els.reccoAnalysis) els.reccoAnalysis.textContent = ta;
    if (els.reccoToneLine) {
      if (expanded && toneOk && toneLabel) {
        els.reccoToneLine.classList.remove('hidden');
        const te = formatToneWithEmoji(tone);
        els.reccoToneLine.textContent = tr ? `AI tone: ${te} — ${tr}` : `AI tone: ${te}`;
      } else {
        els.reccoToneLine.textContent = '';
        els.reccoToneLine.classList.add('hidden');
      }
    }
    if (els.reccoPlans) {
      els.reccoPlans.innerHTML = '';
      for (const [key, label] of planRows) {
        const p = plans[key];
        if (!p || typeof p !== 'object') continue;
        const pts = [];
        if (p.whenToUse) pts.push({ t: 'Why', v: String(p.whenToUse) });
        if (p.toneTip) pts.push({ t: 'Tone', v: String(p.toneTip) });
        if (p.avoid) pts.push({ t: 'Avoid', v: String(p.avoid) });
        if (!pts.length) continue;
        const li = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = `${label}`;
        li.appendChild(strong);
        const sub = document.createElement('ul');
        sub.className = 'lw-recco-plan-points';
        for (const { t, v } of pts) {
          const sli = document.createElement('li');
          sli.textContent = `${t}: ${v}`;
          sub.appendChild(sli);
        }
        li.appendChild(sub);
        els.reccoPlans.appendChild(li);
      }
      els.reccoPlans.classList.toggle('hidden', !els.reccoPlans.children.length);
    }
    if (els.tonePills && !panelsOnly) {
      setActiveTab(els.tonePills, userPrefTone);
      updateGeneratorToneBadge(userPrefTone);
    }

    if (els.reccoToneCompare) {
      els.reccoToneCompare.classList.remove('hidden');
    }

    const dStore = deepInsight && typeof deepInsight === 'object' ? deepInsight : {};
    lastRecommendationPayload = {
      channel: ch,
      reason: reasonStr,
      scores: s,
      userPreferredTone: userPrefTone,
      userPreferredSource: String(userPrefSrcRaw || 'Your setup').trim() || 'Your setup',
      aiRecommendedTone: toneOk ? tone : '',
      deepInsight: {
        targetAnalysis: String(dStore.targetAnalysis || '').trim(),
        recommendedTone: String(dStore.recommendedTone || '').trim(),
        toneRationale: String(dStore.toneRationale || '').trim(),
        agentPick: String(dStore.agentPick || '').trim(),
        shadowScores:
          dStore.shadowScores && typeof dStore.shadowScores === 'object' ? dStore.shadowScores : {},
        channelPlans: dStore.channelPlans && typeof dStore.channelPlans === 'object' ? dStore.channelPlans : {}
      }
    };
    syncReccoToneCompareStrip();
  }

  async function getRecommendation(profile, opts = {}) {
    const identity = await normalizeIdentityForAi();
    if (!identity) return false;

    /** Same-tab / debounced sync — refresh scores in the background without the loading strip. */
    const quietRefresh = opts.refreshing === true;
    if (!quietRefresh) setRecommendationLoading(true, 'Getting AI channel recommendation…');
    try {
      const resp = await sendBackground({
        action: 'GET_RECOMMENDATION',
        payload: { profile, identity }
      });
      if (resp && resp.success) {
        const pref = await resolveUserOutreachTonePreference();
        applyChannelMatchUI(
          resp.channel,
          resp.reason,
          resp.scores,
          {
            targetAnalysis: resp.targetAnalysis,
            recommendedTone: resp.recommendedTone,
            toneRationale: resp.toneRationale,
            channelPlans: resp.channelPlans,
            agentPick: resp.agentPick,
            shadowScores: resp.shadowScores
          },
          {
            reccoDeepExpanded: reccoAnalysisExpanded,
            userPreferredTone: pref.tone,
            userPreferredSource: pref.source
          }
        );
        return true;
      }
      if (resp && resp.error) console.warn('Recommendation:', resp.error);
    } catch (e) {
      console.error(e);
    } finally {
      if (!quietRefresh) setRecommendationLoading(false);
    }
    return false;
  }

  /** Trimmed sender fields for consistent AI payloads (LinkedIn profile and reach-api-default.js fallbacks). */
  async function normalizeIdentityForAi() {
    let raw = await StorageManager.getIdentity();
    if (!raw) {
      await ensureProductIdentity();
      raw = await StorageManager.getIdentity();
    }
    if (!raw) return null;
    const li = await StorageManager.getLinkedInProfile();
    const name =
      String(raw.name || '')
        .trim() || String(li?.name || '').trim();
    let role = String(raw.role || '').trim();
    if (!role) role = String(li?.email || '').trim();
    if (!role) role = 'Professional';
    if (!name) return null;
    return { ...raw, name, role };
  }

  function formatChannelName(chan) {
    if (chan === 'connection') return 'Connection request';
    if (chan === 'inmail') return 'InMail';
    return 'Message';
  }

  function formatChannelWithEmoji(chan) {
    if (chan === 'connection') return '🤝 Connect note';
    if (chan === 'inmail') return '✉️ InMail';
    return '💬 DM';
  }

  // ═══════════════════════════════════════
  //  UI TOGGLES
  // ═══════════════════════════════════════

  function setActiveTab(container, val) {
    if (!container) return;
    container.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    const btn = container.querySelector(`button[data-val="${val}"]`);
    if (btn) btn.classList.add('active');
    updateCharLimit();
    if (container === els.channelTabs) toggleInMailUI();
    if (container === els.tonePills) updateGeneratorToneBadge(val);
  }

  function toggleInMailUI() {
    const channel = getActiveChannel();
    if (!els.subjectEditor || !els.actionRowDefault || !els.actionRowInmail) return;
    if (channel === 'inmail') {
      els.subjectEditor.classList.remove('hidden');
      els.actionRowDefault.classList.add('hidden');
      els.actionRowInmail.classList.remove('hidden');
    } else {
      els.subjectEditor.classList.add('hidden');
      els.actionRowDefault.classList.remove('hidden');
      els.actionRowInmail.classList.add('hidden');
    }
  }

  if (els.channelTabs) {
    els.channelTabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      setActiveTab(els.channelTabs, b.dataset.val);
      const autoOnChannel =
        typeof REACHAI_AUTO_DRAFT_ON_CHANNEL_CLICK === 'undefined' || REACHAI_AUTO_DRAFT_ON_CHANNEL_CLICK;
      if (!e.isTrusted || !autoOnChannel) return;
      void (async () => {
        if (!currentProfile) return;
        const id = await normalizeIdentityForAi();
        if (!id) return;
        await generateNote({ silent: false });
      })();
    });
  }

  if (els.reccoBadge) {
    els.reccoBadge.addEventListener('click', () => {
      if (els.reccoBadge.classList.contains('hidden') || !lastRecommendationPayload) return;
      reccoAnalysisExpanded = !reccoAnalysisExpanded;
      applyChannelMatchUI(
        lastRecommendationPayload.channel,
        lastRecommendationPayload.reason,
        lastRecommendationPayload.scores,
        lastRecommendationPayload.deepInsight,
        {
          reccoDeepExpanded: reccoAnalysisExpanded,
          userPreferredTone: lastRecommendationPayload.userPreferredTone,
          userPreferredSource: lastRecommendationPayload.userPreferredSource
        }
      );
    });
  }

  if (els.btnReccoUseAiTone) {
    els.btnReccoUseAiTone.addEventListener('click', () => {
      if (!lastRecommendationPayload) return;
      const t = lastRecommendationPayload.aiRecommendedTone;
      if (t !== 'professional' && t !== 'casual' && t !== 'direct') return;
      if (els.tonePills) setActiveTab(els.tonePills, t);
      updateGeneratorToneBadge(t);
      syncReccoToneCompareStrip();
    });
  }

  if (els.tonePills) {
    els.tonePills.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-val]');
      if (b) setActiveTab(els.tonePills, b.dataset.val);
      syncReccoToneCompareStrip();
    });
  }

  if (els.toneTilesSetup) {
    els.toneTilesSetup.addEventListener('click', (e) => {
      const tile = e.target.closest('.lw-tone-tile');
      if (!tile || !tile.dataset.tone) return;
      els.toneTilesSetup.querySelectorAll('.lw-tone-tile').forEach((t) => t.classList.remove('active'));
      tile.classList.add('active');
      if (els.tone) els.tone.value = tile.dataset.tone;
    });
  }

  if (els.btnEnhanceMission) {
    els.btnEnhanceMission.addEventListener('click', async () => {
      const t = els.mission.value.trim();
      if (!t) return alert('Add your context first.');
      els.btnEnhanceMission.disabled = true;
      const r = await sendBackground({ action: 'ENHANCE_MISSION', payload: { text: t } });
      els.btnEnhanceMission.disabled = false;
      if (r && r.success && r.text) els.mission.value = String(r.text).trim();
      else alert((r && r.error) || 'Enhance failed. Ensure the API server is running and Gemini is configured in server/.env.');
    });
  }

  const btnLiOpenSetup = document.getElementById('btn-li-open-setup');
  if (btnLiOpenSetup) {
    btnLiOpenSetup.addEventListener('click', async () => {
      await refreshApiUnavailablePanel();
      showScreen('api-unavailable');
    });
  }

  const btnCopyLiRedirect = document.getElementById('btn-copy-li-redirect');
  if (btnCopyLiRedirect) {
    btnCopyLiRedirect.addEventListener('click', async () => {
      const inp = document.getElementById('input-li-redirect-url');
      const v = inp && inp.value ? inp.value.trim() : '';
      if (!v) return;
      try {
        await navigator.clipboard.writeText(v);
        btnCopyLiRedirect.textContent = 'Copied';
        setTimeout(() => {
          btnCopyLiRedirect.textContent = 'Copy';
        }, 2000);
      } catch {
        try {
          inp.focus();
          inp.select();
          document.execCommand('copy');
          btnCopyLiRedirect.textContent = 'Copied';
          setTimeout(() => {
            btnCopyLiRedirect.textContent = 'Copy';
          }, 2000);
        } catch {
          alert(v);
        }
      }
    });
  }

  if (els.btnLinkedinSkip) {
    els.btnLinkedinSkip.addEventListener('click', async () => {
      const req =
        typeof REACHAI_LINKEDIN_SIGNIN_REQUIRED !== 'undefined' && REACHAI_LINKEDIN_SIGNIN_REQUIRED;
      const en = typeof REACHAI_ENABLE_LINKEDIN_OAUTH !== 'undefined' && REACHAI_ENABLE_LINKEDIN_OAUTH;
      if (req && en) return;

      const done = await StorageManager.isSetupComplete();
      if (done) {
        await StorageManager.setLinkedInConnectSkipped(true);
        showScreen('generator');
        void scanProfile({ autoDraftAfterAnalysis: true });
      } else {
        await refreshApiUnavailablePanel();
        showScreen('api-unavailable');
      }
    });
  }

  const btnSignoutLiSetup = document.getElementById('btn-signout-linkedin-setup');
  if (btnSignoutLiSetup) {
    btnSignoutLiSetup.addEventListener('click', async () => {
      if (!confirm('Sign out of LinkedIn on this device?')) return;
      await sendBackground({ action: 'LINKEDIN_OAUTH_CLEAR' });
      await StorageManager.setPostLinkedinSetupActive(false);
      await refreshLinkedInPanel();
      await updateHeaderStatus();
      void applyPostLinkedinSetupUi();
      showScreen('linkedin');
      void refreshLinkedinContinueLabel();
    });
  }

  if (els.btnEditSettingsFooter) {
    els.btnEditSettingsFooter.addEventListener('click', () => {
      void openTrainingScreen();
    });
  }

  function getActiveVal(container) {
    if (!container) return null;
    const active = container.querySelector('.active');
    return active ? active.dataset.val : null;
  }

  function getActiveChannel() {
    return getActiveVal(els.channelTabs) || 'connection';
  }

  function getActiveTone() {
    return getActiveVal(els.tonePills) || 'professional';
  }

  /** If the model returns fenced or truncated JSON, split subject/body (same recovery as background). */
  function coerceInmailPayloadFromText(raw) {
    let s = String(raw ?? '').trim();
    for (let k = 0; k < 12; k++) {
      const before = s;
      s = s.replace(/^\s*```(?:json|javascript|js)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      if (s === before) break;
    }
    s = s.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        const o = JSON.parse(s.slice(i, j + 1));
        const body = String(o.body ?? o.Body ?? o.message ?? o.text ?? '').trim();
        if (body) return { body, subject: String(o.subject ?? o.Subject ?? '').trim() };
      } catch {
        /* fall through to recover */
      }
    }
    if (typeof recoverInMailFieldsFromRaw === 'function') {
      const loose = recoverInMailFieldsFromRaw(raw);
      if (loose && loose.body) return { body: loose.body, subject: loose.subject || '' };
    }
    return null;
  }

  // ═══════════════════════════════════════
  //  GENERATION
  // ═══════════════════════════════════════

  if (els.btnGenerate) els.btnGenerate.addEventListener('click', generateNote);
  if (els.btnRegenerate) els.btnRegenerate.addEventListener('click', generateNote);
  if (els.btnRegenerateInmail) els.btnRegenerateInmail.addEventListener('click', generateNote);

  async function generateNote(opts = {}) {
    const silent = !!opts.silent;
    if (!els.btnGenerate) return false;
    if (generatingLock) return false;

    if (!currentProfile) {
      if (!silent) alert('Please scan a profile first.');
      return false;
    }
    const identity = await normalizeIdentityForAi();
    if (!identity) {
      if (!silent) {
        alert(
          'Sender name and role are still missing. Set REACHAI_DEFAULT_SENDER_NAME / REACHAI_DEFAULT_SENDER_ROLE in reach-api-default.js or sign in with LinkedIn so we can fill them from your profile.'
        );
      }
      return false;
    }

    const sessionPre = await StorageManager.getDailySession();
    if (sessionPre.count >= sessionPre.limit) {
      if (!silent) {
        alert(
          `Daily LinkedIn limit reached (${sessionPre.count}/${sessionPre.limit} today). Change the limit in Knowledge center or your Command Center, or try again tomorrow.`
        );
      }
      return false;
    }

    const matchPre = await StorageManager.getDpSentLogMatch(
      normalizeSidepanelTabUrl(currentProfile.profileUrl || '')
    );
    if (matchPre && matchPre.webInstantly) {
      if (silent) return false;
      const ok = confirm(
        'Your Command Center marks this profile as already emailed (Instantly). Generate a new draft anyway?'
      );
      if (!ok) return false;
    }

    generatingLock = true;
    if (els.editorContainer) els.editorContainer.classList.add('hidden');
    syncGeneratorDraftLayout();
    if (els.handoffTooltip) els.handoffTooltip.classList.add('hidden');
    els.btnGenerate.disabled = true;
    if (els.btnGenText) els.btnGenText.textContent = 'Generating…';
    if (els.btnGenSpinner) els.btnGenSpinner.classList.remove('hidden');

    const channel = getActiveChannel();
    const tone = getActiveTone();
    /** Multi-step agent runs in the service worker with no extra UI (checkbox removed). */
    const useAgent = !silent;

    clearGenerationPhaseTicker();
    activeGenerationRunId = null;
    if (!silent) {
      activeGenerationRunId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      if (els.generateLiveStatus) {
        els.generateLiveStatus.classList.remove('hidden');
        if (useAgent) {
          els.generateLiveStatus.textContent = 'Starting deep agent…';
        } else {
          const phases = [
            'Building prompt with your knowledge base…',
            'Calling your AI server…',
            'Gemini is drafting on your backend…',
            'Still working — long profiles can take a bit…'
          ];
          let pi = 0;
          els.generateLiveStatus.textContent = phases[0];
          generationPhaseTicker = setInterval(() => {
            pi = Math.min(pi + 1, phases.length - 1);
            if (els.generateLiveStatus) els.generateLiveStatus.textContent = phases[pi];
          }, 3200);
        }
      }
    }

    try {
      const resp = await sendBackground({
        action: useAgent ? 'GENERATE_NOTE_AGENT' : 'GENERATE_NOTE',
        payload: {
          channel,
          tone,
          profile: currentProfile,
          identity,
          ...(useAgent ? { agentRunId: activeGenerationRunId } : {}),
          outreach: {
            mode: currentOutreachMode,
            priorSentAt: currentPriorSentAt,
            hasPriorSend: currentOutreachMode === 'bridge',
            pathChannel: channel
          }
        }
      });

      if (resp && resp.success) {
        let outText = String(resp.text || '');
        let outSubject = resp.subject != null ? String(resp.subject) : '';
        if (channel === 'inmail') {
          const needsCoerce =
            /```(?:json)?/i.test(outText) ||
            (/^\s*\{/.test(outText) && /"body"\s*:/.test(outText)) ||
            (!outSubject && /"subject"\s*:/.test(outText));
          if (needsCoerce) {
            const coerced = coerceInmailPayloadFromText(outText);
            if (coerced) {
              outText = coerced.body;
              outSubject = coerced.subject || outSubject;
            }
          }
        } else {
          const looksLikeJson =
            /```(?:json)?/i.test(outText) ||
            (/^\s*\{/.test(outText) && /"body"\s*:/.test(outText));
          if (looksLikeJson) {
            const coerced = coerceInmailPayloadFromText(outText);
            if (coerced && coerced.body) outText = coerced.body;
          }
        }
        currentDraft = outText;
        els.draftEditor.value = currentDraft;
        if (channel === 'inmail') {
          els.subjectEditor.value = outSubject;
        } else {
          els.subjectEditor.value = '';
        }
        draftFeedbackId = { channel, tone, profile: currentProfile, text: currentDraft };

        els.btnFeedbackYes.style.background = '';
        els.btnFeedbackNo.style.background = '';

        updateCharLimit();
        els.editorContainer.classList.remove('hidden');
        syncGeneratorDraftLayout();
        if (lastRecommendationPayload) {
          applyChannelMatchUI(
            lastRecommendationPayload.channel,
            lastRecommendationPayload.reason,
            lastRecommendationPayload.scores,
            lastRecommendationPayload.deepInsight,
            {
              panelsOnly: true,
              reccoDeepExpanded: reccoAnalysisExpanded,
              userPreferredTone: lastRecommendationPayload.userPreferredTone,
              userPreferredSource: lastRecommendationPayload.userPreferredSource
            }
          );
        }
        els.editorContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        await StorageManager.incrementDailyCount();
        await updateSessionCounter();
        return true;
      }
      const msg = (resp && resp.error) || 'Unknown error';
      if (!silent) alert(`Generation error: ${msg}`);
      return false;
    } catch (e) {
      if (!silent) alert(`Error: ${e.message}`);
      return false;
    } finally {
      clearGenerationPhaseTicker();
      activeGenerationRunId = null;
      if (els.generateLiveStatus) {
        els.generateLiveStatus.classList.add('hidden');
        els.generateLiveStatus.textContent = '';
      }
      generatingLock = false;
      els.btnGenerate.disabled = false;
      if (els.btnGenText) els.btnGenText.textContent = 'Generate with Gemini';
      if (els.btnGenSpinner) els.btnGenSpinner.classList.add('hidden');
    }
  }

  // ═══════════════════════════════════════
  //  EDITOR & STATS
  // ═══════════════════════════════════════

  function updateCharLimit() {
    if (!els.charCount || !els.charLimit || !els.draftEditor || !els.subjectEditor) return;
    const channel = getActiveChannel();
    const L = typeof REACH_CHANNEL_LIMITS !== 'undefined'
      ? REACH_CHANNEL_LIMITS
      : { connection: 200, message: 3000, inmailSubjectMax: 200, inmailBodyMax: 1900 };
    const subjLen = els.subjectEditor.value.length;
    const bodyLen = els.draftEditor.value.length;

    let ratio = 0;
    if (channel === 'inmail') {
      const sm = Number(L.inmailSubjectMax) || 200;
      const bm = Number(L.inmailBodyMax) || 1900;
      els.charCount.textContent = String(bodyLen);
      els.charLimit.innerText = `/${bm} · s ${subjLen}/${sm}`;
      ratio = Math.max(sm > 0 ? subjLen / sm : 0, bm > 0 ? bodyLen / bm : 0);
    } else {
      const limit =
        channel === 'message'
          ? Number(L.message) || 3000
          : Number(L.connection) || 200;
      els.charLimit.innerText = `/${limit}`;
      els.charCount.textContent = String(bodyLen);
      ratio = limit > 0 ? bodyLen / limit : 0;
    }

    if (!Number.isFinite(ratio)) ratio = 0;
    if (ratio > 1) els.charCount.style.color = 'var(--danger)';
    else if (ratio > 0.8) els.charCount.style.color = 'var(--warning)';
    else els.charCount.style.color = 'var(--success)';
  }

  els.draftEditor.addEventListener('input', updateCharLimit);
  els.subjectEditor.addEventListener('input', updateCharLimit);

  els.btnCopySubject.addEventListener('click', () => {
    navigator.clipboard.writeText(els.subjectEditor.value);
    showToast("Subject copied!");
  });
  
  els.btnCopyBody.addEventListener('click', async () => {
    navigator.clipboard.writeText(els.draftEditor.value);
    await completeCopyAction();
  });

  els.btnCopy.addEventListener('click', async () => {
    navigator.clipboard.writeText(els.draftEditor.value);
    await completeCopyAction();
  });

  async function completeCopyAction() {
    showToast('Message copied!');
    els.handoffTooltip.classList.remove('hidden');
  }

  async function updateSessionCounter() {
    const session = await StorageManager.getDailySession();
    const count = Number(session.count) || 0;
    const lim = Math.max(1, clampDailyLimit(session.limit || dailyLimitL().RECOMMENDED));
    if (els.sessionCount) els.sessionCount.textContent = String(count);
    if (els.sessionLimit) els.sessionLimit.textContent = String(lim);
    if (els.sessionProgress) {
      const pct = lim > 0 ? Math.min((count / lim) * 100, 100) : 0;
      els.sessionProgress.style.width = `${pct}%`;
    }

    if (els.goalBanner) {
      if (count >= lim) els.goalBanner.classList.remove('hidden');
      else els.goalBanner.classList.add('hidden');
    }
    const rem = document.getElementById('session-remaining');
    if (rem) {
      const left = Math.max(0, lim - count);
      rem.textContent = left === 1 ? '1 remaining' : `${left} remaining`;
    }
  }

  if (els.btnResetDailyUsage) {
    els.btnResetDailyUsage.addEventListener('click', async () => {
      await StorageManager.resetDailyLinkedInUsage();
      await updateSessionCounter();
      showToast("Today's count reset to 0.");
    });
  }

  function showToast(msg = "Copied to clipboard!") {
    els.toast.innerText = msg;
    els.toast.classList.remove('hidden');
    setTimeout(() => els.toast.classList.add('hidden'), 3000);
  }

  // ═══════════════════════════════════════
  //  FEEDBACK LOOP
  // ═══════════════════════════════════════

  async function handleFeedback(isHelpful, btn) {
    if (!draftFeedbackId || !draftFeedbackId.text || !draftFeedbackId.channel) {
      showToast('Generate a message first, then rate it.');
      return;
    }
    btn.style.background = 'var(--surface-hover)';
    await StorageManager.saveFeedback({
      messageType: draftFeedbackId.channel,
      tone: draftFeedbackId.tone,
      profileSummary: `${draftFeedbackId.profile.name || ''}, ${draftFeedbackId.profile.headline || ''}`,
      generatedText: draftFeedbackId.text,
      helpful: isHelpful
    });
    showToast(
      isHelpful
        ? 'Saved. We’ll steer toward this style.'
        : 'Saved. Next generate will lean simpler and clearer for this channel & tone.'
    );
  }

  if (els.btnFeedbackYes) els.btnFeedbackYes.addEventListener('click', () => handleFeedback(true, els.btnFeedbackYes));
  if (els.btnFeedbackNo) els.btnFeedbackNo.addEventListener('click', () => handleFeedback(false, els.btnFeedbackNo));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void (async () => {
      try {
        if (!(await StorageManager.isSetupComplete())) return;
        const gen = document.getElementById('screen-generator');
        if (!gen || gen.classList.contains('hidden')) return;
        let tabNorm = '';
        try {
          const s = await chrome.storage.session.get('reachai_tab_profile_url');
          tabNorm = normalizeSidepanelTabUrl(s.reachai_tab_profile_url || '');
        } catch (_) {
          /* ignore */
        }
        const curNorm = currentProfile ? normalizeSidepanelTabUrl(currentProfile.profileUrl || '') : '';
        const urlMismatch = !!(tabNorm && curNorm && tabNorm !== curNorm) || (tabNorm && !curNorm);
        await pullLatestSessionProfileIntoUI();
        void scanProfile({
          autoDraftAfterAnalysis: urlMismatch,
          preserveRecommendation: !urlMismatch
        });
      } catch (_) {
        /* ignore */
      }
    })();
  });

  const btnRefreshProfile = document.getElementById('btn-refresh-profile');
  if (btnRefreshProfile) {
    btnRefreshProfile.addEventListener('click', () => {
      void scanProfile({ autoDraftAfterAnalysis: true });
    });
  }

  const btnApiRetry = document.getElementById('btn-api-retry');
  if (btnApiRetry) {
    btnApiRetry.addEventListener('click', async () => {
      btnApiRetry.disabled = true;
      try {
        await ensureApiSessionQuietly();
        await updateHeaderStatus();
        await init();
      } finally {
        btnApiRetry.disabled = false;
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.webBridgeV1) {
      void (async () => {
        await applyKbDailyLimitUi();
        await syncToneUIFromWebBridge();
        await updateSessionCounter();
        if (currentProfile) await refreshSentLogBanner(currentProfile);
      })();
    }
    if (changes.settings) {
      void (async () => {
        await applyKbDailyLimitUi();
        await updateSessionCounter();
      })();
    }
    if (changes.dailySession) {
      void updateSessionCounter();
    }
  });

  // Run
  applyLinkedinFeatureGate();
  applyLinkedInRedirectHelperVisibility();
  init();
});
