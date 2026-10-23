"use strict";

const catalog = require("../lib/catalog.json");
const { SubsplashError } = require("../lib/errors");
const { SubsplashClient, extractItems } = require("../lib/client");
const { planResource, planRaw } = require("../lib/plan");

module.exports = function (RED) {
    function ConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.baseUrl = String(config.baseUrl || "https://core.subsplash.com").replace(/\/+$/, "");
        this.appKey = config.appKey || "";
        this.orgKey = config.orgKey || "";
        this.tokenSkewSeconds = config.tokenSkewSeconds;
        this.timeoutMs = config.timeoutMs;
        this.maxRetries = config.maxRetries;
        this.retryBaseMs = config.retryBaseMs;
        this.maxPages = config.maxPages;
        const node = this;
        this.getClient = function () {
            if (!node._client) {
                node._client = new SubsplashClient({
                    baseUrl: node.baseUrl,
                    getCredentials: function () {
                        return node.credentials || {};
                    },
                    getSettings: function () {
                        return {
                            timeoutMs: node.timeoutMs,
                            maxRetries: node.maxRetries,
                            retryBaseMs: node.retryBaseMs,
                            tokenSkewSeconds: node.tokenSkewSeconds,
                            maxPages: node.maxPages,
                            appKey: node.appKey,
                            orgKey: node.orgKey
                        };
                    }
                });
            }
            return node._client;
        };
    }

    RED.nodes.registerType("subsplash-config", ConfigNode, {
        credentials: {
            clientId: { type: "text" },
            clientSecret: { type: "password" },
            accessToken: { type: "password" },
            addClaims: { type: "text" }
        }
    });

    catalog.nodes.forEach((spec) => {
        function ResourceNode(config) {
            RED.nodes.createNode(this, config);
            copyResourceConfig(this, config);
            wireInput(RED, this, async (msg) => {
                const cfg = RED.nodes.getNode(this.subsplash);
                if (!cfg || typeof cfg.getClient !== "function") {
                    throw new SubsplashError("Select a Subsplash config node on the server connection.");
                }
                const operationId = (msg && msg.operation) || this.operation;
                const operation = spec.operations.find((item) => item.operationId === operationId);
                const allowTyped = !operation || !operation.ui || operation.ui.resourceId !== false;
                const planned = planResource({
                    nodeSpec: spec,
                    config: viewConfig(this, resolveResourceId(RED, this, msg, allowTyped)),
                    msg,
                    defaults: {
                        appKey: cfg.appKey,
                        orgKey: cfg.orgKey,
                        applyDefaultKeys: this.applyDefaultKeys !== false
                    }
                });
                const result = await cfg.getClient().execute(planned.plan, {
                    onStatus: (status) => {
                        if (!this.closing) {
                            this.status(status);
                        }
                    }
                });
                return { result, outputMode: planned.outputMode };
            });
        }
        RED.nodes.registerType(spec.type, ResourceNode);
    });

    function RequestNode(config) {
        RED.nodes.createNode(this, config);
        copyRequestConfig(this, config);
        wireInput(RED, this, async (msg) => {
            const cfg = RED.nodes.getNode(this.subsplash);
            if (!cfg || typeof cfg.getClient !== "function") {
                throw new SubsplashError("Select a Subsplash config node on the server connection.");
            }
            const planned = planRaw({
                config: viewConfig(this, resolveResourceId(RED, this, msg, true)),
                msg,
                baseUrl: cfg.baseUrl
            });
            const result = await cfg.getClient().execute(planned.plan, {
                onStatus: (status) => {
                    if (!this.closing) {
                        this.status(status);
                    }
                }
            });
            return { result, outputMode: planned.outputMode };
        });
    }
    RED.nodes.registerType("subsplash-request", RequestNode);
};

function wireInput(RED, node, run) {
    node.closing = false;
    node.on("input", function (msg, send, done) {
        let settled = false;
        const finish = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            if (err) {
                if (!node.closing) {
                    node.status({ fill: "red", shape: "ring", text: clip(err.message || "error", 48) });
                }
                // done(err) is how Node-RED 3 reports a failure: the runtime calls
                // node.error(err, msg), which is what Catch nodes receive. Calling
                // node.error() here as well would deliver the same failure twice.
                done(err);
                return;
            }
            done();
        };
        run.call(node, msg).then((outcome) => {
            applyResult(msg, outcome.result, outcome.outputMode);
            if (!node.closing) {
                node.status({ fill: "green", shape: "dot", text: successText(outcome.result) });
            }
            send(msg);
            finish();
        }).catch((err) => {
            const wrapped = err instanceof Error ? err : new SubsplashError(String(err));
            applyError(msg, wrapped);
            finish(wrapped);
        });
    });
    node.on("close", function (done) {
        node.closing = true;
        node.status({});
        done();
    });
}

function applyResult(msg, result, outputMode) {
    const body = result.body;
    if (outputMode === "items") {
        const items = extractItems(body);
        msg.payload = items === null ? body : items;
    } else {
        msg.payload = body;
    }
    msg.statusCode = result.statusCode;
    msg.headers = result.headers;
    msg.subsplash = result.meta;
}

function applyError(msg, err) {
    msg.statusCode = err.statusCode;
    if (err.body !== undefined) {
        msg.payload = err.body;
    } else {
        msg.payload = {
            message: err.message,
            code: err.code || undefined
        };
    }
    msg.subsplash = Object.assign({}, msg.subsplash || {}, {
        error: {
            message: err.message,
            statusCode: err.statusCode,
            code: err.code,
            network: Boolean(err.network)
        }
    });
    if (err.headers) {
        msg.headers = err.headers;
    }
}

function successText(result) {
    const meta = result.meta || {};
    if (meta.truncated) {
        return clip((meta.count || 0) + " items, truncated", 48);
    }
    if (meta.collection && typeof meta.count === "number" && meta.pagesFetched > 1) {
        return meta.count + " items, " + meta.pagesFetched + " pages";
    }
    if (meta.collection && typeof meta.count === "number") {
        return meta.count + " items";
    }
    return "ok " + result.statusCode;
}

function clip(text, max) {
    const value = String(text || "");
    if (value.length <= max) {
        return value;
    }
    return value.slice(0, max - 1) + "…";
}

function resolveResourceId(RED, node, msg, allowTyped) {
    const type = node.resourceIdType || "str";
    const messageHasId = msg && Object.prototype.hasOwnProperty.call(msg, "resourceId") && msg.resourceId !== undefined;
    if (!allowTyped || messageHasId || type === "str" || !node.resourceId) {
        return node.resourceId || "";
    }
    try {
        const value = RED.util.evaluateNodeProperty(node.resourceId, type, node, msg);
        return value === undefined || value === null ? "" : String(value);
    } catch (err) {
        throw new SubsplashError("Resource ID (" + type + ") could not be read: " + (err.message || err));
    }
}

function viewConfig(node, resourceId) {
    return {
        operation: node.operation,
        resourceId,
        pathParams: node.pathParams,
        body: node.body,
        filters: node.filters,
        include: node.include,
        sort: node.sort,
        fields: node.fields,
        query: node.query,
        headers: node.headers,
        pageNumber: node.pageNumber,
        pageSize: node.pageSize,
        pagination: node.pagination,
        collectionTotal: node.collectionTotal,
        collectionStats: node.collectionStats,
        accept: node.accept,
        output: node.output,
        applyDefaultKeys: node.applyDefaultKeys,
        method: node.method,
        path: node.path,
        authenticate: node.authenticate,
        contentType: node.contentType
    };
}

function copyResourceConfig(node, config) {
    node.name = config.name;
    node.subsplash = config.subsplash;
    node.operation = config.operation;
    node.resourceId = config.resourceId || "";
    node.resourceIdType = config.resourceIdType || "str";
    node.pathParams = config.pathParams || "";
    node.body = config.body || "";
    node.filters = config.filters || "";
    node.include = config.include || "";
    node.sort = config.sort || "";
    node.fields = config.fields || "";
    node.query = config.query || "";
    node.headers = config.headers || "";
    node.pageNumber = config.pageNumber || "";
    node.pageSize = config.pageSize || "";
    node.pagination = config.pagination || "page";
    node.collectionTotal = config.collectionTotal || "";
    node.collectionStats = config.collectionStats || "";
    node.accept = config.accept || "";
    node.output = config.output || "response";
    node.applyDefaultKeys = config.applyDefaultKeys !== false;
}

function copyRequestConfig(node, config) {
    node.name = config.name;
    node.subsplash = config.subsplash;
    node.method = config.method || "GET";
    node.path = config.path || "";
    node.resourceId = config.resourceId || "";
    node.resourceIdType = config.resourceIdType || "str";
    node.authenticate = config.authenticate !== false;
    node.body = config.body || "";
    node.contentType = config.contentType || "";
    node.filters = config.filters || "";
    node.include = config.include || "";
    node.sort = config.sort || "";
    node.fields = config.fields || "";
    node.query = config.query || "";
    node.headers = config.headers || "";
    node.pageNumber = config.pageNumber || "";
    node.pageSize = config.pageSize || "";
    node.pagination = config.pagination || "page";
    node.collectionTotal = config.collectionTotal || "";
    node.accept = config.accept || "";
    node.output = config.output || "response";
}
