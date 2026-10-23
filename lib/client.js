"use strict";

const { SubsplashError, apiErrorMessage, apiErrorCode } = require("./errors");
const { buildUrl } = require("./query");
const { httpRequest, retryAfterMs } = require("./http");
const pkg = require("../package.json");

const USER_AGENT = "node-red-contrib-subsplash/" + pkg.version;
const MAX_RETRY_AFTER_MS = 120000;
const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "DELETE"]);

class SubsplashClient {
    constructor(options) {
        const opts = options || {};
        this.baseUrl = String(opts.baseUrl || "https://core.subsplash.com").replace(/\/+$/, "");
        this.getCredentials = opts.getCredentials || (() => ({}));
        this.getSettings = opts.getSettings || (() => ({}));
        this.requestImpl = opts.requestImpl || httpRequest;
        this.sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.now = opts.now || Date.now;
        this.jitter = opts.jitter || (() => Math.floor(Math.random() * 100));
        this._cached = null;
        this._pending = null;
        this._preferFetched = false;
    }

    settings() {
        const raw = this.getSettings() || {};
        return {
            timeoutMs: clampInt(raw.timeoutMs, 30000, 1000, 120000),
            maxRetries: clampInt(raw.maxRetries, 4, 0, 8),
            retryBaseMs: clampInt(raw.retryBaseMs, 500, 0, 60000),
            tokenSkewSeconds: clampInt(raw.tokenSkewSeconds, 30, 0, 3600),
            maxPages: clampInt(raw.maxPages, 50, 1, 500)
        };
    }

    credentials() {
        return this.getCredentials() || {};
    }

    canFetchToken() {
        const creds = this.credentials();
        return Boolean(creds.clientId && creds.clientSecret);
    }

    async getAccessToken(options) {
        const opts = options || {};
        const creds = this.credentials();
        const settings = this.settings();
        if (!opts.force && !this._preferFetched && creds.accessToken) {
            return creds.accessToken;
        }
        if (opts.force && creds.accessToken && !this.canFetchToken()) {
            throw new SubsplashError(
                "Subsplash returned 401 and the config node has an access token but no client id and secret to request a new one."
            );
        }
        if (!opts.force && this._cached && this._cached.expiresAt - (settings.tokenSkewSeconds * 1000) > this.now()) {
            return this._cached.token;
        }
        if (!this.canFetchToken()) {
            throw new SubsplashError(
                "Add a client id and client secret to the Subsplash config node, or set an access token."
            );
        }
        if (this._pending && !opts.force) {
            return this._pending;
        }
        const pending = this.fetchToken().finally(() => {
            if (this._pending === pending) {
                this._pending = null;
            }
        });
        this._pending = pending;
        const token = await pending;
        this._preferFetched = true;
        return token;
    }

    async fetchToken() {
        const creds = this.credentials();
        const params = new URLSearchParams();
        params.set("grant_type", "client_credentials");
        params.set("client_id", creds.clientId);
        params.set("client_secret", creds.clientSecret);
        if (creds.addClaims) {
            params.set("add_claims", String(creds.addClaims));
        }
        const res = await this.send({
            method: "POST",
            path: "/tokens/v1/token",
            body: params.toString(),
            contentType: "application/x-www-form-urlencoded",
            auth: false,
            idempotent: true,
            operationId: "CreateToken"
        });
        const body = res.body || {};
        if (!body.access_token) {
            throw new SubsplashError("Subsplash token response did not include access_token", {
                statusCode: res.statusCode,
                body: res.body,
                headers: res.headers
            });
        }
        const expiresIn = Number(body.expires_in);
        const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 60;
        this._cached = {
            token: body.access_token,
            expiresAt: this.now() + (ttl * 1000)
        };
        return body.access_token;
    }

    /**
     * Perform one API call, attaching a bearer token when required, refreshing
     * once on 401, and backing off on 429. Unsafe methods are not retried on
     * 5xx or network errors.
     */
    async send(plan, hooks) {
        const settings = this.settings();
        const notify = hooks && hooks.onStatus ? hooks.onStatus : () => {};
        let refreshed = false;
        let attempt = 0;
        while (true) {
            const headers = Object.assign({}, plan.headers || {});
            if (plan.auth) {
                const token = await this.getAccessToken();
                headers.Authorization = "Bearer " + token;
            } else {
                delete headers.Authorization;
                delete headers.authorization;
            }
            if (!headers["User-Agent"] && !headers["user-agent"]) {
                headers["User-Agent"] = USER_AGENT;
            }
            if (plan.contentType && plan.body !== undefined && plan.body !== null) {
                headers["Content-Type"] = plan.contentType;
            }
            const url = buildUrl(this.baseUrl, plan.path, plan.query);
            let res;
            try {
                res = await this.requestImpl(url, {
                    method: plan.method,
                    headers,
                    body: plan.body,
                    timeoutMs: settings.timeoutMs
                });
            } catch (err) {
                const idempotent = plan.idempotent === true || IDEMPOTENT.has(plan.method);
                if (idempotent && attempt < settings.maxRetries) {
                    const wait = this.backoff(attempt, settings);
                    notify({
                        fill: "yellow",
                        shape: "ring",
                        text: "retry " + (attempt + 1)
                    });
                    await this.sleep(wait);
                    attempt += 1;
                    continue;
                }
                throw err;
            }

            if (res.statusCode === 401 && plan.auth && !refreshed && (this.canFetchToken() || this.credentials().accessToken)) {
                refreshed = true;
                this._cached = null;
                if (this.canFetchToken()) {
                    await this.getAccessToken({ force: true });
                    continue;
                }
            }

            if (res.statusCode === 429 && attempt < settings.maxRetries) {
                const wait = this.retryDelay(res.headers, attempt, settings);
                notify({
                    fill: "yellow",
                    shape: "ring",
                    text: "rate limit retry " + (attempt + 1)
                });
                await this.sleep(wait);
                attempt += 1;
                continue;
            }

            const idempotent = plan.idempotent === true || IDEMPOTENT.has(plan.method);
            if (idempotent && isTransientStatus(res.statusCode) && attempt < settings.maxRetries) {
                const wait = this.backoff(attempt, settings);
                notify({
                    fill: "yellow",
                    shape: "ring",
                    text: "retry " + (attempt + 1)
                });
                await this.sleep(wait);
                attempt += 1;
                continue;
            }

            if (res.statusCode >= 400) {
                throw new SubsplashError(apiErrorMessage(res.statusCode, res.body), {
                    statusCode: res.statusCode,
                    code: apiErrorCode(res.body),
                    body: res.body,
                    headers: res.headers
                });
            }
            return {
                statusCode: res.statusCode,
                headers: res.headers,
                body: res.body,
                url
            };
        }
    }

    retryDelay(headers, attempt, settings) {
        const fromHeader = retryAfterMs(headers, this.now());
        if (fromHeader !== null) {
            return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, fromHeader));
        }
        return this.backoff(attempt, settings);
    }

    backoff(attempt, settings) {
        const base = settings.retryBaseMs * Math.pow(2, attempt);
        return Math.min(MAX_RETRY_AFTER_MS, base + this.jitter(attempt));
    }

    /**
     * Run a plan. Collection plans with pagination "all" follow HAL `_links.next`
     * and, when the operation supports it, page[number] until the collection
     * is exhausted or maxPages is hit.
     */
    async execute(plan, hooks) {
        const notify = hooks && hooks.onStatus ? hooks.onStatus : () => {};
        const settings = this.settings();
        const maxPages = clampInt(plan.maxPages, settings.maxPages, 1, 500);
        const fetchAll = plan.pagination === "all" && plan.collection;
        if (!fetchAll) {
            notify({ fill: "blue", shape: "dot", text: "requesting" });
            const prepared = prepareBody(plan, this.credentials());
            const res = await this.send(Object.assign({}, plan, prepared), hooks);
            return shapeResult(plan, res, {
                pagesFetched: 1,
                truncated: false,
                count: countOf(res.body),
                total: totalOf(res.body)
            });
        }

        let pageNumber = plan.pageNumber || 1;
        const pageSize = plan.pageSize || 100;
        let nextPath = null;
        let merged = null;
        let pagesFetched = 0;
        let truncated = false;
        let last = null;
        let lastFull = false;
        const seen = new Set();
        let fetchedCount = 0;

        while (pagesFetched < maxPages) {
            const query = (plan.query || []).filter(([key]) => key !== "page[number]" && key !== "page[size]" && key !== "page");
            if (!nextPath) {
                if (plan.sendPageSize !== false) {
                    query.push(["page[size]", pageSize]);
                }
                if (plan.sendPageNumber !== false) {
                    query.push(["page[number]", pageNumber]);
                }
            }
            notify({
                fill: "blue",
                shape: "ring",
                text: "page " + (pagesFetched + 1)
            });
            const prepared = prepareBody(plan, this.credentials());
            const res = await this.send(Object.assign({}, plan, prepared, {
                path: nextPath || plan.path,
                query: nextPath ? [] : query
            }), hooks);
            last = res;
            pagesFetched += 1;
            const fp = fingerprint(res.body);
            if (seen.has(fp) && fp !== "empty") {
                break;
            }
            seen.add(fp);
            const pageItems = countOf(res.body);
            fetchedCount += pageItems;
            merged = mergeBodies(merged, res.body);
            const total = totalOf(res.body);
            const next = nextLink(res.body);
            if (next) {
                assertSameOrigin(this.baseUrl, next);
                nextPath = next;
                continue;
            }
            nextPath = null;
            if (pageItems === 0) {
                break;
            }
            if (typeof total === "number" && fetchedCount >= total) {
                break;
            }
            const fullPage = pageItems >= pageSize;
            lastFull = fullPage;
            if (plan.syntheticPages && fullPage && (typeof total !== "number" || fetchedCount < total)) {
                pageNumber += 1;
                continue;
            }
            break;
        }

        if (pagesFetched >= maxPages) {
            const moreByTotal = typeof totalOf(last && last.body) === "number" && fetchedCount < totalOf(last.body);
            const moreByLink = Boolean(last && nextLink(last.body));
            if (moreByTotal || moreByLink || lastFull) {
                truncated = true;
            }
        }

        if (merged && typeof merged === "object") {
            const items = primaryArray(merged);
            if (items) {
                merged.count = items.length;
            }
            if (merged._links && typeof merged._links === "object") {
                delete merged._links.next;
                delete merged._links.prev;
            }
        }

        return shapeResult(plan, {
            statusCode: last ? last.statusCode : 200,
            headers: last ? last.headers : {},
            body: merged,
            url: last ? last.url : ""
        }, {
            pagesFetched,
            truncated,
            count: merged && typeof merged.count === "number" ? merged.count : fetchedCount,
            total: totalOf(merged)
        });
    }
}

function prepareBody(plan, credentials) {
    if (!plan.form) {
        return {
            body: serializeJsonBody(plan.body),
            contentType: plan.body === undefined || plan.body === null
                ? undefined
                : (plan.contentType || "application/json")
        };
    }
    let source;
    if (typeof plan.body === "string") {
        const trimmed = plan.body.trim();
        if (trimmed.startsWith("{")) {
            source = JSON.parse(trimmed);
        } else if (trimmed) {
            source = Object.fromEntries(new URLSearchParams(trimmed));
        } else {
            source = {};
        }
    } else {
        source = Object.assign({}, plan.body || {});
    }
    if (plan.fillClientCredentials) {
        if (!source.grant_type) {
            source.grant_type = "client_credentials";
        }
        if (!source.client_id && credentials.clientId) {
            source.client_id = credentials.clientId;
        }
        if (!source.client_secret && credentials.clientSecret) {
            source.client_secret = credentials.clientSecret;
        }
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(source)) {
        if (value === undefined || value === null || value === "") {
            continue;
        }
        params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    return {
        body: params.toString(),
        contentType: plan.contentType || "application/x-www-form-urlencoded"
    };
}

function serializeJsonBody(body) {
    if (body === undefined || body === null) {
        return undefined;
    }
    if (typeof body === "string") {
        return body;
    }
    return JSON.stringify(body);
}

function shapeResult(plan, res, pageMeta) {
    return {
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.body,
        meta: {
            operation: plan.operationId || null,
            method: plan.method,
            path: plan.path,
            url: res.url,
            pagesFetched: pageMeta.pagesFetched,
            truncated: pageMeta.truncated,
            count: pageMeta.count,
            total: pageMeta.total,
            collection: Boolean(plan.collection)
        }
    };
}

function isTransientStatus(code) {
    return code === 502 || code === 503 || code === 504;
}

function clampInt(value, fallback, min, max) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function primaryArray(body) {
    if (!body || typeof body !== "object") {
        return null;
    }
    if (Array.isArray(body)) {
        return body;
    }
    if (!body._embedded || typeof body._embedded !== "object") {
        return null;
    }
    let best = null;
    for (const value of Object.values(body._embedded)) {
        if (Array.isArray(value) && (best === null || value.length > best.length)) {
            best = value;
        }
    }
    return best;
}

function countOf(body) {
    const items = primaryArray(body);
    if (items) {
        return items.length;
    }
    if (body && typeof body === "object" && typeof body.count === "number") {
        return body.count;
    }
    return 0;
}

function totalOf(body) {
    if (body && typeof body === "object" && typeof body.total === "number") {
        return body.total;
    }
    return null;
}

function nextLink(body) {
    if (!body || typeof body !== "object" || !body._links) {
        return null;
    }
    const link = body._links.next;
    if (!link) {
        return null;
    }
    if (typeof link === "string") {
        return link;
    }
    if (typeof link.href === "string") {
        return link.href;
    }
    return null;
}

function fingerprint(body) {
    const items = primaryArray(body);
    if (!items || items.length === 0) {
        return "empty";
    }
    const ident = (item) => {
        if (item && typeof item === "object" && item.id) {
            return String(item.id);
        }
        try {
            return JSON.stringify(item);
        } catch (_err) {
            return String(item);
        }
    };
    return items.length + ":" + ident(items[0]) + ":" + ident(items[items.length - 1]);
}

function mergeBodies(acc, body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return acc || body;
    }
    if (!acc) {
        const copy = Object.assign({}, body);
        if (body._embedded && typeof body._embedded === "object") {
            copy._embedded = {};
            for (const [key, value] of Object.entries(body._embedded)) {
                copy._embedded[key] = Array.isArray(value) ? value.slice() : value;
            }
        }
        return copy;
    }
    if (body._embedded && typeof body._embedded === "object") {
        acc._embedded = acc._embedded || {};
        for (const [key, value] of Object.entries(body._embedded)) {
            if (Array.isArray(value)) {
                const current = Array.isArray(acc._embedded[key]) ? acc._embedded[key] : [];
                acc._embedded[key] = current.concat(value);
            }
        }
    }
    if (typeof body.total === "number") {
        acc.total = body.total;
    }
    return acc;
}

function assertSameOrigin(baseUrl, href) {
    const base = new URL(baseUrl);
    const next = new URL(href, baseUrl);
    if (next.origin !== base.origin) {
        throw new SubsplashError(
            "Refusing to follow a next link on " + next.origin + ". Pagination stays on " + base.origin + "."
        );
    }
}

function extractItems(body) {
    if (!body || typeof body !== "object") {
        return null;
    }
    if (Array.isArray(body)) {
        return body;
    }
    if (!body._embedded || typeof body._embedded !== "object") {
        return null;
    }
    const arrays = Object.entries(body._embedded).filter((entry) => Array.isArray(entry[1]));
    if (arrays.length === 1) {
        return arrays[0][1];
    }
    if (arrays.length > 1) {
        return body._embedded;
    }
    return null;
}

module.exports = {
    SubsplashClient,
    extractItems,
    prepareBody,
    primaryArray
};
