const { TOOLS: browserTools, getPage } = require("../tools/browser");
const { TOOLS: gitTools, BLOCKED_OPERATIONS, checkBlocked } = require("../tools/git");
const { TOOLS: webTools } = require("../tools/web");
const { listFiles } = require("../tools/filesystem");
const { createFolder, writeFile, readFile } = require("../tools/file_editor");
const { runCommand } = require("../tools/terminal");

/**
 * Central tool registry.
 *
 * runTool(name, args) → { success, ...result | error }
 *
 * Filesystem tools keep the original signatures (the two existing planners
 * call them directly too). Destructive operations (git push/pull/reset/clean,
 * file delete) are NEVER executed here — they return
 * { needsConfirmation, reason } and the server layer asks the human.
 */

const FILESYSTEM_TOOLS = {
    fs_list: {
        description: "List files and folders in a directory.",
        input: { path: "string" },
        run: (args) => listFiles(String(args.path || ".")),
    },
    fs_read: {
        description: "Read a text file.",
        input: { path: "string" },
        run: (args) => readFile(String(args.path)),
    },
    fs_write: {
        description: "Create or overwrite a text file.",
        input: { path: "string", content: "string" },
        run: (args) => writeFile(String(args.path), String(args.content == null ? "" : args.content)),
    },
    fs_create_folder: {
        description: "Create a folder (nested paths allowed).",
        input: { path: "string" },
        run: (args) => createFolder(String(args.path)),
    },
};

const CONFIRM_REQUIRED = {
    fs_delete: "permanently deletes a file or folder",
};

const ALL_TOOLS = {
    ...FILESYSTEM_TOOLS,
    ...browserTools,
    ...gitTools,
    ...webTools,
};

function toolCatalog() {
    return Object.entries(ALL_TOOLS)
        .map(([name, t]) => "- " + name + ": " + t.description)
        .join("\n");
}

async function runTool(name, args) {
    const tool = ALL_TOOLS[name];

    if (!tool) {
        const blocked = checkBlocked(name);
        if (blocked) {
            return { success: false, needsConfirmation: true, tool: name, reason: blocked };
        }
        if (CONFIRM_REQUIRED[name]) {
            return { success: false, needsConfirmation: true, tool: name, reason: CONFIRM_REQUIRED[name] };
        }
        return { success: false, error: "unknown tool: " + name };
    }

    if (CONFIRM_REQUIRED[name]) {
        return {
            success: false,
            needsConfirmation: true,
            tool: name,
            reason: CONFIRM_REQUIRED[name],
        };
    }

    try {
        const result = await tool.run(args || {});
        return result && typeof result === "object" ? result : { success: true, result };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}

module.exports = { ALL_TOOLS, runTool, toolCatalog, checkBlocked, BLOCKED_OPERATIONS, getPage };
