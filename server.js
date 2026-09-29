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
      bot.textContent = j.success ? 'Done.' : 'Could not finish: ' + (j.response || 'failed');
      for (const s of (j.results || [])) {
        const d = document.createElement('div');
        d.className = 'step';
        const ok = s.result && s.result.success;
        d.innerHTML = (ok ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>') +
          ' ' + s.action.tool + (s.result && s.result.error ? ' — ' + String(s.result.error).slice(0, 120) : '');
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
    res.type("html").send(CHAT_PAGE);
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