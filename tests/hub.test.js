const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const Module = require("node:module");

process.chdir(path.join(__dirname, ".."));

const ROOT = path.join(__dirname, "..");

// ============================================================
// public/chat.js — run the real file against a stub DOM
// ============================================================

function makeEl(tag) {
    return {
        tagName: tag,
        className: "",
        textContent: "",
        innerHTML: "",
        value: "",
        disabled: false,
        children: [],
        handlers: {},
        focused: 0,
        scrollTop: 0,
        scrollHeight: 0,
        style: {},
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        addEventListener(type, fn) {
            (this.handlers[type] = this.handlers[type] || []).push(fn);
        },
        focus() {
            this.focused++;
        },
    };
}

function loadChat({ port, pathname, fetchImpl }) {
    const code = fs.readFileSync(path.join(ROOT, "public", "chat.js"), "utf8");
    const log = makeEl("div");
    const input = makeEl("textarea");
    const send = makeEl("button");

    const ctx = {
        document: {
            getElementById: (id) => ({ log, input, send })[id],
            createElement: makeEl,
        },
        location: { port, pathname },
        fetch: fetchImpl,
    };

    vm.createContext(ctx);
    vm.runInContext(code, ctx, { filename: "chat.js" });

    return { log, input, send, busy: () => vm.runInContext("busy", ctx) };
}

/** fetch that hands back a promise the test resolves, so "in flight" is explicit. */
function deferredFetch() {
    const calls = [];
    const pending = [];
    const fetchImpl = (url, opts) => {
        calls.push({ url, opts });
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    return { calls, pending, fetchImpl };
}

const reply = (body) => ({ json: async () => body });
const embed = (fetchImpl) => loadChat({ port: "3001", pathname: "/hub", fetchImpl });

test("chat: empty and whitespace-only submits are no-ops that leave the gate open", async () => {
    const { fetchImpl, calls } = deferredFetch();
    const chat = embed(fetchImpl);

    chat.input.value = "";
    await chat.send.onclick();
    chat.input.value = "   ";
    await chat.send.onclick();

    assert.equal(calls.length, 0, "no request should be made");
    assert.equal(chat.busy(), false, "gate must not latch on an empty submit");
    assert.equal(chat.send.disabled, false);
});

test("chat: a second submit while one is in flight is refused, and the typed text survives", async () => {
    const net = deferredFetch();
    const chat = embed(net.fetchImpl);

    chat.input.value = "first";
    const first = chat.send.onclick();
    chat.input.value = "second";
    const second = chat.send.onclick();
    await second;

    assert.equal(net.calls.length, 1, "the in-flight run must not be duplicated");
    assert.equal(chat.busy(), true);
    assert.equal(chat.send.disabled, true);
    assert.equal(chat.input.value, "second", "refused input must not be swallowed");

    net.pending[0].resolve(reply({ success: true, response: "done", results: [] }));
    await first;
});

test("chat: the gate is released after success, after failure, and accepts the next submit", async () => {
    const { fetchImpl, pending, calls } = deferredFetch();
    const chat = embed(fetchImpl);

    // success path
    chat.input.value = "first";
    const first = chat.send.onclick();
    pending[0].resolve(reply({ success: true, response: "done", results: [] }));
    await first;
    assert.equal(chat.busy(), false, "gate released after success");
    assert.equal(chat.send.disabled, false);

    // failure path — must not leave the UI locked
    chat.input.value = "second";
    const second = chat.send.onclick();
    pending[1].reject(new Error("fetch failed"));
    await second;
    assert.equal(chat.busy(), false, "gate released after a network failure");
    assert.equal(chat.send.disabled, false);
    const last = chat.log.children[chat.log.children.length - 1].textContent;
    assert.match(last, /not reachable/, "failure must be reported to the user");

    // and a later attempt is accepted
    chat.input.value = "third";
    const third = chat.send.onclick();
    assert.equal(calls.length, 3, "a submit after a failure must be accepted");
    pending[2].resolve(reply({ success: true, response: "ok", results: [] }));
    await third;
});

test("chat: the request target follows where the page is served from", async () => {
    // chat.js is the standalone agent server's page (served at / on :3000).
    // The gateway hub is Jarvis-only now and no longer serves this file, so
    // there is no /hub/api/agent proxy to target.
    const standalone = deferredFetch();
    const local = loadChat({ port: "3000", pathname: "/", fetchImpl: standalone.fetchImpl });
    local.input.value = "x";
    local.send.onclick();
    assert.equal(standalone.calls[0].url, "/api/agent");
});

// ============================================================
// agent/loop.js — planner step-count boundary
// ============================================================

const MAX_PLAN_STEPS = 8;

function mkPlan(steps) {
    return JSON.stringify({
        goal: "test",
        steps: Array.from({ length: steps }, () => ({ tool: "fs_list", input: { path: "." } })),
    });
}

/**
 * Load loop.js with only the LLM boundary faked; extractJson and the tool
 * registry stay real. nextContent() supplies each successive model reply.
 */
function loadLoop(nextContent) {
    const realLlm = require(path.join(ROOT, "agent", "llm.js"));
    // askQwen destructures { content, provider } from chat() and calls content.trim().
    const stubbedLlm = Object.assign({}, realLlm, {
        chat: async () => ({ content: nextContent(), provider: "test" }),
    });

    const loopPath = require.resolve(path.join(ROOT, "agent", "loop.js"));
    // loop.js resolves ./llm once at load time, so a cached copy would keep the
    // previous stub. Reload it per test.
    delete require.cache[loopPath];

    const origLoad = Module._load;
    Module._load = function (request, parent) {
        if (request === "./llm" && parent && /loop\.js$/.test(parent.filename)) return stubbedLlm;
        return origLoad.apply(this, arguments);
    };
    try {
        return require(loopPath).runAgentLoop;
    } finally {
        Module._load = origLoad;
    }
}

/** Runs runAgentLoop with the loop's chatty logging suppressed. */
async function runQuiet(runAgentLoop, message) {
    const quiet = console.log;
    console.log = () => {};
    try {
        return await runAgentLoop(message);
    } finally {
        console.log = quiet;
    }
}

test("planner: an empty plan means no tools are needed, so the message is answered directly", async () => {
    // First model call is the planner (empty plan), second is the direct answer.
    const queue = [
        JSON.stringify({ goal: "answer directly", steps: [] }),
        "Hello! I'm your local assistant. Ask me anything, or give me a task to run.",
    ];
    const runAgentLoop = loadLoop(() => queue.shift() || "{}");

    const r = await runQuiet(runAgentLoop, "hi there");

    assert.equal(r.success, true, "a conversational message must not be reported as a failure");
    assert.match(String(r.response), /local assistant/);
    assert.equal(r.steps, 0);
    assert.deepEqual(r.results, []);
    assert.doesNotMatch(String(r.response), /planner|qwen/i, "no internal planning language in a chat reply");
});

test("planner: if no model can be reached for the direct answer, it says so instead of failing silently", async () => {
    const queue = [JSON.stringify({ goal: "answer directly", steps: [] })];
    // Planner succeeds, then the answering model is unreachable.
    const runAgentLoop = loadLoop(() => {
        if (queue.length) return queue.shift();
        throw new Error("gateway down");
    });

    const r = await runQuiet(runAgentLoop, "hi there");

    assert.equal(r.success, false, "an unanswered question is not a success");
    assert.match(String(r.response), /couldn't reach a model/);
    assert.match(String(r.response), /Start-MyAI\.bat/, "the message must say how to fix it");
});

test("planner: 1..8 steps are accepted, more than MAX_PLAN_STEPS is rejected", async () => {
    const rawRef = { value: "" };
    const runAgentLoop = loadLoop(() => rawRef.value);

    const observed = [];
    for (const steps of [1, MAX_PLAN_STEPS, MAX_PLAN_STEPS + 1]) {
        rawRef.value = mkPlan(steps);
        const r = await runQuiet(runAgentLoop, "boundary probe");
        observed.push({ steps, success: !!r.success, response: String(r.response || "") });
    }

    const at = (n) => observed.find((o) => o.steps === n);

    assert.equal(at(1).success, true, "a single step is accepted");
    assert.equal(at(MAX_PLAN_STEPS).success, true, "a full plan at the limit is accepted");
    assert.equal(at(MAX_PLAN_STEPS + 1).success, false, "an oversized plan is an error");
    assert.match(at(MAX_PLAN_STEPS + 1).response, /more than 8 steps/);
    assert.doesNotMatch(at(MAX_PLAN_STEPS + 1).response, /qwen/i, "internal model names must not reach the user");
});

test("repair: a failed step whose correction is unusable reports something actionable", async () => {
    // A valid tool that fails at execution, then a repair reply with no .tool,
    // which executePlan returns to the caller as the user-visible response.
    const queue = [
        JSON.stringify({ goal: "test", steps: [{ tool: "fs_read", input: { path: "missing-probe-file-xyz.txt" } }] }),
        JSON.stringify({ note: "no tool here" }),
    ];
    const runAgentLoop = loadLoop(() => (queue.length ? queue.shift() : JSON.stringify({ note: "no tool here" })));

    const r = await runQuiet(runAgentLoop, "repair probe");

    assert.equal(r.success, false);
    const response = String(r.response);
    assert.match(response, /couldn't produce a valid correction/, "got: " + response);
    assert.doesNotMatch(response, /qwen|ollama|groq/i, "internal model names must not reach the user");
});
