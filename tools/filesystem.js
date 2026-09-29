const fs = require("fs");
const path = require("path");

function listFiles(folderPath) {
    try {
        const absolutePath = path.resolve(folderPath);

        const items = fs.readdirSync(absolutePath, {
            withFileTypes: true
        });

        return {
            success: true,
            path: absolutePath,
            files: items.map(item => ({
                name: item.name,
                type: item.isDirectory() ? "folder" : "file"
            }))
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    listFiles
};