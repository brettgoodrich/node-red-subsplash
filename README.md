# node-red-contrib-subsplash

Node-RED nodes for the [Subsplash REST API](https://developer.subsplash.com/api/openapi.yaml). One config node holds your API client credentials, refreshes bearer tokens, and backs off when Subsplash rate-limits you. Resource nodes cover every operation in the OpenAPI document (126 operations, 71 paths), and a request node can call any other path on the same host.

This package is not published by Subsplash and is not endorsed by them. Subsplash is a trademark of its owner. You need your own API client, which Subsplash provisions with your account team. The public documentation form does not issue credentials.

The catalog was generated from OpenAPI 3.0.2, spec version 1.0.0, fetched from `https://developer.subsplash.com/api/openapi.yaml` (last modified Thu, 22 Oct 2026). Regenerate it with `npm run generate` when Subsplash publishes a new spec.

## Requirements

- Node.js 18 or newer
- Node-RED 3.0 or newer

## Install

From your Node-RED user directory, usually `~/.node-red`:

```bash
npm install node-red-contrib-subsplash
```

Restart Node-RED. The nodes appear in the palette under **Subsplash**.

To try the package from a git checkout instead of npm:

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-subsplash
```

## Account setup

1. Ask your Subsplash representative for an API client id and client secret. Token creation uses the `client_credentials` grant.
2. Drag any Subsplash node onto a flow and add a new **Subsplash account** config.
3. Leave the base URL as `https://core.subsplash.com` unless you are pointing at a proxy on that API.
4. Paste the client id and client secret. They are stored in Node-RED's credential store, not in the flow export.
5. Optional: set the app key (six characters, from the dashboard) and the org key (eight characters). Resource nodes can copy those into `filter[app_key]` and `filter[org_key]` when the operation documents that filter and the message did not set it.
6. Deploy.

The config node requests a token with:

```http
POST /tokens/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=...&client_secret=...
```

The response is `{ "access_token", "expires_in", "token_type": "Bearer" }`. The token is cached in memory and refreshed `expires_in` seconds after it was issued, minus the refresh skew (30 seconds unless you change it). Concurrent calls share one token request. A later `401` clears the cache, fetches one new token, and retries the call once.

If you already have a bearer token, put it in the access token credential. It is sent as-is. When a client id and secret are also set, a `401` falls back to the client-credentials grant. Optional `add_claims` is forwarded on the token request only when your API client is allowed to define its own scope (`can_define_scope`). Impersonation (`impersonate_client`, `impersonate_owner`) is available on the tokens node's **CreateToken** operation, not on the shared config.

Public signing-key reads (`GET /tokens/v1/keys` and `GET /tokens/v1/keys/{id}`) do not send a bearer token. Neither does `POST /tokens/v1/token` itself.

## Nodes

| Node | What it calls |
| --- | --- |
| `subsplash-config` | Account, token cache, retries. Config category, not on the main palette. |
| `subsplash-builder` | Lists and list rows (`/builder/v1`). |
| `subsplash-donations` | Campaigns, contributions, donations, funds, pledges, recurring donations, terminals. |
| `subsplash-events` | Calendars, events, repeating events (`/events/v2`). |
| `subsplash-forms` | Forms and responses. |
| `subsplash-groups` | Groups, group types, group members. |
| `subsplash-live` | Broadcasts. |
| `subsplash-media` | Media items and media series. |
| `subsplash-pages` | Links (`/pages/v1/links`). |
| `subsplash-payments` | Instruments, payments, payment intents (create and capture), refunds, setup intents. |
| `subsplash-people` | Profiles, households, custom field definitions, membership status changes. |
| `subsplash-push` | Notifications, topics, topic subscriptions, bulk topic subscriptions. |
| `subsplash-tokens` | Public signing keys, token create, and the token CORS preflight. |
| `subsplash-webhooks` | Webhooks, secret rotation, send attempts. |
| `subsplash-request` | Any method and path on the configured host. |

Each resource node has an operation list. The value stored on the node, and accepted on `msg.operation`, is the OpenAPI `operationId` (`GetAllMediaItems`, `RotateWebhookSecret`, and so on). The editor can filter that list.

Several Push, Payments, and token paths are unversioned (`/notifications`, `/topics`, `/payments`, `/refunds`, `/instruments`, `/payment-intents`, `/setup-intents`, `/bulk-topic-subscriptions`). The nodes use the paths from the spec as they are.

## Message properties

Editor fields are defaults. A property on the message replaces the same field. `filters`, `query`, and `headers` are merged, and the message wins when a key is in both.

`msg.id` is not read. Node-RED messages are not given an id you should overload. Use `msg.resourceId`.

| Property | Type | Effect |
| --- | --- | --- |
| `msg.operation` | string | Operation id, for example `GetOneProfile`. |
| `msg.resourceId` | string | Fills `{id}` in the path. |
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
| `msg.pageSize` | number | `page[size]`. The platform maximum is usually 100. |
| `msg.pagination` | `page` or `all` | One page, or walk the collection. |
| `msg.maxPages` | number | Cap for this message. Cannot exceed 500. |
| `msg.collectionTotal` | `include` or `omit` | `Collection-Total` header. |
| `msg.collectionStats` | string | `Collection-Stats` header, used by donation lists. |
| `msg.accept` | string | Accept header. Some lists can return `text/csv`. |
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

Other properties on the incoming message are left in place. A merged fetch-all collection sets `count` to the number of combined resources and drops `next` / `prev` links. `total` stays the API total when Subsplash sent one.

## Filtering, sorting, includes

Subsplash filters are query parameters: `filter[field]=value`. Only one filter is allowed per field. The value is a string, a comma-separated list (any of those values), or a comparison:

| Prefix | Meaning | Sent as |
| --- | --- | --- |
| *(none)* | equals | `filter[foo]=bar` |
| `!` | not | `filter[foo]=!bar` |
| `<` | less than | `filter[foo]=<5` |
| `>` | greater than | `filter[foo]=>5` |
| `<=` | less or equal | `filter[foo]=<%3D5` |
| `>=` | greater or equal | `filter[foo]=>%3D5` |

The client encodes the rest of the value and keeps commas, `*` wildcards, and `|` or-filters. Pass raw values (`<=5`, `John*`, `a,b`). A field that does not allow a filter or a wildcard returns `400` with the parameter named in `errors[].source.parameter`.

Dates are RFC3339, such as `2017-05-23T15:35:57Z`. Booleans are `true` or `false`. `null` matches a null field where the API allows it.

Sort is a comma-separated list. Prefix a field with `-` for descending and `+` or nothing for ascending: `-created_at,title`.

`include` is a comma-separated list of related resources (`images,audio`). Nested includes use dots (`bar.baz`). A missing related resource does not fail the call; `_embedded` simply omits it.

Sparse fieldsets use `fields[type]=field,field`. The type is the singular snake_case resource name.

Which filters exist depends on the operation. The node's help lists them. A disallowed filter is a `400`, not a silent ignore.

## Pagination

Collection responses are pages. `page[number]` starts at 1. `page[size]` defaults vary by resource; the documented maximum on the shared page parameter is 100. `count` is the size of the current page. `total` is the size of the whole filtered collection, and some resources omit it unless you send `Collection-Total: include`. The pagination guide also allows `omit`.

HAL `_links` on a collection include `self`, `first`, and `last`, plus `next` and `prev` when another page exists. A link may be a string or `{ "href" }`. Fetch-all follows `next` when it is on the same host.

When there is no `next` link, fetch-all requests the next `page[number]` if that operation uses page numbers, the page was full, and `total` (when present) is not yet reached. It stops when a page repeats, a page is short, `total` is reached, or the page cap is hit (50 by default, 500 maximum). `msg.subsplash.truncated` is true when the cap stopped the walk while another page still looked available.

Some list operations in the OpenAPI file do not declare `page[number]` or `page[size]` even though the platform pagination guide describes those parameters for collections. The nodes still accept them, and the help text says when they were not declared. Leave the page fields blank to omit them. `ListBroadcasts` declares `page[size]` only, so fetch-all will not invent page numbers for it; it follows `next` links.

## Errors

A response of 400 or higher fails the node. The runtime receives the error through `done(err)`, which is what a Catch node listens for. The message passed to Catch has:

- `msg.statusCode`
- `msg.payload` set to the error body
- `msg.subsplash.error.code` set to the Subsplash code when the body included one

Common codes from the API guide:

| Code | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 | Generic bad request. |
| `json_syntax` | 400 | Body is not valid JSON. |
| `json` | 400 | Other JSON problem. |
| `missing_value` | 400 or 422 | A required field was absent. |
| `invalid_value` | 400 or 422 | A field failed validation. |
| `json_content` | 422 | JSON shape was not what the endpoint expects. |
| `duplicate_resource` | 409 | Create collided with an existing resource. |
| `no_auth_header` | 401 | Authorization header missing. |
| `invalid_token` | 401 | Token format, signature, or expiry. |
| `authentication` | 401 | Token signature or claim rejected. |
| `authorization` | 403 | Token does not allow this action. |
| `not_found` | 404 | Path is not supported. |
| `resource_not_found` | 404 | Path is valid; that id does not exist. |
| `too_many_requests` | 429 | Rate limit. |
| `internal` | 500 | Server error, often without a detail. |

Validation errors can return several objects in `errors[]`, each with `code`, `detail`, and sometimes `source.pointer` or `source.parameter`.

The node status shows a blue dot while a call is in flight, a blue ring with the page number during fetch-all, a yellow ring while backing off, a green dot with the result count, or a red ring with the error.

## Rate limits

The OpenAPI document does not publish a numeric quota. It does define `too_many_requests` as HTTP 429, and the webhook guide says a `Retry-After` header may be present.

On 429 the node waits for `Retry-After` (delta-seconds or an HTTP date), capped at 120 seconds, then retries. Without the header it uses exponential backoff from the config's retry base (500 ms by default) plus a little jitter. `maxRetries` is how many extra attempts follow the first failure (4 by default).

GET, HEAD, OPTIONS, and DELETE are also retried on 502, 503, and 504, and on network errors such as a timeout. POST, PUT, and PATCH are retried only on 429, so a create is not submitted twice because a gateway timed out. Token requests are treated as safe to retry.

## Webhooks

Creating a webhook returns a `secret` once. Store it yourself; later reads do not show it again. `RotateWebhookSecret` issues a new one. Delivery is visible on `ListSendAttempts`.

Subsplash signs deliveries with HMAC-SHA256. The guide says the key is the webhook secret and the message is the raw request body concatenated with the `Webhook-Timestamp` header, compared to `Webhook-Signature`. Check the timestamp so a captured call cannot be replayed. The Go sample pasted in the OpenAPI description reads the timestamp after it uses it, so confirm the exact encoding against a live delivery before you rely on it. Node-RED's HTTP In node parses JSON bodies, which drops the raw bytes the signature was computed over. Terminate the webhook on a server that can read the raw body, or verify it before the body is parsed.

The endpoint Subsplash calls must be HTTPS in production, accept POST, and return a 2xx. Their guide describes up to 10 delivery attempts with increasing delay. A 429 from your endpoint is honored only when `Retry-After` fits inside one attempt; otherwise they fail that attempt and try again about 60 seconds later. That 429 behavior is about *your* endpoint, not about calling their API.

## Examples

Import these from the editor's Import menu, or from the examples list after the package is installed. Add your credentials on the config node before deploying.

| File | What it shows |
| --- | --- |
| `examples/list-published-media.json` | Filter published media items, include images, sort by newest. |
| `examples/export-donations.json` | Fetch every donation page for an org key and pass the items on. |
| `examples/create-profile.json` | Create a profile, then patch it. Shows `msg.resourceId` and `msg.body`. |
| `examples/raw-request-and-errors.json` | Call a path directly, and route a 404 through a Catch node. |
| `examples/webhooks-and-signing-keys.json` | List public signing keys without a bearer token, and rotate a webhook secret. |

## Operations

<!-- GENERATED:OPERATIONS:START -->
### `subsplash-builder`

Reads and writes Builder lists and the rows inside those lists.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListListRows` | `GET /builder/v1/list-rows` | yes | list; page params not in spec |
| `CreateListRow` | `POST /builder/v1/list-rows` | yes | application/json |
| `GetOneListRow` | `GET /builder/v1/list-rows/{id}` {id} | yes |  |
| `UpdateListRow` | `PATCH /builder/v1/list-rows/{id}` {id} | yes | application/json |
| `DeleteListRow` | `DELETE /builder/v1/list-rows/{id}` {id} | yes |  |
| `ListLists` | `GET /builder/v1/lists` | yes | list; page params not in spec |
| `CreateList` | `POST /builder/v1/lists` | yes | application/json |
| `GetOneList` | `GET /builder/v1/lists/{id}` {id} | yes |  |
| `UpdateList` | `PATCH /builder/v1/lists/{id}` {id} | yes | application/json |
| `DeleteList` | `DELETE /builder/v1/lists/{id}` {id} | yes |  |

### `subsplash-donations`

Reads giving data and manages funds: campaigns, donations, pledges, recurring donations, and terminals.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `GetAllCampaigns` | `GET /donations/v1/campaigns` | yes | list; requires `filter[org_key]` |
| `GetOneCampaign` | `GET /donations/v1/campaigns/{id}` {id} | yes |  |
| `GetOneCampaignContributions` | `GET /donations/v1/campaigns/{id}/contributions` {id} | yes | requires `filter[org_key]` |
| `GetAllDonations` | `GET /donations/v1/donations` | yes | list |
| `GetOneDonation` | `GET /donations/v1/donations/{id}` {id} | yes |  |
| `GetAllFunds` | `GET /donations/v1/funds` | yes | list; requires `filter[org_key]` |
| `CreateFund` | `POST /donations/v1/funds` | yes | application/json |
| `GetOneFund` | `GET /donations/v1/funds/{id}` {id} | yes |  |
| `UpdateOneFund` | `PATCH /donations/v1/funds/{id}` {id} | yes | application/json |
| `GetAllPledges` | `GET /donations/v1/pledges` | yes | list; requires `filter[org_key]` |
| `GetOnePledge` | `GET /donations/v1/pledges/{id}` {id} | yes |  |
| `GetAllRecurringDonations` | `GET /donations/v1/recurring-donations` | yes | list |
| `GetOneRecurringDonation` | `GET /donations/v1/recurring-donations/{id}` {id} | yes |  |
| `GetAllDonationTerminals` | `GET /donations/v1/terminals` | yes | list; page params not in spec |

### `subsplash-events`

Reads and writes calendars, events, and repeating events.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListCalendarsV2` | `GET /events/v2/calendars` | yes | list; page params not in spec |
| `CreateCalendar` | `POST /events/v2/calendars` | yes | application/json |
| `GetOneCalendar` | `GET /events/v2/calendars/{id}` {id} | yes |  |
| `UpdateCalendar` | `PATCH /events/v2/calendars/{id}` {id} | yes | application/json |
| `DeleteCalendar` | `DELETE /events/v2/calendars/{id}` {id} | yes |  |
| `ListEventsV2` | `GET /events/v2/events` | yes | list; page params not in spec |
| `CreateEvent` | `POST /events/v2/events` | yes | application/json |
| `GetOneEvent` | `GET /events/v2/events/{id}` {id} | yes |  |
| `UpdateEvent` | `PATCH /events/v2/events/{id}` {id} | yes | application/json |
| `DeleteEvent` | `DELETE /events/v2/events/{id}` {id} | yes |  |
| `ListRepeatingEvents` | `GET /events/v2/repeating-events` | yes | list; page params not in spec |
| `CreateRepeatingEvent` | `POST /events/v2/repeating-events` | yes | application/json |
| `GetOneRepeatingEvent` | `GET /events/v2/repeating-events/{id}` {id} | yes |  |
| `UpdateRepeatingEvent` | `PATCH /events/v2/repeating-events/{id}` {id} | yes | application/json |
| `DeleteRepeatingEvent` | `DELETE /events/v2/repeating-events/{id}` {id} | yes |  |

### `subsplash-forms`

Reads forms and the responses people submit.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListForms` | `GET /forms/v1/forms` | yes | list |
| `GetOneForm` | `GET /forms/v1/forms/{id}` {id} | yes |  |
| `ListResponses` | `GET /forms/v1/responses` | yes | list |
| `GetOneResponse` | `GET /forms/v1/responses/{id}` {id} | yes |  |

### `subsplash-groups`

Reads and writes groups, group types, and group members.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListGroupMembers` | `GET /groups/v1/group-members` | yes | list; page params not in spec |
| `CreateGroupMember` | `POST /groups/v1/group-members` | yes | application/json |
| `GetOneGroupMember` | `GET /groups/v1/group-members/{id}` {id} | yes |  |
| `UpdateGroupMember` | `PATCH /groups/v1/group-members/{id}` {id} | yes | application/json |
| `DeleteGroupMember` | `DELETE /groups/v1/group-members/{id}` {id} | yes |  |
| `ListGroupTypes` | `GET /groups/v1/group-types` | yes | list; page params not in spec |
| `CreateGroupType` | `POST /groups/v1/group-types` | yes | application/json |
| `GetOneGroupType` | `GET /groups/v1/group-types/{id}` {id} | yes |  |
| `UpdateGroupType` | `PATCH /groups/v1/group-types/{id}` {id} | yes | application/json |
| `DeleteGroupType` | `DELETE /groups/v1/group-types/{id}` {id} | yes |  |
| `ListGroups` | `GET /groups/v1/groups` | yes | list; page params not in spec |
| `CreateGroup` | `POST /groups/v1/groups` | yes | application/json |
| `GetOneGroup` | `GET /groups/v1/groups/{id}` {id} | yes |  |
| `UpdateGroup` | `PATCH /groups/v1/groups/{id}` {id} | yes | application/json |
| `DeleteGroup` | `DELETE /groups/v1/groups/{id}` {id} | yes |  |

### `subsplash-live`

Reads live-stream broadcasts.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListBroadcasts` | `GET /live/v1/broadcasts` | yes | list; requires `filter[app_key]` |
| `GetOneBroadcast` | `GET /live/v1/broadcasts/{id}` {id} | yes |  |

### `subsplash-media`

Reads and writes media items and media series.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `GetAllMediaItems` | `GET /media/v1/media-items` | yes | list |
| `CreateMediaItem` | `POST /media/v1/media-items` | yes | application/json |
| `GetOneMediaItem` | `GET /media/v1/media-items/{id}` {id} | yes |  |
| `UpdateMediaItem` | `PATCH /media/v1/media-items/{id}` {id} | yes | application/json |
| `DeleteMediaItem` | `DELETE /media/v1/media-items/{id}` {id} | yes |  |
| `GetAllMediaSeries` | `GET /media/v1/media-series` | yes | list; page params not in spec |
| `CreateMediaSeries` | `POST /media/v1/media-series` | yes | application/json |
| `GetOneMediaSeries` | `GET /media/v1/media-series/{id}` {id} | yes |  |
| `UpdateMediaSeries` | `PATCH /media/v1/media-series/{id}` {id} | yes | application/json |
| `DeleteMediaSeries` | `DELETE /media/v1/media-series/{id}` {id} | yes |  |

### `subsplash-pages`

Reads and writes short links used by Subsplash pages.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `GetAllLinks` | `GET /pages/v1/links` | yes | list |
| `CreateLink` | `POST /pages/v1/links` | yes | application/json |
| `GetOneLink` | `GET /pages/v1/links/{id}` {id} | yes |  |
| `UpdateLink` | `PATCH /pages/v1/links/{id}` {id} | yes | application/json |
| `DeleteLink` | `DELETE /pages/v1/links/{id}` {id} | yes |  |

### `subsplash-payments`

Reads payments, instruments, and refunds, and creates payment intents, captures, and setup intents.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListInstruments` | `GET /instruments` | yes | list |
| `GetOneInstrument` | `GET /instruments/{id}` {id} | yes |  |
| `CreatePaymentIntent` | `POST /payment-intents` | yes | application/json |
| `CapturePaymentIntent` | `POST /payment-intents/{id}/capture` {id} | yes |  |
| `ListPayments` | `GET /payments` | yes | list |
| `GetOnePayment` | `GET /payments/{id}` {id} | yes |  |
| `ListRefunds` | `GET /refunds` | yes | list |
| `GetOneRefund` | `GET /refunds/{id}` {id} | yes |  |
| `CreateSetupIntent` | `POST /setup-intents` | yes | application/json |

### `subsplash-people`

Reads and writes profiles, households, custom fields, and membership status changes.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListCustomFieldDefinitions` | `GET /people/v1/custom-field-definitions` | yes | list |
| `CreateCustomFieldDefinition` | `POST /people/v1/custom-field-definitions` | yes | application/json |
| `GetOneCustomFieldDefinition` | `GET /people/v1/custom-field-definitions/{id}` {id} | yes |  |
| `UpdateCustomFieldDefinition` | `PATCH /people/v1/custom-field-definitions/{id}` {id} | yes | application/json |
| `ListHouseholds` | `GET /people/v1/households` | yes | list |
| `CreateHousehold` | `POST /people/v1/households` | yes | application/json |
| `GetOneHousehold` | `GET /people/v1/households/{id}` {id} | yes |  |
| `UpdateHousehold` | `PATCH /people/v1/households/{id}` {id} | yes | application/json |
| `DeleteHousehold` | `DELETE /people/v1/households/{id}` {id} | yes |  |
| `ListMembershipStatusChanges` | `GET /people/v1/membership-status-changes` | yes | list |
| `CreateMembershipStatusChange` | `POST /people/v1/membership-status-changes` | yes | application/json |
| `GetOneMembershipStatusChange` | `GET /people/v1/membership-status-changes/{id}` {id} | yes |  |
| `UpdateMembershipStatusChange` | `PATCH /people/v1/membership-status-changes/{id}` {id} | yes | application/json |
| `DeleteMembershipStatusChange` | `DELETE /people/v1/membership-status-changes/{id}` {id} | yes |  |
| `ListProfiles` | `GET /people/v1/profiles` | yes | list |
| `CreateProfile` | `POST /people/v1/profiles` | yes | application/json |
| `GetOneProfile` | `GET /people/v1/profiles/{id}` {id} | yes |  |
| `UpdateProfile` | `PATCH /people/v1/profiles/{id}` {id} | yes | application/json |

### `subsplash-push`

Reads and writes push topics and notifications, and lists or bulk-creates topic subscriptions.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `CreateBulkTopicSubscription` | `POST /bulk-topic-subscriptions` | yes | application/hal+json |
| `GetAllNotifications` | `GET /notifications` | yes | list |
| `CreateNotification` | `POST /notifications` | yes | application/hal+json |
| `GetOneNotification` | `GET /notifications/{id}` {id} | yes |  |
| `UpdateNotification` | `PATCH /notifications/{id}` {id} | yes | application/hal+json |
| `DeleteNotification` | `DELETE /notifications/{id}` {id} | yes |  |
| `GetAllTopicSubscriptions` | `GET /topic-subscriptions` | yes | list |
| `GetOneTopicSubscription` | `GET /topic-subscriptions/{id}` {id} | yes |  |
| `GetAllTopics` | `GET /topics` | yes | list |
| `CreateTopic` | `POST /topics` | yes | application/hal+json |
| `GetOneTopic` | `GET /topics/{id}` {id} | yes |  |
| `UpdateTopic` | `PATCH /topics/{id}` {id} | yes | application/hal+json |
| `DeleteTopics` | `DELETE /topics/{id}` {id} | yes |  |

### `subsplash-tokens`

Reads public signing keys and requests tokens with the client-credentials grant.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `GetAllPublicKeys` | `GET /tokens/v1/keys` | no | list; page params not in spec |
| `GetOnePublicKey` | `GET /tokens/v1/keys/{id}` {id} | no |  |
| `CreateToken` | `POST /tokens/v1/token` | no | application/x-www-form-urlencoded |
| `OptionsToken` | `OPTIONS /tokens/v1/token` | no |  |

### `subsplash-webhooks`

Reads and writes webhook subscriptions, rotates the signing secret, and lists delivery attempts.

| Operation | Call | Auth | Notes |
| --- | --- | --- | --- |
| `ListSendAttempts` | `GET /webhooks/v1/send-attempts` | yes | list; page params not in spec |
| `ListWebhooks` | `GET /webhooks/v1/webhooks` | yes | list; page params not in spec |
| `CreateWebhook` | `POST /webhooks/v1/webhooks` | yes | application/json |
| `GetOneWebhook` | `GET /webhooks/v1/webhooks/{id}` {id} | yes |  |
| `UpdateWebhook` | `PATCH /webhooks/v1/webhooks/{id}` {id} | yes | application/json |
| `DeleteWebhook` | `DELETE /webhooks/v1/webhooks/{id}` {id} | yes |  |
| `RotateWebhookSecret` | `POST /webhooks/v1/webhooks/{id}/rotate-secret` {id} | yes | application/json |

### `subsplash-request`

Sends an arbitrary method and path on the same host. Use it for a HAL link or for an endpoint added to the API before this package is regenerated.
<!-- GENERATED:OPERATIONS:END -->

## Endpoint coverage

Every operation in the OpenAPI `paths` object is listed. Auth "no" means the node does not send a bearer token.

<!-- GENERATED:COVERAGE:START -->
| Method | Path | Operation | Node | Auth | Paging | Body |
| --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/builder/v1/list-rows` | `ListListRows` | `subsplash-builder` | yes | collection, page params undeclared |  |
| `POST` | `/builder/v1/list-rows` | `CreateListRow` | `subsplash-builder` | yes |  | application/json |
| `GET` | `/builder/v1/list-rows/{id}` | `GetOneListRow` | `subsplash-builder` | yes |  |  |
| `PATCH` | `/builder/v1/list-rows/{id}` | `UpdateListRow` | `subsplash-builder` | yes |  | application/json |
| `DELETE` | `/builder/v1/list-rows/{id}` | `DeleteListRow` | `subsplash-builder` | yes |  |  |
| `GET` | `/builder/v1/lists` | `ListLists` | `subsplash-builder` | yes | collection, page params undeclared |  |
| `POST` | `/builder/v1/lists` | `CreateList` | `subsplash-builder` | yes |  | application/json |
| `GET` | `/builder/v1/lists/{id}` | `GetOneList` | `subsplash-builder` | yes |  |  |
| `PATCH` | `/builder/v1/lists/{id}` | `UpdateList` | `subsplash-builder` | yes |  | application/json |
| `DELETE` | `/builder/v1/lists/{id}` | `DeleteList` | `subsplash-builder` | yes |  |  |
| `GET` | `/donations/v1/campaigns` | `GetAllCampaigns` | `subsplash-donations` | yes | page[number], page[size] |  |
| `GET` | `/donations/v1/campaigns/{id}` | `GetOneCampaign` | `subsplash-donations` | yes |  |  |
| `GET` | `/donations/v1/campaigns/{id}/contributions` | `GetOneCampaignContributions` | `subsplash-donations` | yes |  |  |
| `GET` | `/donations/v1/donations` | `GetAllDonations` | `subsplash-donations` | yes | page[number], page[size] |  |
| `GET` | `/donations/v1/donations/{id}` | `GetOneDonation` | `subsplash-donations` | yes |  |  |
| `GET` | `/donations/v1/funds` | `GetAllFunds` | `subsplash-donations` | yes | page[number], page[size] |  |
| `POST` | `/donations/v1/funds` | `CreateFund` | `subsplash-donations` | yes |  | application/json |
| `GET` | `/donations/v1/funds/{id}` | `GetOneFund` | `subsplash-donations` | yes |  |  |
| `PATCH` | `/donations/v1/funds/{id}` | `UpdateOneFund` | `subsplash-donations` | yes |  | application/json |
| `GET` | `/donations/v1/pledges` | `GetAllPledges` | `subsplash-donations` | yes | page[number], page[size] |  |
| `GET` | `/donations/v1/pledges/{id}` | `GetOnePledge` | `subsplash-donations` | yes |  |  |
| `GET` | `/donations/v1/recurring-donations` | `GetAllRecurringDonations` | `subsplash-donations` | yes | page[number], page[size] |  |
| `GET` | `/donations/v1/recurring-donations/{id}` | `GetOneRecurringDonation` | `subsplash-donations` | yes |  |  |
| `GET` | `/donations/v1/terminals` | `GetAllDonationTerminals` | `subsplash-donations` | yes | collection, page params undeclared |  |
| `GET` | `/events/v2/calendars` | `ListCalendarsV2` | `subsplash-events` | yes | collection, page params undeclared |  |
| `POST` | `/events/v2/calendars` | `CreateCalendar` | `subsplash-events` | yes |  | application/json |
| `GET` | `/events/v2/calendars/{id}` | `GetOneCalendar` | `subsplash-events` | yes |  |  |
| `PATCH` | `/events/v2/calendars/{id}` | `UpdateCalendar` | `subsplash-events` | yes |  | application/json |
| `DELETE` | `/events/v2/calendars/{id}` | `DeleteCalendar` | `subsplash-events` | yes |  |  |
| `GET` | `/events/v2/events` | `ListEventsV2` | `subsplash-events` | yes | collection, page params undeclared |  |
| `POST` | `/events/v2/events` | `CreateEvent` | `subsplash-events` | yes |  | application/json |
| `GET` | `/events/v2/events/{id}` | `GetOneEvent` | `subsplash-events` | yes |  |  |
| `PATCH` | `/events/v2/events/{id}` | `UpdateEvent` | `subsplash-events` | yes |  | application/json |
| `DELETE` | `/events/v2/events/{id}` | `DeleteEvent` | `subsplash-events` | yes |  |  |
| `GET` | `/events/v2/repeating-events` | `ListRepeatingEvents` | `subsplash-events` | yes | collection, page params undeclared |  |
| `POST` | `/events/v2/repeating-events` | `CreateRepeatingEvent` | `subsplash-events` | yes |  | application/json |
| `GET` | `/events/v2/repeating-events/{id}` | `GetOneRepeatingEvent` | `subsplash-events` | yes |  |  |
| `PATCH` | `/events/v2/repeating-events/{id}` | `UpdateRepeatingEvent` | `subsplash-events` | yes |  | application/json |
| `DELETE` | `/events/v2/repeating-events/{id}` | `DeleteRepeatingEvent` | `subsplash-events` | yes |  |  |
| `GET` | `/forms/v1/forms` | `ListForms` | `subsplash-forms` | yes | page[number], page[size] |  |
| `GET` | `/forms/v1/forms/{id}` | `GetOneForm` | `subsplash-forms` | yes |  |  |
| `GET` | `/forms/v1/responses` | `ListResponses` | `subsplash-forms` | yes | page[number], page[size] |  |
| `GET` | `/forms/v1/responses/{id}` | `GetOneResponse` | `subsplash-forms` | yes |  |  |
| `GET` | `/groups/v1/group-members` | `ListGroupMembers` | `subsplash-groups` | yes | collection, page params undeclared |  |
| `POST` | `/groups/v1/group-members` | `CreateGroupMember` | `subsplash-groups` | yes |  | application/json |
| `GET` | `/groups/v1/group-members/{id}` | `GetOneGroupMember` | `subsplash-groups` | yes |  |  |
| `PATCH` | `/groups/v1/group-members/{id}` | `UpdateGroupMember` | `subsplash-groups` | yes |  | application/json |
| `DELETE` | `/groups/v1/group-members/{id}` | `DeleteGroupMember` | `subsplash-groups` | yes |  |  |
| `GET` | `/groups/v1/group-types` | `ListGroupTypes` | `subsplash-groups` | yes | collection, page params undeclared |  |
| `POST` | `/groups/v1/group-types` | `CreateGroupType` | `subsplash-groups` | yes |  | application/json |
| `GET` | `/groups/v1/group-types/{id}` | `GetOneGroupType` | `subsplash-groups` | yes |  |  |
| `PATCH` | `/groups/v1/group-types/{id}` | `UpdateGroupType` | `subsplash-groups` | yes |  | application/json |
| `DELETE` | `/groups/v1/group-types/{id}` | `DeleteGroupType` | `subsplash-groups` | yes |  |  |
| `GET` | `/groups/v1/groups` | `ListGroups` | `subsplash-groups` | yes | collection, page params undeclared |  |
| `POST` | `/groups/v1/groups` | `CreateGroup` | `subsplash-groups` | yes |  | application/json |
| `GET` | `/groups/v1/groups/{id}` | `GetOneGroup` | `subsplash-groups` | yes |  |  |
| `PATCH` | `/groups/v1/groups/{id}` | `UpdateGroup` | `subsplash-groups` | yes |  | application/json |
| `DELETE` | `/groups/v1/groups/{id}` | `DeleteGroup` | `subsplash-groups` | yes |  |  |
| `GET` | `/live/v1/broadcasts` | `ListBroadcasts` | `subsplash-live` | yes | page[size] |  |
| `GET` | `/live/v1/broadcasts/{id}` | `GetOneBroadcast` | `subsplash-live` | yes |  |  |
| `GET` | `/media/v1/media-items` | `GetAllMediaItems` | `subsplash-media` | yes | page[number], page[size] |  |
| `POST` | `/media/v1/media-items` | `CreateMediaItem` | `subsplash-media` | yes |  | application/json |
| `GET` | `/media/v1/media-items/{id}` | `GetOneMediaItem` | `subsplash-media` | yes |  |  |
| `PATCH` | `/media/v1/media-items/{id}` | `UpdateMediaItem` | `subsplash-media` | yes |  | application/json |
| `DELETE` | `/media/v1/media-items/{id}` | `DeleteMediaItem` | `subsplash-media` | yes |  |  |
| `GET` | `/media/v1/media-series` | `GetAllMediaSeries` | `subsplash-media` | yes | collection, page params undeclared |  |
| `POST` | `/media/v1/media-series` | `CreateMediaSeries` | `subsplash-media` | yes |  | application/json |
| `GET` | `/media/v1/media-series/{id}` | `GetOneMediaSeries` | `subsplash-media` | yes |  |  |
| `PATCH` | `/media/v1/media-series/{id}` | `UpdateMediaSeries` | `subsplash-media` | yes |  | application/json |
| `DELETE` | `/media/v1/media-series/{id}` | `DeleteMediaSeries` | `subsplash-media` | yes |  |  |
| `GET` | `/pages/v1/links` | `GetAllLinks` | `subsplash-pages` | yes | page[number], page[size] |  |
| `POST` | `/pages/v1/links` | `CreateLink` | `subsplash-pages` | yes |  | application/json |
| `GET` | `/pages/v1/links/{id}` | `GetOneLink` | `subsplash-pages` | yes |  |  |
| `PATCH` | `/pages/v1/links/{id}` | `UpdateLink` | `subsplash-pages` | yes |  | application/json |
| `DELETE` | `/pages/v1/links/{id}` | `DeleteLink` | `subsplash-pages` | yes |  |  |
| `GET` | `/instruments` | `ListInstruments` | `subsplash-payments` | yes | page[number], page[size] |  |
| `GET` | `/instruments/{id}` | `GetOneInstrument` | `subsplash-payments` | yes |  |  |
| `POST` | `/payment-intents` | `CreatePaymentIntent` | `subsplash-payments` | yes |  | application/json |
| `POST` | `/payment-intents/{id}/capture` | `CapturePaymentIntent` | `subsplash-payments` | yes |  |  |
| `GET` | `/payments` | `ListPayments` | `subsplash-payments` | yes | page[number], page[size] |  |
| `GET` | `/payments/{id}` | `GetOnePayment` | `subsplash-payments` | yes |  |  |
| `GET` | `/refunds` | `ListRefunds` | `subsplash-payments` | yes | page[number], page[size] |  |
| `GET` | `/refunds/{id}` | `GetOneRefund` | `subsplash-payments` | yes |  |  |
| `POST` | `/setup-intents` | `CreateSetupIntent` | `subsplash-payments` | yes |  | application/json |
| `GET` | `/people/v1/custom-field-definitions` | `ListCustomFieldDefinitions` | `subsplash-people` | yes | page[number], page[size] |  |
| `POST` | `/people/v1/custom-field-definitions` | `CreateCustomFieldDefinition` | `subsplash-people` | yes |  | application/json |
| `GET` | `/people/v1/custom-field-definitions/{id}` | `GetOneCustomFieldDefinition` | `subsplash-people` | yes |  |  |
| `PATCH` | `/people/v1/custom-field-definitions/{id}` | `UpdateCustomFieldDefinition` | `subsplash-people` | yes |  | application/json |
| `GET` | `/people/v1/households` | `ListHouseholds` | `subsplash-people` | yes | page[number], page[size] |  |
| `POST` | `/people/v1/households` | `CreateHousehold` | `subsplash-people` | yes |  | application/json |
| `GET` | `/people/v1/households/{id}` | `GetOneHousehold` | `subsplash-people` | yes |  |  |
| `PATCH` | `/people/v1/households/{id}` | `UpdateHousehold` | `subsplash-people` | yes |  | application/json |
| `DELETE` | `/people/v1/households/{id}` | `DeleteHousehold` | `subsplash-people` | yes |  |  |
| `GET` | `/people/v1/membership-status-changes` | `ListMembershipStatusChanges` | `subsplash-people` | yes | page[number], page[size] |  |
| `POST` | `/people/v1/membership-status-changes` | `CreateMembershipStatusChange` | `subsplash-people` | yes |  | application/json |
| `GET` | `/people/v1/membership-status-changes/{id}` | `GetOneMembershipStatusChange` | `subsplash-people` | yes |  |  |
| `PATCH` | `/people/v1/membership-status-changes/{id}` | `UpdateMembershipStatusChange` | `subsplash-people` | yes |  | application/json |
| `DELETE` | `/people/v1/membership-status-changes/{id}` | `DeleteMembershipStatusChange` | `subsplash-people` | yes |  |  |
| `GET` | `/people/v1/profiles` | `ListProfiles` | `subsplash-people` | yes | page[number], page[size] |  |
| `POST` | `/people/v1/profiles` | `CreateProfile` | `subsplash-people` | yes |  | application/json |
| `GET` | `/people/v1/profiles/{id}` | `GetOneProfile` | `subsplash-people` | yes |  |  |
| `PATCH` | `/people/v1/profiles/{id}` | `UpdateProfile` | `subsplash-people` | yes |  | application/json |
| `POST` | `/bulk-topic-subscriptions` | `CreateBulkTopicSubscription` | `subsplash-push` | yes |  | application/hal+json |
| `GET` | `/notifications` | `GetAllNotifications` | `subsplash-push` | yes | page[number], page[size] |  |
| `POST` | `/notifications` | `CreateNotification` | `subsplash-push` | yes |  | application/hal+json |
| `GET` | `/notifications/{id}` | `GetOneNotification` | `subsplash-push` | yes |  |  |
| `PATCH` | `/notifications/{id}` | `UpdateNotification` | `subsplash-push` | yes |  | application/hal+json |
| `DELETE` | `/notifications/{id}` | `DeleteNotification` | `subsplash-push` | yes |  |  |
| `GET` | `/topic-subscriptions` | `GetAllTopicSubscriptions` | `subsplash-push` | yes | page[number], page[size] |  |
| `GET` | `/topic-subscriptions/{id}` | `GetOneTopicSubscription` | `subsplash-push` | yes |  |  |
| `GET` | `/topics` | `GetAllTopics` | `subsplash-push` | yes | page[number], page[size] |  |
| `POST` | `/topics` | `CreateTopic` | `subsplash-push` | yes |  | application/hal+json |
| `GET` | `/topics/{id}` | `GetOneTopic` | `subsplash-push` | yes |  |  |
| `PATCH` | `/topics/{id}` | `UpdateTopic` | `subsplash-push` | yes |  | application/hal+json |
| `DELETE` | `/topics/{id}` | `DeleteTopics` | `subsplash-push` | yes |  |  |
| `GET` | `/tokens/v1/keys` | `GetAllPublicKeys` | `subsplash-tokens` | no | collection, page params undeclared |  |
| `GET` | `/tokens/v1/keys/{id}` | `GetOnePublicKey` | `subsplash-tokens` | no |  |  |
| `POST` | `/tokens/v1/token` | `CreateToken` | `subsplash-tokens` | no |  | application/x-www-form-urlencoded |
| `OPTIONS` | `/tokens/v1/token` | `OptionsToken` | `subsplash-tokens` | no |  |  |
| `GET` | `/webhooks/v1/send-attempts` | `ListSendAttempts` | `subsplash-webhooks` | yes | collection, page params undeclared |  |
| `GET` | `/webhooks/v1/webhooks` | `ListWebhooks` | `subsplash-webhooks` | yes | collection, page params undeclared |  |
| `POST` | `/webhooks/v1/webhooks` | `CreateWebhook` | `subsplash-webhooks` | yes |  | application/json |
| `GET` | `/webhooks/v1/webhooks/{id}` | `GetOneWebhook` | `subsplash-webhooks` | yes |  |  |
| `PATCH` | `/webhooks/v1/webhooks/{id}` | `UpdateWebhook` | `subsplash-webhooks` | yes |  | application/json |
| `DELETE` | `/webhooks/v1/webhooks/{id}` | `DeleteWebhook` | `subsplash-webhooks` | yes |  |  |
| `POST` | `/webhooks/v1/webhooks/{id}/rotate-secret` | `RotateWebhookSecret` | `subsplash-webhooks` | yes |  | application/json |
<!-- GENERATED:COVERAGE:END -->

## Gaps and ambiguous spots

These are limits of the published spec, not missing nodes. The request node can still call a path if you have one.

- `OPTIONS /tokens/v1/token` (`OptionsToken`) is a CORS preflight. It is wired so the path is reachable. Flows do not need it.
- Many list operations (builder lists, events, groups, media series, webhooks, and others) do not declare `filter`, `sort`, `include`, or `page` parameters, while the platform guides say collections support them. The nodes send those parameters only when you set them. An undeclared filter can still 400.
- `ListBroadcasts` documents `page[size]` but not `page[number]`. Fetch-all follows `_links.next` and does not synthesize page numbers.
- No request-per-minute figure is published. Backoff follows 429 and `Retry-After` only.
- `GET /donations/v1/recurring-donations/{id}` documents a `filter[status]` query parameter, which is unusual on a get-by-id call. It is passed through when you set it.
- Profiles, campaigns, donations, pledges, forms, responses, broadcasts, instruments, payments, and refunds do not have delete operations in the spec. Funds have no delete. Topic subscriptions have list, get, and bulk create, not a single-resource create or delete. The nodes do not invent those calls.
- `GetOneCampaignContributions` is `GET /donations/v1/campaigns/{id}/contributions`.
- `CapturePaymentIntent` is `POST /payment-intents/{id}/capture`.
- Notification, topic, and bulk-subscription bodies are `application/hal+json`. The token body is `application/x-www-form-urlencoded`. Other writes are `application/json`.
- Some `Collection-Total` parameters list only `include` in the schema enum. The pagination guide also describes `omit`. The node will send either when you ask it to.
- Webhook signature verification depends on the raw body. The sample in the spec looks inconsistent; see the Webhooks section above.
- The developer site at `https://developer.subsplash.com/docs/restapi/` redirects to an access form. The machine-readable spec used here is public. Field-level prose that never made it into the spec is not repeated.

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

Publishing steps are in [PUBLISHING.md](PUBLISHING.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
