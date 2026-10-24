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

var SUBSPLASH_OPS = [
    ["=", "="],
    ["!", "!"],
    ["<", "<"],
    [">", ">"],
    ["<=", "<="],
    [">=", ">="]
];

function subsplashFieldsApi() {
    return window.subsplashFields;
}

function subsplashEmptyForm() {
    var names = window.SUBSPLASH_HEADER_NAMES || [];
    return {
        idHint: "",
        filters: [],
        include: [],
        sort: [],
        fieldsets: [],
        headers: names.map(function (name) { return { name: name }; }),
        queryKeys: []
    };
}

function subsplashSetupEditor(options) {
    var api = subsplashFieldsApi();
    var state = { op: options.op || null };
    var refreshers = [];
    var modes = {};
    var bodyQuiet = false;

    function form() {
        return (state.op && state.op.form) || subsplashEmptyForm();
    }

    function bodyFields() {
        return (state.op && state.op.bodyFields) || [];
    }

    function track(row, fn) {
        refreshers.push(function () {
            if (row && row[0] && document.body && document.body.contains(row[0])) {
                fn();
            }
        });
    }

    function placeholderFor(spec) {
        if (spec && spec.example) {
            return String(spec.example);
        }
        if (spec && spec.format === "date-time") {
            return "2017-05-23T15:35:57Z";
        }
        if (spec && spec.format === "uuid") {
            return "uuid";
        }
        if (spec && spec.format) {
            return spec.format;
        }
        return "";
    }

    function mountValue(slot, spec, current) {
        slot.empty();
        var text = current === undefined || current === null ? "" : String(current);
        if (spec && spec.enum && spec.enum.length) {
            var known = {};
            var select = $("<select class='subsplash-value'></select>");
            var custom = $("<input type='text' class='subsplash-value-custom' placeholder='Custom'>").hide();
            $("<option>").val("").text("").appendTo(select);
            spec.enum.forEach(function (item) {
                known[item] = true;
                $("<option>").val(item).text(item).appendTo(select);
            });
            $("<option>").val("__custom__").text("Custom").appendTo(select);
            if (text && !known[text]) {
                select.val("__custom__");
                custom.val(text).show();
            } else {
                select.val(text);
            }
            select.on("change", function () {
                custom.toggle(select.val() === "__custom__");
            });
            slot.append($("<div class='subsplash-inline'></div>").append(select).append(custom));
            return;
        }
        if (spec && spec.type === "boolean") {
            var boolSelect = $("<select class='subsplash-value'></select>");
            $("<option>").val("").text("").appendTo(boolSelect);
            $("<option>").val("true").text("true").appendTo(boolSelect);
            $("<option>").val("false").text("false").appendTo(boolSelect);
            boolSelect.val(text);
            slot.append(boolSelect);
            return;
        }
        var inputType = "text";
        if (spec && (spec.type === "integer" || spec.type === "number")) {
            inputType = "number";
        } else if (spec && spec.format === "date") {
            inputType = "date";
        }
        slot.append($("<input class='subsplash-value'>").attr("type", inputType).attr("placeholder", placeholderFor(spec)).val(text));
    }

    function readValue(slot) {
        var select = slot.find("select.subsplash-value");
        if (select.length) {
            if (select.val() === "__custom__") {
                return slot.find(".subsplash-value-custom").val() || "";
            }
            return select.val() || "";
        }
        var input = slot.find(".subsplash-value");
        return input.length ? (input.val() || "") : "";
    }

    function keyControl(row, list, selected) {
        var current = selected || "";
        if (!list || !list.length) {
            var free = $("<input type='text' class='subsplash-key-free'>").val(current);
            row.append(free);
            var freeControl = {
                read: function () { return (free.val() || "").trim(); },
                refresh: function (next) {
                    if (!next || !next.length || !free.parent().length) {
                        return;
                    }
                    var value = freeControl.read();
                    var created = keyControl(row, next, value);
                    free.replaceWith(row.children().last());
                    freeControl.read = created.read;
                    freeControl.refresh = created.refresh;
                }
            };
            return freeControl;
        }
        var known = {};
        var select = $("<select class='subsplash-key'></select>");
        var custom = $("<input type='text' class='subsplash-key-custom' placeholder='Custom'>").hide();
        function fill(options, value) {
            known = {};
            select.empty();
            $("<option>").val("").text("").appendTo(select);
            (options || []).forEach(function (opt) {
                known[opt.value] = true;
                $("<option>").val(opt.value).text(opt.label || opt.value).appendTo(select);
            });
            $("<option>").val("__custom__").text("Custom").appendTo(select);
            if (value && !known[value]) {
                select.val("__custom__");
                custom.val(value).show();
            } else {
                select.val(value || "");
                custom.toggle(false);
            }
        }
        select.on("change", function () {
            custom.toggle(select.val() === "__custom__");
        });
        fill(list, current);
        row.append($("<div class='subsplash-inline subsplash-key-wrap'></div>").append(select).append(custom));
        var control = {
            read: function () {
                return select.val() === "__custom__" ? (custom.val() || "").trim() : (select.val() || "");
            },
            refresh: function (next) {
                fill(next, control.read());
            }
        };
        return control;
    }

    function filterOptions() {
        return (form().filters || []).map(function (item) {
            return { value: item.name, label: item.name };
        });
    }

    function findFilter(key) {
        var filters = form().filters || [];
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].name === key) {
                return filters[i];
            }
        }
        return null;
    }

    function findHeader(key) {
        var headers = form().headers || [];
        for (var i = 0; i < headers.length; i++) {
            if (headers[i].name === key) {
                return headers[i];
            }
        }
        return null;
    }

    function findBodyField(key) {
        var fields = bodyFields();
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].name === key) {
                return fields[i];
            }
        }
        return null;
    }

    function fieldsetOptions() {
        return (form().fieldsets || []).map(function (item) {
            return { value: item.type, label: item.type };
        });
    }

    function findFieldset(type) {
        var sets = form().fieldsets || [];
        for (var i = 0; i < sets.length; i++) {
            if (sets[i].type === type) {
                return sets[i];
            }
        }
        return null;
    }

    function headerSuggestions() {
        var seen = {};
        var names = [];
        function add(name) {
            if (name && !seen[name]) {
                seen[name] = true;
                names.push(name);
            }
        }
        (window.SUBSPLASH_HEADER_NAMES || []).forEach(add);
        (form().headers || []).forEach(function (header) { add(header.name); });
        return names;
    }

    function fillDataList(id, values) {
        var list = $(id);
        list.empty();
        (values || []).forEach(function (value) {
            $("<option>").attr("value", value).appendTo(list);
        });
    }

    function setupList(id, builder) {
        $(id).editableList({
            addItem: function (row, index, data) {
                builder(row, data || {});
            },
            removable: true,
            sortable: true,
            height: "auto"
        });
    }

    function listBox(list) {
        return $(list).parent(".red-ui-editableList-container");
    }

    function listActions(list) {
        var box = listBox(list);
        if (!box.length) {
            return $();
        }
        var actions = box.children(".subsplash-list-actions");
        if (!actions.length) {
            actions = $("<div class='subsplash-list-actions'></div>").appendTo(box);
        }
        var add = $(list).closest(".red-ui-editableList").children(".red-ui-editableList-addButton");
        if (add.length) {
            actions.append(add);
        }
        return actions;
    }

    function loadList(id, rows) {
        var list = $(id);
        list.editableList("empty");
        (rows || []).forEach(function (row) {
            list.editableList("addItem", row);
        });
    }

    var JSON_ROW_ERROR = "Couldn't load this JSON into rows. Switch back to View as JSON to fix it.";

    function wireMode(name, list, area, readRows, parse, serialize, io) {
        var mode = "rows";
        var holdJson = false;
        var keepText = io && io.keepText;
        var button = $("#subsplash-" + name + "-mode");
        var actions = listActions(list);
        if (actions.length) {
            if (area && !keepText) {
                $(area).insertBefore(actions);
            }
            actions.append(button);
        }
        var error = $("<div class='subsplash-json-error' role='alert'></div>").hide();
        if (actions.length) {
            actions.before(error);
        }
        function readText() {
            if (io && io.read) {
                return io.read();
            }
            return $(area).val();
        }
        function writeText(text) {
            if (io && io.write) {
                io.write(text);
                return;
            }
            $(area).val(text);
        }
        function hideJson(hidden) {
            if (io && io.hide) {
                io.hide(hidden);
                return;
            }
            $(area).toggle(!hidden);
        }
        function showError(on) {
            error.text(on ? JSON_ROW_ERROR : "");
            error.toggle(!!on);
        }
        function show(next) {
            holdJson = false;
            mode = next;
            var rowsOn = mode === "rows";
            $(list).toggle(rowsOn);
            listBox(list).find(".red-ui-editableList-addButton").toggle(rowsOn);
            hideJson(rowsOn);
            button.text(rowsOn ? "View as JSON" : "View as Rows");
            showError(false);
        }
        function showUnloaded() {
            holdJson = true;
            mode = "json";
            $(list).hide();
            listBox(list).find(".red-ui-editableList-addButton").hide();
            hideJson(true);
            button.text("View as JSON");
            showError(true);
        }
        button.on("click", function (event) {
            event.preventDefault();
            if (holdJson) {
                show("json");
                return;
            }
            if (mode === "rows") {
                if (!keepText) {
                    writeText(serialize(readRows()));
                }
                show("json");
                return;
            }
            var parsed = parse(readText());
            if (!parsed || parsed.mode !== "rows") {
                showUnloaded();
                return;
            }
            if (io && io.beforeLoad) {
                io.beforeLoad();
            }
            loadList(list, parsed.rows);
            if (io && io.afterLoad) {
                io.afterLoad();
            }
            show("rows");
        });
        if (area && !keepText) {
            $(area).on("input", function () {
                if (holdJson || mode !== "json") {
                    return;
                }
                var parsed = parse(readText());
                if (parsed && parsed.mode === "rows") {
                    showError(false);
                }
            });
        }
        modes[name] = {
            show: show,
            holding: function () { return holdJson; },
            save: function () {
                if (mode === "json" || holdJson) {
                    return (readText() || "").trim();
                }
                return serialize(readRows());
            }
        };
    }

    function setExtras(open) {
        var panel = $("#subsplash-extras-panel");
        if (!panel.length) {
            return;
        }
        panel.toggle(!!open);
        $("#subsplash-extras-caret").toggleClass("fa-caret-down", !!open).toggleClass("fa-caret-right", !open);
        $("#subsplash-extras-toggle").attr("aria-expanded", open ? "true" : "false");
    }

    function readFilterRows() {
        var rows = [];
        $("#subsplash-filters-list .subsplash-filter-row").each(function () {
            var row = $(this);
            rows.push({
                key: row.data("keyRead")(),
                op: row.find(".subsplash-op").val() || "=",
                value: readValue(row.find(".subsplash-value-slot"))
            });
        });
        return rows;
    }

    function readSortRows() {
        var rows = [];
        $("#subsplash-sort-list .subsplash-sort-row").each(function () {
            var row = $(this);
            rows.push({ field: row.data("keyRead")(), desc: row.data("desc") === true });
        });
        return rows;
    }

    function readFieldRows() {
        var rows = [];
        $("#subsplash-fields-list .subsplash-field-row").each(function () {
            var row = $(this);
            rows.push({
                type: row.data("keyRead")(),
                fields: row.find(".subsplash-field-list").val() || ""
            });
        });
        return rows;
    }

    function readPairRows(selector) {
        var rows = [];
        $(selector).each(function () {
            var row = $(this);
            rows.push({
                key: row.data("keyRead")(),
                value: readValue(row.find(".subsplash-value-slot"))
            });
        });
        return rows;
    }

    function readBodyRows() {
        var rows = [];
        $("#subsplash-body-fields .subsplash-body-row").each(function () {
            var row = $(this);
            rows.push({
                key: row.data("keyRead")(),
                value: readValue(row.find(".subsplash-value-slot"))
            });
        });
        return rows;
    }

    function coerceBody(key, raw) {
        var field = findBodyField(key);
        var text = raw === undefined || raw === null ? "" : String(raw);
        if (field && (field.type === "object" || field.type === "array")) {
            try {
                return JSON.parse(text);
            } catch (err) {
                return text;
            }
        }
        if (text.charAt(0) === "{" || text.charAt(0) === "[") {
            try {
                return JSON.parse(text);
            } catch (err) {
                // Keep the typed text when it is not JSON.
            }
        }
        if (field && field.type === "boolean") {
            return text === "true";
        }
        if (field && (field.type === "integer" || field.type === "number")) {
            if (text === "") {
                return null;
            }
            var number = Number(text);
            return Number.isNaN(number) ? text : number;
        }
        return text;
    }

    function writeBodyFromRows() {
        if (bodyQuiet) {
            return;
        }
        var obj = {};
        readBodyRows().forEach(function (row) {
            if (!row.key) {
                return;
            }
            obj[row.key] = coerceBody(row.key, row.value);
        });
        $("#node-input-body").typedInput("value", JSON.stringify(obj));
    }

    function addFilterRow(row, data) {
        var line = $("<div class='subsplash-inline subsplash-filter-row'></div>").appendTo(row);
        var keys = keyControl(line, filterOptions(), data.key || "");
        line.data("keyRead", function () { return keys.read(); });
        var op = $("<select class='subsplash-op'></select>");
        SUBSPLASH_OPS.forEach(function (pair) {
            $("<option>").val(pair[0]).text(pair[1]).appendTo(op);
        });
        op.val(data.op || "=");
        var slot = $("<span class='subsplash-value-slot'></span>");
        function paint() {
            mountValue(slot, findFilter(keys.read()), readValue(slot) || data.value || "");
            data.value = "";
        }
        line.append(op).append(slot);
        line.on("change", function (event) {
            var target = event && event.target;
            if (target && $(target).is(".subsplash-key, .subsplash-key-free, .subsplash-key-custom")) {
                mountValue(slot, findFilter(keys.read()), "");
            }
        });
        paint();
        track(line, function () {
            var value = readValue(slot);
            keys.refresh(filterOptions());
            mountValue(slot, findFilter(keys.read()), value);
        });
    }

    function addSortRow(row, data) {
        var line = $("<div class='subsplash-inline subsplash-sort-row'></div>").appendTo(row);
        var options = (form().sort || []).map(function (field) { return { value: field, label: field }; });
        var keys = keyControl(line, options, data.field || "");
        line.data("keyRead", function () { return keys.read(); });
        line.data("desc", data.desc === true);
        var toggle = $("<button type='button' class='red-ui-button subsplash-dir'></button>");
        function paintDir() {
            toggle.text(line.data("desc") ? "Descending" : "Ascending");
        }
        toggle.on("click", function (event) {
            event.preventDefault();
            line.data("desc", !line.data("desc"));
            paintDir();
        });
        paintDir();
        line.append(toggle);
        track(line, function () {
            keys.refresh((form().sort || []).map(function (field) { return { value: field, label: field }; }));
        });
    }

    function addFieldRow(row, data) {
        var line = $("<div class='subsplash-inline subsplash-field-row'></div>").appendTo(row);
        var keys = keyControl(line, fieldsetOptions(), data.type || "");
        line.data("keyRead", function () { return keys.read(); });
        var input = $("<input type='text' class='subsplash-field-list' placeholder='field,field'>").val(data.fields || "");
        var add = $("<select class='subsplash-field-add'><option value=''>Add</option></select>");
        function paintAdd() {
            var spec = findFieldset(keys.read());
            var current = add.val();
            add.empty();
            $("<option>").val("").text("Add").appendTo(add);
            if (spec && spec.enum && spec.enum.length) {
                spec.enum.forEach(function (item) {
                    $("<option>").val(item).text(item).appendTo(add);
                });
                add.show();
            } else {
                add.hide();
            }
            if (spec && spec.example) {
                input.attr("placeholder", spec.example);
            }
            add.val(current);
        }
        add.on("change", function () {
            var picked = add.val();
            add.val("");
            if (!picked) {
                return;
            }
            var parts = (input.val() || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean);
            if (parts.indexOf(picked) === -1) {
                parts.push(picked);
            }
            input.val(parts.join(","));
        });
        line.on("change", paintAdd);
        line.append(input).append(add);
        paintAdd();
        track(line, function () {
            keys.refresh(fieldsetOptions());
            paintAdd();
        });
    }

    function addPairRow(row, data, kind) {
        var line = $("<div class='subsplash-inline'></div>").addClass("subsplash-" + kind + "-row").appendTo(row);
        var suggestions = kind === "headers" ? headerSuggestions() : (form().queryKeys || []);
        var key = $("<input type='text' class='subsplash-pair-key'>").attr("list", "subsplash-" + kind + "-names").val(data.key || "");
        line.data("keyRead", function () { return (key.val() || "").trim(); });
        var slot = $("<span class='subsplash-value-slot'></span>");
        function paint() {
            var spec = kind === "headers" ? findHeader(line.data("keyRead")()) : null;
            mountValue(slot, spec && spec.enum ? spec : null, readValue(slot) || data.value || "");
            data.value = "";
        }
        key.on("change", function () {
            mountValue(slot, kind === "headers" ? findHeader((key.val() || "").trim()) : null, "");
        });
        line.append(key).append(slot);
        paint();
        track(line, function () {
            fillDataList("#subsplash-" + kind + "-names", kind === "headers" ? headerSuggestions() : (form().queryKeys || []));
            var value = readValue(slot);
            var spec = kind === "headers" ? findHeader((key.val() || "").trim()) : null;
            mountValue(slot, spec && spec.enum ? spec : null, value);
        });
        fillDataList("#subsplash-" + kind + "-names", suggestions);
    }

    function addBodyRow(row, data) {
        var line = $("<div class='subsplash-inline subsplash-body-row'></div>").appendTo(row);
        var options = bodyFields().map(function (field) {
            return { value: field.name, label: field.required ? field.name + " *" : field.name };
        });
        var keys = keyControl(line, options, data.key || "");
        line.data("keyRead", function () { return keys.read(); });
        var slot = $("<span class='subsplash-value-slot'></span>");
        function paint(preserve) {
            var value = preserve ? readValue(slot) : (data.value || "");
            mountValue(slot, findBodyField(keys.read()), value);
            data.value = "";
        }
        line.append(slot);
        line.on("change", function (event) {
            var target = event && event.target;
            if (target && $(target).is(".subsplash-key, .subsplash-key-free, .subsplash-key-custom")) {
                paint(false);
            }
            writeBodyFromRows();
        });
        paint(false);
        track(line, function () {
            var value = readValue(slot);
            keys.refresh(bodyFields().map(function (field) {
                return { value: field.name, label: field.required ? field.name + " *" : field.name };
            }));
            mountValue(slot, findBodyField(keys.read()), value);
        });
    }

    function readInclude() {
        var values = [];
        $("#subsplash-include-chips .subsplash-chip.selected").each(function () {
            values.push($(this).text());
        });
        return values;
    }

    function renderInclude(selected) {
        var known = (form().include || []).slice();
        var box = $("#subsplash-include-chips").empty();
        var seen = {};
        known.forEach(function (value) { seen[value] = true; });
        var chosen = {};
        (selected || []).forEach(function (value) {
            chosen[value] = true;
            if (!seen[value]) {
                known.push(value);
            }
        });
        known.forEach(function (value) {
            var chip = $("<button type='button' class='red-ui-button subsplash-chip'></button>").text(value);
            if (chosen[value]) {
                chip.addClass("selected");
            }
            chip.on("click", function (event) {
                event.preventDefault();
                chip.toggleClass("selected");
            });
            box.append(chip);
        });
    }

    function parseBody(raw) {
        var text = raw === undefined || raw === null ? "" : String(raw);
        if (!text.trim()) {
            return { mode: "rows", rows: [] };
        }
        var value;
        try {
            value = JSON.parse(text);
        } catch (err) {
            return { mode: "json", rows: [] };
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return { mode: "json", rows: [] };
        }
        return { mode: "rows", rows: rowsFromObject(value) };
    }

    function rowsFromObject(obj) {
        return Object.keys(obj || {}).map(function (key) {
            var value = obj[key];
            if (value !== null && typeof value === "object") {
                value = JSON.stringify(value);
            } else if (value === null || value === undefined) {
                value = "";
            } else {
                value = String(value);
            }
            return { key: key, value: value };
        });
    }

    function setBody(text) {
        $("#node-input-body").typedInput("value", text);
    }

    $("#node-input-resourceId").typedInput({
        types: ["str", "msg", "flow", "global", "env"],
        typeField: "#node-input-resourceIdType"
    });
    $("#node-input-body").typedInput({
        types: [{
            value: "json",
            label: "JSON",
            icon: "red/images/typedInput/json.svg",
            validate: function (v) {
                return window.subsplashJsonOrEmpty(v);
            },
            expand: function () {
                var that = this;
                var value = this.value() || "";
                try {
                    value = JSON.stringify(JSON.parse(value), null, 4);
                } catch (err) {
                    // Open the editor with the current text when it is not JSON yet.
                }
                RED.editor.editJSON({
                    value: value,
                    complete: function (next) {
                        var compact = next;
                        try {
                            compact = JSON.stringify(JSON.parse(next));
                        } catch (err) {
                            compact = next;
                        }
                        that.value(compact);
                    }
                });
            }
        }]
    });

    $("<datalist id='subsplash-query-names'></datalist>").insertBefore("#subsplash-query-list");
    $("<datalist id='subsplash-headers-names'></datalist>").insertBefore("#subsplash-headers-list");

    setupList("#subsplash-filters-list", addFilterRow);
    setupList("#subsplash-sort-list", addSortRow);
    setupList("#subsplash-fields-list", addFieldRow);
    setupList("#subsplash-query-list", function (row, data) { addPairRow(row, data, "query"); });
    setupList("#subsplash-headers-list", function (row, data) { addPairRow(row, data, "headers"); });
    setupList("#subsplash-body-fields", addBodyRow);
    listActions("#subsplash-sort-list");
    listActions("#subsplash-body-fields");

    wireMode("filters", "#subsplash-filters-list", "#subsplash-filters-json", readFilterRows, api.parseFilters, api.serializeFilters);
    wireMode("fields", "#subsplash-fields-list", "#subsplash-fields-json", readFieldRows, api.parseFields, api.serializeFields);
    wireMode("query", "#subsplash-query-list", "#subsplash-query-json", function () {
        return readPairRows("#subsplash-query-list .subsplash-query-row");
    }, api.parsePairs, api.serializePairs);
    wireMode("headers", "#subsplash-headers-list", "#subsplash-headers-json", function () {
        return readPairRows("#subsplash-headers-list .subsplash-headers-row");
    }, api.parsePairs, api.serializePairs);
    wireMode("body", "#subsplash-body-fields", null, readBodyRows, parseBody, function () {
        return "";
    }, {
        keepText: true,
        read: function () {
            return $("#node-input-body").typedInput("value") || "";
        },
        write: function (text) {
            setBody(text);
        },
        hide: function (hidden) {
            $("#node-input-body").next(".red-ui-typedInput-container").toggle(!hidden);
        },
        beforeLoad: function () {
            bodyQuiet = true;
        },
        afterLoad: function () {
            bodyQuiet = false;
        }
    });

    $("#subsplash-include-add").on("click", function (event) {
        event.preventDefault();
        var value = ($("#subsplash-include-custom").val() || "").trim();
        if (!value) {
            return;
        }
        var selected = readInclude();
        if (selected.indexOf(value) === -1) {
            selected.push(value);
        }
        $("#subsplash-include-custom").val("");
        renderInclude(selected);
    });

    $("#subsplash-body-template").on("click", function (event) {
        event.preventDefault();
        var obj = api.bodyTemplate(bodyFields());
        bodyQuiet = true;
        loadList("#subsplash-body-fields", rowsFromObject(obj));
        bodyQuiet = false;
        setBody(JSON.stringify(obj, null, 2));
        modes.body.show("rows");
    });
    var clearButton = $("#subsplash-body-clear");
    var clearTimer = null;
    function armClear(armed) {
        if (clearTimer) {
            clearTimeout(clearTimer);
            clearTimer = null;
        }
        clearButton.data("armed", !!armed);
        if (armed) {
            clearButton.addClass("subsplash-danger");
            clearTimer = setTimeout(function () {
                armClear(false);
            }, 4000);
            return;
        }
        clearButton.removeClass("subsplash-danger");
    }
    function clearBody() {
        bodyQuiet = true;
        loadList("#subsplash-body-fields", []);
        bodyQuiet = false;
        setBody("");
        if (modes.body.holding()) {
            modes.body.show("rows");
        }
    }
    clearButton.on("click", function (event) {
        event.preventDefault();
        if (!clearButton.data("armed")) {
            armClear(true);
            return;
        }
        armClear(false);
        clearBody();
    });
    clearButton.on("blur", function () {
        setTimeout(function () {
            if (!clearButton.data("armed") || document.activeElement === clearButton[0]) {
                return;
            }
            armClear(false);
        }, 0);
    });
    $(document).off("mousedown.subsplashBodyClear").on("mousedown.subsplashBodyClear", function (event) {
        if (!clearButton.data("armed")) {
            return;
        }
        if (clearButton.is(event.target) || clearButton.has(event.target).length) {
            return;
        }
        armClear(false);
    });
    function loadSaved() {
        var filters = api.parseFilters($("#node-input-filters").val());
        if (filters.mode === "json") {
            $("#subsplash-filters-json").val(filters.text);
            modes.filters.show("json");
        } else {
            loadList("#subsplash-filters-list", filters.rows);
            modes.filters.show("rows");
        }
        renderInclude(api.parseInclude($("#node-input-include").val()));
        loadList("#subsplash-sort-list", api.parseSort($("#node-input-sort").val()));
        var fields = api.parseFields($("#node-input-fields").val());
        if (fields.mode === "json") {
            $("#subsplash-fields-json").val(fields.text);
            modes.fields.show("json");
        } else {
            loadList("#subsplash-fields-list", fields.rows);
            modes.fields.show("rows");
        }
        var query = api.parsePairs($("#node-input-query").val());
        if (query.mode === "json") {
            $("#subsplash-query-json").val(query.text);
            modes.query.show("json");
        } else {
            loadList("#subsplash-query-list", query.rows);
            modes.query.show("rows");
        }
        var headers = api.parsePairs($("#node-input-headers").val());
        if (headers.mode === "json") {
            $("#subsplash-headers-json").val(headers.text);
            modes.headers.show("json");
        } else {
            loadList("#subsplash-headers-list", headers.rows);
            modes.headers.show("rows");
        }
        var body = parseBody($("#node-input-body").typedInput("value"));
        if (body.mode === "rows") {
            bodyQuiet = true;
            loadList("#subsplash-body-fields", body.rows);
            bodyQuiet = false;
            modes.body.show("rows");
        } else {
            modes.body.show("json");
        }
        var savedQuery = ($("#node-input-query").val() || "").trim();
        var savedHeaders = ($("#node-input-headers").val() || "").trim();
        setExtras(savedQuery !== "" || savedHeaders !== "");
    }

    function applyPlaceholder() {
        var hint = form().idHint || (options.placeholder || "id");
        var input = $("#node-input-resourceId");
        input.attr("placeholder", hint);
        input.next(".red-ui-typedInput-container").find(".red-ui-typedInput-input").attr("placeholder", hint);
    }

    function refreshLists() {
        fillDataList("#subsplash-query-names", form().queryKeys || []);
        fillDataList("#subsplash-headers-names", headerSuggestions());
    }

    $("#subsplash-extras-toggle").on("click", function (event) {
        event.preventDefault();
        setExtras(!$("#subsplash-extras-panel").is(":visible"));
    });

    loadSaved();
    applyPlaceholder();
    refreshLists();

    return {
        setOperation: function (op) {
            state.op = op;
            applyPlaceholder();
            refreshLists();
            refreshers.forEach(function (fn) { fn(); });
            renderInclude(readInclude());
        },
        save: function () {
            $("#node-input-filters").val(modes.filters.save());
            $("#node-input-include").val(api.serializeInclude(readInclude()));
            $("#node-input-sort").val(api.serializeSort(readSortRows()));
            $("#node-input-fields").val(modes.fields.save());
            $("#node-input-query").val(modes.query.save());
            $("#node-input-headers").val(modes.headers.save());
        }
    };
}

window.subsplashPrepare = function (node) {
    var ops = (window.SUBSPLASH_EDITOR_CATALOG && window.SUBSPLASH_EDITOR_CATALOG[node.type]) || [];
    var select = $("#node-input-operation");
    var session = null;

    function currentOp() {
        var id = select.val() || node.operation;
        for (var i = 0; i < ops.length; i++) {
            if (ops[i].operationId === id) {
                return ops[i];
            }
        }
        return null;
    }

    function fill() {
        var current = select.val() || node.operation;
        select.empty();
        var groups = {};
        var order = [];
        ops.forEach(function (op) {
            var tag = (op.tags && op.tags[0]) || "Other";
            if (!groups[tag]) {
                groups[tag] = [];
                order.push(tag);
            }
            groups[tag].push(op);
        });
        order.sort(function (a, b) { return a.localeCompare(b); });
        order.forEach(function (tag) {
            var group = $("<optgroup>").attr("label", tag);
            groups[tag].forEach(function (op) {
                var text = op.label + "  —  " + op.method + " " + op.path;
                $("<option>").val(op.operationId).text(text).appendTo(group);
            });
            group.appendTo(select);
        });
        if (current) {
            select.val(current);
        }
    }

    function show(selector, on) {
        $(selector).toggle(!!on);
    }

    function describe() {
        var op = currentOp();
        if (session) {
            session.setOperation(op);
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

    fill();
    session = subsplashSetupEditor({ op: currentOp(), placeholder: "id" });
    window.__subsplashEditor = session;
    select.on("change", describe);
    describe();
};

window.subsplashPrepareRequest = function () {
    window.__subsplashEditor = subsplashSetupEditor({
        op: { form: subsplashEmptyForm(), bodyFields: [] },
        placeholder: "Used when the path contains {id}"
    });
};

window.subsplashSave = function () {
    if (window.__subsplashEditor) {
        window.__subsplashEditor.save();
    }
};
