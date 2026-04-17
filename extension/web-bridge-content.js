// Runs only on the Command Center origin (must match extension/manifest.json + lib/dp-bridge.js COMMAND_CENTER_ORIGIN).
// Page localStorage is in the main world — injected script reads it and postMessages to this isolated listener.
// Realtime: patched Storage (same-tab), storage event (other tabs), custom events, focus/visibility/online, 30s fallback.

(() => {
  const ORIGIN = 'https://outreach-tool-nine-omega.vercel.app';
  if (!location.href.startsWith(ORIGIN)) return;

  let bridgeInjected = false;
  function injectMainListener() {
    if (bridgeInjected) return;
    bridgeInjected = true;
    const s = document.createElement('script');
    s.textContent = `(${function () {
      var _dpPushTimer = null;
      function push() {
        try {
          window.postMessage(
            {
              source: 'LYNKWELL_DP',
              type: 'DP_BRIDGE_PUSH',
              dp_config: localStorage.getItem('dp_config'),
              dp_sent_log: localStorage.getItem('dp_sent_log')
            },
            '*'
          );
        } catch (e) {}
      }
      function schedulePush() {
        if (_dpPushTimer != null) clearTimeout(_dpPushTimer);
        _dpPushTimer = setTimeout(function () {
          _dpPushTimer = null;
          push();
        }, 60);
      }
      var _origSetItem = Storage.prototype.setItem;
      var _origRemoveItem = Storage.prototype.removeItem;
      var _origClear = Storage.prototype.clear;
      function _bridgeKey(k) {
        return k === 'dp_config' || k === 'dp_sent_log';
      }
      Storage.prototype.setItem = function (key, value) {
        _origSetItem.call(this, key, value);
        if (_bridgeKey(String(key))) schedulePush();
      };
      Storage.prototype.removeItem = function (key) {
        _origRemoveItem.call(this, key);
        if (_bridgeKey(String(key))) schedulePush();
      };
      Storage.prototype.clear = function () {
        _origClear.call(this);
        schedulePush();
      };
      push();
      window.addEventListener('dp_config_updated', schedulePush);
      window.addEventListener('dp_sent_log_updated', schedulePush);
      window.addEventListener('storage', function (e) {
        if (e.key === 'dp_config' || e.key === 'dp_sent_log' || e.key == null) schedulePush();
      });
      window.addEventListener('focus', push);
      window.addEventListener('pageshow', function (ev) {
        if (ev.persisted) push();
      });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') push();
      });
      window.addEventListener('online', push);
      setInterval(push, 30000);
    }.toString()})();`;
    (document.documentElement || document.head).appendChild(s);
    s.remove();
  }

  window.addEventListener('message', (ev) => {
    try {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.source !== 'LYNKWELL_DP' || d.type !== 'DP_BRIDGE_PUSH') return;
      chrome.runtime.sendMessage({
        action: 'DP_BRIDGE_SNAPSHOT',
        payload: { dp_config: d.dp_config, dp_sent_log: d.dp_sent_log }
      });
    } catch {
      /* ignore */
    }
  });

  let injectAttempts = 0;
  function scheduleInject() {
    const root = document.documentElement || document.head;
    if (root) {
      injectMainListener();
      return;
    }
    if (++injectAttempts > 240) return;
    requestAnimationFrame(scheduleInject);
  }
  scheduleInject();
})();
