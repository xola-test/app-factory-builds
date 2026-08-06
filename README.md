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
npm run build                         (target's own build)
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

The three checks are plain Node scripts, runnable locally:

```sh
node scripts/validate-manifest.mjs <repo>/xola-embedded-app.json --app-id <id> [--registry-url <elrond>]
node scripts/check-budgets.mjs <repo>/dist --report size-report.json
node scripts/finalize-bundle.mjs <repo>/dist --git-sha <sha> --pipeline <runUrl>
```

`schema/xola-embedded-app.schema.json` is vendored from
`docs/contracts/`; the shared validation library (CONTRACT-DECISIONS M8 open
item) replaces it when it exists.
