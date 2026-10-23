"use strict";

const { test, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const nock = require("nock");
const helper = require("node-red-node-test-helper");
const subsplash = require("../nodes/subsplash.js");
const catalog = require("../lib/catalog.json");
const { BASE, TOKEN, sampleMessage, pathname } = require("./support");

helper.init(require.resolve("node-red"));

function finish(result, callback) {
    if (result && typeof result.then === "function") {
        return result.then(
            () => callback(),
            (err) => callback(err)
        );
    }
    return undefined;
}

function load(flow, credentials) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        };
        try {
            finish(helper.load(subsplash, flow, credentials, done), done);
        } catch (err) {
            done(err);
        }
    });
}

function unload() {
    return new Promise((resolve) => {
        try {
            const result = helper.unload();
            if (result && typeof result.then === "function") {
                result.then(() => resolve(), () => resolve());
                return;
            }
        } catch (_err) {
            resolve();
            return;
        }
        setTimeout(resolve, 20);
    });
}

function once(node, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for " + node.id)), ms || 8000);
        node.once("input", (msg) => {
            clearTimeout(timer);
            resolve(msg);
        });
    });
}

function place(flow) {
    let x = 80;
    for (const node of flow) {
        if (node.type === "tab" || node.type === "subsplash-config") {
            continue;
        }
        node.x = x;
        node.y = 60;
        x += 40;
    }
    return flow;
}

function resourceFlow() {
    const flow = [
        { id: "tab", type: "tab", label: "test" },
        {
            id: "cfg",
            type: "subsplash-config",
            name: "test",
            z: "tab",
            baseUrl: BASE,
            appKey: "CHURCH",
            orgKey: "ORGKEY12",
            tokenSkewSeconds: 30,
            timeoutMs: 5000,
            maxRetries: 2,
            retryBaseMs: 1,
            maxPages: 5
        }
    ];
    for (const spec of catalog.nodes) {
        flow.push({
            id: "n-" + spec.type,
            type: spec.type,
            z: "tab",
            name: spec.palette,
            subsplash: "cfg",
            operation: (spec.operations.find((op) => op.method === "GET") || spec.operations[0]).operationId,
            resourceId: "",
            body: "",
            filters: "",
            include: "",
            sort: "",
            fields: "",
            query: "",
            headers: "",
            pageNumber: "",
            pageSize: "",
            pagination: "page",
            collectionTotal: "",
            accept: "",
            output: "response",
            applyDefaultKeys: true,
            wires: [["out-" + spec.type]]
        });
        flow.push({ id: "out-" + spec.type, type: "helper", z: "tab" });
    }
    flow.push({
        id: "raw",
        type: "subsplash-request",
        z: "tab",
        name: "raw",
        subsplash: "cfg",
        method: "GET",
        path: "/pages/v1/links",
        authenticate: true,
        pagination: "page",
        output: "items",
        wires: [["out-raw"]]
    });
    flow.push({ id: "out-raw", type: "helper", z: "tab" });
    return place(flow);
}

before(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect(/(127\.0\.0\.1|localhost)/);
    await new Promise((resolve, reject) => {
        try {
            finish(helper.startServer(resolve), (err) => (err ? reject(err) : resolve()));
        } catch (err) {
            reject(err);
        }
    });
});

after(async () => {
    await unload();
    await new Promise((resolve) => {
        try {
            helper.stopServer(resolve);
        } catch (_err) {
            resolve();
        }
    });
    nock.cleanAll();
    nock.enableNetConnect();
});

afterEach(async () => {
    await unload();
    nock.cleanAll();
});

test("every node type loads and calls the API", { timeout: 60000 }, async () => {
    await load(resourceFlow(), {
        cfg: { clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "test-secret" }
    });
    assert.equal(helper.getNode("cfg").name, "test");
    let tokenReady = false;
    for (const spec of catalog.nodes) {
        const node = helper.getNode("n-" + spec.type);
        assert.ok(node, spec.type);
        const op = spec.operations.find((item) => item.operationId === node.operation);
        nock.cleanAll();
        const scope = nock(BASE);
        if (op.auth && !tokenReady) {
            scope.post("/tokens/v1/token").reply(200, TOKEN);
            tokenReady = true;
        }
        const expectedPath = op.path.replaceAll("{id}", "abc-123");
        let sawAuth;
        scope.intercept((uri) => pathname(uri) === expectedPath, op.method).reply(function () {
            sawAuth = this.req.headers.authorization;
            return [200, {
                ok: true,
                id: "abc-123",
                _embedded: { items: [{ id: "abc-123" }] },
                count: 1,
                total: 1
            }];
        });
        const output = helper.getNode("out-" + spec.type);
        const pending = once(output);
        const message = sampleMessage(op);
        message.topic = spec.type;
        node.receive(message);
        const result = await pending;
        assert.equal(result.topic, spec.type);
        assert.equal(result.payload.ok, true);
        assert.equal(result.statusCode, 200);
        assert.equal(result.subsplash.operation, op.operationId);
        assert.equal(sawAuth, op.auth ? "Bearer tok-1" : undefined);
        assert.equal(scope.isDone(), true);
        const text = node.status;
        assert.equal(typeof text, "function");
    }

    nock.cleanAll();
    nock(BASE).get("/pages/v1/links").reply(200, {
        count: 1,
        total: 1,
        _embedded: { links: [{ id: "link-1", title: "Give" }] }
    });
    const rawOut = once(helper.getNode("out-raw"));
    helper.getNode("raw").receive({ topic: "raw" });
    const raw = await rawOut;
    assert.equal(raw.topic, "raw");
    assert.equal(raw.payload[0].id, "link-1");
    assert.equal(raw.subsplash.pagesFetched, 1);
});

test("fetch all merges pages and keeps unrelated message properties", { timeout: 20000 }, async () => {
    await load(place([
        { id: "tab", type: "tab", label: "pages" },
        {
            id: "cfg",
            type: "subsplash-config",
            baseUrl: BASE,
            maxRetries: 1,
            retryBaseMs: 1,
            timeoutMs: 5000,
            maxPages: 5,
            tokenSkewSeconds: 30
        },
        {
            id: "media",
            type: "subsplash-media",
            z: "tab",
            subsplash: "cfg",
            operation: "GetAllMediaItems",
            pagination: "all",
            pageSize: "1",
            output: "items",
            applyDefaultKeys: false,
            wires: [["out"]]
        },
        { id: "out", type: "helper", z: "tab" }
    ]), {
        cfg: { clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "test-secret" }
    });
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items").query(true).reply(200, {
        total: 2,
        count: 1,
        _embedded: { "media-items": [{ id: "a", title: "One" }] },
        _links: { next: { href: BASE + "/media/v1/media-items?page[number]=2&page[size]=1" } }
    });
    nock(BASE).get("/media/v1/media-items").query(true).reply(200, {
        total: 2,
        count: 1,
        _embedded: { "media-items": [{ id: "b", title: "Two" }] }
    });
    const statuses = [];
    const media = helper.getNode("media");
    const original = media.status;
    media.status = function (status) {
        statuses.push(status);
        return original.call(media, status);
    };
    const pending = once(helper.getNode("out"));
    media.receive({ topic: "series" });
    const msg = await pending;
    assert.equal(msg.topic, "series");
    assert.deepEqual(msg.payload.map((item) => item.id), ["a", "b"]);
    assert.equal(msg.subsplash.pagesFetched, 2);
    assert.ok(statuses.some((status) => status && status.fill === "green"));
});

test("API errors are delivered to Catch through node.error", { timeout: 20000 }, async () => {
    await load(place([
        { id: "tab", type: "tab", label: "errors" },
        {
            id: "cfg",
            type: "subsplash-config",
            baseUrl: BASE,
            maxRetries: 0,
            retryBaseMs: 1,
            timeoutMs: 5000,
            tokenSkewSeconds: 30
        },
        {
            id: "media",
            type: "subsplash-media",
            z: "tab",
            subsplash: "cfg",
            operation: "GetOneMediaItem",
            applyDefaultKeys: false,
            wires: [["ok"]]
        },
        { id: "ok", type: "helper", z: "tab" },
        {
            id: "catcher",
            type: "catch",
            z: "tab",
            name: "errors",
            scope: ["media"],
            uncaught: false,
            wires: [["bad"]]
        },
        { id: "bad", type: "helper", z: "tab" }
    ]), {
        cfg: { clientId: "11111111-1111-4111-8111-111111111111", clientSecret: "test-secret" }
    });
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items/missing").reply(404, {
        errors: [{ code: "resource_not_found", detail: "gone" }]
    });
    const media = helper.getNode("media");
    let reported = null;
    const original = media.error;
    media.error = function (err, msg) {
        reported = { err, msg };
        return original.call(media, err, msg);
    };
    const pending = once(helper.getNode("bad"));
    media.receive({ resourceId: "missing", topic: "lookup" });
    const caught = await pending;
    assert.ok(reported, "node.error was called with the message");
    assert.equal(reported.err.statusCode, 404);
    assert.equal(reported.msg.topic, "lookup");
    assert.equal(caught.statusCode, 404);
    assert.equal(caught.payload.errors[0].code, "resource_not_found");
    assert.equal(caught.subsplash.error.code, "resource_not_found");
    assert.equal(caught.topic, "lookup");
});

test("a node without credentials reports a usable error", { timeout: 20000 }, async () => {
    await load(place([
        { id: "tab", type: "tab", label: "creds" },
        {
            id: "cfg",
            type: "subsplash-config",
            baseUrl: BASE,
            maxRetries: 0,
            timeoutMs: 5000
        },
        {
            id: "media",
            type: "subsplash-media",
            z: "tab",
            subsplash: "cfg",
            operation: "GetAllMediaItems",
            wires: [["out"]]
        },
        {
            id: "catcher",
            type: "catch",
            z: "tab",
            scope: ["media"],
            uncaught: false,
            wires: [["out"]]
        },
        { id: "out", type: "helper", z: "tab" }
    ]), { cfg: {} });
    const pending = once(helper.getNode("out"));
    helper.getNode("media").receive({});
    const msg = await pending;
    assert.match(msg.payload.message, /client id and client secret/);
});
