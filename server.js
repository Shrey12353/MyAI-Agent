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

// (chat page lives in public/chat.html)

app.get("/", (req, res) => {
    // Real chat page lives in public/chat.html (the CHAT_PAGE template below
    // is unused legacy — template literals ate its regex backslashes).
    res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Static assets for the chat page.
app.use("/chat", express.static(path.join(__dirname, "public")));

// The page loads its script as /hub/chat.js so that the same HTML also works
// when the gateway serves it at /hub. Mount the folder there too.
app.use("/hub", express.static(path.join(__dirname, "public")));

// Generated media (images/videos) so the chat page can render them inline.
app.use("/media", express.static(path.join(__dirname, "workspace", "media")));

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