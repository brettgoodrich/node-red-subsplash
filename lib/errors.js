"use strict";

/**
 * Error raised for Subsplash API failures, invalid node input, and transport
 * problems. `statusCode` and `code` are copied from the API error object when
 * the server returned one, so a Catch flow can switch on them.
 */
class SubsplashError extends Error {
    constructor(message, extra) {
        super(message);
        this.name = "SubsplashError";
        const info = extra || {};
        if (info.statusCode !== undefined) {
            this.statusCode = info.statusCode;
        }
        if (info.code !== undefined) {
            this.code = info.code;
        }
        if (info.body !== undefined) {
            this.body = info.body;
        }
        if (info.headers !== undefined) {
            this.headers = info.headers;
        }
        if (info.network) {
            this.network = true;
        }
        if (info.cause) {
            this.cause = info.cause;
        }
    }
}

function apiErrorMessage(statusCode, body) {
    const errors = body && typeof body === "object" ? body.errors : null;
    if (Array.isArray(errors) && errors.length > 0) {
        const parts = errors.map((entry) => {
            if (!entry || typeof entry !== "object") {
                return String(entry);
            }
            const bits = [];
            if (entry.code) {
                bits.push(entry.code);
            }
            if (entry.detail) {
                bits.push(entry.detail);
            }
            const source = entry.source && (entry.source.pointer || entry.source.parameter);
            if (source) {
                bits.push("(" + source + ")");
            }
            return bits.join(": ") || "error";
        });
        return "Subsplash API " + statusCode + ": " + parts.join("; ");
    }
    if (typeof body === "string" && body.trim()) {
        return "Subsplash API " + statusCode + ": " + body.trim().slice(0, 300);
    }
    return "Subsplash API " + statusCode;
}

function apiErrorCode(body) {
    const errors = body && typeof body === "object" ? body.errors : null;
    if (Array.isArray(errors) && errors[0] && errors[0].code) {
        return errors[0].code;
    }
    return undefined;
}

module.exports = {
    SubsplashError,
    apiErrorMessage,
    apiErrorCode
};
