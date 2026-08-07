# app-factory-builds

The central build pipeline for Xola embedded apps (PHASE-3 WC-2). Only this
pipeline produces publishable or previewable artifacts; author-controlled CI
is never trusted or ingested. See `docs/PHASE-3.md` section 3.2 in the
devappcenter workspace for the design and `W0-DECISIONS.md` for W0-5 (the
OIDC callback decision).

## What one run does

```
mint installation token (GitHub App) -> checkout target repo@sha read-only
npm ci --ignore-scripts               (lifecycle scripts disabled, both repos)
validate authored manifest            (vendored schema + registry cross-check)
build                                 (Mode A: target's own build;
                                       Mode B: the pipeline's wrapper)
verify dist/index.html + dist/xola-embedded-app.json
enforce size budgets                  (per canvas type, warn + hard tiers)
security scan                         (semgrep + dependency advisories)
finalize bundle                       (bundleSha256, checksums.json, stamped manifest)
upload to S3                          (skipped until the WC-1 role is configured)
report to elrond                      (OIDC token; skipped without buildId/callbackUrl)
```

The hash rule: `bundleSha256` is computed over the dist tree before the
`build` block is stamped into the manifest copy, because a hash cannot cover
a file that contains the hash. `checksums.json` covers every final file,
including the stamped manifest. The registry's copy of the manifest is
canonical.

## Build modes (WC-8)

PHASE-3 section 3.2 defines two source modes:

- **Mode A, bring-your-own-static.** The author's own build writes
  `dist/index.html`, the assets, and the manifest. The pipeline runs
  `npm run build` in the target repo. This is the default and the flexible
  path.
- **Mode B, Xola module app.** The author writes one module that exports
  `mount(el, xola)` and, optionally, `unmount()`. There is no HTML file and
  no build config in the target repo.

**What marks an app as Mode B:** the `moduleEntry` property in
`xola-embedded-app.json`, for example `"moduleEntry": "src/app.js"`. Its
presence is the only signal (CONTRACT-DECISIONS M11). `entry` then names the
generated `index.html`.

**What the wrapper generates** (`scripts/build-module-app.mjs`), into
`.xola-build/` inside the target repo:

- `index.html`: the iframe entrypoint, with a `<div id="root">`.
- `bootstrap.js`: it creates the SDK with the manifest's `apiVersion`, calls
  `mount(root, xola)`, and registers `unmount()` on `pagehide` when the
  module exports one. If `mount` is not a function, it shows a readable
  error in the iframe and throws. That check is at runtime because a module's
  exports cannot be checked before the module runs.

It then builds with a pipeline-provided vite config (`base: "./"`, because
bundles are served from a hashed CDN subpath and absolute asset paths would
404) and copies the manifest into `dist/`. vite is a dependency of this repo,
so a Mode B target repo needs no build tooling. The SDK is not: the target
must declare `@xola/embedded-app-sdk` itself, because the generated bootstrap
imports it and it resolves from the target's own `node_modules`.

**Both modes converge on one artifact shape:** `dist/index.html` + hashed
assets + `dist/xola-embedded-app.json`. Every pipeline step after the build
(bundle contract, budgets, scan, hash, upload, callback) is mode-blind.

`fixtures/module-app/` is a Mode B sample used to run the wrapper locally:

```sh
cd fixtures/module-app && npm install --ignore-scripts && cd -
node scripts/build-module-app.mjs fixtures/module-app
node scripts/check-budgets.mjs fixtures/module-app/dist
node scripts/finalize-bundle.mjs fixtures/module-app/dist --git-sha <sha> --pipeline local
```

## Setup (per environment)

Repo secret:

- `APP_FACTORY_PRIVATE_KEY`: the App's private key PEM. The App must be
  installed on every source org the pipeline builds from.

Repo variables:

- `APP_FACTORY_APP_ID`: the GitHub App id (public information, so a
  variable, not a secret).

Repo variables (all optional until their infrastructure exists):

- `AWS_UPLOAD_ROLE_ARN`, `AWS_REGION`, `ARTIFACT_BUCKET`: enables the S3
  upload step (WC-1).
- Workflow env `ELROND_OIDC_AUDIENCE` must match elrond's `ci.audience`
  config; elrond also pins `ci.pipelineRepo` to this repo's full name.

## Dry runs

Dispatch with `buildId` and `callbackUrl` empty: the run builds, validates,
budgets, and hashes, then skips upload and callback. This works with no AWS
and no elrond, so the pipeline is testable from day one:

```sh
gh workflow run build.yml -R <org>/app-factory-builds \
  -f appId=com.example.my-app -f org=<org> -f repo=<app-repo> \
  -f gitSha=<sha> -f channel=preview
```

## Security scanning (WC-5)

`scripts/scan.mjs` runs static analysis and dependency advisories, then writes
one normalized `scanReport` that the registry Build record stores and the
reviewer UI renders.

What blocks a build:

- any ERROR-severity static finding
- a high or critical advisory in a **production** dependency, because those
  ship inside the bundle

What warns without blocking: everything else, including advisories in
build-only dependencies. Those do not reach a seller's browser, but a
compromised build-time package is still worth surfacing.

The rules in `semgrep/xola-embedded-app.yml` are the ones that exist because of
how embedded apps are hosted, rather than generic JavaScript hygiene (which the
registry rulesets cover): no tokens in browser storage (every app shares one
origin until per-app subdomains ship), no wildcard `postMessage` target origin,
no `eval` or runtime script injection, and warnings for external network calls
the bundle CSP would block anyway.

Socket.dev is wired but inert: it runs only where `SOCKET_SECURITY_API_KEY` is
configured, and reports itself as skipped everywhere else.

Run it locally against any app repo:

```sh
node scripts/scan.mjs ../path/to/app --out scan-report.json
```

Without semgrep installed it reports that scanner as skipped rather than
passing silently.

## Scripts

The build steps and checks are plain Node scripts, runnable locally:

```sh
node scripts/validate-manifest.mjs <repo>/xola-embedded-app.json --app-id <id> [--registry-url <elrond>]
node scripts/build-module-app.mjs <repo>            # Mode B only; exits 0 with a note for Mode A
node scripts/check-budgets.mjs <repo>/dist --report size-report.json
node scripts/finalize-bundle.mjs <repo>/dist --git-sha <sha> --pipeline <runUrl>
```

`schema/xola-embedded-app.schema.json` is vendored from
`docs/contracts/`; the shared validation library (CONTRACT-DECISIONS M8 open
item) replaces it when it exists.
