"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { planResource, findNode } = require("../lib/plan");
const catalog = require("../lib/catalog.json");
const { configFor } = require("./support");

const html = fs.readFileSync(path.join(__dirname, "..", "nodes", "subsplash.html"), "utf8");

function operation(type, operationId) {
    const node = findNode(catalog, type);
    const op = node.operations.find((item) => item.operationId === operationId);
    assert.ok(op, operationId);
    return { node, op };
}

function names(pairs) {
    return pairs.map((pair) => pair[0]);
}

test("every operation publishes editor visibility flags", () => {
    const accept = [];
    for (const node of catalog.nodes) {
        for (const op of node.operations) {
            assert.deepEqual(Object.keys(op.ui).sort(), [
                "accept",
                "body",
                "defaultKeys",
                "extraPathParams",
                "fields",
                "filters",
                "include",
                "paging",
                "resourceId",
                "sort",
                "total"
            ]);
            assert.deepEqual(op.ui.extraPathParams, []);
            assert.equal(op.ui.resourceId, op.pathParams.length > 0);
            assert.equal(op.ui.body, op.body);
            assert.equal(op.ui.include, op.query.some((param) => param.name === "include"));
            assert.equal(op.ui.sort, op.query.some((param) => param.name === "sort"));
            assert.equal(op.ui.filters, op.query.some((param) => param.name === "filter" || param.name.startsWith("filter[")));
            assert.equal(
                op.ui.defaultKeys,
                op.query.some((param) => param.name === "filter[app_key]" || param.name === "filter[org_key]")
            );
            if (op.collection) {
                assert.equal(op.ui.paging, !op.pageUndocumented, op.operationId);
            }
            if (op.ui.accept) {
                accept.push(op.operationId);
            }
        }
    }
    assert.deepEqual(accept.sort(), [
        "GetAllDonations",
        "GetAllRecurringDonations",
        "GetOneCampaignContributions",
        "ListPayments"
    ]);
});

test("GetOneCampaign shows resource id and include only", () => {
    const { op } = operation("subsplash-donations", "GetOneCampaign");
    assert.equal(op.ui.resourceId, true);
    assert.equal(op.ui.include, true);
    assert.equal(op.ui.sort, false);
    assert.equal(op.ui.filters, false);
    assert.equal(op.ui.fields, false);
    assert.equal(op.ui.paging, false);
    assert.equal(op.ui.body, false);
    assert.equal(op.ui.total, false);
    assert.equal(op.ui.accept, false);
    assert.equal(op.ui.defaultKeys, false);
});

test("GetAllMediaItems shows filters, sort, include, and paging", () => {
    const { op } = operation("subsplash-media", "GetAllMediaItems");
    assert.equal(op.ui.resourceId, false);
    assert.equal(op.ui.body, false);
    assert.equal(op.ui.filters, true);
    assert.equal(op.ui.sort, true);
    assert.equal(op.ui.include, true);
    assert.equal(op.ui.fields, false);
    assert.equal(op.ui.paging, true);
    assert.equal(op.ui.defaultKeys, true);
    assert.equal(op.ui.total, false);
    assert.equal(op.ui.accept, false);
});

test("CreateProfile shows body and hides resource id", () => {
    const { op } = operation("subsplash-people", "CreateProfile");
    assert.equal(op.ui.body, true);
    assert.equal(op.ui.resourceId, false);
    assert.equal(op.ui.filters, false);
    assert.equal(op.ui.sort, false);
    assert.equal(op.ui.include, false);
    assert.equal(op.ui.paging, false);
    assert.equal(op.ui.accept, false);
});

test("ListResponses shows fields and total, and hides Accept despite the header enum", () => {
    const { op } = operation("subsplash-forms", "ListResponses");
    assert.equal(op.ui.fields, true);
    assert.equal(op.ui.filters, true);
    assert.equal(op.ui.sort, true);
    assert.equal(op.ui.include, true);
    assert.equal(op.ui.paging, true);
    assert.equal(op.ui.total, true);
    assert.equal(op.ui.accept, false);
    assert.equal(op.ui.defaultKeys, true);
    assert.ok(op.headers.some((param) => param.name === "Accept"));
});

test("GetOneCampaign drops stale editor values and keeps message overrides and query", () => {
    const { node, op } = operation("subsplash-donations", "GetOneCampaign");
    const stale = Object.assign(configFor(op), {
        resourceId: "editor-id",
        sort: "-created_at",
        filters: "{\"status\":\"active\"}",
        include: "fund",
        fields: "{\"campaigns\":\"title\"}",
        pageSize: "25",
        pageNumber: "3",
        pagination: "all",
        accept: "text/csv",
        collectionTotal: "include",
        body: "{\"nope\":true}",
        query: "{\"extra\":\"1\"}",
        headers: "{\"X-Trace\":\"yes\"}",
        pathParams: "{\"id\":\"from-path-params\"}"
    });
    const planned = planResource({
        nodeSpec: node,
        config: stale,
        msg: {},
        defaults: { applyDefaultKeys: false }
    });
    assert.equal(planned.plan.path, "/donations/v1/campaigns/editor-id");
    assert.equal(planned.plan.pagination, "page");
    assert.equal(planned.plan.pageSize, null);
    assert.equal(planned.plan.body, undefined);
    assert.deepEqual(names(planned.plan.query).sort(), ["extra", "include"]);
    assert.equal(planned.plan.query.find((pair) => pair[0] === "include")[1], "fund");
    assert.equal(planned.plan.headers.Accept, undefined);
    assert.equal(planned.plan.headers["Collection-Total"], undefined);
    assert.equal(planned.plan.headers["X-Trace"], "yes");

    const overridden = planResource({
        nodeSpec: node,
        config: stale,
        msg: {
            sort: "-title",
            filters: { status: "closed" },
            include: "other",
            pageSize: 10,
            accept: "text/csv",
            collectionTotal: "include",
            body: { title: "from-message" }
        },
        defaults: { applyDefaultKeys: false }
    });
    assert.equal(overridden.plan.path, "/donations/v1/campaigns/editor-id");
    assert.ok(names(overridden.plan.query).includes("sort"));
    assert.ok(names(overridden.plan.query).includes("filter[status]"));
    assert.ok(names(overridden.plan.query).includes("page[size]"));
    assert.equal(overridden.plan.query.find((pair) => pair[0] === "include")[1], "other");
    assert.equal(overridden.plan.headers.Accept, "text/csv");
    assert.equal(overridden.plan.headers["Collection-Total"], "include");
    assert.deepEqual(overridden.plan.body, { title: "from-message" });
});

test("GetAllMediaItems sends editor sort and page size", () => {
    const { node, op } = operation("subsplash-media", "GetAllMediaItems");
    const planned = planResource({
        nodeSpec: node,
        config: Object.assign(configFor(op), {
            sort: "-published_at",
            pageSize: "25",
            pagination: "page",
            include: "images"
        }),
        msg: {},
        defaults: { applyDefaultKeys: false }
    });
    assert.equal(planned.plan.path, "/media/v1/media-items");
    assert.equal(planned.plan.query.find((pair) => pair[0] === "sort")[1], "-published_at");
    assert.equal(planned.plan.query.find((pair) => pair[0] === "page[size]")[1], 25);
    assert.equal(planned.plan.query.find((pair) => pair[0] === "include")[1], "images");
    assert.equal(planned.plan.pagination, "page");
});

test("CreateProfile sends the editor body and ignores a stale sort and resource id", () => {
    const { node, op } = operation("subsplash-people", "CreateProfile");
    const planned = planResource({
        nodeSpec: node,
        config: Object.assign(configFor(op), {
            resourceId: "should-not-appear",
            body: "{\"name\":\"Ada\"}",
            sort: "-created_at",
            filters: "{\"status\":\"active\"}",
            pagination: "all",
            pageSize: "10"
        }),
        msg: {},
        defaults: { applyDefaultKeys: false }
    });
    assert.equal(planned.plan.path, "/people/v1/profiles");
    assert.equal(planned.plan.method, "POST");
    assert.deepEqual(planned.plan.body, { name: "Ada" });
    assert.deepEqual(planned.plan.query, []);
    assert.equal(planned.plan.pagination, "page");

    const overridden = planResource({
        nodeSpec: node,
        config: Object.assign(configFor(op), { sort: "-created_at", body: "" }),
        msg: { sort: "-updated_at", body: { name: "Grace" } },
        defaults: { applyDefaultKeys: false }
    });
    assert.equal(overridden.plan.query.find((pair) => pair[0] === "sort")[1], "-updated_at");
    assert.deepEqual(overridden.plan.body, { name: "Grace" });
});

test("resource dialogs can hide fields and the request node keeps them", () => {
    const requestAt = html.indexOf("data-template-name=\"subsplash-request\"");
    const requestHtml = html.slice(requestAt, html.indexOf("</script>", requestAt));
    assert.ok(requestHtml.includes("node-input-sort"));
    assert.ok(requestHtml.includes("node-input-filters"));
    assert.ok(requestHtml.includes("node-input-query"));
    assert.ok(requestHtml.includes("node-input-headers"));
    assert.ok(requestHtml.includes("node-input-output"));
    assert.equal(/class="[^"]*\bsubsplash-sort\b/.test(requestHtml), false);
    assert.equal(/class="[^"]*\bsubsplash-page\b/.test(requestHtml), false);
    assert.ok(requestHtml.includes("subsplash-sort-list"));
    assert.ok(requestHtml.includes("node-input-resourceIdType"));

    const donationsAt = html.indexOf("data-template-name=\"subsplash-donations\"");
    const donationsHtml = html.slice(donationsAt, html.indexOf("</script>", donationsAt));
    for (const className of [
        "subsplash-id",
        "subsplash-path-params",
        "subsplash-body",
        "subsplash-filters",
        "subsplash-include",
        "subsplash-sort",
        "subsplash-fields",
        "subsplash-page",
        "subsplash-total",
        "subsplash-accept",
        "subsplash-defaults"
    ]) {
        assert.ok(donationsHtml.includes(className), className);
    }
    assert.ok(donationsHtml.includes("node-input-query"));
    assert.ok(donationsHtml.includes("node-input-headers"));
    assert.ok(donationsHtml.includes("node-input-output"));
    assert.ok(html.includes("ui.paging"));
    assert.ok(html.includes("select.on(\"change\", describe)"));
    assert.equal(html.includes("subsplash-op-filter"), false);
    assert.equal(html.includes("Filter the operation list"), false);
});
