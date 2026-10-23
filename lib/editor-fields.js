"use strict";

const OPERATORS = ["<=", ">=", "<", ">", "!"];

function parseJsonObject(raw) {
    if (raw === undefined || raw === null) {
        return { ok: true, value: null };
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
        return { ok: true, value: raw };
    }
    const text = String(raw).trim();
    if (!text) {
        return { ok: true, value: null };
    }
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return { ok: false, text: String(raw) };
        }
        return { ok: true, value };
    } catch (_err) {
        return { ok: false, text: String(raw) };
    }
}

function isScalar(value) {
    return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function splitOperator(value) {
    const text = value === null || value === undefined ? "" : String(value);
    for (const op of OPERATORS) {
        if (text.startsWith(op)) {
            return { op, value: text.slice(op.length) };
        }
    }
    return { op: "=", value: text };
}

function applyOperator(op, value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (!op || op === "=") {
        return text;
    }
    return op + text;
}

function jsonText(raw, value) {
    if (typeof raw === "string") {
        return raw;
    }
    return JSON.stringify(value);
}

function parseFilters(raw) {
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
        return { mode: "json", rows: [], text: parsed.text || "" };
    }
    if (!parsed.value) {
        return { mode: "rows", rows: [], text: "" };
    }
    const rows = [];
    for (const [key, value] of Object.entries(parsed.value)) {
        if (!isScalar(value)) {
            return { mode: "json", rows: [], text: jsonText(raw, parsed.value) };
        }
        const split = splitOperator(value);
        rows.push({ key, op: split.op, value: split.value });
    }
    return { mode: "rows", rows, text: "" };
}

function serializeFilters(rows) {
    const obj = {};
    for (const row of rows || []) {
        const key = String((row && row.key) || "").trim();
        if (!key) {
            continue;
        }
        const raw = row.value === undefined || row.value === null ? "" : String(row.value);
        if (raw.trim() === "") {
            continue;
        }
        obj[key] = applyOperator(row.op, raw);
    }
    return Object.keys(obj).length ? JSON.stringify(obj) : "";
}

function parseInclude(raw) {
    if (Array.isArray(raw)) {
        return raw.map((item) => String(item).trim()).filter(Boolean);
    }
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return [];
    }
    return String(raw).split(",").map((item) => item.trim()).filter(Boolean);
}

function serializeInclude(values) {
    const out = [];
    const seen = new Set();
    for (const value of values || []) {
        const text = String(value || "").trim();
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        out.push(text);
    }
    return out.join(",");
}

function parseSort(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === "") {
        return [];
    }
    const rows = [];
    for (const part of String(raw).split(",")) {
        const text = part.trim();
        if (!text) {
            continue;
        }
        if (text.startsWith("-")) {
            rows.push({ field: text.slice(1), desc: true });
        } else if (text.startsWith("+")) {
            rows.push({ field: text.slice(1), desc: false });
        } else {
            rows.push({ field: text, desc: false });
        }
    }
    return rows;
}

function serializeSort(rows) {
    const out = [];
    for (const row of rows || []) {
        let field = String((row && row.field) || "").trim();
        if (field.startsWith("-") || field.startsWith("+")) {
            field = field.slice(1);
        }
        if (!field) {
            continue;
        }
        out.push((row.desc ? "-" : "") + field);
    }
    return out.join(",");
}

function parseFields(raw) {
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
        return { mode: "json", rows: [], text: parsed.text || "" };
    }
    if (!parsed.value) {
        return { mode: "rows", rows: [], text: "" };
    }
    const rows = [];
    for (const [type, value] of Object.entries(parsed.value)) {
        if (!isScalar(value)) {
            return { mode: "json", rows: [], text: jsonText(raw, parsed.value) };
        }
        rows.push({ type, fields: value === null ? "" : String(value) });
    }
    return { mode: "rows", rows, text: "" };
}

function serializeFields(rows) {
    const obj = {};
    for (const row of rows || []) {
        const type = String((row && row.type) || "").trim();
        const fields = String((row && row.fields) || "").trim();
        if (!type || !fields) {
            continue;
        }
        const parts = fields.split(",").map((item) => item.trim()).filter(Boolean);
        if (obj[type]) {
            for (const part of obj[type].split(",")) {
                if (part && !parts.includes(part)) {
                    parts.unshift(part);
                }
            }
        }
        obj[type] = parts.filter((part, index) => parts.indexOf(part) === index).join(",");
    }
    return Object.keys(obj).length ? JSON.stringify(obj) : "";
}

function parsePairs(raw) {
    const parsed = parseJsonObject(raw);
    if (!parsed.ok) {
        return { mode: "json", rows: [], text: parsed.text || "" };
    }
    if (!parsed.value) {
        return { mode: "rows", rows: [], text: "" };
    }
    const rows = [];
    for (const [key, value] of Object.entries(parsed.value)) {
        if (!isScalar(value)) {
            return { mode: "json", rows: [], text: jsonText(raw, parsed.value) };
        }
        rows.push({ key, value: value === null ? "null" : String(value) });
    }
    return { mode: "rows", rows, text: "" };
}

function serializePairs(rows) {
    const obj = {};
    for (const row of rows || []) {
        const key = String((row && row.key) || "").trim();
        if (!key) {
            continue;
        }
        obj[key] = row.value === undefined || row.value === null ? "" : String(row.value);
    }
    return Object.keys(obj).length ? JSON.stringify(obj) : "";
}

function emptyBodyValue(field) {
    if (!field) {
        return "";
    }
    if (field.type === "boolean") {
        return false;
    }
    if (field.type === "integer" || field.type === "number") {
        return null;
    }
    if (field.type === "array") {
        return [];
    }
    if (field.type === "object") {
        return {};
    }
    return "";
}

function bodyTemplate(fields) {
    const list = Array.isArray(fields) ? fields : [];
    const writable = list.filter((field) => field && field.name && !field.readOnly);
    const ordered = writable.filter((field) => field.required).concat(writable.filter((field) => !field.required));
    const obj = {};
    for (const field of ordered) {
        obj[field.name] = emptyBodyValue(field);
    }
    return obj;
}

module.exports = {
    parseFilters,
    serializeFilters,
    parseInclude,
    serializeInclude,
    parseSort,
    serializeSort,
    parseFields,
    serializeFields,
    parsePairs,
    serializePairs,
    bodyTemplate,
    splitOperator,
    applyOperator
};
