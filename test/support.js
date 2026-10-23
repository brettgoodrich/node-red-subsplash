"use strict";

const { SubsplashClient } = require("../lib/client");

const BASE = "https://core.subsplash.com";

const TOKEN = {
    access_token: "tok-1",
    expires_in: 3600,
    token_type: "Bearer"
};

function createClient(extra) {
    const options = extra || {};
    const waits = [];
    const settings = Object.assign({
        timeoutMs: 5000,
        maxRetries: 2,
        retryBaseMs: 10,
        tokenSkewSeconds: 30,
        maxPages: 5
    }, options.settings || {});
    const credentials = Object.assign({
        clientId: "11111111-1111-4111-8111-111111111111",
        clientSecret: "test-secret"
    }, options.credentials || {});
    const instance = new SubsplashClient({
        baseUrl: options.baseUrl || BASE,
        getCredentials: () => credentials,
        getSettings: () => settings,
        sleep: (ms) => {
            waits.push(ms);
            return Promise.resolve();
        },
        jitter: () => 0,
        now: options.now || Date.now
    });
    instance.waits = waits;
    return instance;
}

function sampleMessage(op) {
    const msg = {};
    if (op.pathParams && op.pathParams.length > 0) {
        msg.resourceId = "abc-123";
    }
    const filters = {};
    const query = {};
    for (const param of op.query || []) {
        if (!param.required) {
            continue;
        }
        if (param.name.startsWith("filter[") && param.name.endsWith("]")) {
            const key = param.name.slice("filter[".length, -1);
            filters[key] = /org_key/i.test(key) ? "ORGKEY12" : "CHURCH";
        } else {
            query[param.name] = "x";
        }
    }
    if (Object.keys(filters).length > 0) {
        msg.filters = filters;
    }
    if (Object.keys(query).length > 0) {
        msg.query = query;
    }
    if (op.body) {
        const body = {};
        for (const field of op.bodyFields || []) {
            if (!field.required || String(field.name).startsWith("_")) {
                continue;
            }
            if (field.type === "array") {
                body[field.name] = ["example"];
            } else if (field.type === "boolean") {
                body[field.name] = true;
            } else if (field.type === "integer" || field.type === "number") {
                body[field.name] = 1;
            } else if (/key/i.test(field.name)) {
                body[field.name] = /org_key/i.test(field.name) ? "ORGKEY12" : "CHURCH";
            } else {
                body[field.name] = "example";
            }
        }
        if (Object.keys(body).length === 0) {
            body.example = true;
        }
        msg.body = body;
    }
    return msg;
}

function configFor(op) {
    return {
        operation: op.operationId,
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
        collectionStats: "",
        accept: "",
        output: "response",
        applyDefaultKeys: false,
        method: "GET",
        path: "",
        authenticate: true,
        contentType: ""
    };
}

function pathname(uri) {
    return String(uri).split("?")[0];
}

module.exports = {
    BASE,
    TOKEN,
    createClient,
    sampleMessage,
    configFor,
    pathname
};
