# Publishing

Do not publish from a machine that does not have your npm account. This file is the checklist. The package is already laid out for the [Node-RED Flow Library](https://flows.nodered.org/).

The npm name is `@brettgoodrich/node-red-subsplash`. Node-RED reserves the unscoped `node-red-` prefix, so the package is scoped to the npm user `brettgoodrich`. That scope also satisfies the Flow Library scorecard rule for packages first published after 31 January 2022. `publishConfig.access` is `public`, which scoped packages need. Node type ids stay `subsplash-*`. The palette category is **Subsplash**.

Repository, homepage, and bugs already point at `https://github.com/brettgoodrich/node-red-subsplash`. Confirm the scoped name is still free on npm before the first publish (a 404 from the registry means it is unpublished). Do not publish under `@subsplash/...` unless you control that organization.

## Before the first publish

1. Sign in as the npm user `brettgoodrich`.
2. From a clean checkout:

   ```bash
   npm install
   npm test
   npm run lint
   npm pack --dry-run
   ```

   The tarball should contain `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `PUBLISHING.md`, `lib/`, `nodes/` (including `nodes/icons/subsplash.svg` and `nodes/subsplash.html`), `examples/`, and the catalog generator. It should not contain `node_modules/`, tests, or the OpenAPI download.

3. Optional local scorecard, if you install the tool:

   ```bash
   npx --yes node-red-dev validate .
   ```

   Fix anything it reports before you publish. The `node-red` keyword is intentional; Node-RED asks you to add it only once the node is documented and working, which this package is.

## npm

```bash
npm login
npm publish
```

If the package is scoped and you did not leave `publishConfig.access` set:

```bash
npm publish --access public
```

Check `https://www.npmjs.com/package/@brettgoodrich/node-red-subsplash`. Install it into a throwaway Node-RED user directory and confirm the palette lists the Subsplash nodes:

```bash
mkdir -p /tmp/nodered-user && cd /tmp/nodered-user
npm init -y
npm install @brettgoodrich/node-red-subsplash
node-red --userDir /tmp/nodered-user
```

The log should start without errors from this module. The editor's palette should show the Subsplash category.

## Flow Library

The library no longer indexes npm on its own.

1. Sign in at [flows.nodered.org](https://flows.nodered.org/). The account is the Node-RED forum / Flow Library account.
2. Open **Add** (+) and choose **node**, or go to [flows.nodered.org/add/node](https://flows.nodered.org/add/node).
3. Submit `@brettgoodrich/node-red-subsplash`.
4. Wait for the library to fetch the npm metadata. The page then shows the README, the nodes, and a scorecard.
5. Open the scorecard. Typical checks this package is built for:
   - `README.md` describing install and use
   - `package.json` `node-red.nodes` pointing at `nodes/subsplash.js`
   - `node-red` in `keywords`
   - `node-red.version` (`>=3.0.0`) and `engines.node` (`>=18`)
   - `LICENSE` (Apache-2.0)
   - repository URL
   - HTML help for every node, including the config node
   - example flows under `examples/`
6. The package is already scoped, so the unscoped-name deduction should not apply.

## Later releases

1. Update the changelog.
2. Bump `version` in `package.json` (semver).
3. If the Subsplash spec changed, download the new `openapi.yaml` and run `SUBSPLASH_OPENAPI=./openapi.yaml npm run generate`. Review the diff. Do not commit the vendor spec unless you have the rights to redistribute it; the generator only needs it locally.
4. `npm test` and `npm run lint`.
5. `npm publish`.
6. On the package's Flow Library page, use **request refresh** (visible when you are logged in). You can also submit the package again through the add-node form.

## What not to do

- Do not commit real client secrets, access tokens, or `flows_cred.json`.
- Do not add the `node-red` keyword to a fork that does not run.
- Do not publish under the `@subsplash` scope unless Subsplash has given you that organization.
