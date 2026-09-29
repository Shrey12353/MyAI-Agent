const { execFile } = require("node:child_process");
const path = require("node:path");

/**
 * Git tools for MyAI-Agent.
 * Read and commit-level operations run directly. Anything that reaches the
 * network (push/pull/fetch) or rewrites history (reset --hard, clean) is
 * BLOCKED here and returns needsConfirmation=true — the caller (server layer)
 * must ask the human before ever running it.
 */

const CWD = process.cwd();

function git(args, opts = {}) {
    return new Promise((resolve) => {
        execFile(
            "git",
            args,
            { cwd: opts.cwd || CWD, timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true },
            (err, stdout, stderr) => {
                resolve({
                    success: !err,
                    code: err ? err.code : 0,
                    stdout: String(stdout || "").trim(),
                    stderr: String(stderr || err && err.message || "").trim(),
                });
            }
        );
    });
}

function isRepo(cwd) {
    return git(["rev-parse", "--is-inside-work-tree"], { cwd }).then((r) =>
        r.success && r.stdout === "true"
    );
}

async function resolveCwd(cwd) {
    if (!cwd) return CWD;
    const abs = path.resolve(String(cwd));
    if (!(await isRepo(abs))) {
        return { error: "not a git repository: " + abs };
    }
    return { cwd: abs };
}

async function status(args) {
    const r = await resolveCwd(args && args.cwd);
    if (r.error) return { success: false, error: r.error };
    const out = await git(["status", "--short", "--branch"], { cwd: r.cwd });
    return { success: out.success, status: out.stdout, error: out.stderr || undefined };
}

async function diff(args) {
    const r = await resolveCwd(args && args.cwd);
    if (r.error) return { success: false, error: r.error };
    const staged = args && args.staged;
    const out = await git(["diff", staged ? "--staged" : "", "--stat"].filter(Boolean), { cwd: r.cwd });
    const full = await git(["diff", staged ? "--staged" : ""].filter(Boolean), { cwd: r.cwd });
    return { success: out.success, stat: out.stdout, diff: full.stdout.slice(0, 8000), error: full.stderr || undefined };
}

async function log(args) {
    const r = await resolveCwd(args && args.cwd);
    if (r.error) return { success: false, error: r.error };
    const n = Math.min(Math.max(parseInt((args && args.count) || "10", 10) || 10, 1), 50);
    const out = await git(["log", "--oneline", "-" + n], { cwd: r.cwd });
    return { success: out.success, log: out.stdout, error: out.stderr || undefined };
}

async function add(args) {
    const r = await resolveCwd(args && args.cwd);
    if (r.error) return { success: false, error: r.error };
    const paths = Array.isArray(args && args.paths) && args.paths.length ? args.paths : ["."];
    const out = await git(["add", "--", ...paths], { cwd: r.cwd });
    return { success: out.success, output: out.stdout || out.stderr };
}

async function commit(args) {
    const r = await resolveCwd(args && args.cwd);
    if (r.error) return { success: false, error: r.error };
    const message = String((args && args.message) || "").trim();
    if (!message) return { success: false, error: "commit message required" };

    // Refuse to commit nothing (avoids confusing failures).
    const staged = await git(["diff", "--staged", "--quiet"], { cwd: r.cwd });
    if (staged.success) {
        return { success: false, error: "nothing is staged — call git_add first" };
    }
    const out = await git(["commit", "-m", message], { cwd: r.cwd });
    return { success: out.success, output: (out.stdout || out.stderr).slice(0, 2000) };
}

const BLOCKED_OPERATIONS = {
    git_push: "uploads your commits to a remote — irreversible outside your PC",
    git_pull: "changes local branches from the network",
    git_fetch: "network operation",
    git_reset_hard: "destroys uncommitted work permanently",
    git_clean: "deletes untracked files permanently",
    git_branch_delete: "removes a branch permanently",
};

/** Returns the warning entry for a blocked op, or null if allowed. */
function checkBlocked(toolName) {
    return BLOCKED_OPERATIONS[toolName] || null;
}

const TOOLS = {
    git_status: {
        description: "Show branch + changed files for a git repository.",
        input: { cwd: "string (optional, defaults to the agent project)" },
        run: status,
    },
    git_diff: {
        description: "Show uncommitted changes (set staged=true for staged ones).",
        input: { cwd: "string (optional)", staged: "boolean (optional)" },
        run: diff,
    },
    git_log: {
        description: "Show recent commit history.",
        input: { cwd: "string (optional)", count: "number (optional, default 10)" },
        run: log,
    },
    git_add: {
        description: "Stage files for commit (paths array, default all).",
        input: { paths: "string[] (optional)", cwd: "string (optional)" },
        run: add,
    },
    git_commit: {
        description: "Commit staged changes with a message.",
        input: { message: "string", cwd: "string (optional)" },
        run: commit,
    },
};

module.exports = { TOOLS, BLOCKED_OPERATIONS, checkBlocked };
