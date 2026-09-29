const axios = require("axios");
require("dotenv").config();

/**
 * LLM abstraction for MyAI-Agent.
 *
 *   agent code → llm.chat() → FreeLLMAPI gateway (auto model routing, failover)
 *                          ↘ Ollama (local Qwen) if the gateway is unreachable
 *
 * The gateway (FreeLLMAPI, http://localhost:3001/v1) pools every free provider
 * key you add to it and picks the best available model per request. Model is
 * never hard-coded: "auto" (default), "auto:smart" (hard reasoning/coding),
 * "auto:fast" (speed). If the whole gateway is down, requests fall back to the
 * local Ollama model, exactly like the original agent did.
 */

const BASE = (process.env.FREELLMAPI_BASE_URL || "http://localhost:3001/v1").replace(/\/+$/, "");
const KEY = process.env.FREELLMAPI_API_KEY || "";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";

const CLOUD_TIMEOUT_MS = Number(process.env.FREELLMAPI_TIMEOUT_MS || 120000);
const LOCAL_TIMEOUT_MS = 180000;

/** How long to skip the gateway after it failed, before probing it again. */
const RETRY_GATEWAY_AFTER_MS = 60000;

let cloudDownUntil = 0;
let lastProvider = "none";

function modelFor(kind) {
    if (kind === "smart") return "auto:smart";
    if (kind === "fast") return "auto:fast";
    return "auto";
}

/** Pull the first JSON object/array out of a response that may have markdown fences or prose. */
function extractJson(text) {
    if (typeof text !== "string") return text;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    try {
        return JSON.parse(candidate);
    } catch {
        const start = candidate.search(/[[{]/);
        const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
        if (start !== -1 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

async function chatCloud(messages, kind, json) {
    const body = {
        model: modelFor(kind),
        messages,
        temperature: 0.2,
    };
    if (json) body.response_format = { type: "json_object" };

    const res = await axios.post(BASE + "/chat/completions", body, {
        headers: KEY ? { Authorization: "Bearer " + KEY } : {},
        timeout: CLOUD_TIMEOUT_MS,
    });
    return res.data.choices[0].message.content;
}

async function chatLocal(messages, json) {
    const res = await axios.post(
        OLLAMA_URL,
        {
            model: OLLAMA_MODEL,
            messages,
            stream: false,
            format: json ? "json" : undefined,
            options: { temperature: 0.2 },
        },
        { timeout: LOCAL_TIMEOUT_MS }
    );
    return res.data.message.content;
}

function isGatewayUsable() {
    return Date.now() >= cloudDownUntil;
}

function markGatewayDown() {
    cloudDownUntil = Date.now() + RETRY_GATEWAY_AFTER_MS;
}

/**
 * Send a chat request. Returns { content, provider }.
 * opts.kind: "auto" | "smart" | "fast"
 * opts.json: ask for JSON output (default true, as both planners need it)
 */
async function chat(messages, opts = {}) {
    const kind = opts.kind || "auto";
    const json = opts.json !== false;

    if (isGatewayUsable()) {
        try {
            const content = await chatCloud(messages, kind, json);
            lastProvider = "freellmapi:" + modelFor(kind);
            return { content, provider: lastProvider };
        } catch (err) {
            const status = err.response ? err.response.status : 0;
            const reason = err.response ? "HTTP " + status : err.message;
            console.warn("[llm] gateway unavailable (" + reason + ") → falling back to Ollama " + OLLAMA_MODEL);
            // Network failure or auth/quota/server errors: gateway can't serve us now.
            if (!err.response || status === 401 || status === 403 || status === 429 || status >= 500) {
                markGatewayDown();
            }
        }
    }

    const content = await chatLocal(messages, json);
    lastProvider = "ollama:" + OLLAMA_MODEL;
    return { content, provider: lastProvider };
}

/** Which backend answered last (for logs/health). */
function status() {
    return {
        gateway: BASE,
        gatewayModel: "auto | auto:smart | auto:fast",
        localModel: OLLAMA_MODEL,
        lastProvider,
        gatewayCooldown: isGatewayUsable() ? false : Math.ceil((cloudDownUntil - Date.now()) / 1000) + "s",
    };
}

module.exports = {
    chat,
    extractJson,
    modelFor,
    status,
};
