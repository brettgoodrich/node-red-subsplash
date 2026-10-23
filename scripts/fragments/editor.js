window.SUBSPLASH_EDITOR_CATALOG = window.SUBSPLASH_EDITOR_CATALOG || {};

window.subsplashJsonOrEmpty = function (v) {
    if (v === undefined || v === null || String(v).trim() === "") {
        return true;
    }
    try {
        JSON.parse(v);
        return true;
    } catch (err) {
        return false;
    }
};

window.subsplashBaseUrl = function (v) {
    if (!v) {
        return false;
    }
    try {
        var url = new URL(v);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return false;
        }
        if (url.username || url.password) {
            return false;
        }
        return true;
    } catch (err) {
        return false;
    }
};

window.subsplashLabel = function (node) {
    if (node.name) {
        return node.name;
    }
    var ops = (window.SUBSPLASH_EDITOR_CATALOG && window.SUBSPLASH_EDITOR_CATALOG[node.type]) || [];
    for (var i = 0; i < ops.length; i++) {
        if (ops[i].operationId === node.operation) {
            return ops[i].label;
        }
    }
    return (node.type || "subsplash").replace("subsplash-", "");
};

window.subsplashPrepare = function (node) {
    var ops = (window.SUBSPLASH_EDITOR_CATALOG && window.SUBSPLASH_EDITOR_CATALOG[node.type]) || [];
    var select = $("#node-input-operation");
    function fill() {
        var current = select.val() || node.operation;
        select.empty();
        ops.forEach(function (op) {
            var text = op.label + "  —  " + op.method + " " + op.path;
            $("<option>").val(op.operationId).text(text).appendTo(select);
        });
        if (current) {
            select.val(current);
        }
    }
    function show(selector, on) {
        $(selector).toggle(!!on);
    }
    function describe() {
        var id = select.val();
        var op = null;
        for (var i = 0; i < ops.length; i++) {
            if (ops[i].operationId === id) {
                op = ops[i];
            }
        }
        var ui = op && op.ui ? op.ui : null;
        if (!ui) {
            show(".subsplash-id", op && op.pathParams && op.pathParams.length);
            show(".subsplash-path-params", false);
            show(".subsplash-body", op && op.body);
            show(".subsplash-filters", true);
            show(".subsplash-include", true);
            show(".subsplash-sort", true);
            show(".subsplash-fields", true);
            show(".subsplash-page", op && op.collection);
            show(".subsplash-total", true);
            show(".subsplash-accept", true);
            show(".subsplash-defaults", true);
        } else {
            show(".subsplash-id", ui.resourceId);
            show(".subsplash-path-params", ui.extraPathParams && ui.extraPathParams.length);
            show(".subsplash-body", ui.body);
            show(".subsplash-filters", ui.filters);
            show(".subsplash-include", ui.include);
            show(".subsplash-sort", ui.sort);
            show(".subsplash-fields", ui.fields);
            show(".subsplash-page", ui.paging);
            show(".subsplash-total", ui.total);
            show(".subsplash-accept", ui.accept);
            show(".subsplash-defaults", ui.defaultKeys);
        }
        if (!op) {
            $("#subsplash-op-summary").text("");
            return;
        }
        var bits = [op.method + " " + op.path];
        if (op.summary) {
            bits.push(op.summary);
        }
        if (op.contentType) {
            bits.push("Body is " + op.contentType + (op.bodyRequired ? " (required)" : ""));
        }
        if (op.requiredQuery && op.requiredQuery.length) {
            bits.push("Requires " + op.requiredQuery.join(", "));
        }
        if (ui && ui.extraPathParams && ui.extraPathParams.length) {
            bits.push("Additional path parameters: " + ui.extraPathParams.join(", "));
        }
        if (ui && op.collection && !ui.paging) {
            bits.push("OpenAPI does not declare page parameters. Pass them with msg.pageNumber, msg.pageSize, msg.pagination, or msg.query. Fetch all follows _links.next when the API sends it.");
        } else if (op.pageUndocumented) {
            bits.push("OpenAPI does not declare page parameters for this list. Leave page fields blank to omit them. Fetch all follows _links.next when the API sends it.");
        }
        $("#subsplash-op-summary").text(bits.join(". ") + ".");
    }
    select.on("change", describe);
    fill();
    describe();
};
