const { exec } = require("child_process");

const BLOCKED_PATTERNS = [
    /format\s+[a-z]:/i,
    /del\s+\/[sfq]/i,
    /rd\s+\/[sq]/i,
    /rmdir\s+\/[sq]/i,
    /shutdown/i,
    /restart-computer/i,
    /remove-item/i,
    /rm\s+-rf/i,
    /diskpart/i
];

function isDangerous(command) {
    return BLOCKED_PATTERNS.some(pattern => pattern.test(command));
}

function runCommand(command) {
    return new Promise((resolve) => {

        if (!command || !command.trim()) {
            return resolve({
                success: false,
                error: "No command provided."
            });
        }

        if (isDangerous(command)) {
            return resolve({
                success: false,
                blocked: true,
                error: "This command is blocked because it may be destructive."
            });
        }

        exec(
            command,
            {
                cwd: process.cwd(),
                timeout: 30000,
                maxBuffer: 1024 * 1024
            },
            (error, stdout, stderr) => {

                resolve({
                    success: !error,
                    command,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    error: error ? error.message : null
                });

            }
        );
    });
}

module.exports = {
    runCommand
};