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
  test environment. The cookie-minting endpoint is WC-7.
- **Custom domains**: set `release_aliases`/`preview_aliases` plus
  `acm_certificate_arn` (us-east-1). Without them the distributions serve on
  default cloudfront.net domains, which is enough for pipeline testing.
- **Retention**: release bundles are never lifecycle-expired (unpublish is
  not delete, PHASE-3 section 3.3). Versioning is on to protect immutable
  content paths from accidental overwrite.
- The per-app-subdomain hardening question (PHASE-3 section 3.14) is not
  addressed here; it changes the distribution layout when decided.
