# @brettgoodrich/node-red-subsplash

Node-RED nodes for the [Subsplash REST API](https://developer.subsplash.com/docs/restapi/). One config node holds your API client credentials, refreshes bearer tokens, and backs off when Subsplash rate-limits you. Resource nodes cover the API, and a request node can call any other path on the same host.

This package is not published by Subsplash and is not endorsed by them. Subsplash is a trademark of its owner. You need your own API client, which Subsplash provisions with your account team. The public documentation form does not issue credentials.

## Requirements

- Node.js 18 or newer
- Node-RED 3.0 or newer

## Install

From your Node-RED user directory, usually `~/.node-red`:

```bash
npm install @brettgoodrich/node-red-subsplash
```

Restart Node-RED. The nodes appear in the palette under **Subsplash**. Node type ids stay `subsplash-*` (`subsplash-media`, `subsplash-request`, and the rest). The config node is `subsplash-config`.

To try the package from a git checkout instead of npm:

```bash
cd ~/.node-red
npm install /path/to/node-red-subsplash
```

## Account setup

1. Ask your Subsplash representative for an API client id and client secret. Token creation uses the `client_credentials` grant.
2. Drag any Subsplash node onto a flow and add a new **Subsplash account** config.
3. Leave the base URL as `https://core.subsplash.com` unless you are pointing at a proxy on that API.
4. Paste the client id and client secret. They are stored in Node-RED's credential store, not in the flow export.
5. Optional: set the app key (six characters, from the dashboard) and the org key (eight characters). Resource nodes can copy those into `filter[app_key]` and `filter[org_key]` when the operation documents that filter and the message did not set it.
6. Deploy.

The config node requests a token with `POST /tokens/v1/token` as `application/x-www-form-urlencoded` and `grant_type=client_credentials`. The token is cached in memory and refreshed `expires_in` seconds after it was issued, minus the refresh skew (30 seconds unless you change it). Concurrent calls share one token request. A later `401` clears the cache, fetches one new token, and retries the call once.

If you already have a bearer token, put it in the access token credential. It is sent as-is. When a client id and secret are also set, a `401` falls back to the client-credentials grant. Optional `add_claims` is forwarded on the token request only when your API client is allowed to define its own scope. Public signing-key reads and `POST /tokens/v1/token` do not send a bearer token.

## Nodes

Implements the [Subsplash API](https://developer.subsplash.com/docs/restapi/) as Node-RED nodes:

- `subsplash-config` — account, token cache, and retries
- `subsplash-builder` — lists and list rows
- `subsplash-donations` — campaigns, donations, funds, pledges, and terminals
- `subsplash-events` — calendars, events, and repeating events
- `subsplash-forms` — forms and responses
- `subsplash-groups` — groups, group types, and members
- `subsplash-live` — broadcasts
- `subsplash-media` — media items and series
- `subsplash-pages` — page links
- `subsplash-payments` — payments, instruments, refunds, and intents
- `subsplash-people` — profiles, households, custom fields, and membership changes
- `subsplash-push` — notifications, topics, and subscriptions
- `subsplash-tokens` — signing keys and token requests
- `subsplash-webhooks` — webhooks, secret rotation, and send attempts
- `subsplash-request` — any method and path on the configured host

Each resource node's operation value, on the node and on `msg.operation`, is the OpenAPI `operationId`. The dropdown groups operations by spec tag. The node's help lists the calls for that node.

## Message properties

Editor fields are defaults. A property on the message replaces the same field. `filters`, `query`, and `headers` are merged, and the message wins when a key is in both.

The edit dialog shows a field only when the selected operation declares it. Query, Headers, and Output stay on every operation. The request node keeps every field. A value left on a hidden field is not sent. The same property on the message is still honored.

`msg.id` is not read. Use `msg.resourceId`.

### Editor controls

What you type is saved in the same text or JSON an older flow already used, so a flow exported before these controls still loads and runs. Opening a node does not rewrite it. Saving may compact JSON whitespace.

- **Operation.** A dropdown of every operation on the node, grouped by the first spec tag. A value added to the API later can still be set with `msg.operation` after you regenerate the catalog.
- **Resource ID.** A typed input: a literal string, or a value from the message, flow context, global context, or an environment variable. `msg.resourceId` still wins when the message sets it. A typed value saved on a hidden Resource ID is not evaluated and is not sent.
- **Body.** JSON or field rows for the same object. **Insert template** writes the operation's writable request-body fields, required fields first. **Clear all fields** sits next to Insert template at the same size. The first click changes the label to **Are you sure?** without changing the button's width; the second empties the rows and the JSON. It returns to **Clear all fields** after a few seconds, or if you click or move focus elsewhere. **View as Rows** loads the JSON into the rows. If that JSON cannot be loaded, the text stays as typed and the section shows an error instead of replacing the rows.
- **Filters.** One row per filter: a key from the operation, plus Custom; an operator (`=`, `!`, `<`, `>`, `<=`, `>=`); and a value control for that filter. Rows are saved as the same filter object as before, for example `{"status":"!draft"}`.
- **Include.** Chips for the include values the operation declares, plus any you add. Saved as a comma-separated string.
- **Sort.** One row per field. Each row is ascending or descending. Saved as a comma-separated list, with `-` on descending fields.
- **Fields.** One row per sparse fieldset. Saved as JSON, for example `{"responses":"count"}`.
- **Query.** Key/value rows for any other query parameter. This is the escape hatch for a parameter the other fields do not cover.
- **Headers.** Key/value rows. Suggested names come from the spec, and you can type any other header.

Query and Headers are under **Add Extras**, below a divider and collapsed until you open it. The section opens by itself when the saved node already has a query or header value. Body, Filters, Fields, Query, and Headers switch between rows and JSON with **View as JSON** / **View as Rows**. Choosing **View as Rows** loads the JSON into the rows. Invalid JSON, or a value the rows cannot represent, is left intact and the section shows a red message telling you to switch back to **View as JSON**. The message goes away when you go back, or once the JSON can be loaded. The request node uses the same controls with free-text keys.

| Property | Type | Effect |
| --- | --- | --- |
| `msg.operation` | string | Operation id, for example `GetOneProfile`. |
| `msg.resourceId` | string | Fills `{id}` in the path. Wins over a typed Resource ID. |
| `msg.pathParams` | object | Named path parameters when you need more than `id`. |
| `msg.body` | object or string | Request body. Wins over `msg.payload`. |
| `msg.payload` | object or string | Body when `msg.body` is absent and the editor body is empty. Ignored for GET and DELETE on the request node unless you set `msg.body`. |
| `msg.filters` | object | Filters. Key `status` is sent as `filter[status]`. |
| `msg.query` | object | Extra query parameters, using Subsplash's names. |
| `msg.include` | string or array | `include` query, comma-separated. |
| `msg.sort` | string | For example `-created_at,title`. |
| `msg.fields` | object | Sparse fieldsets. `{ "responses": "count" }` becomes `fields[responses]=count`. |
| `msg.headers` | object | Extra headers. The bearer token is not taken from here. |
| `msg.pageNumber` | number | `page[number]`, starting at 1. |
| `msg.pageSize` | number | `page[size]`. |
| `msg.pagination` | `page` or `all` | One page, or walk the collection. |
| `msg.maxPages` | number | Cap for this message. Cannot exceed 500. |
| `msg.collectionTotal` | `include` or `omit` | `Collection-Total` header. |
| `msg.collectionStats` | string | `Collection-Stats` header. |
| `msg.accept` | string | Accept header. |
| `msg.output` | `response` or `items` | Full body, or the embedded array when there is exactly one. |
| `msg.method`, `msg.path`, `msg.url` | string | Request node only. `msg.url` is used when path is empty, and only if the host matches the base URL. |
| `msg.authenticate` | boolean | Request node only. `false` omits the bearer token. |
| `msg.contentType` | string | Request node only. Use `application/x-www-form-urlencoded` to encode an object as a form. |

### Outputs

| Property | Meaning |
| --- | --- |
| `msg.payload` | Response body. With output `items`, the single array under `_embedded`. On failure, the API error body. |
| `msg.statusCode` | HTTP status of the last response. |
| `msg.headers` | Response headers, lower case. |
| `msg.subsplash` | `operation`, `method`, `path`, `url`, `pagesFetched`, `count`, `total`, `truncated`, `collection`. On failure, `subsplash.error` has `message`, `statusCode`, `code`, and `network`. |

Other properties on the incoming message are left in place.

## Pagination and errors

Collection nodes can return one page or walk every page. Fetch-all follows `_links.next` when it stays on the same host. When the operation uses page numbers and there is no next link, further pages are requested until the page is short, `total` is reached, a page repeats, or the page cap is hit (50 by default, 500 maximum). `msg.subsplash.truncated` is true when the cap stops the walk early. Paging controls appear only when the operation declares page parameters. A page size or fetch-all setting saved on the node is not sent when those controls are hidden. `msg.pageNumber`, `msg.pageSize`, `msg.pagination`, and `msg.query` are still honored.

A response of 400 or higher fails the node through `done(err)`, which is what a Catch node listens for. Catch receives `msg.statusCode`, the error body on `msg.payload`, and `msg.subsplash.error.code` when the body included one. The status shows a blue dot while a call is in flight, a blue ring with the page number during fetch-all, a yellow ring while backing off, a green dot with the result count, or a red ring with the error.

On HTTP 429 the node waits for `Retry-After` (capped at 120 seconds), then retries. Without that header it uses exponential backoff from the config's retry base (500 ms by default) plus a little jitter. `maxRetries` is how many extra attempts follow the first failure (4 by default). GET, HEAD, OPTIONS, and DELETE are also retried on 502, 503, and 504, and on network errors. POST, PUT, and PATCH are retried only on 429.

## Examples

Import these from the editor's Import menu, or from the examples list after the package is installed. Add your credentials on the config node before deploying.

| File | What it shows |
| --- | --- |
| `examples/list-published-media.json` | Filter published media items, include images, sort by newest. |
| `examples/export-donations.json` | Fetch every donation page for an org key and pass the items on. |
| `examples/create-profile.json` | Create a profile, then patch it. Shows `msg.resourceId` and `msg.body`. |
| `examples/raw-request-and-errors.json` | Call a path directly, and route a 404 through a Catch node. |
| `examples/webhooks-and-signing-keys.json` | List public signing keys without a bearer token, and rotate a webhook secret. |

## Development

```bash
npm install
npm test
npm run lint
```

Tests use `node-red-node-test-helper` and `nock`. They cover token caching and refresh, a call for every operation, pagination, rate-limit retry, and Catch handling. No live Subsplash account is required.

To rebuild the catalog after replacing the OpenAPI file:

```bash
SUBSPLASH_OPENAPI=/path/to/openapi.yaml npm run generate
```

The catalog is generated from `https://developer.subsplash.com/api/openapi.yaml`. Publishing steps are in [PUBLISHING.md](PUBLISHING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
