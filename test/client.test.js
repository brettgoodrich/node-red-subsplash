"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const nock = require("nock");
const catalog = require("../lib/catalog.json");
const { planResource, findNode } = require("../lib/plan");
const { BASE, TOKEN, createClient, sampleMessage, configFor, pathname } = require("./support");

function operations() {
    const list = [];
    for (const node of catalog.nodes) {
        for (const op of node.operations) {
            list.push({ node, op });
        }
    }
    return list;
}

function planFor(node, op, msgExtra, configExtra) {
    return planResource({
        nodeSpec: node,
        config: Object.assign(configFor(op), configExtra || {}),
        msg: Object.assign(sampleMessage(op), msgExtra || {}),
        defaults: { applyDefaultKeys: false }
    });
}

before(() => {
    nock.disableNetConnect();
});

after(() => {
    nock.cleanAll();
    nock.enableNetConnect();
});

beforeEach(() => {
    nock.cleanAll();
});

test("catalog matches the OpenAPI operation lock", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "operations.txt"), "utf8")
        .trim()
        .split("\n")
        .sort();
    const actual = operations()
        .map(({ op }) => op.method + " " + op.path + " " + op.operationId)
        .sort();
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(actual, fixture);
    assert.equal(catalog.meta.operationCount, 126);
    assert.equal(catalog.meta.pathCount, 71);
});

for (const { node, op } of operations()) {
    test(op.method + " " + op.path + " " + op.operationId, async () => {
        const scope = nock(BASE);
        if (op.auth) {
            scope.post("/tokens/v1/token").reply(200, TOKEN);
        }
        let authorization;
        const expectedPath = op.path.replaceAll("{id}", "abc-123");
        scope.intercept((uri) => pathname(uri) === expectedPath, op.method).reply(function () {
            authorization = this.req.headers.authorization;
            return [200, { ok: true, id: "abc-123" }];
        });
        const planned = planFor(node, op);
        const result = await createClient().execute(planned.plan);
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.ok, true);
        assert.equal(result.meta.operation, op.operationId);
        assert.equal(result.meta.method, op.method);
        if (op.auth) {
            assert.equal(authorization, "Bearer tok-1");
        } else {
            assert.equal(authorization, undefined);
        }
        assert.equal(scope.isDone(), true);
    });
}

test("token request is form encoded, cached, and not repeated", async () => {
    const bodies = [];
    const scope = nock(BASE);
    scope.post("/tokens/v1/token").reply(function (_uri, body) {
        bodies.push(String(body));
        return [200, TOKEN];
    });
    scope.get("/media/v1/media-items").times(2).reply(200, { _embedded: { "media-items": [] }, count: 0, total: 0 });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    const api = createClient();
    const planned = planFor(node, op);
    await api.execute(planned.plan);
    await api.execute(planned.plan);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /grant_type=client_credentials/);
    assert.match(bodies[0], /client_id=11111111-1111-4111-8111-111111111111/);
    assert.match(bodies[0], /client_secret=test-secret/);
    assert.equal(scope.isDone(), true);
});

test("a token that is already inside the refresh skew is fetched again", async () => {
    let hits = 0;
    nock(BASE).post("/tokens/v1/token").times(2).reply(() => {
        hits += 1;
        return [200, { access_token: "t" + hits, expires_in: 1, token_type: "Bearer" }];
    });
    nock(BASE).get("/media/v1/media-items").times(2).reply(200, { ok: true });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    const api = createClient({ settings: { tokenSkewSeconds: 60 } });
    const planned = planFor(node, op);
    await api.execute(planned.plan);
    await api.execute(planned.plan);
    assert.equal(hits, 2);
});

test("parallel calls share one token request", async () => {
    let hits = 0;
    nock(BASE).post("/tokens/v1/token").delay(40).reply(() => {
        hits += 1;
        return [200, TOKEN];
    });
    const api = createClient();
    const tokens = await Promise.all([
        api.getAccessToken(),
        api.getAccessToken(),
        api.getAccessToken()
    ]);
    assert.deepEqual(tokens, ["tok-1", "tok-1", "tok-1"]);
    assert.equal(hits, 1);
});

test("401 refreshes the token once and does not loop", async () => {
    let hits = 0;
    nock(BASE).post("/tokens/v1/token").times(2).reply(() => {
        hits += 1;
        return [200, { access_token: "t" + hits, expires_in: 3600, token_type: "Bearer" }];
    });
    nock(BASE).get("/media/v1/media-items/abc-123").reply(401, { errors: [{ code: "invalid_token", detail: "expired" }] });
    nock(BASE).get("/media/v1/media-items/abc-123").reply(401, { errors: [{ code: "invalid_token", detail: "still bad" }] });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetOneMediaItem");
    const planned = planFor(node, op);
    await assert.rejects(
        () => createClient().execute(planned.plan),
        (err) => err.statusCode === 401 && err.code === "invalid_token"
    );
    assert.equal(hits, 2);
});

test("401 then a fresh token succeeds", async () => {
    const seen = [];
    nock(BASE).post("/tokens/v1/token").reply(200, { access_token: "old", expires_in: 3600, token_type: "Bearer" });
    nock(BASE).post("/tokens/v1/token").reply(200, { access_token: "new", expires_in: 3600, token_type: "Bearer" });
    nock(BASE).get("/media/v1/media-items/abc-123").reply(function () {
        seen.push(this.req.headers.authorization);
        return [401, { errors: [{ code: "invalid_token" }] }];
    });
    nock(BASE).get("/media/v1/media-items/abc-123").reply(function () {
        seen.push(this.req.headers.authorization);
        return [200, { id: "abc-123" }];
    });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetOneMediaItem");
    const result = await createClient().execute(planFor(node, op).plan);
    assert.equal(result.body.id, "abc-123");
    assert.deepEqual(seen, ["Bearer old", "Bearer new"]);
});

test("a static access token is used until it is rejected", async () => {
    nock(BASE).get("/tokens/v1/keys").reply(function () {
        assert.equal(this.req.headers.authorization, undefined);
        return [200, { keys: [] }];
    });
    const node = findNode(catalog, "subsplash-tokens");
    const op = node.operations.find((item) => item.operationId === "GetAllPublicKeys");
    await createClient({
        credentials: { accessToken: "static-token", clientId: "", clientSecret: "" }
    }).execute(planFor(node, op).plan);

    const seen = [];
    nock(BASE).get("/media/v1/media-items").reply(function () {
        seen.push(this.req.headers.authorization);
        return [401, { errors: [{ code: "invalid_token" }] }];
    });
    nock(BASE).post("/tokens/v1/token").reply(200, { access_token: "fresh", expires_in: 3600, token_type: "Bearer" });
    nock(BASE).get("/media/v1/media-items").reply(function () {
        seen.push(this.req.headers.authorization);
        return [200, { ok: true }];
    });
    const media = findNode(catalog, "subsplash-media");
    const list = media.operations.find((item) => item.operationId === "GetAllMediaItems");
    const result = await createClient({
        credentials: { accessToken: "static-token" }
    }).execute(planFor(media, list).plan);
    assert.equal(result.body.ok, true);
    assert.deepEqual(seen, ["Bearer static-token", "Bearer fresh"]);
});

test("429 honors Retry-After and a later 200 succeeds", async () => {
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).post("/media/v1/media-items").reply(429, { errors: [{ code: "too_many_requests", detail: "slow down" }] }, { "Retry-After": "1" });
    nock(BASE).post("/media/v1/media-items").reply(201, { id: "made" });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "CreateMediaItem");
    const api = createClient();
    const result = await api.execute(planFor(node, op, { body: { title: "Sunday" } }).plan);
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.id, "made");
    assert.deepEqual(api.waits, [1000]);
});

test("POST is not retried on HTTP 500", async () => {
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).post("/media/v1/media-items").reply(500, { errors: [{ code: "internal", detail: "nope" }] });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "CreateMediaItem");
    const api = createClient({ settings: { maxRetries: 3 } });
    await assert.rejects(
        () => api.execute(planFor(node, op, { body: { title: "Sunday" } }).plan),
        (err) => err.statusCode === 500 && err.code === "internal"
    );
    assert.deepEqual(api.waits, []);
});

test("GET is retried on HTTP 503", async () => {
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items").reply(503, { errors: [{ code: "internal" }] });
    nock(BASE).get("/media/v1/media-items").reply(200, { ok: true, count: 0, total: 0 });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    const api = createClient({ settings: { maxRetries: 2, retryBaseMs: 5 } });
    const result = await api.execute(planFor(node, op).plan);
    assert.equal(result.body.ok, true);
    assert.deepEqual(api.waits, [5]);
});

test("fetch all follows _links.next and merges embedded arrays", async () => {
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items").query(true).reply(200, {
        total: 2,
        count: 1,
        _embedded: { "media-items": [{ id: "a" }] },
        _links: { next: { href: BASE + "/media/v1/media-items?page[number]=2&page[size]=1" } }
    });
    nock(BASE).get("/media/v1/media-items").query(true).reply(200, {
        total: 2,
        count: 1,
        _embedded: { "media-items": [{ id: "b" }] },
        _links: { self: BASE + "/media/v1/media-items?page[number]=2" }
    });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    const result = await createClient().execute(planFor(node, op, { pagination: "all", pageSize: 1 }).plan);
    assert.equal(result.meta.pagesFetched, 2);
    assert.equal(result.meta.truncated, false);
    assert.deepEqual(result.body._embedded["media-items"].map((item) => item.id), ["a", "b"]);
    assert.equal(result.body.count, 2);
    assert.equal(result.body._links.next, undefined);
});

test("fetch all increments page numbers when next links are absent", async () => {
    const seen = [];
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items").query(true).times(2).reply(function () {
        seen.push(this.req.path);
        const page = seen.length;
        const items = page === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }];
        return [200, { total: 3, count: items.length, _embedded: { "media-items": items } }];
    });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    const result = await createClient().execute(planFor(node, op, { pagination: "all", pageSize: 2 }).plan);
    assert.equal(result.meta.pagesFetched, 2);
    assert.deepEqual(result.body._embedded["media-items"].map((item) => item.id), ["a", "b", "c"]);
    assert.match(seen[0], /page\[number\]=1/);
    assert.match(seen[0], /page\[size\]=2/);
    assert.match(seen[1], /page\[number\]=2/);
});

test("fetch all stops when a page repeats and reports truncation at the cap", async () => {
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items").query(true).times(3).reply(200, {
        total: 10,
        count: 1,
        _embedded: { "media-items": [{ id: "same" }] }
    });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    const repeated = await createClient().execute(planFor(node, op, { pagination: "all", pageSize: 1 }).plan);
    assert.equal(repeated.body._embedded["media-items"].length, 1);

    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/people/v1/profiles").query(true).reply(200, {
        total: 50,
        count: 2,
        _embedded: { profiles: [{ id: "p1" }, { id: "p2" }] }
    });
    const people = findNode(catalog, "subsplash-people");
    const list = people.operations.find((item) => item.operationId === "ListProfiles");
    const capped = await createClient({ settings: { maxPages: 1 } }).execute(
        planFor(people, list, { pagination: "all", pageSize: 2, maxPages: 1 }).plan
    );
    assert.equal(capped.meta.pagesFetched, 1);
    assert.equal(capped.meta.truncated, true);
});

test("refuses to follow a next link on another origin", async () => {
    nock(BASE).post("/tokens/v1/token").reply(200, TOKEN);
    nock(BASE).get("/media/v1/media-items").query(true).reply(200, {
        count: 1,
        total: 2,
        _embedded: { "media-items": [{ id: "a" }] },
        _links: { next: "https://evil.example/media/v1/media-items?page[number]=2" }
    });
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    await assert.rejects(
        () => createClient().execute(planFor(node, op, { pagination: "all", pageSize: 1 }).plan),
        /evil\.example/
    );
});

test("missing client credentials fail before a resource call", async () => {
    const node = findNode(catalog, "subsplash-media");
    const op = node.operations.find((item) => item.operationId === "GetAllMediaItems");
    await assert.rejects(
        () => createClient({ credentials: { clientId: "", clientSecret: "", accessToken: "" } }).execute(planFor(node, op).plan),
        /client id and client secret/
    );
});
