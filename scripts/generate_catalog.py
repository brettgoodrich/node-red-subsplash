#!/usr/bin/env python3
"""Build lib/catalog.json, nodes/subsplash.html, and the README coverage sections.

Reads the Subsplash OpenAPI document. Default path: /tmp/subsplash/openapi.yaml.
Override with SUBSPLASH_OPENAPI or the first argument.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write("PyYAML is required to regenerate the catalog.\n")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SUBSPLASH_OPENAPI", "/tmp/subsplash/openapi.yaml"))

DOMAINS = [
    {
        "id": "builder",
        "type": "subsplash-builder",
        "palette": "builder",
        "blurb": "Reads and writes Builder lists and the rows inside those lists.",
        "tags": {"List", "ListRow"},
    },
    {
        "id": "donations",
        "type": "subsplash-donations",
        "palette": "donations",
        "blurb": "Reads giving data and manages funds: campaigns, donations, pledges, recurring donations, and terminals.",
        "tags": {"Campaign", "CampaignContributions", "Donation", "DonationTerminal", "Fund", "Pledge", "RecurringDonation"},
    },
    {
        "id": "events",
        "type": "subsplash-events",
        "palette": "events",
        "blurb": "Reads and writes calendars, events, and repeating events.",
        "tags": {"Calendar", "Event", "RepeatingEvent"},
    },
    {
        "id": "forms",
        "type": "subsplash-forms",
        "palette": "forms",
        "blurb": "Reads forms and the responses people submit.",
        "tags": {"Form", "Response"},
    },
    {
        "id": "groups",
        "type": "subsplash-groups",
        "palette": "groups",
        "blurb": "Reads and writes groups, group types, and group members.",
        "tags": {"Group", "GroupMember", "GroupType"},
    },
    {
        "id": "live",
        "type": "subsplash-live",
        "palette": "live",
        "blurb": "Reads live-stream broadcasts.",
        "tags": {"Broadcast"},
    },
    {
        "id": "media",
        "type": "subsplash-media",
        "palette": "media",
        "blurb": "Reads and writes media items and media series.",
        "tags": {"MediaItem", "MediaSeries"},
    },
    {
        "id": "pages",
        "type": "subsplash-pages",
        "palette": "pages",
        "blurb": "Reads and writes short links used by Subsplash pages.",
        "tags": {"Link"},
    },
    {
        "id": "payments",
        "type": "subsplash-payments",
        "palette": "payments",
        "blurb": "Reads payments, instruments, and refunds, and creates payment intents, captures, and setup intents.",
        "tags": {"Instrument", "Payment", "PaymentIntent", "Refund", "SetupIntent"},
    },
    {
        "id": "people",
        "type": "subsplash-people",
        "palette": "people",
        "blurb": "Reads and writes profiles, households, custom fields, and membership status changes.",
        "tags": {"CustomFieldDefinition", "Household", "MembershipStatusChange", "Profile"},
    },
    {
        "id": "push",
        "type": "subsplash-push",
        "palette": "push",
        "blurb": "Reads and writes push topics and notifications, and lists or bulk-creates topic subscriptions.",
        "tags": {"Notification", "Topic", "TopicSubscription"},
    },
    {
        "id": "tokens",
        "type": "subsplash-tokens",
        "palette": "tokens",
        "blurb": "Reads public signing keys and requests tokens with the client-credentials grant.",
        "tags": {"SigningKey", "Token"},
    },
    {
        "id": "webhooks",
        "type": "subsplash-webhooks",
        "palette": "webhooks",
        "blurb": "Reads and writes webhook subscriptions, rotates the signing secret, and lists delivery attempts.",
        "tags": {"SendAttempt", "Webhook"},
    },
]

TAG_DOMAIN = {}
for domain in DOMAINS:
    for tag in domain["tags"]:
        TAG_DOMAIN[tag] = domain["id"]

METHOD_ORDER = {"get": 0, "post": 1, "patch": 2, "put": 3, "delete": 4, "options": 5, "head": 6}


def clean(text, limit):
    if not text:
        return ""
    text = re.sub(r"\s+", " ", str(text)).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def resolve_ref(spec, ref):
    cur = spec
    for part in ref.lstrip("#/").split("/"):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def resolve_param(spec, param):
    seen = set()
    current = param
    while isinstance(current, dict) and "$ref" in current and current["$ref"] not in seen:
        seen.add(current["$ref"])
        current = resolve_ref(spec, current["$ref"])
    return current or {}


def merge_schema(spec, schema, depth=0):
    if depth > 10 or not isinstance(schema, dict):
        return {"properties": {}, "required": [], "name": None}
    if "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        target = resolve_ref(spec, schema["$ref"]) or {}
        merged = merge_schema(spec, target, depth + 1)
        merged["name"] = merged.get("name") or name
        return merged
    properties = {}
    required = []
    name = None
    for part in schema.get("allOf") or []:
        merged = merge_schema(spec, part, depth + 1)
        properties.update(merged.get("properties") or {})
        required.extend(merged.get("required") or [])
        name = name or merged.get("name")
    own = schema.get("properties") or {}
    properties.update(own)
    required.extend(schema.get("required") or [])
    deduped = list(dict.fromkeys(required))
    return {"properties": properties, "required": deduped, "name": name}


def schema_type(schema):
    if not isinstance(schema, dict):
        return ""
    if "enum" in schema and schema["enum"]:
        return "enum"
    if schema.get("type"):
        return schema["type"]
    if "$ref" in schema:
        return schema["$ref"].split("/")[-1]
    if "allOf" in schema:
        return "object"
    return ""


def enum_values(schema):
    if not isinstance(schema, dict):
        return None
    values = schema.get("enum")
    if not isinstance(values, list) or not values or len(values) > 12:
        return None
    if not all(isinstance(item, (str, int, float, bool)) for item in values):
        return None
    return [str(item) for item in values]


def body_info(spec, operation):
    body = operation.get("requestBody")
    if not body:
        return {
            "body": False,
            "bodyRequired": False,
            "contentType": None,
            "bodySchema": None,
            "bodyFields": [],
        }
    content = body.get("content") or {}
    content_type = next(iter(content), None)
    schema = {}
    if content_type:
        schema = (content[content_type] or {}).get("schema") or {}
    merged = merge_schema(spec, schema)
    fields = []
    required = set(merged.get("required") or [])
    for name, prop in list((merged.get("properties") or {}).items())[:40]:
        if name.startswith("x-"):
            continue
        prop = prop if isinstance(prop, dict) else {}
        fields.append({
            "name": name,
            "type": schema_type(prop) or "value",
            "required": name in required,
            "description": clean(prop.get("description"), 140),
        })
    return {
        "body": True,
        "bodyRequired": bool(body.get("required")),
        "contentType": content_type,
        "bodySchema": merged.get("name"),
        "bodyFields": fields,
    }


def is_collection(method, operation):
    if str(method).upper() != "GET":
        return False
    operation_id = operation.get("operationId") or ""
    summary = (operation.get("summary") or "").lower()
    return operation_id.startswith("List") or operation_id.startswith("GetAll") or summary.startswith("list")


def collect_parameters(spec, path_item, operation):
    """Path-item parameters apply to every method. Operation parameters override the same name and location."""
    ordered = {}
    for source in ((path_item or {}).get("parameters") or [], (operation or {}).get("parameters") or []):
        for item in source:
            param = resolve_param(spec, item)
            if not isinstance(param, dict):
                continue
            ordered[(param.get("in"), param.get("name"))] = param
    return list(ordered.values())


def operation_record(spec, path, method, operation, path_item):
    params = collect_parameters(spec, path_item, operation)
    path_params = []
    query = []
    headers = []
    has_page_object = False
    has_page_number = False
    has_page_size = False
    for param in params:
        name = param.get("name")
        location = param.get("in")
        schema = param.get("schema") or {}
        if location == "path":
            path_params.append(name)
            continue
        if location == "header":
            headers.append({
                "name": name,
                "description": clean(param.get("description"), 180),
                "enum": enum_values(schema),
            })
            continue
        if location != "query":
            continue
        if not name:
            continue
        if name == "page":
            has_page_object = True
            continue
        if name == "page[number]":
            has_page_number = True
            continue
        if name == "page[size]":
            has_page_size = True
            continue
        if name == "fields":
            continue
        query.append({
            "name": name,
            "required": bool(param.get("required")),
            "description": clean(param.get("description"), 180),
            "enum": enum_values(schema),
        })
    for name in re.findall(r"\{([^{}]+)\}", path):
        if name not in path_params:
            path_params.append(name)
    page_number = has_page_object or has_page_number
    page_size = has_page_object or has_page_size
    collection = is_collection(method, operation)
    page_undocumented = False
    if collection and not page_number and not page_size:
        page_number = True
        page_size = True
        page_undocumented = True
    info = body_info(spec, operation)
    if "security" in operation:
        auth = bool(operation.get("security"))
    else:
        auth = True
    tags = operation.get("tags") or []
    matched = [TAG_DOMAIN[tag] for tag in tags if tag in TAG_DOMAIN]
    if len(set(matched)) != 1:
        raise SystemExit(f"Operation {operation.get('operationId')} tags {tags} did not map to one domain")
    summary = operation.get("summary") or operation.get("operationId")
    return matched[0], {
        "operationId": operation.get("operationId"),
        "label": summary,
        "summary": summary,
        "description": clean(operation.get("description") or summary, 320),
        "method": method.upper(),
        "path": path,
        "auth": auth,
        "collection": collection,
        "pageNumber": page_number,
        "pageSize": page_size,
        "pageUndocumented": page_undocumented,
        "syntheticPages": bool(page_number),
        "pathParams": path_params,
        "query": query,
        "headers": headers,
        "tags": tags,
        **info,
    }


def load_operations(spec):
    grouped = {domain["id"]: [] for domain in DOMAINS}
    count = 0
    for path, item in spec.get("paths", {}).items():
        methods = []
        for method, operation in item.items():
            if method.startswith("x-") or method in ("parameters", "summary", "description", "servers"):
                continue
            if not isinstance(operation, dict):
                continue
            methods.append((method, operation))
        methods.sort(key=lambda pair: METHOD_ORDER.get(pair[0], 9))
        for method, operation in methods:
            domain_id, record = operation_record(spec, path, method, operation, item)
            grouped[domain_id].append(record)
            count += 1
    return grouped, count


def editor_catalog(nodes):
    catalog = {}
    for node in nodes:
        catalog[node["type"]] = [
            {
                "operationId": op["operationId"],
                "label": op["label"],
                "summary": op["summary"],
                "method": op["method"],
                "path": op["path"],
                "pathParams": op["pathParams"],
                "body": op["body"],
                "bodyRequired": op["bodyRequired"],
                "contentType": op["contentType"],
                "collection": op["collection"],
                "pageUndocumented": op["pageUndocumented"],
                "requiredQuery": [param["name"] for param in op["query"] if param["required"]],
            }
            for op in node["operations"]
        ]
    return catalog


def esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def shared_inputs():
    return """
<h3>Inputs</h3>
    <dl class="message-properties">
        <dt class="optional">operation <span class="property-type">string</span></dt>
        <dd>Overrides the operation selected in the editor. Use the operation id shown below, for example <code>GetAllMediaItems</code>.</dd>
        <dt class="optional">resourceId <span class="property-type">string</span></dt>
        <dd>Resource id for operations whose path contains <code>{id}</code>. Replaces the resource ID typed in the editor.</dd>
        <dt class="optional">body <span class="property-type">object | string</span></dt>
        <dd>Request body. When this is omitted, <code>msg.payload</code> is sent for operations that take a body.</dd>
        <dt class="optional">payload <span class="property-type">object | string</span></dt>
        <dd>Used as the request body only when <code>msg.body</code> is not set and the editor body is empty.</dd>
        <dt class="optional">filters <span class="property-type">object</span></dt>
        <dd>Merged over the editor filters. A key <code>status</code> is sent as <code>filter[status]</code>. Prefix a value with <code>!</code>, <code>&lt;</code>, <code>&gt;</code>, <code>&lt;=</code>, or <code>&gt;=</code> for a comparison. Commas mean any of those values. Use <code>*</code> as a wildcard where the field allows it.</dd>
        <dt class="optional">query <span class="property-type">object</span></dt>
        <dd>Extra query parameters, using the API's parameter names. Merged over the editor query. Keys set here win over the same key in filters when the names match exactly.</dd>
        <dt class="optional">include <span class="property-type">string | array</span></dt>
        <dd>Related resources to embed, comma-separated or as an array. Replaces the editor include.</dd>
        <dt class="optional">sort <span class="property-type">string</span></dt>
        <dd>Sort list such as <code>-created_at,title</code>. Prefix a field with <code>-</code> for descending.</dd>
        <dt class="optional">fields <span class="property-type">object</span></dt>
        <dd>Sparse fieldsets. <code>{"responses":"count"}</code> is sent as <code>fields[responses]=count</code>.</dd>
        <dt class="optional">headers <span class="property-type">object</span></dt>
        <dd>Extra request headers. Authorization is set by the config node and is not taken from here.</dd>
        <dt class="optional">pageNumber <span class="property-type">number</span></dt>
        <dd>1-based page. Sent as <code>page[number]</code>.</dd>
        <dt class="optional">pageSize <span class="property-type">number</span></dt>
        <dd>Page size. Sent as <code>page[size]</code>. The platform maximum is usually 100.</dd>
        <dt class="optional">pagination <span class="property-type">string</span></dt>
        <dd><code>page</code> returns one page. <code>all</code> follows <code>_links.next</code> and, when page numbers apply, requests further pages. The config node's max pages caps the walk.</dd>
        <dt class="optional">maxPages <span class="property-type">number</span></dt>
        <dd>Overrides the config node's page cap for this message. Cannot exceed 500.</dd>
        <dt class="optional">collectionTotal <span class="property-type">string</span></dt>
        <dd><code>include</code> or <code>omit</code>. Sent as the <code>Collection-Total</code> header when set.</dd>
        <dt class="optional">collectionStats <span class="property-type">string</span></dt>
        <dd>Sent as the <code>Collection-Stats</code> header when set. Used by donation lists.</dd>
        <dt class="optional">accept <span class="property-type">string</span></dt>
        <dd>Overrides the Accept header. Some donation, payment, and form lists can return <code>text/csv</code>.</dd>
        <dt class="optional">output <span class="property-type">string</span></dt>
        <dd><code>response</code> keeps the API body. <code>items</code> replaces <code>msg.payload</code> with the single embedded array when there is one.</dd>
        <dt class="optional">pathParams <span class="property-type">object</span></dt>
        <dd>Named path parameters. <code>resourceId</code> fills <code>id</code> when that is the only placeholder.</dd>
    </dl>
<h3>Outputs</h3>
    <dl class="message-properties">
        <dt>payload <span class="property-type">object | array | string</span></dt>
        <dd>The response body, or the embedded items when output is <code>items</code>. On an API error this is the error body.</dd>
        <dt>statusCode <span class="property-type">number</span></dt>
        <dd>HTTP status of the last response.</dd>
        <dt>headers <span class="property-type">object</span></dt>
        <dd>Response headers. Names are lower case, as Node reports them.</dd>
        <dt>subsplash <span class="property-type">object</span></dt>
        <dd>Call metadata: <code>operation</code>, <code>method</code>, <code>path</code>, <code>url</code>, <code>pagesFetched</code>, <code>count</code>, <code>total</code>, <code>truncated</code>, and <code>collection</code>. Failures also set <code>subsplash.error</code> with <code>message</code>, <code>statusCode</code>, and <code>code</code>.</dd>
    </dl>
"""


def render_operation_help(op):
    bits = [f"<h4>{esc(op['operationId'])}</h4>"]
    sentence = f"<code>{esc(op['method'])} {esc(op['path'])}</code>"
    if op.get("summary"):
        sentence += ". " + esc(op["summary"])
    if op["auth"]:
        sentence += ". Requires a bearer token."
    else:
        sentence += ". Does not send a bearer token."
    if op["collection"]:
        if op["pageUndocumented"]:
            sentence += " Collection. The OpenAPI operation does not declare page parameters; fetch-all still follows <code>_links.next</code>."
        else:
            sentence += " Paginated collection."
    if op["body"]:
        required = "required" if op["bodyRequired"] else "optional"
        sentence += f" {esc(required).capitalize()} body (<code>{esc(op['contentType'] or 'application/json')}</code>)."
    bits.append(f"<p>{sentence}</p>")
    if op["description"] and op["description"] != op["summary"]:
        bits.append(f"<p>{esc(op['description'])}</p>")
    required_fields = [field for field in op["bodyFields"] if field["required"] and not field["name"].startswith("_")]
    if required_fields:
        rendered = ", ".join(f"<code>{esc(field['name'])}</code>" for field in required_fields[:20])
        bits.append(f"<p>Required body fields: {rendered}.</p>")
    elif op["body"] and op["bodyFields"]:
        names = [field["name"] for field in op["bodyFields"] if not field["name"].startswith("_")][:12]
        if names:
            rendered = ", ".join(f"<code>{esc(name)}</code>" for name in names)
            bits.append(f"<p>Body fields include {rendered}.</p>")
    if op["query"]:
        items = []
        for param in op["query"]:
            text = f"<code>{esc(param['name'])}</code>"
            if param["required"]:
                text += " (required)"
            if param.get("enum"):
                text += " (" + ", ".join(esc(value) for value in param["enum"]) + ")"
            elif param.get("description"):
                text += " — " + esc(param["description"])
            items.append(f"<li>{text}</li>")
        bits.append("<ul>" + "".join(items) + "</ul>")
    if op["headers"]:
        items = []
        for param in op["headers"]:
            text = f"<code>{esc(param['name'])}</code>"
            if param.get("enum"):
                text += " (" + ", ".join(esc(value) for value in param["enum"]) + ")"
            elif param.get("description"):
                text += " — " + esc(param["description"])
            items.append(f"<li>{text}</li>")
        bits.append("<p>Headers:</p><ul>" + "".join(items) + "</ul>")
    return "\n".join(bits)


def render_help(node):
    operations = "\n".join(render_operation_help(op) for op in node["operations"])
    return f"""<script type="text/html" data-help-name="{esc(node['type'])}">
<p>{esc(node['blurb'])}</p>
{shared_inputs()}
<h3>Details</h3>
    <p>Choose an operation in the node, or set <code>msg.operation</code> to one of the ids below. Values typed in the editor are defaults. A property on the message replaces the same editor field. Filters, query, and headers are merged, and the message value wins for a key that appears in both.</p>
    <p>List calls can return one page or walk every page. Fetch-all follows the HAL <code>_links.next</code> link when Subsplash sends one. When the operation uses page numbers and there is no next link, further pages are requested until the page is short, <code>total</code> is reached, a page repeats, or the page cap is hit. A merged collection reports <code>count</code> as the number of combined resources. <code>subsplash.truncated</code> is true when the cap stopped the walk early.</p>
    <p>Set <code>output</code> to <code>items</code> when the next node wants the embedded array instead of the collection envelope. Other message properties are left in place.</p>
    <p>API failures call <code>done(err)</code>. Node-RED then reports the error with the message attached, so a Catch node receives <code>msg.statusCode</code>, the error body on <code>msg.payload</code>, and <code>msg.subsplash.error.code</code> (for example <code>resource_not_found</code> or <code>too_many_requests</code>).</p>
    <p>When "Apply default app and org keys" is checked, a documented <code>filter[app_key]</code> or <code>filter[org_key]</code> is filled from the config node if the message did not set it. Filters the operation does not document are not added.</p>
<h4>Operations</h4>
{operations}
<h3>References</h3>
    <ul>
        <li><a href="https://developer.subsplash.com/api/openapi.yaml">Subsplash OpenAPI specification</a> — source for these operations</li>
        <li><a href="https://developer.subsplash.com/">Subsplash developer site</a> — documentation access is separate from API credentials</li>
    </ul>
</script>
"""


DIALOG = """
    <div class="form-row">
        <label for="node-input-name"><i class="fa fa-tag"></i> Name</label>
        <input type="text" id="node-input-name" placeholder="Name">
    </div>
    <div class="form-row">
        <label for="node-input-subsplash"><i class="fa fa-server"></i> Account</label>
        <input type="text" id="node-input-subsplash">
    </div>
    <div class="form-row">
        <label for="subsplash-op-filter"><i class="fa fa-search"></i> Find</label>
        <input type="text" id="subsplash-op-filter" placeholder="Filter the operation list">
    </div>
    <div class="form-row">
        <label for="node-input-operation"><i class="fa fa-tasks"></i> Operation</label>
        <select id="node-input-operation" style="width:70%;"></select>
    </div>
    <div class="form-row">
        <div id="subsplash-op-summary" class="form-tips"></div>
    </div>
    <div class="form-row subsplash-id">
        <label for="node-input-resourceId"><i class="fa fa-hashtag"></i> Resource ID</label>
        <input type="text" id="node-input-resourceId" placeholder="msg.resourceId">
    </div>
    <div class="form-row subsplash-body">
        <label for="node-input-body"><i class="fa fa-file-code-o"></i> Body</label>
        <input type="text" id="node-input-body" placeholder='{"title":"..."}'>
        <div class="form-tips">JSON object, or form fields for the token call. Leave empty to use msg.body or msg.payload.</div>
    </div>
    <div class="form-row">
        <label for="node-input-filters"><i class="fa fa-filter"></i> Filters</label>
        <input type="text" id="node-input-filters" placeholder='{"status":"published"}'>
    </div>
    <div class="form-row">
        <label for="node-input-include"><i class="fa fa-link"></i> Include</label>
        <input type="text" id="node-input-include" placeholder="images,audio">
    </div>
    <div class="form-row">
        <label for="node-input-sort"><i class="fa fa-sort"></i> Sort</label>
        <input type="text" id="node-input-sort" placeholder="-published_at">
    </div>
    <div class="form-row">
        <label for="node-input-fields"><i class="fa fa-list"></i> Fields</label>
        <input type="text" id="node-input-fields" placeholder='{"responses":"count"}'>
    </div>
    <div class="form-row">
        <label for="node-input-query"><i class="fa fa-question"></i> Query</label>
        <input type="text" id="node-input-query" placeholder='{"filter[short_code]":"ABC"}'>
    </div>
    <div class="form-row">
        <label for="node-input-headers"><i class="fa fa-header"></i> Headers</label>
        <input type="text" id="node-input-headers" placeholder="{}">
    </div>
    <div class="form-row subsplash-page">
        <label for="node-input-pagination"><i class="fa fa-files-o"></i> Pages</label>
        <select id="node-input-pagination" style="width:70%;">
            <option value="page">Single page</option>
            <option value="all">Fetch all pages</option>
        </select>
    </div>
    <div class="form-row subsplash-page">
        <label for="node-input-pageNumber"><i class="fa fa-arrow-right"></i> Page number</label>
        <input type="text" id="node-input-pageNumber" placeholder="1">
    </div>
    <div class="form-row subsplash-page">
        <label for="node-input-pageSize"><i class="fa fa-arrows-v"></i> Page size</label>
        <input type="text" id="node-input-pageSize" placeholder="25">
    </div>
    <div class="form-row">
        <label for="node-input-collectionTotal"><i class="fa fa-calculator"></i> Total</label>
        <select id="node-input-collectionTotal" style="width:70%;">
            <option value="">Default</option>
            <option value="include">Include collection total</option>
            <option value="omit">Omit collection total</option>
        </select>
    </div>
    <div class="form-row">
        <label for="node-input-accept"><i class="fa fa-file-text-o"></i> Accept</label>
        <input type="text" id="node-input-accept" placeholder="application/hal+json or text/csv">
    </div>
    <div class="form-row">
        <label for="node-input-output"><i class="fa fa-sign-out"></i> Output</label>
        <select id="node-input-output" style="width:70%;">
            <option value="response">Full response</option>
            <option value="items">Embedded items</option>
        </select>
    </div>
    <div class="form-row">
        <label for="node-input-applyDefaultKeys"><i class="fa fa-magic"></i> Default keys</label>
        <input type="checkbox" id="node-input-applyDefaultKeys" style="width:auto; margin-top:7px;">
        <div class="form-tips">Fill documented filter[app_key] and filter[org_key] from the config node when the message does not set them.</div>
    </div>
"""


def render_resource_js(node):
    default_op = node["operations"][0]["operationId"]
    return f"""<script type="text/javascript">
    RED.nodes.registerType("{node['type']}", {{
        category: "Subsplash",
        color: "#D5E4F2",
        defaults: {{
            name: {{ value: "" }},
            subsplash: {{ value: "", type: "subsplash-config", required: true }},
            operation: {{ value: "{default_op}", required: true }},
            resourceId: {{ value: "" }},
            body: {{ value: "", validate: window.subsplashJsonOrEmpty }},
            filters: {{ value: "", validate: window.subsplashJsonOrEmpty }},
            include: {{ value: "" }},
            sort: {{ value: "" }},
            fields: {{ value: "", validate: window.subsplashJsonOrEmpty }},
            query: {{ value: "", validate: window.subsplashJsonOrEmpty }},
            headers: {{ value: "", validate: window.subsplashJsonOrEmpty }},
            pageNumber: {{ value: "" }},
            pageSize: {{ value: "" }},
            pagination: {{ value: "page" }},
            collectionTotal: {{ value: "" }},
            collectionStats: {{ value: "" }},
            accept: {{ value: "" }},
            output: {{ value: "response" }},
            applyDefaultKeys: {{ value: true }}
        }},
        inputs: 1,
        outputs: 1,
        icon: "subsplash.svg",
        paletteLabel: "{node['palette']}",
        label: function () {{
            return window.subsplashLabel(this);
        }},
        oneditprepare: function () {{
            window.subsplashPrepare(this);
        }}
    }});
</script>
<script type="text/html" data-template-name="{node['type']}">
{DIALOG}
</script>
{render_help(node)}
"""


REQUEST_NODE = r"""<script type="text/javascript">
    RED.nodes.registerType("subsplash-request", {
        category: "Subsplash",
        color: "#F6E3B8",
        defaults: {
            name: { value: "" },
            subsplash: { value: "", type: "subsplash-config", required: true },
            method: { value: "GET", required: true },
            path: {
                value: "",
                validate: function (v) {
                    if (!v) {
                        return true;
                    }
                    return typeof v === "string" && v.charAt(0) === "/" && v.indexOf("://") === -1 && v.indexOf("\\") === -1;
                }
            },
            resourceId: { value: "" },
            authenticate: { value: true },
            body: { value: "", validate: window.subsplashJsonOrEmpty },
            contentType: { value: "" },
            filters: { value: "", validate: window.subsplashJsonOrEmpty },
            include: { value: "" },
            sort: { value: "" },
            fields: { value: "", validate: window.subsplashJsonOrEmpty },
            query: { value: "", validate: window.subsplashJsonOrEmpty },
            headers: { value: "", validate: window.subsplashJsonOrEmpty },
            pageNumber: { value: "" },
            pageSize: { value: "" },
            pagination: { value: "page" },
            collectionTotal: { value: "" },
            accept: { value: "" },
            output: { value: "response" }
        },
        inputs: 1,
        outputs: 1,
        icon: "subsplash.svg",
        paletteLabel: "request",
        label: function () {
            return this.name || (this.method ? this.method + " " + (this.path || "request") : "request");
        }
    });
</script>
<script type="text/html" data-template-name="subsplash-request">
    <div class="form-row">
        <label for="node-input-name"><i class="fa fa-tag"></i> Name</label>
        <input type="text" id="node-input-name" placeholder="Name">
    </div>
    <div class="form-row">
        <label for="node-input-subsplash"><i class="fa fa-server"></i> Account</label>
        <input type="text" id="node-input-subsplash">
    </div>
    <div class="form-row">
        <label for="node-input-method"><i class="fa fa-exchange"></i> Method</label>
        <select id="node-input-method" style="width:70%;">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
            <option value="HEAD">HEAD</option>
            <option value="OPTIONS">OPTIONS</option>
        </select>
    </div>
    <div class="form-row">
        <label for="node-input-path"><i class="fa fa-road"></i> Path</label>
        <input type="text" id="node-input-path" placeholder="/media/v1/media-items">
        <div class="form-tips">Path on the configured base URL. <code>{id}</code> is filled from the resource ID. A full URL is accepted only when its host matches the base URL.</div>
    </div>
    <div class="form-row">
        <label for="node-input-resourceId"><i class="fa fa-hashtag"></i> Resource ID</label>
        <input type="text" id="node-input-resourceId" placeholder="Used when the path contains {id}">
    </div>
    <div class="form-row">
        <label for="node-input-authenticate"><i class="fa fa-lock"></i> Bearer token</label>
        <input type="checkbox" id="node-input-authenticate" style="width:auto; margin-top:7px;">
    </div>
    <div class="form-row">
        <label for="node-input-contentType"><i class="fa fa-file-code-o"></i> Content type</label>
        <input type="text" id="node-input-contentType" placeholder="application/json">
    </div>
    <div class="form-row">
        <label for="node-input-body"><i class="fa fa-file-code-o"></i> Body</label>
        <input type="text" id="node-input-body" placeholder="{}">
    </div>
    <div class="form-row">
        <label for="node-input-query"><i class="fa fa-question"></i> Query</label>
        <input type="text" id="node-input-query" placeholder="{}">
    </div>
    <div class="form-row">
        <label for="node-input-filters"><i class="fa fa-filter"></i> Filters</label>
        <input type="text" id="node-input-filters" placeholder='{"status":"published"}'>
    </div>
    <div class="form-row">
        <label for="node-input-include"><i class="fa fa-link"></i> Include</label>
        <input type="text" id="node-input-include">
    </div>
    <div class="form-row">
        <label for="node-input-sort"><i class="fa fa-sort"></i> Sort</label>
        <input type="text" id="node-input-sort">
    </div>
    <div class="form-row">
        <label for="node-input-fields"><i class="fa fa-list"></i> Fields</label>
        <input type="text" id="node-input-fields">
    </div>
    <div class="form-row">
        <label for="node-input-headers"><i class="fa fa-header"></i> Headers</label>
        <input type="text" id="node-input-headers">
    </div>
    <div class="form-row">
        <label for="node-input-pagination"><i class="fa fa-files-o"></i> Pages</label>
        <select id="node-input-pagination" style="width:70%;">
            <option value="page">Single page</option>
            <option value="all">Fetch all pages</option>
        </select>
    </div>
    <div class="form-row">
        <label for="node-input-pageNumber">Page number</label>
        <input type="text" id="node-input-pageNumber">
    </div>
    <div class="form-row">
        <label for="node-input-pageSize">Page size</label>
        <input type="text" id="node-input-pageSize">
    </div>
    <div class="form-row">
        <label for="node-input-collectionTotal">Total</label>
        <select id="node-input-collectionTotal" style="width:70%;">
            <option value="">Default</option>
            <option value="include">Include collection total</option>
            <option value="omit">Omit collection total</option>
        </select>
    </div>
    <div class="form-row">
        <label for="node-input-accept">Accept</label>
        <input type="text" id="node-input-accept">
    </div>
    <div class="form-row">
        <label for="node-input-output"><i class="fa fa-sign-out"></i> Output</label>
        <select id="node-input-output" style="width:70%;">
            <option value="response">Full response</option>
            <option value="items">Embedded items</option>
        </select>
    </div>
</script>
<script type="text/html" data-help-name="subsplash-request">
    <p>Calls any path on the configured Subsplash base URL, including endpoints that are not wrapped by a resource node.</p>
    <h3>Inputs</h3>
    <dl class="message-properties">
        <dt class="optional">method <span class="property-type">string</span></dt>
        <dd>HTTP method. One of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.</dd>
        <dt class="optional">path <span class="property-type">string</span></dt>
        <dd>Path beginning with <code>/</code>, or a full URL whose origin matches the config base URL. <code>{id}</code> is replaced from <code>msg.resourceId</code>.</dd>
        <dt class="optional">url <span class="property-type">string</span></dt>
        <dd>Used as the path when <code>msg.path</code> and the editor path are empty. Same origin rules apply.</dd>
        <dt class="optional">authenticate <span class="property-type">boolean</span></dt>
        <dd>When false, the bearer token is omitted. Public signing keys are the usual reason.</dd>
        <dt class="optional">contentType <span class="property-type">string</span></dt>
        <dd>Content-Type for the body. Defaults to <code>application/json</code> when a body is present. Use <code>application/x-www-form-urlencoded</code> to send an object as a form.</dd>
        <dt class="optional">body <span class="property-type">object | string</span></dt>
        <dd>Request body. For GET, HEAD, DELETE, and OPTIONS the editor body is used only when set; otherwise <code>msg.payload</code> is not sent unless <code>msg.body</code> is set.</dd>
        <dt class="optional">payload <span class="property-type">object | string</span></dt>
        <dd>Body for POST, PUT, and PATCH when <code>msg.body</code> and the editor body are empty.</dd>
        <dt class="optional">query <span class="property-type">object</span></dt>
        <dd>Query parameters merged over the editor query.</dd>
        <dt class="optional">filters <span class="property-type">object</span></dt>
        <dd>Same filter object the resource nodes accept.</dd>
        <dt class="optional">include <span class="property-type">string | array</span></dt>
        <dd>Include list.</dd>
        <dt class="optional">sort <span class="property-type">string</span></dt>
        <dd>Sort list.</dd>
        <dt class="optional">fields <span class="property-type">object</span></dt>
        <dd>Sparse fieldsets.</dd>
        <dt class="optional">headers <span class="property-type">object</span></dt>
        <dd>Extra headers. A bearer token replaces any Authorization header when authenticate is true, and strips it when authenticate is false.</dd>
        <dt class="optional">pagination <span class="property-type">string</span></dt>
        <dd><code>all</code> walks pages the same way a resource list does. <code>page</code> sends one request.</dd>
        <dt class="optional">pageNumber <span class="property-type">number</span></dt>
        <dd>Sent as <code>page[number]</code>.</dd>
        <dt class="optional">pageSize <span class="property-type">number</span></dt>
        <dd>Sent as <code>page[size]</code>.</dd>
        <dt class="optional">maxPages <span class="property-type">number</span></dt>
        <dd>Page cap for this message.</dd>
        <dt class="optional">output <span class="property-type">string</span></dt>
        <dd><code>response</code> or <code>items</code>.</dd>
        <dt class="optional">resourceId <span class="property-type">string</span></dt>
        <dd>Fills <code>{id}</code> in the path.</dd>
    </dl>
    <h3>Outputs</h3>
    <dl class="message-properties">
        <dt>payload <span class="property-type">object | array | string</span></dt>
        <dd>Response body, or the error body when the call fails.</dd>
        <dt>statusCode <span class="property-type">number</span></dt>
        <dd>HTTP status of the last response.</dd>
        <dt>headers <span class="property-type">object</span></dt>
        <dd>Response headers.</dd>
        <dt>subsplash <span class="property-type">object</span></dt>
        <dd>Method, path, paging metadata, and <code>error</code> when the call failed.</dd>
    </dl>
    <h3>Details</h3>
    <p>Use this node for a path the resource nodes do not list, or when you already have a URL from a HAL <code>_links</code> object. Requests that point at a different host are rejected. Redirects are not followed.</p>
    <p>The same token cache, 401 refresh, and 429 backoff as the resource nodes apply. POST, PUT, and PATCH are retried only when Subsplash returns 429.</p>
    <h3>References</h3>
    <ul>
        <li><a href="https://developer.subsplash.com/api/openapi.yaml">Subsplash OpenAPI specification</a></li>
    </ul>
</script>
"""


def render_html(nodes):
    editor = (ROOT / "scripts" / "fragments" / "editor.js").read_text()
    config = (ROOT / "scripts" / "fragments" / "config.html").read_text()
    catalog_json = json.dumps(editor_catalog(nodes), ensure_ascii=False).replace("<", "\\u003c")
    parts = [
        "<!-- Generated by scripts/generate_catalog.py. Regenerate instead of editing by hand. -->",
        "<script type=\"text/javascript\">",
        "window.SUBSPLASH_EDITOR_CATALOG = " + catalog_json + ";",
        "</script>",
        "<script type=\"text/javascript\">",
        editor,
        "</script>",
        config,
    ]
    for node in nodes:
        parts.append(render_resource_js(node))
    parts.append(REQUEST_NODE)
    return "\n".join(parts) + "\n"


def coverage_table(nodes):
    lines = [
        "| Method | Path | Operation | Node | Auth | Paging | Body |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for node in nodes:
        for op in node["operations"]:
            if not op["collection"]:
                paging = ""
            elif op["pageUndocumented"]:
                paging = "collection, page params undeclared"
            elif op["syntheticPages"]:
                paging = "page[number], page[size]"
            elif op["pageSize"]:
                paging = "page[size]"
            else:
                paging = "collection"
            body = op["contentType"] if op["body"] else ""
            auth = "yes" if op["auth"] else "no"
            lines.append(
                f"| `{op['method']}` | `{op['path']}` | `{op['operationId']}` | `{node['type']}` | {auth} | {paging} | {body} |"
            )
    return "\n".join(lines)


def operations_section(nodes):
    blocks = []
    for node in nodes:
        blocks.append(f"### `{node['type']}`")
        blocks.append("")
        blocks.append(node["blurb"])
        blocks.append("")
        blocks.append("| Operation | Call | Auth | Notes |")
        blocks.append("| --- | --- | --- | --- |")
        for op in node["operations"]:
            notes = []
            if op["collection"]:
                notes.append("list")
            if op["pageUndocumented"]:
                notes.append("page params not in spec")
            required = [param["name"] for param in op["query"] if param["required"]]
            if required:
                notes.append("requires " + ", ".join(f"`{name}`" for name in required))
            if op["body"]:
                notes.append(op["contentType"] or "body")
            path_note = ""
            if op["pathParams"]:
                path_note = " " + " ".join("{" + name + "}" for name in op["pathParams"])
            blocks.append(
                f"| `{op['operationId']}` | `{op['method']} {op['path']}`{path_note} | "
                f"{'yes' if op['auth'] else 'no'} | {'; '.join(notes)} |"
            )
        blocks.append("")
    blocks.append("### `subsplash-request`")
    blocks.append("")
    blocks.append("Sends an arbitrary method and path on the same host. Use it for a HAL link or for an endpoint added to the API before this package is regenerated.")
    blocks.append("")
    return "\n".join(blocks).rstrip() + "\n"


def splice(text, name, replacement):
    start = f"<!-- GENERATED:{name}:START -->"
    end = f"<!-- GENERATED:{name}:END -->"
    if start not in text or end not in text:
        raise SystemExit(f"README is missing {start}")
    pre, rest = text.split(start, 1)
    _, post = rest.split(end, 1)
    return pre + start + "\n" + replacement.rstrip() + "\n" + end + post


def main():
    if not SPEC_PATH.is_file():
        sys.stderr.write(f"OpenAPI file not found: {SPEC_PATH}\n")
        sys.exit(1)
    spec = yaml.safe_load(SPEC_PATH.read_text())
    grouped, count = load_operations(spec)
    info = spec.get("info") or {}
    nodes = []
    for domain in DOMAINS:
        operations = grouped[domain["id"]]
        if not operations:
            raise SystemExit(f"Domain {domain['id']} has no operations")
        nodes.append({
            "id": domain["id"],
            "type": domain["type"],
            "palette": domain["palette"],
            "blurb": domain["blurb"],
            "operations": operations,
        })
    catalog = {
        "meta": {
            "specUrl": "https://developer.subsplash.com/api/openapi.yaml",
            "specOpenapi": spec.get("openapi"),
            "specTitle": info.get("title"),
            "specVersion": info.get("version"),
            "specLastModified": "Thu, 22 Oct 2026 16:44:42 GMT",
            "baseUrl": "https://core.subsplash.com",
            "tokenPath": "/tokens/v1/token",
            "operationCount": count,
            "pathCount": len(spec.get("paths") or {}),
        },
        "nodes": nodes,
    }
    (ROOT / "lib" / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    (ROOT / "nodes" / "subsplash.html").write_text(render_html(nodes))
    readme_path = ROOT / "README.md"
    if readme_path.is_file() and "GENERATED:COVERAGE:START" in readme_path.read_text():
        text = readme_path.read_text()
        text = splice(text, "OPERATIONS", operations_section(nodes))
        text = splice(text, "COVERAGE", coverage_table(nodes))
        readme_path.write_text(text)
    print(f"Wrote {count} operations across {len(nodes)} resource nodes")


if __name__ == "__main__":
    main()
