const web = require("../tools/web");

/** Expose internal Bing HTML parser for tests. */
function parseBingHelpers(html, limit) {
    return web._internal.parseBing(html, limit);
}

module.exports = { parseBingHelpers };
