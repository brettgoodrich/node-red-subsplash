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

test("README lists the nodes and leaves the API catalog in the spec", () => {
    assert.match(readme, /Implements the \[Subsplash API\]\(https:\/\/developer\.subsplash\.com\/docs\/restapi\/\) as Node-RED nodes:/);
    for (const type of [
        "subsplash-config",
        "subsplash-builder",
        "subsplash-donations",
        "subsplash-events",
        "subsplash-forms",
        "subsplash-groups",
        "subsplash-live",
        "subsplash-media",
        "subsplash-pages",
        "subsplash-payments",
        "subsplash-people",
        "subsplash-push",
        "subsplash-tokens",
        "subsplash-webhooks",
        "subsplash-request"
    ]) {
        assert.ok(readme.includes("`" + type + "`"), type);
    }
    assert.equal(readme.includes("GENERATED:OPERATIONS"), false);
    assert.equal(readme.includes("GENERATED:COVERAGE"), false);
    assert.equal(readme.includes("`GET /builder/v1/list-rows`"), false);
    assert.ok(readme.includes("npm install @brettgoodrich/node-red-subsplash"));
    assert.ok(readme.includes("client_credentials"));
    assert.ok(readme.includes("Apache-2.0"));
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
            assert.deepEqual(editorOp.form, op.form, op.operationId + " form");
            assert.deepEqual(editorOp.tags, op.tags, op.operationId + " tags");
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
