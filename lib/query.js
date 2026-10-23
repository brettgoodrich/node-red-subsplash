"use strict";

const { SubsplashError } = require("./errors");

function stringifyScalar(value) {
    if (value === null) {
        return "null";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    return String(value);
}

/**
 * Encode a query value the way the Subsplash filter guide describes it.
 * Comparison operators stay readable (`<`, `<=` as `<%3D`, `>`, `>=` as
 * `>%3D`, `!`). Commas, asterisks, pipes, and backslashes are preserved so
 * multi-value filters, wildcards, or-filters, and escaped commas survive.
 */
function encodeQueryValue(value) {
    let rest = Array.isArray(value)
        ? value.map(stringifyScalar).join(",")
        : stringifyScalar(value);
    let prefix = "";
    if (rest.startsWith("<=")) {
        prefix = "<%3D";
        rest = rest.slice(2);
    } else if (rest.startsWith(">=")) {
        prefix = ">%3D";
        rest = rest.slice(2);
    } else if (rest.startsWith("<%3D")) {
        prefix = "<%3D";
        rest = rest.slice(5);
    } else if (rest.startsWith(">%3D")) {
        prefix = ">%3D";
        rest = rest.slice(5);
    } else if (rest.startsWith("<")) {
        prefix = "<";
        rest = rest.slice(1);
    } else if (rest.startsWith(">")) {
        prefix = ">";
        rest = rest.slice(1);
    } else if (rest.startsWith("!")) {
        prefix = "!";
        rest = rest.slice(1);
    }
    const encoded = encodeURIComponent(rest)
        .replace(/%2C/g, ",")
        .replace(/%2A/g, "*")
        .replace(/%7C/g, "|")
        .replace(/%5C/g, "\\");
    return prefix + encoded;
}

function encodeKey(key) {
    return encodeURIComponent(key).replace(/%5B/g, "[").replace(/%5D/g, "]");
}

function encodeQuery(pairs) {
    if (!pairs || pairs.length === 0) {
        return "";
    }
    return pairs.map(([key, value]) => encodeKey(key) + "=" + encodeQueryValue(value)).join("&");
}

/**
 * Build an absolute URL against the configured base. Absolute paths are
 * joined onto the base URL's path prefix. Absolute URLs must share that
 * origin; this keeps the node from becoming an open proxy.
 */
function buildUrl(baseUrl, path, pairs) {
    let base;
    try {
        base = new URL(baseUrl);
    } catch (_err) {
        throw new SubsplashError("Subsplash base URL is not a valid URL");
    }
    if (base.protocol !== "https:" && base.protocol !== "http:") {
        throw new SubsplashError("Subsplash base URL must use http or https");
    }
    if (base.username || base.password) {
        throw new SubsplashError("Put credentials on the config node, not in the base URL");
    }

    const raw = String(path || "");
    if (raw.startsWith("//") || raw.includes("\\")) {
        throw new SubsplashError("Path is not allowed");
    }

    let url;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        try {
            url = new URL(raw);
        } catch (_err) {
            throw new SubsplashError("Path is not a valid URL");
        }
        if (url.origin !== base.origin) {
            throw new SubsplashError(
                "Refusing to call " + url.origin + ". Requests must stay on " + base.origin + "."
            );
        }
    } else {
        const prefix = base.pathname.replace(/\/+$/, "");
        const rel = raw.startsWith("/") ? raw : "/" + raw;
        const [pathname, search] = splitSearch(rel);
        try {
            url = new URL(prefix + pathname, base.origin);
        } catch (_err) {
            throw new SubsplashError("Path is not valid");
        }
        if (search) {
            url.search = search;
        }
    }

    if (url.origin !== base.origin) {
        throw new SubsplashError(
            "Refusing to call " + url.origin + ". Requests must stay on " + base.origin + "."
        );
    }

    const merged = [];
    const seen = new Map();
    function put(key, value) {
        if (seen.has(key)) {
            merged[seen.get(key)][1] = value;
            return;
        }
        seen.set(key, merged.length);
        merged.push([key, value]);
    }
    for (const [key, value] of url.searchParams.entries()) {
        put(key, value);
    }
    for (const pair of pairs || []) {
        if (!pair) {
            continue;
        }
        put(pair[0], pair[1]);
    }
    const query = encodeQuery(merged);
    return url.origin + url.pathname + (query ? "?" + query : "");
}

function splitSearch(path) {
    const idx = path.indexOf("?");
    if (idx === -1) {
        return [path, ""];
    }
    return [path.slice(0, idx), path.slice(idx)];
}

function filterPairs(filters) {
    if (filters === undefined || filters === null) {
        return [];
    }
    if (typeof filters !== "object" || Array.isArray(filters)) {
        throw new SubsplashError("Filters must be an object of field names to values");
    }
    const pairs = [];
    for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === "") {
            continue;
        }
        const name = key.startsWith("filter[") ? key : "filter[" + key + "]";
        pairs.push([name, value]);
    }
    return pairs;
}

function fieldPairs(fields) {
    if (fields === undefined || fields === null || fields === "") {
        return [];
    }
    let source = fields;
    if (typeof fields === "string") {
        try {
            source = JSON.parse(fields);
        } catch (_err) {
            throw new SubsplashError("Fields must be a JSON object of resource type to comma-separated field list");
        }
    }
    if (typeof source !== "object" || Array.isArray(source)) {
        throw new SubsplashError("Fields must be an object, for example {\"responses\":\"count\"}");
    }
    const pairs = [];
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined || value === null || value === "") {
            continue;
        }
        const name = key.startsWith("fields[") ? key : "fields[" + key + "]";
        const rendered = Array.isArray(value) ? value.join(",") : value;
        pairs.push([name, rendered]);
    }
    return pairs;
}

module.exports = {
    encodeQuery,
    encodeQueryValue,
    encodeKey,
    buildUrl,
    filterPairs,
    fieldPairs
};
