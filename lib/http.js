"use strict";

const http = require("node:http");
const https = require("node:https");
const { SubsplashError } = require("./errors");

const JSON_START = /^[\s]*[[{]/;

/**
 * Single HTTP request using Node's http/https modules so tests can intercept
 * it with nock. Redirects are not followed.
 */
function httpRequest(urlString, options) {
    const opts = options || {};
    return new Promise((resolve, reject) => {
        let url;
        try {
            url = new URL(urlString);
        } catch (_err) {
            reject(new SubsplashError("Invalid request URL"));
            return;
        }
        const lib = url.protocol === "https:" ? https : http;
        const headers = Object.assign({}, opts.headers || {});
        const body = opts.body === undefined || opts.body === null ? null : Buffer.from(String(opts.body));
        if (body) {
            headers["Content-Length"] = Buffer.byteLength(body);
        }
        const req = lib.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method: opts.method || "GET",
            headers,
            agent: false,
            timeout: opts.timeoutMs
        }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks);
                const text = raw.toString("utf8");
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: parseBody(text, res.headers["content-type"])
                });
            });
        });
        req.on("timeout", () => {
            req.destroy(Object.assign(new Error("Subsplash request timed out"), { code: "ETIMEDOUT" }));
        });
        req.on("error", (err) => {
            reject(new SubsplashError(err.message || "Subsplash request failed", {
                network: true,
                code: err.code,
                cause: err
            }));
        });
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function parseBody(text, contentType) {
    if (!text) {
        return null;
    }
    const type = String(contentType || "");
    if (/json/i.test(type) || JSON_START.test(text)) {
        try {
            return JSON.parse(text);
        } catch (_err) {
            return text;
        }
    }
    return text;
}

function headerValue(headers, name) {
    if (!headers) {
        return undefined;
    }
    const value = headers[String(name).toLowerCase()];
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

function retryAfterMs(headers, now) {
    const raw = headerValue(headers, "retry-after");
    if (raw === undefined || raw === null || raw === "") {
        return null;
    }
    const text = String(raw).trim();
    if (/^\d+(\.\d+)?$/.test(text)) {
        return Math.round(Number(text) * 1000);
    }
    const date = Date.parse(text);
    if (!Number.isNaN(date)) {
        return Math.max(0, date - now);
    }
    return null;
}

module.exports = {
    httpRequest,
    headerValue,
    retryAfterMs
};
