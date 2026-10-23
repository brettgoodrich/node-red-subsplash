"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildUrl, encodeQueryValue, filterPairs, fieldPairs } = require("../lib/query");
const { planResource, planRaw, findNode } = require("../lib/plan");
const catalog = require("../lib/catalog.json");
const { configFor } = require("./support");

const BASE = "https://core.subsplash.com";

test("encodes comparison operators, wildcards, and multi-value filters", () => {
    assert.equal(encodeQueryValue("<=5"), "<%3D5");
    assert.equal(encodeQueryValue(">=5"), ">%3D5");
    assert.equal(encodeQueryValue("<5"), "<5");
    assert.equal(encodeQueryValue("!bar"), "!bar");
    assert.equal(encodeQueryValue("a,b*"), "a,b*");
    assert.equal(encodeQueryValue("foo|bar"), "foo|bar");
    assert.equal(encodeQueryValue("a\\,b"), "a\\,b");
    const url = buildUrl(BASE, "/media/v1/media-items", [
        ["filter[title]", "<=John*"],
        ["filter[status]", "published,draft"]
    ]);
    assert.equal(
        url,
        BASE + "/media/v1/media-items?filter[title]=<%3DJohn*&filter[status]=published,draft"
    );
});

test("rejects a URL on another host", () => {
    assert.throws(
        () => buildUrl(BASE, "https://evil.example/media/v1/media-items", []),
        /evil\.example/
    );
    assert.throws(() => buildUrl(BASE, "//evil.example/x", []), /not allowed/);
});

test("joins a base path prefix", () => {
    const url = buildUrl("https://proxy.example/subsplash/", "/media/v1/media-items", []);
    assert.equal(url, "https://proxy.example/subsplash/media/v1/media-items");
});

test("filter and field helpers", () => {
    assert.deepEqual(filterPairs({ status: "published", "filter[app_key]": "CHURCH", skip: "" }), [
        ["filter[status]", "published"],
        ["filter[app_key]", "CHURCH"]
    ]);
    assert.deepEqual(fieldPairs({ responses: "count" }), [["fields[responses]", "count"]]);
    assert.throws(() => filterPairs(["nope"]), /Filters must be an object/);
});

test("required org key can be filled from the config defaults", () => {
    const node = findNode(catalog, "subsplash-donations");
    assert.throws(
        () => planResource({
            nodeSpec: node,
            config: configFor(node.operations.find((op) => op.operationId === "GetAllCampaigns")),
            msg: {},
            defaults: { applyDefaultKeys: false }
        }),
        /filter\[org_key\]/
    );
    const planned = planResource({
        nodeSpec: node,
        config: configFor(node.operations.find((op) => op.operationId === "GetAllCampaigns")),
        msg: {},
        defaults: { applyDefaultKeys: true, orgKey: "ORGKEY12", appKey: "CHURCH" }
    });
    assert.ok(planned.plan.query.some(([key, value]) => key === "filter[org_key]" && value === "ORGKEY12"));
});

test("message filters override the editor and resourceId fills the path", () => {
    const node = findNode(catalog, "subsplash-media");
    const planned = planResource({
        nodeSpec: node,
        config: Object.assign(configFor(node.operations.find((op) => op.operationId === "GetOneMediaItem")), {
            resourceId: "from-editor",
            filters: "{\"status\":\"draft\"}",
            include: "images"
        }),
        msg: {
            resourceId: "from-message",
            filters: { status: "published" },
            sort: "-published_at"
        },
        defaults: { applyDefaultKeys: false }
    });
    assert.equal(planned.plan.path, "/media/v1/media-items/from-message");
    assert.ok(planned.plan.query.some(([key, value]) => key === "filter[status]" && value === "published"));
    assert.ok(planned.plan.query.some(([key, value]) => key === "include" && value === "images"));
    assert.ok(planned.plan.query.some(([key, value]) => key === "sort" && value === "-published_at"));
});

test("raw requests stay on the base host and substitute {id}", () => {
    const planned = planRaw({
        config: {
            method: "GET",
            path: "/people/v1/profiles/{id}",
            resourceId: "abc-123",
            authenticate: false,
            pagination: "page",
            output: "response"
        },
        msg: {}
    });
    assert.equal(planned.plan.path, "/people/v1/profiles/abc-123");
    assert.equal(planned.plan.auth, false);
    assert.throws(
        () => planRaw({
            config: { method: "GET", path: "media/v1/media-items", authenticate: true, pagination: "page" },
            msg: {}
        }),
        /must start with/
    );
    assert.throws(
        () => planRaw({
            config: { method: "GET", path: "", authenticate: true, pagination: "page" },
            msg: { url: "https://evil.example/payments" },
            baseUrl: BASE
        }),
        /evil\.example/
    );
});
