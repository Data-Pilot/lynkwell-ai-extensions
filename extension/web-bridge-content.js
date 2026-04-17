// Runs only on the Command Center origin (must match extension/manifest.json + lib/dp-bridge.js COMMAND_CENTER_ORIGIN).
// Page localStorage is in the main world — injected script reads it and postMessages to this isolated listener.

(() => {
  const ORIGIN = 'https://outreach-tool-nine-omega.vercel.app';
  if (!location.href.startsWith(ORIGIN)) return;

  function injectMainListener() {
    const s = document.createElement('script');
    s.textContent = `(${function () {
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
      push();
      window.addEventListener('dp_config_updated', push);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') push();
      });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMainListener);
  } else {
    injectMainListener();
  }
})();
