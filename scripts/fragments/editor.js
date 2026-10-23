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
    var filter = $("#subsplash-op-filter");
    function fill(term) {
        var current = select.val() || node.operation;
        var needle = (term || "").toLowerCase();
        select.empty();
        ops.forEach(function (op) {
            var hay = (op.label + " " + op.method + " " + op.path + " " + op.operationId).toLowerCase();
            if (needle && hay.indexOf(needle) === -1 && op.operationId !== current) {
                return;
            }
            var text = op.label + "  —  " + op.method + " " + op.path;
            $("<option>").val(op.operationId).text(text).appendTo(select);
        });
        if (current) {
            select.val(current);
        }
    }
    function describe() {
        var id = select.val();
        var op = null;
        for (var i = 0; i < ops.length; i++) {
            if (ops[i].operationId === id) {
                op = ops[i];
            }
        }
        $(".subsplash-id").toggle(!!(op && op.pathParams && op.pathParams.length));
        $(".subsplash-body").toggle(!!(op && op.body));
        $(".subsplash-page").toggle(!!(op && op.collection));
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
        if (op.pageUndocumented) {
            bits.push("OpenAPI does not declare page parameters for this list. Leave page fields blank to omit them. Fetch all follows _links.next when the API sends it.");
        }
        $("#subsplash-op-summary").text(bits.join(". ") + ".");
    }
    filter.on("keyup input", function () {
        fill(filter.val());
        describe();
    });
    select.on("change", describe);
    fill("");
    describe();
};
