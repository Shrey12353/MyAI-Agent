const { listFiles } = require("../tools/filesystem");
const { runCommand } = require("../tools/terminal");

function detectTool(message) {

    const text = message.toLowerCase();

    // -------------------------------
    // FILESYSTEM
    // -------------------------------

    if (
        text.includes("list the files") ||
        text.includes("show the files") ||
        text.includes("what files") ||
        text.includes("files in")
    ) {
        return "list_files";
    }

    // -------------------------------
    // TERMINAL
    // -------------------------------

    if (
        text.startsWith("run ") ||
        text.startsWith("execute ") ||
        text.includes("run command")
    ) {
        return "run_command";
    }

    return null;
}

function extractFolderPath(message) {

    const windowsPath = message.match(
        /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/
    );

    if (windowsPath) {
        return windowsPath[0];
    }

    return ".";
}

function extractCommand(message) {

    let command = message.trim();

    command = command.replace(
        /^run\s+(the\s+)?(command\s+)?/i,
        ""
    );

    command = command.replace(
        /^execute\s+(the\s+)?(command\s+)?/i,
        ""
    );

    return command.trim();
}

async function runAgent(message) {

    const tool = detectTool(message);

    // ------------------------------------------
    // LIST FILES
    // ------------------------------------------

    if (tool === "list_files") {

        const folderPath = extractFolderPath(message);

        const result = listFiles(folderPath);

        return {
            type: "tool_result",
            tool: "list_files",
            input: folderPath,
            result
        };
    }

    // ------------------------------------------
    // RUN COMMAND
    // ------------------------------------------

    if (tool === "run_command") {

        const command = extractCommand(message);

        const result = await runCommand(command);

        return {
            type: "tool_result",
            tool: "run_command",
            input: command,
            result
        };
    }

    // ------------------------------------------
    // UNKNOWN
    // ------------------------------------------

    return {
        type: "message",
        response:
            "I understand your request, but I don't have a tool for that yet."
    };
}

module.exports = {
    runAgent
};