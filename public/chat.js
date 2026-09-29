
const log = document.getElementById('log');
const input = document.getElementById('input');
const send = document.getElementById('send');
// When embedded in the gateway (:3001/models/chat), the agent API lives on :3000.
const AGENT_API = location.port === '3001' ? '/models/chat' : '';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderMd(src) {
  const lines = String(src || '').split(/\r?\n/);
  let html = '';
  let i = 0;
  const isRow = (L) => /^\s*\|.*\|\s*$/.test(L);
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const L = lines[i];
    if (/^```/.test(L)) {
      let j = i + 1; const buf = [];
      while (j < lines.length && !/^```/.test(lines[j])) { buf.push(lines[j]); j++; }
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      i = j + 1; continue;
    }
    if (isRow(L) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(L); i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(cells(lines[i])); i++; }
      html += '<table><thead><tr>' + head.map((h) => '<th>' + inline(esc(h)) + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(esc(c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    if (/^\s*[-*]\s+/.test(L)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      html += '<ul>' + buf.map((b) => '<li>' + inline(esc(b)) + '</li>').join('') + '</ul>';
      continue;
    }
    if (!L.trim()) { i++; continue; }
    html += '<p>' + inline(esc(L)) + '</p>';
    i++;
  }
  return html;
}

function add(cls, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

async function go() {
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  add('you', message);
  send.disabled = true;
  const bot = add('bot', 'Thinking...');
  try {
    const r = await fetch(AGENT_API + '/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const j = await r.json();
    if (j.error) { bot.textContent = 'Error: ' + j.error; }
    else {
      bot.innerHTML = '<strong>' + (j.success ? '\u2705' : '\u26a0\ufe0f') + '</strong> ' + renderMd(j.response || (j.success ? 'Done.' : 'failed'));
      // Inline media from image/video tool results.
      for (const s of (j.results || [])) {
        const r = s.result || {};
        if (!r.success || !r.file) continue;
        const base = location.pathname.replace(/\/$/, '');
        const fname = String(r.file).replace(/\\/g, '/').split('/').pop();
        const isVideo = /\.(mp4|webm|mov)$/i.test(fname);
        const holder = document.createElement('div');
        holder.className = 'msg bot';
        if (isVideo) {
          holder.innerHTML = '<video class="media" controls src="' + base + '/media/' + encodeURIComponent(fname) + '"></video>';
        } else {
          holder.innerHTML = '<img class="media" alt="generated" src="' + base + '/media/' + encodeURIComponent(fname) + '">';
        }
        const cap = document.createElement('div');
        cap.className = 'media-path';
        cap.textContent = fname;
        holder.appendChild(cap);
        log.appendChild(holder);
      }
      for (const s of (j.results || [])) {
        const d = document.createElement('div');
        d.className = 'step';
        const ok = s.result && s.result.success;
        d.innerHTML = (ok ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>') +
          ' ' + esc(s.action.tool) + (s.result && s.result.error ? ' — ' + esc(String(s.result.error).slice(0, 120)) : '');
        log.appendChild(d);
      }
      log.scrollTop = log.scrollHeight;
    }
  } catch (e) {
    bot.textContent = '⚠️ Agent server not reachable (' + e.message + '). Start it with Start-MyAI.bat (port 3000 must be running).';
  }
  send.disabled = false;
  input.focus();
}

send.onclick = go;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
});
