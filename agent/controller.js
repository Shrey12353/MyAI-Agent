const axios = require("axios");

const { listFiles } = require("../tools/filesystem");
const { runCommand } = require("../tools/terminal");
const {
    createFolder,
    writeFile,
    readFile
} = require("../tools/file_editor");

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "qwen2.5:3b";

async function askAI(userMessage) {
    const response = await axios.post(OLLAMA_URL, {
        model: MODEL,
        messages: [
            {
                role: "system",
                content: `
You are the planning brain of a Windows computer AI agent.

Return ONLY valid JSON.

Available tools:

create_folder
Input: folder path string.

write_file
Input:
{
  "path": "file path",
  "content": "file contents"
}

read_file
Input: file path string.

list_files
Input: folder path string.

run_command
Input: Windows command string.

Rules:

1. Use ONLY the tools above.
2. Create folders using create_folder.
3. Create or modify files using write_file.
4. Read files using read_file.
5. List folders using list_files.
6. Use run_command only for actual terminal commands.
7. Never use mkdir, mkdir -p, touch, echo >, cat, rm, cp, or mv.
8. Never use Unix/Linux commands.
9. To execute JavaScript, use:
   node path/to/file.js
10. Do not execute a JavaScript file by giving only its filename.
11. If multiple actions are required, return them in the correct order.

Example:

{
  "goal": "Create and run a JavaScript file",
  "actions": [
    {
      "tool": "create_folder",
      "input": "AgentTest"
    },
    {
      "tool": "write_file",
      "input": {
        "path": "AgentTest/hello.js",
        "content": "console.log('Hello');"
      }
    },
    {
      "tool": "run_command",
      "input": "node AgentTest/hello.js"
    }
  ]
}
`
            },
            {
                role: "user",
                content: userMessage
            }
        ],
        stream: false,
        format: "json"
    });

    return response.data.message.content.trim();
}

function parsePlan(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function validateAction(action) {
    const allowed = [
        "create_folder",
        "write_file",
        "read_file",
        "list_files",
        "run_command"
    ];

    if (!action || !allowed.includes(action.tool)) {
        return {
            valid: false,
            error: "Unknown or invalid tool."
        };
    }

    if (action.tool === "write_file") {
        if (
            !action.input ||
            typeof action.input.path !== "string" ||
            typeof action.input.content !== "string"
        ) {
            return {
                valid: false,
                error: "Invalid write_file input."
            };
        }
    }

    if (
        ["create_folder", "read_file", "list_files"].includes(action.tool)
    ) {
        if (
            typeof action.input !== "string" ||
            !action.input.trim()
        ) {
            return {
                valid: false,
                error: "Invalid path."
            };
        }
    }

    if (action.tool === "run_command") {
        if (
            typeof action.input !== "string" ||
            !action.input.trim()
        ) {
            return {
                valid: false,
                error: "Invalid command."
            };
        }

        const command = action.input.trim().toLowerCase();

        const forbidden = [
            "mkdir",
            "touch ",
            "echo ",
            "rm ",
            "cp ",
            "mv ",
            "chmod ",
            "remove-item",
            "new-item"
        ];

        for (const item of forbidden) {
            if (command.includes(item)) {
                return {
                    valid: false,
                    error: "Filesystem operation must use the dedicated tool."
                };
            }
        }

        if (
            /\.(js|mjs|cjs)$/i.test(command) &&
            !/^node\s+/i.test(command)
        ) {
            return {
                valid: false,
                error: "JavaScript files must be executed with Node.js."
            };
        }
    }

    return {
        valid: true
    };
}

async function executeAction(action) {
    switch (action.tool) {
        case "create_folder":
            return createFolder(action.input);

        case "write_file":
            return writeFile(
                action.input.path,
                action.input.content
            );

        case "read_file":
            return readFile(action.input);

        case "list_files":
            return listFiles(action.input);

        case "run_command":
            return await runCommand(action.input);

        default:
            return {
                success: false,
                error: "Unknown tool."
            };
    }
}

async function runAgent(userMessage) {
    console.log("\nUSER:", userMessage);

    const rawPlan = await askAI(userMessage);

    console.log("\nAI PLAN:", rawPlan);

    const plan = parsePlan(rawPlan);

    if (
        !plan ||
        !Array.isArray(plan.actions)
    ) {
        return {
            type: "message",
            response: "I couldn't create a valid action plan.",
            rawAIResponse: rawPlan
        };
    }

    const results = [];

    for (const action of plan.actions.slice(0, 10)) {
        console.log("\nACTION:", action);

        const validation = validateAction(action);

        if (!validation.valid) {
            results.push({
                action,
                result: {
                    success: false,
                    blocked: true,
                    error: validation.error
                }
            });

            break;
        }

        const result = await executeAction(action);

        results.push({
            action,
            result
        });

        if (!result.success) {
            break;
        }
    }

    return {
        type: "agent_result",
        goal: plan.goal || userMessage,
        plan: plan.actions.slice(0, 10),
        results
    };
}

module.exports = {
    runAgent
};