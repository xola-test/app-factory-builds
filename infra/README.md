# Artifact store infrastructure (WC-1)

Terraform for one environment of the embedded-apps artifact store: the S3
bucket, the release and preview CloudFront distributions with the Phase 1 CSP
pinned as response headers, the preview signed-cookie key group (W0-7), and
the GitHub OIDC upload role for the pipeline.

## Layout produced

```
s3://xola-embedded-apps-<env>/<appId>/<bundleSha256>/...      release bundles
s3://xola-embedded-apps-<env>/preview/<appId>/<gitSha>/...    preview bundles (14-day lifecycle expiry)

release distribution  -> bucket root      (embeddedapps.<env>.xola.app)
preview distribution  -> /preview prefix  (preview.embeddedapps.<env>.xola.app)
```

Reads go only through CloudFront (Origin Access Control); writes go only
through the pipeline role (`AssumeRoleWithWebIdentity`, trust limited to
`repo:<pipeline_repo>:*`).

## Credentials

Terraform needs AWS credentials. The pipeline does not.

**The pipeline has no AWS keys and must not be given any.** It authenticates
with GitHub OIDC: the workflow assumes `AWS_UPLOAD_ROLE_ARN` and receives
credentials that expire in an hour and are pinned to this repository (see
`iam.tf`). The three AWS entries in the repository's Actions settings are
**variables**, not secrets: `AWS_UPLOAD_ROLE_ARN`, `AWS_REGION`, and
`ARTIFACT_BUCKET`. None is a credential. The only Actions secret is
`APP_FACTORY_PRIVATE_KEY`, which is the GitHub App key. Putting a long-lived
access key in Actions would replace short-lived scoped credentials with a
permanent one that can write the artifact bucket, which is the failure this
design exists to prevent.

An access key is for an operator's own machine, for two jobs: running
`terraform apply`, and reading objects from the bucket directly to verify a
published bundle at the origin (`scripts/verify-bundle.mjs` reads a CDN copy,
which can be stale; see WC-9). Put it in `~/.aws/credentials`:

```ini
[xola-embedded-apps]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

Then `export AWS_PROFILE=xola-embedded-apps` before running Terraform.

With the profile set, verify a published bundle against the origin rather than
the CDN. A CDN read can return a stale variant and report a mismatch that does
not exist in the bucket (WC-9):

```sh
aws s3 sync s3://xola-embedded-apps-<env>/<appId>/<bundleSha256>/ ./bundle-check
node ../scripts/verify-bundle.mjs ./bundle-check --expect-sha <bundleSha256>
```

Such a key can read and write the whole bucket, so treat it as a local admin
credential. Never commit it, never put it in `environments/*.tfvars` (those
are tracked, and this repo is public), and delete keys that are no longer in
use rather than leaving them disabled.

No Xola service needs AWS credentials at run time. The app-factory service
signs preview cookies with the CloudFront private key, which is a separate
secret held under `infra/secrets/` and gitignored.

## Apply

```sh
cd infra
terraform init
terraform apply -var-file=environments/<env>.tfvars
```

Then copy the `workflow_variables` output into the pipeline repo's Actions
variables (`AWS_UPLOAD_ROLE_ARN`, `AWS_REGION`, `ARTIFACT_BUCKET`); the
upload step activates on the next run.

## Notes

- **Per-app scoping**: OIDC claims do not carry the app id, so the upload
  role scopes to the bucket, not per-app prefixes. Per-app isolation comes
  from the pipeline being the only writer (see iam.tf).
- **Preview access (W0-7)**: provide `preview_public_key_pem` to require
  CloudFront signed cookies on the preview distribution. Omitting it leaves
  preview open and prints a warning output; only acceptable for a throwaway
  test environment. Cookies are minted by the app-factory service at
  `GET /v1/apps/:appId/preview-access`, which authorizes through the app
  linkage first.

  Generate the pair, keep the private half for that service, and put only the
  public half here:

  ```sh
  openssl genrsa -out preview-signer.pem 2048
  openssl rsa -pubout -in preview-signer.pem -out preview-signer.pub
  ```

  Verified live in the sandbox account (2026-08-07): with the key group
  attached, a preview URL returns 403 with no cookies, 200 with cookies
  minted for that app, and 403 with cookies minted for a different app. That
  last case is the point: a cookie cannot read another app's preview.
- **Custom domains**: set `release_aliases`/`preview_aliases` plus
  `acm_certificate_arn` (us-east-1). Without them the distributions serve on
  default cloudfront.net domains, which is enough for pipeline testing.
- **Retention**: release bundles are never lifecycle-expired (unpublish is
  not delete, PHASE-3 section 3.3). Versioning is on to protect immutable
  content paths from accidental overwrite.
- The per-app-subdomain hardening question (PHASE-3 section 3.14) is not
  addressed here; it changes the distribution layout when decided.
