"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../lib/catalog.json");
const { planResource } = require("../lib/plan");
const { configFor } = require("./support");
const {
    parseFilters,
    serializeFilters,
    parseInclude,
    serializeInclude,
    parseSort,
    serializeSort,
    parseFields,
    serializeFields,
    parsePairs,
    serializePairs,
    bodyTemplate
} = require("../lib/editor-fields");

function operation(id) {
    for (const node of catalog.nodes) {
        const op = node.operations.find((item) => item.operationId === id);
        if (op) {
            return { node, op };
        }
    }
    throw new Error("missing operation " + id);
}

test("old filter JSON migrates to rows and serializes back to the same object", () => {
    const raw = "{\"status\":\"published\",\"created_at\":\">=2020-01-01\"}";
    const parsed = parseFilters(raw);
    assert.equal(parsed.mode, "rows");
    assert.deepEqual(parsed.rows, [
        { key: "status", op: "=", value: "published" },
        { key: "created_at", op: ">=", value: "2020-01-01" }
    ]);
    assert.equal(serializeFilters(parsed.rows), raw);
    assert.equal(serializeFilters([]), "");
    assert.equal(parseFilters("").mode, "rows");
    assert.deepEqual(parseFilters("").rows, []);
});

test("filter values that are not a flat object stay in JSON mode", () => {
    const nested = "{\"status\":{\"eq\":\"published\"}}";
    const parsed = parseFilters(nested);
    assert.equal(parsed.mode, "json");
    assert.equal(parsed.text, nested);
    assert.equal(parseFilters("[1,2]").mode, "json");
    assert.equal(parseFilters("not json").mode, "json");
});

test("include, sort, fields, and query rows round-trip to the stored text", () => {
    assert.deepEqual(parseInclude("images, audio"), ["images", "audio"]);
    assert.equal(serializeInclude(["images", "images", " audio "]), "images,audio");
    assert.equal(serializeInclude([]), "");

    assert.deepEqual(parseSort("-published_at,title"), [
        { field: "published_at", desc: true },
        { field: "title", desc: false }
    ]);
    assert.equal(serializeSort(parseSort("-published_at,+title")), "-published_at,title");
    assert.equal(serializeSort([]), "");

    const fields = parseFields("{\"responses\":\"count\"}");
    assert.equal(fields.mode, "rows");
    assert.deepEqual(fields.rows, [{ type: "responses", fields: "count" }]);
    assert.equal(serializeFields(fields.rows), "{\"responses\":\"count\"}");
    assert.equal(parseFields("{\"responses\":[\"count\"]}").mode, "json");

    const query = parsePairs("{\"filter[short_code]\":\"ABC\"}");
    assert.equal(query.mode, "rows");
    assert.deepEqual(query.rows, [{ key: "filter[short_code]", value: "ABC" }]);
    assert.equal(serializePairs(query.rows), "{\"filter[short_code]\":\"ABC\"}");
    assert.equal(parsePairs("{\"nested\":{\"a\":1}}").mode, "json");
    assert.equal(serializePairs([{ key: "q", value: "" }, { key: "", value: "x" }]), "{\"q\":\"\"}");
});

test("filter rows serialize to the query parameters the runtime already sends", () => {
    const { node, op } = operation("GetAllMediaItems");
    const filters = serializeFilters([
        { key: "status", op: "!", value: "draft" },
        { key: "auth_date", op: ">=", value: "2020-01-01" },
        { key: "custom_key", op: "=", value: "kept" },
        { key: "", op: "=", value: "dropped" },
        { key: "empty", op: "!", value: "" }
    ]);
    assert.equal(filters, "{\"status\":\"!draft\",\"auth_date\":\">=2020-01-01\",\"custom_key\":\"kept\"}");
    const planned = planResource({
        nodeSpec: node,
        config: Object.assign(configFor(op), {
            filters,
            include: serializeInclude(["images", "audio"]),
            sort: serializeSort([
                { field: "published_at", desc: true },
                { field: "title", desc: false }
            ]),
            fields: serializeFields([{ type: "media-item", fields: "title,status" }])
        }),
        msg: {},
        defaults: { applyDefaultKeys: false }
    });
    const query = Object.fromEntries(planned.plan.query);
    assert.equal(query["filter[status]"], "!draft");
    assert.equal(query["filter[auth_date]"], ">=2020-01-01");
    assert.equal(query["filter[custom_key]"], "kept");
    assert.equal(query.include, "images,audio");
    assert.equal(query.sort, "-published_at,title");
    if (op.ui.fields) {
        assert.equal(query["fields[media-item]"], "title,status");
    }
});

test("message overrides still replace the serialized editor values", () => {
    const { node, op } = operation("GetAllDonations");
    const planned = planResource({
        nodeSpec: node,
        config: Object.assign(configFor(op), {
            filters: serializeFilters([{ key: "status", op: "=", value: "draft" }]),
            sort: "-created_at",
            include: "profile"
        }),
        msg: {
            filters: { status: "published" },
            sort: "auth_date",
            include: ["funds", "campuses"]
        },
        defaults: { applyDefaultKeys: false }
    });
    const query = Object.fromEntries(planned.plan.query);
    assert.equal(query["filter[status]"], "published");
    assert.equal(query.sort, "auth_date");
    assert.equal(query.include, "funds,campuses");
});

test("body templates list required writable fields first and do not invent values", () => {
    const { op } = operation("CreateProfile");
    const template = bodyTemplate(op.bodyFields);
    const required = op.bodyFields.filter((field) => field.required).map((field) => field.name);
    assert.ok(required.length > 0);
    assert.deepEqual(Object.keys(template).slice(0, required.length), required);
    for (const field of op.bodyFields) {
        if (field.type === "boolean") {
            assert.equal(template[field.name], false);
        } else if (field.type === "integer" || field.type === "number") {
            assert.equal(template[field.name], null);
        } else if (field.type === "array") {
            assert.deepEqual(template[field.name], []);
        } else if (field.type === "object") {
            assert.deepEqual(template[field.name], {});
        } else {
            assert.equal(template[field.name], "");
        }
    }
    assert.deepEqual(bodyTemplate([]), {});
});

test("enums are read from nested schemas, including lists longer than 12", () => {
    const donations = operation("GetAllDonations").op.form;
    for (const value of ["profile", "funds", "campuses", "refunds", "refunds.payout"]) {
        assert.ok(donations.include.includes(value), value);
    }

    const media = operation("GetAllMediaItems").op.form;
    for (const field of ["published_at", "created_at", "title"]) {
        assert.ok(media.sort.includes(field), field);
    }
    assert.equal(media.sort.some((field) => field.startsWith("-")), false);

    const payments = operation("ListPayments").op.form;
    const payment = payments.fieldsets.find((item) => item.type === "payment");
    assert.ok(payment, "fields[payment]");
    assert.ok(payment.enum.length > 12);
    for (const name of ["id", "status", "amount", "created_at"]) {
        assert.ok(payment.enum.includes(name), name);
    }

    assert.equal(operation("CapturePaymentIntent").op.form.idHint, "pi_...");
    assert.equal(operation("GetOneCampaign").op.form.idHint, "uuid");
    assert.equal(operation("GetOneBroadcast").op.form.idHint, "");

    const names = catalog.meta.headerNames;
    for (const name of ["Accept", "Collection-Total", "Collection-Stats", "Cache-Control", "Pagination-Strategy"]) {
        assert.ok(names.includes(name), name);
    }
    const broadcast = operation("GetOneBroadcast").op.form.headers.find((header) => header.name === "Cache-Control");
    assert.deepEqual(broadcast.enum, ["no-cache"]);
    const members = operation("ListGroupMembers").op.form.headers.map((header) => header.name);
    assert.ok(members.includes("Pagination-Strategy"));
});
