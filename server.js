const path = require("node:path");
const express = require("express");
const cors = require("cors");

const { runAgent } = require("./agent/controller");
const { runAgentLoop } = require("./agent/loop");
const llm = require("./agent/llm");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ------------------------------------------
// CHAT PAGE (simple built-in UI)
// ------------------------------------------

const CHAT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My AI Agent</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: Segoe UI, system-ui, sans-serif; background:#0f1115; color:#e6e6e6; margin:0; display:flex; justify-content:center; }
  #app { width: min(860px, 96vw); display:flex; flex-direction:column; height:100vh; padding:14px; }
  h1 { font-size:16px; margin:0 0 10px; color:#9ab; font-weight:600; }
  #log { flex:1; overflow-y:auto; padding:8px; background:#161a22; border-radius:10px; }
  .msg { margin:10px 0; padding:10px 12px; border-radius:8px; max-width:92%; white-space:pre-wrap; }
  .you { background:#1f2a3a; margin-left:auto; }
  .bot { background:#1a2029; }
  .step { font-size:12.5px; color:#9ab; margin:3px 0 3px 14px; font-family:Consolas,monospace; }
  .ok { color:#7dd07d; } .bad { color:#e07d7d; }
  .row { display:flex; gap:8px; margin-top:10px; }
  textarea { flex:1; resize:none; height:64px; background:#161a22; color:#e6e6e6; border:1px solid #2a3140; border-radius:8px; padding:10px; font-size:14px; font-family:inherit; }
  button { background:#2f6fdb; border:0; color:#fff; padding:0 22px; border-radius:8px; font-size:14px; cursor:pointer; }
  button:disabled { opacity:.5; cursor:wait; }
  .hint { color:#567; font-size:12px; margin-top:8px; }
  .msg p { margin:6px 0; }
  .msg table { border-collapse:collapse; margin:8px 0; font-size:13.5px; }
  .msg th, .msg td { border:1px solid #2a3140; padding:5px 10px; text-align:left; }
  .msg th { background:#1f2633; color:#bcd; }
  .msg code { background:#11151c; padding:1px 5px; border-radius:4px; font-family:Consolas,monospace; font-size:12.5px; }
  .msg pre { background:#11151c; padding:10px; border-radius:8px; overflow-x:auto; }
  .msg pre code { padding:0; background:none; }
  .msg ul { margin:6px 0 6px 18px; padding:0; }
</style>
</head>
<body>
<div id="app">
  <h1>My AI Agent — tell me what to do</h1>
  <div id="log"></div>
  <div class="row">
    <textarea id="input" placeholder="e.g. Search the web for Node.js 24 and save a 3-line summary to workspace/notes.txt"></textarea>
    <button id="send">Send</button>
  </div>
  <div class="hint">Enter = send &middot; Shift+Enter = new line &middot; agent plans, runs tools, and repairs its own mistakes</div>
</div>
<script>
const log = document.getElementById('log');
const input = document.getElementById('input');
const send = document.getElementById('send');
const FENCE = new RegExp('^' + String.fromCharCode(96).repeat(3));

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  return s
    .replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + ']+)' + String.fromCharCode(96), 'g'), '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function renderMd(src) {
  const lines = String(src || '').split(/\r?\n/);
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const L = lines[i];
    if (FENCE.test(L)) {
      let j = i + 1; const buf = [];
      while (j < lines.length && !FENCE.test(lines[j])) { buf.push(lines[j]); j++; }
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      i = j + 1; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(L); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
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
    const r = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const j = await r.json();
    if (j.error) { bot.textContent = 'Error: ' + j.error; }
    else {
      bot.innerHTML = '<strong>' + (j.success ? '\u2705' : '\u26a0\ufe0f') + '</strong> ' + renderMd(j.response || (j.success ? 'Done.' : 'failed'));
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
    bot.textContent = 'Agent unreachable: ' + e.message;
  }
  send.disabled = false;
  input.focus();
}

send.onclick = go;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
});
</script>
</body>
</html>`;

app.get("/", (req, res) => {
    // Real chat page lives in public/chat.html (the CHAT_PAGE template below
    // is unused legacy — template literals ate its regex backslashes).
    res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// ------------------------------------------
// CHAT / AGENT
// ------------------------------------------

app.get("/api/health", (req, res) => {
    res.json({
        status: "online",
        agent: "My AI Agent",
        llm: llm.status()
    });
});

// ------------------------------------------
// AGENT (self-repairing loop: plan → execute → diagnose → fix → retry)
// ------------------------------------------

app.post("/api/agent", async (req, res) => {

    try {

        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                error: "Message is required"
            });
        }

        const result = await runAgentLoop(message);

        res.json(result);

    } catch (error) {

        console.error("Agent loop error:", error);

        res.status(500).json({
            error: "Agent loop failed."
        });
    }
});

// ------------------------------------------
// CHAT / AGENT (original simple planner — kept)
// ------------------------------------------

app.post("/api/chat", async (req, res) => {

    try {

        const { message } = req.body;

        if (!message) {
            return res.status(400).json({
                error: "Message is required"
            });
        }

        const result = await runAgent(message);

        res.json(result);

    } catch (error) {

        console.error("Agent error:", error);

        res.status(500).json({
            error: "Agent failed."
        });
    }
});

// ------------------------------------------
// START SERVER
// ------------------------------------------

app.listen(PORT, () => {
    console.log(`My AI Agent running at http://localhost:${PORT}`);
});