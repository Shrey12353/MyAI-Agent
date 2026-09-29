const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

process.chdir(path.join(__dirname, ".."));

const { ALL_TOOLS, runTool } = require("../agent/tools");
const { parseBingHelpers } = require("./helpers");

test("catalog exposes the expected tool surface", () => {
    for (const name of [
        "fs_list", "fs_read", "fs_write", "fs_create_folder",
        "browser_open", "browser_read", "browser_click", "browser_type",
        "browser_extract", "browser_screenshot",
        "git_status", "git_diff", "git_log", "git_add", "git_commit",
        "web_search",
    ]) {
        assert.ok(ALL_TOOLS[name], "missing tool: " + name);
    }
});

test("destructive operations are gated behind confirmation", async () => {
    const push = await runTool("git_push", {});
    assert.equal(push.needsConfirmation, true);
    const del = await runTool("fs_delete", { path: "whatever" });
    assert.equal(del.needsConfirmation, true);
    const hard = await runTool("git_reset_hard", {});
    assert.equal(hard.needsConfirmation, true);
});

test("unknown tools fail cleanly", async () => {
    const r = await runTool("definitely_not_a_tool", {});
    assert.equal(r.success, false);
    assert.match(r.error, /unknown tool/);
});

test("fs tools round-trip through the registry", async () => {
    const folder = await runTool("fs_create_folder", { path: "data/registry-test" });
    assert.equal(folder.success, true);
    const write = await runTool("fs_write", { path: "data/registry-test/x.txt", content: "hello" });
    assert.equal(write.success, true);
    const read = await runTool("fs_read", { path: "data/registry-test/x.txt" });
    assert.equal(read.success, true);
    assert.equal(read.content, "hello");
});

test("bing parser extracts and decodes tracking URLs", () => {
    const html = '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8=">Example Site</a></h2><p class="b_lineclamp">A sample snippet.</p></li>';
    const out = parseBingHelpers(html, 5);
    assert.equal(out.length, 1);
    assert.equal(out[0].url, "https://example.com/");
    assert.equal(out[0].title, "Example Site");
    assert.equal(out[0].snippet, "A sample snippet.");
});

test("bing parser skips malformed blocks", () => {
    const html = '<li class="b_algo"><h2><a href="/relative">No URL</a></h2></li><li class="b_algo"><h2><a href="https://ok.example/x">Fine</a></h2></li>';
    const out = parseBingHelpers(html, 5);
    assert.equal(out.length, 1);
    assert.equal(out[0].url, "https://ok.example/x");
});
