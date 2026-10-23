"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const catalog = require("../lib/catalog.json");

const root = path.join(__dirname, "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const html = fs.readFileSync(path.join(root, "nodes", "subsplash.html"), "utf8");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "operations.txt"), "utf8").trim().split("\n");

test("README maps every locked operation", () => {
    for (const line of fixture) {
        const [method, opPath, operationId] = line.split(" ");
        assert.ok(readme.includes("`" + method + "`"), method);
        assert.ok(readme.includes("`" + opPath + "`"), opPath);
        assert.ok(readme.includes("`" + operationId + "`"), operationId);
    }
    assert.ok(readme.includes("subsplash-request"));
    assert.ok(readme.includes("subsplash-config"));
});

function readEditorCatalog(source) {
    const marker = "window.SUBSPLASH_EDITOR_CATALOG = ";
    const start = source.indexOf(marker);
    assert.ok(start !== -1, "editor catalog assignment");
    const jsonStart = source.indexOf("{", start);
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = jsonStart; i < source.length; i += 1) {
        const char = source[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === "\"") {
                inString = false;
            }
            continue;
        }
        if (char === "\"") {
            inString = true;
        } else if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return JSON.parse(source.slice(jsonStart, i + 1));
            }
        }
    }
    throw new Error("editor catalog JSON did not end");
}

test("help and editor catalog include every node and operation", () => {
    const editor = readEditorCatalog(html);
    const types = ["subsplash-config", "subsplash-request"].concat(catalog.nodes.map((node) => node.type));
    for (const type of types) {
        assert.ok(html.includes('data-help-name="' + type + '"'), type);
        assert.ok(html.includes('data-template-name="' + type + '"'), type);
        assert.ok(html.includes('registerType("' + type + '"'), type);
    }
    for (const node of catalog.nodes) {
        const editorOps = editor[node.type].map((op) => op.operationId).sort();
        const runtimeOps = node.operations.map((op) => op.operationId).sort();
        assert.deepEqual(editorOps, runtimeOps);
        for (const op of node.operations) {
            assert.ok(html.includes("<h4>" + op.operationId + "</h4>"), op.operationId);
            const editorOp = editor[node.type].find((item) => item.operationId === op.operationId);
            assert.deepEqual(editorOp.ui, op.ui, op.operationId);
        }
    }
});

test("editor scripts parse", () => {
    const scripts = [...html.matchAll(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 14);
    scripts.forEach((script, index) => {
        const file = path.join(os.tmpdir(), "subsplash-editor-" + index + ".js");
        fs.writeFileSync(file, script[1]);
        execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    });
});

test("example flows are importable JSON and reference real node types", () => {
    const allowed = new Set([
        "tab", "inject", "debug", "catch", "change", "comment", "function",
        "subsplash-config", "subsplash-request"
    ]);
    for (const node of catalog.nodes) {
        allowed.add(node.type);
    }
    const examples = fs.readdirSync(path.join(root, "examples")).filter((name) => name.endsWith(".json"));
    assert.ok(examples.length >= 5);
    const seen = new Set();
    for (const name of examples) {
        const flow = JSON.parse(fs.readFileSync(path.join(root, "examples", name), "utf8"));
        assert.ok(Array.isArray(flow), name);
        assert.ok(flow.some((node) => node.type === "tab"), name);
        for (const node of flow) {
            assert.ok(allowed.has(node.type), name + " has unknown type " + node.type);
            if (String(node.type).startsWith("subsplash-") && node.type !== "subsplash-config" && node.type !== "subsplash-request") {
                seen.add(node.type);
                assert.equal(typeof node.operation, "string", name);
                assert.ok(node.subsplash, name);
            }
        }
    }
    assert.ok(seen.has("subsplash-media"));
    assert.ok(seen.has("subsplash-donations"));
    assert.ok(seen.has("subsplash-people"));
    assert.ok(seen.has("subsplash-tokens"));
    assert.ok(seen.has("subsplash-webhooks"));
});
