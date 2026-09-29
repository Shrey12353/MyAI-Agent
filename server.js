const express = require("express");
const cors = require("cors");

const { runAgent } = require("./agent/controller");

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