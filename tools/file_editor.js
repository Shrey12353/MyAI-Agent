const fs = require("fs");
const path = require("path");

function createFolder(folderPath) {
    try {
        const absolutePath = path.resolve(folderPath);

        fs.mkdirSync(absolutePath, {
            recursive: true
        });

        return {
            success: true,
            path: absolutePath
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

function writeFile(filePath, content) {
    try {
        const absolutePath = path.resolve(filePath);

        fs.writeFileSync(
            absolutePath,
            content,
            "utf8"
        );

        return {
            success: true,
            path: absolutePath
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

function readFile(filePath) {
    try {
        const absolutePath = path.resolve(filePath);

        const content = fs.readFileSync(
            absolutePath,
            "utf8"
        );

        return {
            success: true,
            path: absolutePath,
            content
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    createFolder,
    writeFile,
    readFile
};