const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

process.chdir(path.join(__dirname, "..")); // llm.js reads .env from cwd

const llm = require("../agent/llm");

test("modelFor maps task kinds to gateway models", () => {
    assert.equal(llm.modelFor("fast"), "auto:fast");
    assert.equal(llm.modelFor("smart"), "auto:smart");
    assert.equal(llm.modelFor("anything"), "auto");
});

test("extractJson handles plain JSON", () => {
    assert.deepEqual(llm.extractJson('{"goal":"x"}'), { goal: "x" });
});

test("extractJson handles fenced JSON", () => {
    assert.deepEqual(llm.extractJson('here:\n```json\n{"a":1}\n```\n'), { a: 1 });
});

test("extractJson handles prose around JSON", () => {
    assert.deepEqual(llm.extractJson('Sure! The plan is {"a":1} thanks'), { a: 1 });
});

test("extractJson returns null on garbage", () => {
    assert.equal(llm.extractJson("no json here"), null);
});

test("status reports gateway and fallback", () => {
    const s = llm.status();
    assert.equal(s.gateway, "http://localhost:3001/v1");
    assert.equal(s.localModel, "qwen2.5:3b");
    assert.ok("lastProvider" in s);
});
