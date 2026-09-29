const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");

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

function mediaDir() {
    const dir = path.join(process.cwd(), "workspace", "media");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function gatewayConfig() {
    require("dotenv").config();
    return {
        base: (process.env.FREELLMAPI_BASE_URL || "http://localhost:3001/v1").replace(/\/+$/, ""),
        key: process.env.FREELLMAPI_API_KEY || "",
    };
}

/** Generate an image via the gateway's /v1/images/generations. */
async function imageGenerate(args) {
    const prompt = String((args && args.prompt) || "").trim();
    if (!prompt) return { success: false, error: "prompt required" };
    const { base, key } = gatewayConfig();
    if (!key) return { success: false, error: "FREELLMAPI_API_KEY missing in .env" };
    try {
        const r = await axios.post(
            base + "/images/generations",
            {
                model: String(args.model || "auto"),
                prompt,
                n: 1,
                size: String(args.size || "1024x1024"),
            },
            { headers: { Authorization: "Bearer " + key }, timeout: 180000 }
        );
        const item = (r.data.data || [])[0] || {};
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        let bytes = null;
        if (item.b64_json) {
            bytes = Buffer.from(item.b64_json, "base64");
        } else if (item.url) {
            const img = await axios.get(item.url, { responseType: "arraybuffer", timeout: 120000 });
            bytes = Buffer.from(img.data);
        }
        if (!bytes) {
            return { success: false, error: "gateway returned no image data: " + JSON.stringify(r.data).slice(0, 200) };
        }
        // Name the extension by real content (Cloudflare serves JPEG bytes).
        const isPng = bytes.length > 8 && bytes.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
        const ext = isPng ? "png" : isJpeg ? "jpg" : "png";
        const file = path.join(mediaDir(), "image-" + stamp + "." + ext);
        fs.writeFileSync(file, bytes);
        return { success: true, file, model: item.model || r.headers["x-routed-via"] || "auto", prompt };
    } catch (err) {
        const body = err.response ? JSON.stringify(err.response.data).slice(0, 250) : err.message;
        return { success: false, error: "image generation failed: " + body };
    }
}

/** Generate a video via the gateway's /v1/videos/generations (returns an MP4 path). */
async function videoGenerate(args) {
    const prompt = String((args && args.prompt) || "").trim();
    if (!prompt) return { success: false, error: "prompt required" };
    const { base, key } = gatewayConfig();
    if (!key) return { success: false, error: "FREELLMAPI_API_KEY missing in .env" };
    try {
        const r = await axios.post(
            base + "/videos/generations",
            {
                model: String(args.model || "auto"),
                prompt,
                seconds: Number(args.seconds || 5),
            },
            { headers: { Authorization: "Bearer " + key }, timeout: 600000 }
        );
        const d = r.data;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const file = path.join(mediaDir(), "video-" + stamp + ".mp4");
        if (d.b64_json || (d.data && d.data[0] && d.data[0].b64_json)) {
            const b64 = d.b64_json || d.data[0].b64_json;
            fs.writeFileSync(file, Buffer.from(b64, "base64"));
        } else if (d.url || (d.data && d.data[0] && d.data[0].url)) {
            const url = d.url || d.data[0].url;
            const vid = await axios.get(url, { responseType: "arraybuffer", timeout: 300000 });
            fs.writeFileSync(file, Buffer.from(vid.data));
        } else {
            return { success: false, error: "gateway returned no video data: " + JSON.stringify(d).slice(0, 250) };
        }
        return { success: true, file, prompt };
    } catch (err) {
        const body = err.response ? JSON.stringify(err.response.data).slice(0, 250) : err.message;
        return { success: false, error: "video generation failed: " + body };
    }
}

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

const MEDIA_TOOLS = {
    image_generate: {
        description: "Generate an image from a text prompt via the FreeLLMAPI gateway (needs an image provider key, e.g. Google or Cloudflare). Saves a PNG under workspace/media and returns the path.",
        input: { prompt: "string (what to draw)", size: "string (optional, e.g. 1024x1024)", model: "string (optional, default auto)" },
        run: imageGenerate,
    },
    video_generate: {
        description: "Generate a short video from a text prompt via the FreeLLMAPI gateway (needs a video provider key, e.g. ModelScope/Google). Saves an MP4 under workspace/media and returns the path.",
        input: { prompt: "string (what to film)", seconds: "number (optional, default 5)", model: "string (optional, default auto)" },
        run: videoGenerate,
    },
};

const ALL_TOOLS = {
    ...FILESYSTEM_TOOLS,
    ...browserTools,
    ...gitTools,
    ...webTools,
    ...MEDIA_TOOLS,
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
