"use strict";

const { SubsplashError } = require("./errors");
const { filterPairs, fieldPairs } = require("./query");

const RAW_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function assertSameOrigin(path, baseUrl) {
    let target;
    try {
        target = new URL(path);
    } catch (_err) {
        throw new SubsplashError("Path is not a valid URL");
    }
    if (!baseUrl) {
        throw new SubsplashError("Absolute URLs need the config node's base URL. Refusing to call " + target.origin + ".");
    }
    let base;
    try {
        base = new URL(baseUrl);
    } catch (_err) {
        throw new SubsplashError("Subsplash base URL is not a valid URL");
    }
    if (target.origin !== base.origin) {
        throw new SubsplashError(
            "Refusing to call " + target.origin + ". Requests must stay on " + base.origin + "."
        );
    }
}

function findNode(catalog, type) {
    return catalog.nodes.find((node) => node.type === type) || null;
}

function planResource({ nodeSpec, config, msg, defaults }) {
    const message = msg || {};
    const operationId = pick(message, "operation", config.operation);
    const operation = nodeSpec.operations.find((op) => op.operationId === operationId);
    if (!operation) {
        throw new SubsplashError(
            "Unknown operation \"" + operationId + "\" on " + nodeSpec.type + "."
        );
    }
    const pathValues = pathParamValues(operation, config, message);
    const path = fillPath(operation.path, operation.pathParams, pathValues);
    const query = buildQuery(operation, config, message, defaults || {});
    assertRequiredQuery(operation, query);
    const body = resolveBody(operation, config, message);
    if (operation.bodyRequired && (body === undefined || body === null || body === "")) {
        throw new SubsplashError(
            operation.operationId + " requires a request body. Set it on the node or pass msg.body (or msg.payload)."
        );
    }
    const pagination = String(pick(message, "pagination", config.pagination) || "page");
    if (pagination !== "page" && pagination !== "all") {
        throw new SubsplashError("pagination must be \"page\" or \"all\"");
    }
    const pageNumber = optionalInt(pick(message, "pageNumber", config.pageNumber), "pageNumber");
    const pageSize = optionalInt(pick(message, "pageSize", config.pageSize), "pageSize");
    const headers = buildHeaders(operation, config, message);
    const maxPages = optionalInt(pick(message, "maxPages", undefined), "maxPages");
    return {
        outputMode: pick(message, "output", config.output) || "response",
        operation,
        plan: {
            method: operation.method,
            path,
            query,
            headers,
            body,
            contentType: operation.contentType || undefined,
            form: operation.contentType === "application/x-www-form-urlencoded",
            fillClientCredentials: operation.operationId === "CreateToken",
            auth: operation.auth,
            pagination: operation.collection ? pagination : "page",
            collection: operation.collection,
            syntheticPages: Boolean(operation.syntheticPages),
            sendPageNumber: operation.pageNumber !== false,
            sendPageSize: operation.pageSize !== false,
            pageNumber,
            pageSize,
            maxPages,
            operationId: operation.operationId,
            idempotent: operation.method === "GET" || operation.method === "HEAD" || operation.method === "OPTIONS" || operation.method === "DELETE"
        }
    };
}

function planRaw({ config, msg, baseUrl }) {
    const message = msg || {};
    const method = String(pick(message, "method", config.method) || "GET").toUpperCase();
    if (!RAW_METHODS.has(method)) {
        throw new SubsplashError("Method must be one of " + Array.from(RAW_METHODS).join(", "));
    }
    let path = pick(message, "path", config.path);
    if ((path === undefined || path === null || path === "") && typeof message.url === "string") {
        path = message.url;
    }
    if (!path || typeof path !== "string") {
        throw new SubsplashError("Set a path on the request node or msg.path. Paths start with /.");
    }
    path = path.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
        assertSameOrigin(path, baseUrl);
    } else {
        if (!path.startsWith("/")) {
            throw new SubsplashError("Path must start with /. Received \"" + path + "\".");
        }
        const resourceId = pick(message, "resourceId", config.resourceId);
        const extra = isPlainObject(message.pathParams) ? message.pathParams : {};
        if (path.includes("{id}")) {
            const id = extra.id || resourceId;
            if (!id) {
                throw new SubsplashError("This path needs an id. Set the resource ID or msg.resourceId.");
            }
            path = path.replaceAll("{id}", encodeURIComponent(String(id)));
        }
    }
    const query = [];
    mergePairs(query, objectPairs(parseJsonish(config.query, "query")));
    mergePairs(query, objectPairs(parseJsonish(pickDefined(message, "query"), "query")));
    mergePairs(query, filterPairs(parseJsonish(config.filters, "filters")));
    mergePairs(query, filterPairs(parseJsonish(pickDefined(message, "filters"), "filters")));
    const include = pick(message, "include", config.include);
    if (include) {
        put(query, "include", Array.isArray(include) ? include.join(",") : include);
    }
    const sort = pick(message, "sort", config.sort);
    if (sort) {
        put(query, "sort", sort);
    }
    mergePairs(query, fieldPairs(pickDefined(message, "fields") !== undefined ? message.fields : config.fields));
    const pagination = String(pick(message, "pagination", config.pagination) || "page");
    if (pagination !== "page" && pagination !== "all") {
        throw new SubsplashError("pagination must be \"page\" or \"all\"");
    }
    const pageNumber = optionalInt(pick(message, "pageNumber", config.pageNumber), "pageNumber");
    const pageSize = optionalInt(pick(message, "pageSize", config.pageSize), "pageSize");
    const fetchAll = pagination === "all";
    const headers = {};
    Object.assign(headers, stringMap(parseJsonish(config.headers, "headers"), "headers"));
    Object.assign(headers, stringMap(parseJsonish(pickDefined(message, "headers"), "headers"), "headers"));
    const accept = pick(message, "accept", config.accept);
    if (accept) {
        headers.Accept = String(accept);
    }
    const collectionTotal = pick(message, "collectionTotal", config.collectionTotal);
    if (collectionTotal) {
        headers["Collection-Total"] = String(collectionTotal);
    }
    let authenticate = config.authenticate !== false;
    if (Object.prototype.hasOwnProperty.call(message, "authenticate")) {
        authenticate = Boolean(message.authenticate);
    }
    const body = resolveRawBody(method, config, message);
    const contentType = pick(message, "contentType", config.contentType) || (body === undefined ? undefined : "application/json");
    return {
        outputMode: pick(message, "output", config.output) || "response",
        operation: null,
        plan: {
            method,
            path,
            query,
            headers,
            body,
            contentType,
            form: contentType === "application/x-www-form-urlencoded",
            fillClientCredentials: false,
            auth: authenticate,
            pagination: fetchAll ? "all" : "page",
            collection: fetchAll,
            syntheticPages: fetchAll,
            sendPageNumber: true,
            sendPageSize: true,
            pageNumber,
            pageSize,
            maxPages: optionalInt(pick(message, "maxPages", undefined), "maxPages"),
            operationId: null,
            idempotent: method === "GET" || method === "HEAD" || method === "OPTIONS" || method === "DELETE"
        }
    };
}

function pathParamValues(operation, config, message) {
    const values = {};
    if (isPlainObject(message.pathParams)) {
        Object.assign(values, message.pathParams);
    }
    const resourceId = pick(message, "resourceId", config.resourceId);
    if (resourceId) {
        if (operation.pathParams.length === 1) {
            values[operation.pathParams[0]] = resourceId;
        } else {
            values.id = resourceId;
        }
    }
    return values;
}

function fillPath(template, names, values) {
    return template.replace(/\{([^}]+)\}/g, (_, name) => {
        const value = values[name];
        if (value === undefined || value === null || value === "") {
            throw new SubsplashError(
                "Missing path parameter \"" + name + "\". Set the resource ID on the node or msg.resourceId."
            );
        }
        return encodeURIComponent(String(value));
    });
}

function buildQuery(operation, config, message, defaults) {
    const query = [];
    mergePairs(query, objectPairs(parseJsonish(config.query, "query")));
    mergePairs(query, objectPairs(parseJsonish(pickDefined(message, "query"), "query")));
    mergePairs(query, filterPairs(parseJsonish(config.filters, "filters")));
    mergePairs(query, filterPairs(parseJsonish(pickDefined(message, "filters"), "filters")));
    if (defaults.applyDefaultKeys !== false) {
        maybeDefault(query, operation, "filter[app_key]", defaults.appKey);
        maybeDefault(query, operation, "filter[org_key]", defaults.orgKey);
    }
    const include = pick(message, "include", config.include);
    if (include) {
        put(query, "include", Array.isArray(include) ? include.join(",") : include);
    }
    const sort = pick(message, "sort", config.sort);
    if (sort) {
        put(query, "sort", sort);
    }
    const fieldsValue = Object.prototype.hasOwnProperty.call(message, "fields") ? message.fields : config.fields;
    mergePairs(query, fieldPairs(fieldsValue));
    const pageNumber = optionalInt(pick(message, "pageNumber", config.pageNumber), "pageNumber");
    const pageSize = optionalInt(pick(message, "pageSize", config.pageSize), "pageSize");
    const pagination = String(pick(message, "pagination", config.pagination) || "page");
    if (pagination !== "all") {
        if (pageNumber !== null) {
            put(query, "page[number]", pageNumber);
        }
        if (pageSize !== null) {
            put(query, "page[size]", pageSize);
        }
    }
    return query.filter(([key]) => key !== "page");
}

function buildHeaders(operation, config, message) {
    const headers = {};
    Object.assign(headers, stringMap(parseJsonish(config.headers, "headers"), "headers"));
    Object.assign(headers, stringMap(parseJsonish(pickDefined(message, "headers"), "headers"), "headers"));
    const accept = pick(message, "accept", config.accept);
    if (accept) {
        headers.Accept = String(accept);
    }
    const collectionTotal = pick(message, "collectionTotal", config.collectionTotal);
    if (collectionTotal) {
        headers["Collection-Total"] = String(collectionTotal);
    }
    const collectionStats = pick(message, "collectionStats", config.collectionStats);
    if (collectionStats) {
        headers["Collection-Stats"] = String(collectionStats);
    }
    return headers;
}

function maybeDefault(query, operation, key, value) {
    if (!value) {
        return;
    }
    const documented = (operation.query || []).some((param) => param.name === key);
    if (!documented) {
        return;
    }
    const existing = query.find((pair) => pair[0] === key);
    if (!existing) {
        query.push([key, value]);
    }
}

function assertRequiredQuery(operation, query) {
    for (const param of operation.query || []) {
        if (!param.required) {
            continue;
        }
        if (param.name === "page" || param.name.startsWith("page[")) {
            continue;
        }
        const found = query.find((pair) => pair[0] === param.name && pair[1] !== undefined && pair[1] !== "");
        if (!found) {
            throw new SubsplashError(
                operation.operationId + " requires " + param.name + ". Set it in filters or query, or set the default app key / org key on the config node."
            );
        }
    }
}

function resolveBody(operation, config, message) {
    if (!operation.body && operation.contentType !== "application/x-www-form-urlencoded") {
        if (Object.prototype.hasOwnProperty.call(message, "body")) {
            return message.body === null ? undefined : message.body;
        }
        return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(message, "body")) {
        return message.body === null ? undefined : message.body;
    }
    const fromNode = parseJsonish(config.body, "body");
    if (fromNode !== undefined) {
        return fromNode;
    }
    if (message.payload !== undefined && operation.body) {
        return message.payload;
    }
    return undefined;
}

function resolveRawBody(method, config, message) {
    if (method === "GET" || method === "HEAD" || method === "DELETE" || method === "OPTIONS") {
        if (Object.prototype.hasOwnProperty.call(message, "body")) {
            return message.body === null ? undefined : message.body;
        }
        const fromNode = parseJsonish(config.body, "body");
        return fromNode;
    }
    if (Object.prototype.hasOwnProperty.call(message, "body")) {
        return message.body === null ? undefined : message.body;
    }
    const fromNode = parseJsonish(config.body, "body");
    if (fromNode !== undefined) {
        return fromNode;
    }
    if (message.payload !== undefined) {
        return message.payload;
    }
    return undefined;
}

function objectPairs(value) {
    if (value === undefined || value === null || value === "") {
        return [];
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new SubsplashError("Query must be an object of parameter names to values");
    }
    const pairs = [];
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined || item === "") {
            continue;
        }
        pairs.push([key, item]);
    }
    return pairs;
}

function mergePairs(target, pairs) {
    for (const pair of pairs) {
        put(target, pair[0], pair[1]);
    }
}

function put(pairs, key, value) {
    const index = pairs.findIndex((pair) => pair[0] === key);
    if (index === -1) {
        pairs.push([key, value]);
    } else {
        pairs[index][1] = value;
    }
}

function stringMap(value, label) {
    if (value === undefined || value === null || value === "") {
        return {};
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new SubsplashError(label + " must be an object");
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined || item === null || item === "") {
            continue;
        }
        out[key] = String(item);
    }
    return out;
}

function parseJsonish(value, label) {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== "string") {
        return value;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch (err) {
        throw new SubsplashError("Invalid JSON for " + label + ": " + err.message);
    }
}

function optionalInt(value, label) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        throw new SubsplashError(label + " must be an integer of 1 or greater");
    }
    return n;
}

function pick(message, key, fallback) {
    if (message && Object.prototype.hasOwnProperty.call(message, key) && message[key] !== undefined) {
        return message[key];
    }
    return fallback;
}

function pickDefined(message, key) {
    if (message && Object.prototype.hasOwnProperty.call(message, key)) {
        return message[key];
    }
    return undefined;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
    findNode,
    planResource,
    planRaw
};
