const axios = require("axios");

/**
 * Web search for MyAI-Agent — keyless.
 * Order: 1) Bing over plain HTTP (works reliably, no key),
 *        2) DuckDuckGo lite/html over plain HTTP,
 *        3) DuckDuckGo rendered in the agent's real Chrome (last resort).
 * Returns { via, results: [{title, url, snippet}] }.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function decodeEntities(s) {
    return String(s)
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&#(\d+);/g, (_, n) => {
            try {
                return String.fromCodePoint(Number(n));
            } catch {
                return "";
            }
        })
        .replace(/\s+/g, " ")
        .trim();
}

/** Bing wraps result URLs in /ck/a?...&u=a1<base64> tracking links — decode them. */
function decodeBingUrl(u) {
    const href = String(u).replace(/&amp;/g, "&");
    const m = href.match(/[?&]u=a1([A-Za-z0-9_-]{20,})/);
    if (m) {
        try {
            const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
            const decoded = Buffer.from(b64, "base64").toString("utf8");
            if (/^https?:\/\//.test(decoded)) return decoded;
        } catch {
            /* keep original */
        }
    }
    return u;
}

function parseBing(html, limit) {
    const out = [];
    const blocks = String(html).split('<li class="b_algo').slice(1);
    for (const b of blocks) {
        if (out.length >= limit) break;
        const am = b.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!am) continue;
        const url = decodeBingUrl(am[1]);
        const title = decodeEntities(am[2]);
        if (!/^https?:\/\//.test(url) || !title) continue;
        const sm =
            b.match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
            b.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
        const snippet = sm ? decodeEntities(sm[1]) : "";
        out.push({ title, url, snippet: snippet.slice(0, 300) });
    }
    return out;
}

function unwrapDdgUrl(href) {
    const m = String(href).match(/[?&]uddg=([^&]+)/);
    if (m) {
        try {
            return decodeURIComponent(m[1]);
        } catch {
            return href;
        }
    }
    return href;
}

function parseDdg(html, limit) {
    const results = [];
    const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(String(html))) && results.length < limit) {
        const url = unwrapDdgUrl(m[1]);
        const title = decodeEntities(m[2]);
        if (url.startsWith("http") && title) results.push({ title, url, snippet: "" });
    }
    return results;
}

async function viaBing(query, limit) {
    try {
        const r = await axios.get("https://www.bing.com/search", {
            params: { q: query, count: limit },
            timeout: 15000,
            headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
        });
        return parseBing(r.data, limit);
    } catch {
        return [];
    }
}

async function viaDdgHttp(query, limit) {
    try {
        const r = await axios.get("https://lite.duckduckgo.com/lite/", {
            params: { q: query },
            timeout: 15000,
            headers: { "User-Agent": UA },
        });
        const results = parseDdg(String(r.data).replace(/result-link/g, "result__a"), limit);
        if (results.length) return results;
    } catch {
        /* fall through */
    }
    try {
        const r = await axios.post(
            "https://html.duckduckgo.com/html/",
            new URLSearchParams({ q: query }).toString(),
            {
                timeout: 15000,
                headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
            }
        );
        return parseDdg(r.data, limit);
    } catch {
        return [];
    }
}

/** Last resort: render DuckDuckGo in the agent's real Chrome. */
async function viaBrowser(query, limit) {
    const { getPage } = require("./browser");
    const p = await getPage();
    await p.goto("https://www.bing.com/search?q=" + encodeURIComponent(query), {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });
    await p.waitForSelector("li.b_algo", { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(800);
    return p.evaluate((max) => {
        const out = [];
        const seen = new Set();
        for (const node of Array.from(document.querySelectorAll("li.b_algo"))) {
            if (out.length >= max) break;
            const a = node.querySelector("h2 a[href]");
            if (!a) continue;
            let href = a.href;
            const um = href.match(/[?&]u=a1([A-Za-z0-9_-]{20,})/);
            if (um) {
                try {
                    href = Buffer.from(um[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
                } catch {
                    /* keep href */
                }
            }
            if (!/^https?:\/\//.test(href) || seen.has(href)) continue;
            seen.add(href);
            const snipEl = node.querySelector(".b_caption p, p");
            out.push({
                title: String(a.innerText || "").trim().slice(0, 160),
                url: href,
                snippet: snipEl ? String(snipEl.innerText || "").trim().slice(0, 300) : "",
            });
        }
        return out;
    }, limit);
}

async function search(args) {
    const query = String((args && args.query) || "").trim();
    const limit = Math.min(Math.max(parseInt((args && args.count) || "5", 10) || 5, 1), 10);
    if (!query) return { success: false, error: "query required" };

    const bing = await viaBing(query, limit);
    if (bing.length) return { success: true, via: "bing", query, results: bing };

    const ddg = await viaDdgHttp(query, limit);
    if (ddg.length) return { success: true, via: "duckduckgo", query, results: ddg };

    try {
        const results = await viaBrowser(query, limit);
        if (results.length) return { success: true, via: "browser", query, results };
        return { success: false, error: "no results found from any search backend" };
    } catch (err) {
        return { success: false, error: "search failed: " + (err instanceof Error ? err.message : String(err)) };
    }
}

const TOOLS = {
    web_search: {
        description: "Search the web (Bing keyless, DuckDuckGo backup, real browser last resort). Returns titles, URLs, snippets.",
        input: { query: "string", count: "number (optional, default 5, max 10)" },
        run: search,
    },
};

module.exports = { TOOLS, search, _internal: { parseBing, parseDdg, decodeBingUrl } };
