/* Shared: background (importScripts) + sidepanel — recover InMail subject/body when JSON is fenced or truncated. */

function stripInmailOuterFences(s) {
  let t = String(s ?? '').trim();
  for (let n = 0; n < 12; n++) {
    const before = t;
    t = t.replace(/^\s*```(?:json|javascript|js|JSON)?\s*/i, '').trim();
    t = t.replace(/\s*```\s*$/i, '').trim();
    if (t === before) break;
  }
  t = t.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return t;
}

/**
 * When JSON is truncated (token limit) or invalid, read "subject"/"body" string values by scan.
 * Tolerates missing closing quote on body (returns text so far).
 */
function recoverInMailFieldsFromRaw(rawText) {
  const s = stripInmailOuterFences(String(rawText ?? '').trim());
  if (!s) return null;

  function readStringAfterKey(key) {
    const re = new RegExp(`"${key}"\\s*:\\s*"`, 'i');
    const m = re.exec(s);
    if (!m) return '';
    let i = m.index + m[0].length;
    let out = '';
    while (i < s.length) {
      const c = s[i];
      if (c === '"') {
        let bs = 0;
        for (let k = i - 1; k >= 0 && s[k] === '\\'; k--) bs++;
        if (bs % 2 === 0) break;
        out += '"';
        i++;
        continue;
      }
      if (c === '\\' && i + 1 < s.length) {
        const n = s[i + 1];
        if (n === 'n') {
          out += '\n';
          i += 2;
          continue;
        }
        if (n === 'r') {
          out += '\r';
          i += 2;
          continue;
        }
        if (n === 't') {
          out += '\t';
          i += 2;
          continue;
        }
        if (n === 'u' && /[0-9a-fA-F]{4}/.test(s.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        if (n === '"' || n === '\\' || n === '/') {
          out += n;
          i += 2;
          continue;
        }
        out += n;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  const subject = readStringAfterKey('subject').trim();
  const body = readStringAfterKey('body').trim();
  if (!body && !subject) return null;
  return { subject, body };
}
