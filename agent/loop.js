const fs = require("fs");
const path = require("path");

const { chat, extractJson } = require("./llm");
const { runTool } = require("./tools");

const { listFiles } = require("../tools/filesystem");
const { runCommand } = require("../tools/terminal");

const {
    createFolder,
    writeFile,
    readFile
} = require("../tools/file_editor");


const MAX_PLAN_STEPS = 8;

/** Tools served by the central registry (agent/tools.js) rather than the
 *  sandboxed workspace functions below. Inputs are objects. */
const REGISTRY_TOOLS = [
    "fs_list", "fs_read", "fs_write", "fs_create_folder",
    "browser_open", "browser_read", "browser_click", "browser_type",
    "browser_extract", "browser_screenshot",
    "git_status", "git_diff", "git_log", "git_add", "git_commit",
    "web_search", "image_generate", "video_generate",
];
const MAX_FIX_ATTEMPTS = 3;


// ============================================================
// WORKSPACE
// ============================================================

const WORKSPACE = path.resolve(
    process.cwd(),
    "workspace"
);


// ============================================================
// PATH HELPERS
// ============================================================

function normalizePath(input) {

    if (!input || typeof input !== "string") {
        return "";
    }

    return path
        .resolve(input)
        .replace(/[\\/]+/g, "\\")
        .replace(/\\$/, "")
        .toLowerCase();
}


function resolveWorkspacePath(input) {

    if (!input || typeof input !== "string") {
        return null;
    }

    const cleaned =
        input
            .trim()
            .replace(/^["']|["']$/g, "");

    const absolute =
        path.isAbsolute(cleaned)
            ? path.resolve(cleaned)
            : path.resolve(WORKSPACE, cleaned);

    const workspaceNormalized =
        normalizePath(WORKSPACE);

    const absoluteNormalized =
        normalizePath(absolute);

    if (
        absoluteNormalized !== workspaceNormalized &&
        !absoluteNormalized.startsWith(
            workspaceNormalized + "\\"
        )
    ) {

        return null;
    }

    return absolute;
}


// ============================================================
// NORMALIZE ACTION (tolerate common LLM schema slips without an LLM fix)
// ============================================================

function normalizeAction(action) {

    if (!action || typeof action !== "object") {
        return action;
    }

    // Registry tools (browser/git/web/fs_*) take object inputs — leave them alone.
    if (REGISTRY_TOOLS.includes(action.tool)) {
        return action;
    }


    // run_command / read_file / etc. given as {command:...} or {path:...}
    // instead of a plain string — pull the string out.
    if (
        action.tool !== "write_file" &&
        action.input &&
        typeof action.input === "object"
    ) {

        const inner =
            action.input.command ??
            action.input.cmd ??
            action.input.path ??
            action.input.folder ??
            action.input.dir;

        if (typeof inner === "string") {
            action.input = inner;
        }
    }


    // write_file given as {input:{path,content}} — unwrap the nesting.
    if (
        action.tool === "write_file" &&
        action.input &&
        typeof action.input === "object" &&
        action.input.input &&
        typeof action.input.input === "object" &&
        typeof action.input.input.path === "string" &&
        typeof action.input.input.content === "string"
    ) {
        action.input = action.input.input;
    }

    return action;
}


// ============================================================
// VALIDATE ACTION
// ============================================================

function validateAction(action) {

    const allowedTools = [
        "create_folder",
        "write_file",
        "read_file",
        "list_files",
        "run_command"
    ];


    if (
        !action ||
        typeof action !== "object"
    ) {
        return {
            valid: false,
            error: "Invalid action."
        };
    }


    // --------------------------------------------------------
    // REGISTRY TOOLS (browser / git / web / fs_*)
    // --------------------------------------------------------

    if (REGISTRY_TOOLS.includes(action.tool)) {

        if (
            !action.input ||
            typeof action.input !== "object" ||
            Array.isArray(action.input)
        ) {
            action.input = {};
        }

        if (
            action.tool === "web_search" &&
            !String(action.input.query || "").trim()
        ) {
            return {
                valid: false,
                error: "web_search needs input { query }"
            };
        }

        if (
            action.tool === "browser_open" &&
            !String(action.input.url || "").trim()
        ) {
            return {
                valid: false,
                error: "browser_open needs input { url }"
            };
        }

        if (
            action.tool === "git_commit" &&
            !String(action.input.message || "").trim()
        ) {
            return {
                valid: false,
                error: "git_commit needs input { message }"
            };
        }

        return { valid: true };
    }


    if (
        !allowedTools.includes(action.tool)
    ) {

        return {
            valid: false,
            error: "Invalid or unknown tool."
        };
    }


    // --------------------------------------------------------
    // CREATE FOLDER
    // --------------------------------------------------------

    if (action.tool === "create_folder") {

        if (
            typeof action.input !== "string" ||
            !action.input.trim()
        ) {

            return {
                valid: false,
                error: "Invalid folder path."
            };
        }


        if (
            /\.(js|mjs|cjs|json|txt|html|css|jsx|tsx|py)$/i
                .test(action.input.trim())
        ) {

            return {
                valid: false,
                error:
                    "This is a file path. Use write_file instead."
            };
        }


        const resolved =
            resolveWorkspacePath(action.input);


        if (!resolved) {

            return {
                valid: false,
                error:
                    "Folder must be inside the agent workspace."
            };
        }


        action.input = resolved;
    }


    // --------------------------------------------------------
    // WRITE FILE
    // --------------------------------------------------------

    if (action.tool === "write_file") {

        if (
            !action.input ||
            typeof action.input !== "object" ||
            typeof action.input.path !== "string" ||
            typeof action.input.content !== "string"
        ) {

            return {
                valid: false,
                error: "Invalid write_file input."
            };
        }


        const resolved =
            resolveWorkspacePath(
                action.input.path
            );


        if (!resolved) {

            return {
                valid: false,
                error:
                    "File must be inside the agent workspace."
            };
        }


        action.input.path = resolved;
    }


    // --------------------------------------------------------
    // READ FILE
    // --------------------------------------------------------

    if (action.tool === "read_file") {

        if (
            typeof action.input !== "string" ||
            !action.input.trim()
        ) {

            return {
                valid: false,
                error: "Invalid file path."
            };
        }


        const resolved =
            resolveWorkspacePath(action.input);


        if (!resolved) {

            return {
                valid: false,
                error:
                    "File must be inside the agent workspace."
            };
        }


        action.input = resolved;
    }


    // --------------------------------------------------------
    // LIST FILES
    // --------------------------------------------------------

    if (action.tool === "list_files") {

        if (
            typeof action.input !== "string" ||
            !action.input.trim()
        ) {

            return {
                valid: false,
                error: "Invalid folder path."
            };
        }


        const resolved =
            resolveWorkspacePath(action.input);


        if (!resolved) {

            return {
                valid: false,
                error:
                    "Folder must be inside the agent workspace."
            };
        }


        action.input = resolved;
    }


    // --------------------------------------------------------
    // RUN COMMAND
    // --------------------------------------------------------

    if (action.tool === "run_command") {

        if (
            typeof action.input !== "string" ||
            !action.input.trim()
        ) {

            return {
                valid: false,
                error: "Invalid terminal command."
            };
        }


        const command =
            action.input.trim().toLowerCase();


        const forbidden = [
            "mkdir ",
            "mkdir/",
            "mkdir -p",
            "touch ",
            "echo ",
            " > ",
            ">>",
            "rm ",
            "cp ",
            "mv ",
            "chmod ",
            "remove-item",
            "new-item"
        ];


        for (const pattern of forbidden) {

            if (command.includes(pattern)) {

                return {
                    valid: false,
                    error:
                        "Filesystem operations must use the dedicated filesystem tools."
                };
            }
        }


        if (
            /\.(js|mjs|cjs)$/i.test(command) &&
            !/^node\s+/i.test(command)
        ) {

            return {
                valid: false,
                error:
                    "JavaScript files must be executed using Node.js."
            };
        }


        // Run commands from the workspace.
        action.input =
            action.input.replace(
                /^node\s+/i,
                "node "
            );
    }


    return {
        valid: true
    };
}


// ============================================================
// EXECUTE ACTION
// ============================================================

async function executeAction(action) {

    if (REGISTRY_TOOLS.includes(action.tool)) {
        return runTool(action.tool, action.input || {});
    }

    switch (action.tool) {

        case "create_folder":

            return createFolder(
                action.input
            );


        case "write_file":

            return writeFile(
                action.input.path,
                action.input.content
            );


        case "read_file":

            return readFile(
                action.input
            );


        case "list_files":

            return listFiles(
                action.input
            );


        case "run_command":

            return await runCommand(
                action.input
            );


        default:

            return {
                success: false,
                error: "Unknown tool."
            };
    }
}


// ============================================================
// ENSURE WORKSPACE
// ============================================================

function ensureWorkspace() {

    fs.mkdirSync(
        WORKSPACE,
        {
            recursive: true
        }
    );
}


// ============================================================
// ASK QWEN
// ============================================================

async function askQwen(systemPrompt, userMessage) {

    const { content, provider } =
        await chat(
            [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            { kind: "smart" }
        );

    console.log("[llm] " + provider);

    return content.trim();
}


// ============================================================
// PARSE JSON
// ============================================================

function parseJSON(text) {

    const parsed = extractJson(text);

    return parsed && typeof parsed === "object" ? parsed : null;
}


// ============================================================
// CREATE PLAN
// ============================================================

async function createPlan(userMessage) {

    const systemPrompt = `

You are the planning brain of a Windows computer AI agent.

Your job is to convert the user's request into a SHORT ordered plan.

Do NOT execute anything.

Return ONLY valid JSON.

FORMAT:

{
  "goal": "short description",
  "steps": [
    {
      "tool": "create_folder",
      "input": "folder name"
    },
    {
      "tool": "write_file",
      "input": {
        "path": "folder/file.js",
        "content": "..."
      }
    },
    {
      "tool": "run_command",
      "input": "node folder/file.js"
    }
  ]
}


AVAILABLE TOOLS:

create_folder
write_file
read_file
list_files
run_command

ADDITIONAL TOOLS (input is a JSON object):

web_search — input {"query": "..."}
fs_list — input {"path": "folder"}   fs_read — {"path": "file"}
fs_write — {"path": "file", "content": "..."}   fs_create_folder — {"path": "folder"}
browser_open — {"url": "https://..."} then browser_read — {} (gives element refs e0, e1...)
browser_click — {"ref": "e3"}   browser_type — {"ref": "e2", "text": "...", "submit": true}
browser_extract — {"selector": "body"}   browser_screenshot — {"name": "shot"}
git_status — {"cwd": "repo path"}   git_diff — {"cwd": "...", "staged": false}
git_log — {"cwd": "..."}   git_add — {"cwd": "...", "paths": ["."]}   git_commit — {"cwd": "...", "message": "..."}
image_generate — {"prompt": "what to draw", "size": "1024x1024"} → saves a PNG, returns the path
video_generate — {"prompt": "what to film", "seconds": 5} → saves an MP4, returns the path
(push, pull, reset, clean and file deletion are blocked — never plan them)


RULES:

1. Create the plan in logical order.

2. Never create the same folder twice.

3. Never create the same file twice.

4. Use write_file for files.

5. Use create_folder for folders.

6. JavaScript files must be run with node.

7. Paths should be RELATIVE to the workspace.

8. NEVER use:
mkdir
touch
rm
cp
mv
echo >
chmod

9. Do not use Unix/Linux commands.

10. Keep the plan as short as possible.

11. Do not include unnecessary actions.

12. If the user asks to create and run a program, the final step should run the program.

13. Do not use absolute Windows paths.

14. File and folder paths must NOT start with "workspace/" — the system
    resolves paths inside the workspace automatically. To save fruits.md in
    the workspace, write the path as "fruits.md", NOT "workspace/fruits.md".


FORMATTING SKILLS (important):

When the task involves presenting data (comparisons, lists of items, search results,
prices, schedules, file contents), choose a format the user can read at a glance:

- Tables: to make data tables, write the data to a file in Markdown table form
  (rows separated by newlines, cells by |, second line like |---|---|),
  or in CSV with commas.
- Example Markdown table inside a file:
  | Name | Price | Stock |\n|---|---|---|\n| Pen | 10 | 50 |\n| Book | 120 | 7 |
- Example CSV: Name,Price,Stock\nPen,10,50\nBook,120,7
- Use Markdown tables when the user will read it in chat or a .md file;
  use CSV when the user asks for a data file or a spreadsheet.
- Align columns and keep cell text short. Never invent data.

`;


    const raw =
        await askQwen(
            systemPrompt,
            userMessage
        );


    console.log("\nQWEN PLAN:");
    console.log(raw);


    const plan =
        parseJSON(raw);


    if (!plan || !Array.isArray(plan.steps)) {

        return {
            success: false,
            error:
                "Qwen returned an invalid plan.",
            raw
        };
    }


    if (
        plan.steps.length === 0 ||
        plan.steps.length > MAX_PLAN_STEPS
    ) {

        return {
            success: false,
            error:
                "Qwen produced an invalid number of plan steps.",
            plan
        };
    }


    return {
        success: true,
        plan
    };
}


// ============================================================
// EXECUTE PLAN
// ============================================================

async function executePlan(
    userMessage,
    plan
) {

    const results = [];

    let fixAttempts = 0;


    console.log(
        "\n================================="
    );

    console.log(
        "EXECUTING PLAN"
    );

    console.log(
        "================================="
    );


    for (
        let index = 0;
        index < plan.steps.length;
        index++
    ) {

        const stepNumber =
            index + 1;


        let action =
            JSON.parse(
                JSON.stringify(
                    plan.steps[index]
                )
            );

        action = normalizeAction(action);


        console.log(
            `\n========== PLAN STEP ${stepNumber} ==========`
        );

        console.log(
            "ACTION:"
        );

        console.log(action);


        // ----------------------------------------------------
        // VALIDATE
        // ----------------------------------------------------

        const validation =
            validateAction(action);


        if (!validation.valid) {

            console.log(
                "\nPLAN ACTION BLOCKED:"
            );

            console.log(
                validation.error
            );


            const fixed =
                await requestFix(
                    userMessage,
                    plan,
                    results,
                    action,
                    validation.error
                );


            if (!fixed.success) {

                return {
                    success: false,
                    response:
                        fixed.error,
                    results
                };
            }


            action =
                fixed.action;


            const revalidation =
                validateAction(action);


            if (!revalidation.valid) {

                return {
                    success: false,
                    response:
                        revalidation.error,
                    results
                };
            }
        }


        // ----------------------------------------------------
        // SKIP EXISTING FOLDER
        // ----------------------------------------------------

        if (
            action.tool === "create_folder" &&
            fs.existsSync(action.input)
        ) {

            console.log(
                "\nFOLDER ALREADY EXISTS — SKIPPING CREATION."
            );


            results.push({

                step: stepNumber,

                action,

                result: {

                    success: true,

                    skipped: true,

                    alreadyExists: true,

                    path: action.input
                }
            });


            continue;
        }


        // ----------------------------------------------------
        // EXECUTE
        // ----------------------------------------------------

        const result =
            await executeAction(
                action
            );


        console.log(
            "\nTOOL RESULT:"
        );

        console.log(result);


        results.push({

            step: stepNumber,

            action,

            result

        });


        // ----------------------------------------------------
        // SUCCESS
        // ----------------------------------------------------

        if (result.success) {

            continue;
        }


        // ----------------------------------------------------
        // FAILURE → ASK QWEN FOR FIX
        // ----------------------------------------------------

        console.log(
            "\nACTION FAILED — ASKING QWEN FOR A FIX."
        );


        fixAttempts++;


        if (
            fixAttempts > MAX_FIX_ATTEMPTS
        ) {

            return {

                success: false,

                response:
                    "The agent could not recover from the failed action.",

                results
            };
        }


        const fixed =
            await requestFix(
                userMessage,
                plan,
                results,
                action,
                result.error ||
                "Tool execution failed."
            );


        if (!fixed.success) {

            return {

                success: false,

                response:
                    fixed.error,

                results
            };
        }


        // Replace the failed step with Qwen's correction.
        plan.steps[index] =
            fixed.action;


        // Retry same plan position.
        index--;
    }


    return {

        success: true,

        response:
            "Task completed successfully.",

        results
    };
}


// ============================================================
// ASK QWEN TO FIX FAILED PLAN STEP
// ============================================================

async function requestFix(
    userMessage,
    plan,
    results,
    failedAction,
    error
) {

    const systemPrompt = `

You are a repair brain for a Windows computer AI agent.

A planned action failed or was invalid.

Your job is to provide ONE corrected action.

Return ONLY valid JSON:

{
  "tool": "tool_name",
  "input": "..."
}

For write_file:

{
  "tool": "write_file",
  "input": {
    "path": "file path",
    "content": "file contents"
  }
}


AVAILABLE TOOLS:

create_folder
write_file
read_file
list_files
run_command

ADDITIONAL TOOLS (input is a JSON object):

web_search — input {"query": "..."}
fs_list — input {"path": "folder"}   fs_read — {"path": "file"}
fs_write — {"path": "file", "content": "..."}   fs_create_folder — {"path": "folder"}
browser_open — {"url": "https://..."} then browser_read — {} (gives element refs e0, e1...)
browser_click — {"ref": "e3"}   browser_type — {"ref": "e2", "text": "...", "submit": true}
browser_extract — {"selector": "body"}   browser_screenshot — {"name": "shot"}
git_status — {"cwd": "repo path"}   git_diff — {"cwd": "...", "staged": false}
git_log — {"cwd": "..."}   git_add — {"cwd": "...", "paths": ["."]}   git_commit — {"cwd": "...", "message": "..."}
image_generate — {"prompt": "what to draw", "size": "1024x1024"} → saves a PNG, returns the path
video_generate — {"prompt": "what to film", "seconds": 5} → saves an MP4, returns the path
(push, pull, reset, clean and file deletion are blocked — never plan them)


RULES:

- Fix the failed action.
- Do not repeat an action that already succeeded.
- Do not recreate existing folders.
- Use write_file for files.
- Use create_folder for folders.
- JavaScript must run with node.
- Paths must be relative to the workspace.
- Never use mkdir.
- Never use touch.
- Never use rm.
- Never use cp.
- Never use mv.
- Never use echo >.
- Never use Unix/Linux commands.

USER GOAL:

${userMessage}

FAILED ACTION:

${JSON.stringify(
        failedAction,
        null,
        2
    )}

ERROR:

${error}

PREVIOUS RESULTS:

${JSON.stringify(
        results,
        null,
        2
    )}

ORIGINAL PLAN:

${JSON.stringify(
        plan,
        null,
        2
    )}

`;


    const raw =
        await askQwen(
            systemPrompt,
            "Provide the corrected action."
        );


    console.log(
        "\nQWEN FIX:"
    );

    console.log(raw);


    const action =
        parseJSON(raw);


    if (
        !action ||
        !action.tool
    ) {

        return {

            success: false,

            error:
                "Qwen returned an invalid correction."
        };
    }


    return {

        success: true,

        action
    };
}


// ============================================================
// FINAL RESPONSE (present results, with tables where useful)
// ============================================================

function resultDigest(execution) {

    const rows = [];

    for (const r of execution.results || []) {

        const res = r.result || {};
        let data = "";

        if (r.action.tool === "run_command") {
            data = res.stdout || res.stderr || res.error || "";
        } else if (r.action.tool === "web_search") {
            data = JSON.stringify(
                (res.results || []).slice(0, 5).map(x => ({ title: x.title, url: x.url, snippet: (x.snippet || "").slice(0, 140) }))
            );
        } else if (r.action.tool === "fs_read") {
            data = String(res.content || "").slice(0, 600);
        } else if (r.action.tool === "browser_extract") {
            data = String(res.text || "").slice(0, 600);
        } else if (r.action.tool === "browser_open" || r.action.tool === "browser_read") {
            data = String(res.summary || "").slice(0, 400);
        } else if (r.action.tool === "fs_write" || r.action.tool === "write_file") {
            const written = (r.action.input && r.action.input.content) || "";
            data = "wrote " + (res.path || "(file)") + ":\n" + String(written).slice(0, 800);
        } else if (r.action.tool === "fs_create_folder" || r.action.tool === "create_folder") {
            data = "created folder " + (res.path || "(done)");
        } else if (r.action.tool === "git_status") {
            data = String(res.status || "").slice(0, 400);
        } else if (r.action.tool === "git_log") {
            data = String(res.log || "").slice(0, 400);
        } else if (r.action.tool === "git_diff") {
            data = String(res.stat || "").slice(0, 400);
        } else {
            data = JSON.stringify(res).slice(0, 300);
        }

        rows.push({
            step: r.step,
            tool: r.action.tool,
            ok: !!res.success,
            data: String(data).slice(0, 700),
        });
    }

    return rows;
}


async function composeFinalResponse(userMessage, execution) {

    // Failed runs already carry a human-readable reason.
    if (!execution.success) {
        return execution.response || "The task could not be completed.";
    }

    const digest = resultDigest(execution);

    // Nothing to report beyond success?  Keep it short, no LLM call.
    const hasData = digest.some(r => r.data && r.data.length > 0);
    if (!hasData) {
        return execution.response || "Task completed successfully.";
    }

    const systemPrompt = `
You are the reporting voice of a Windows computer AI agent.
The agent just executed the user's task using tools.

Write the final answer the user will read:

1. Start with 1-2 sentences: did it succeed, and what was done.
2. If the tool results contain data the user asked for (search results, file
   contents, command output, page text, lists of items), PRESENT that data.
3. For multiple comparable items, use a Markdown TABLE: header row, then a
   |---|---| separator line, then one row per item. Keep cells short.
4. Use bullet lists for loose items, **bold** for key values, backticks for
   file names and commands, and a fenced code block for code or raw output.
5. NEVER invent data that is not in the tool results. If the data is empty or
   the task failed, say so plainly.
6. Keep it under 150 words unless the data itself needs more.

TASK:
${userMessage}

TOOL RESULTS:
${JSON.stringify(digest, null, 1)}

Write the final answer now.
`;

    try {
        const { content } = await chat(
            [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Write the final answer." },
            ],
            { kind: "fast", json: false }
        );
        const text = String(content || "").trim();
        return text || execution.response;
    } catch {
        // Reporting must never break a successful run.
        return execution.response || "Task completed successfully.";
    }
}


// ============================================================
// MAIN AGENT
// ============================================================

async function runAgentLoop(
    userMessage
) {

    ensureWorkspace();


    console.log(
        "\n================================="
    );

    console.log(
        "MY AI AGENT"
    );

    console.log(
        "WORKSPACE:",
        WORKSPACE
    );

    console.log(
        "================================="
    );


    // --------------------------------------------------------
    // PLAN
    // --------------------------------------------------------

    const planning =
        await createPlan(
            userMessage
        );


    if (!planning.success) {

        return {

            type: "agent_result",

            success: false,

            response:
                planning.error,

            plan:
                planning.plan ||
                null
        };
    }


    const plan =
        planning.plan;


    console.log(
        "\nPLAN CREATED:"
    );

    console.log(
        JSON.stringify(
            plan,
            null,
            2
        )
    );


    // --------------------------------------------------------
    // EXECUTE
    // --------------------------------------------------------

    const execution =
        await executePlan(
            userMessage,
            plan
        );


    const finalResponse =
        await composeFinalResponse(
            userMessage,
            execution
        );


    return {

        type: "agent_result",

        success:
            execution.success,

        response:
            finalResponse,

        plan,

        steps:
            execution.results.length,

        results:
            execution.results
    };
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
    runAgentLoop
};