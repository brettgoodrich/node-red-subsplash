# Changelog

## 0.1.0 - 2026-10-23

First release of `@brettgoodrich/node-red-subsplash`. Node type ids are `subsplash-*`. The palette category is Subsplash.

- Config node for Subsplash client credentials, in-memory token cache, refresh, and one retry after HTTP 401.
- Resource nodes for every operation in the Subsplash OpenAPI 1.0.0 document (126 operations, 71 paths): builder, donations, events, forms, groups, live, media, pages, payments, people, push, tokens, and webhooks.
- Generic request node for any path on the configured host.
- Editor values with message overrides, filter encoding, sparse fieldsets, single-page and fetch-all pagination, and 429 backoff that honors `Retry-After`.
- Help text for every node and operation, example flows, and a coverage table in the README.
