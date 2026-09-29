const path = require("node:path");

/**
 * Browser tools for MyAI-Agent (Playwright, real Chrome via the "chrome"
 * channel). One shared persistent profile (data/browser-profile), one shared
 * page. Interactive elements get short refs (e0, e1, ...) the model clicks or
 * types by. Every action has a timeout and a structured result.
 */

const PROFILE_DIR = path.join(process.cwd(), "data", "browser-profile");

let context = null;
let page = null;
let launching = null;

async function clearStaleLocks() {
    const fs = require("node:fs/promises");
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try {
            await fs.rm(path.join(PROFILE_DIR, name), { force: true });
        } catch {
            /* best effort */
        }
    }
}

async function getContext() {
    if (context) return context;
    if (launching) return launching;

    launching = (async () => {
        const { chromium } = require("playwright");
        const launch = () => chromium.launchPersistentContext(PROFILE_DIR, {
            headless: true,
            channel: "chrome",
            args: ["--disable-blink-features=AutomationControlled"],
            viewport: { width: 1366, height: 900 },
            ignoreHTTPSErrors: true,
            timeout: 60000,
        });
        try {
            context = await launch();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/existing browser session|ProcessSingleton|user data directory|browser has been closed/i.test(msg)) {
                await clearStaleLocks();
                context = await launch();
            } else {
                throw err;
            }
        }
        context.setDefaultTimeout(15000);
        return context;
    })();

    try {
        return await launching;
    } catch (err) {
        launching = null;
        throw err;
    }
}

async function getPage() {
    if (page && !page.isClosed()) return page;
    const c = await getContext();
    page = await c.newPage();
    return page;
}

/** Short refs for interactive elements so the model can click/type by ref. */
async function domSummary(p) {
    const items = await p.evaluate(() => {
        const els = Array.from(document.querySelectorAll(
            "a, button, input, textarea, select, [role=button]"
        ));
        return els.slice(0, 80).map((el, i) => {
            const tag = el.tagName.toLowerCase();
            const text = el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
            el.dataset.agentRef = "e" + i;
            const href = tag === "a" ? el.href : "";
            const clean = String(text).trim().slice(0, 60).replace(/\s+/g, " ");
            return "e" + i + ": <" + tag + "> " + clean + (href ? " -> " + String(href).slice(0, 80) : "");
        });
    });
    const title = await p.title();
    return "PAGE: " + title + " (" + p.url() + ")\nElements:\n" + (items.join("\n") || "(none)");
}

async function byRef(p, ref) {
    const el = await p.$('[data-agent-ref="' + ref + '"]');
    if (!el) {
        throw new Error("ref " + ref + " not found — call browser_read for fresh refs");
    }
    return el;
}

async function open(args) {
    const p = await getPage();
    await p.goto(String(args.url || "about:blank"), { waitUntil: "domcontentloaded", timeout: 30000 });
    return { success: true, summary: await domSummary(p) };
}

async function read() {
    const p = await getPage();
    const summary = await domSummary(p);
    const text = await p.evaluate(() => (document.body ? document.body.innerText : ""));
    return { success: true, summary, text: String(text).slice(0, 3000) };
}

async function click(args) {
    const p = await getPage();
    const target = args.ref
        ? await byRef(p, String(args.ref))
        : args.selector
            ? await p.$(String(args.selector))
            : null;
    if (!target) return { success: false, error: "element not found (bad ref/selector)" };
    await target.click({ timeout: 10000 });
    await p.waitForTimeout(800);
    return { success: true, summary: await domSummary(p) };
}

async function type(args) {
    const p = await getPage();
    const target = args.ref
        ? await byRef(p, String(args.ref))
        : args.selector
            ? await p.$(String(args.selector))
            : null;
    if (!target) return { success: false, error: "element not found (bad ref/selector)" };
    await target.click({ timeout: 10000 });
    await target.fill(String(args.text == null ? "" : args.text));
    if (args.submit) await p.keyboard.press("Enter");
    await p.waitForTimeout(500);
    return { success: true, summary: await domSummary(p) };
}

async function extract(args) {
    const p = await getPage();
    const sel = String(args.selector || "body");
    const text = await p
        .$eval(sel, (el) => el.innerText)
        .catch(() => "");
    if (!text) return { success: false, error: "selector not found or empty" };
    return { success: true, text: String(text).slice(0, 6000) };
}

async function screenshot(args) {
    const p = await getPage();
    const dir = path.join(process.cwd(), "data", "screenshots");
    require("node:fs").mkdirSync(dir, { recursive: true });
    const file = path.join(dir, String(args.name || "shot") + ".png");
    await p.screenshot({ path: file, fullPage: false });
    return { success: true, file };
}

const TOOLS = {
    browser_open: {
        description: "Open a URL in the browser and list clickable elements with refs (e0, e1...).",
        input: { url: "string (full http(s) URL)" },
        run: open,
    },
    browser_read: {
        description: "Re-read the current page: element refs plus visible text.",
        input: {},
        run: read,
    },
    browser_click: {
        description: "Click an element by ref (from open/read) or CSS selector.",
        input: { ref: "string like e3 (or selector: string)" },
        run: click,
    },
    browser_type: {
        description: "Type text into an input by ref or selector; set submit=true to press Enter.",
        input: { text: "string", ref: "string like e3 (or selector: string)", submit: "boolean" },
        run: type,
    },
    browser_extract: {
        description: "Extract page text, optionally from a CSS selector (articles, search results).",
        input: { selector: "string (optional, default body)" },
        run: extract,
    },
    browser_screenshot: {
        description: "Save a PNG screenshot of the current page under data/screenshots.",
        input: { name: "string (filename without extension)" },
        run: screenshot,
    },
};

module.exports = { getPage, TOOLS };
