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
// HOME
// ------------------------------------------

app.get("/", (req, res) => {
    res.json({
        status: "online",
        agent: "My AI Agent"
    });
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