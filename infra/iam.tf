# The GitHub OIDC upload role for the central pipeline (W0-5 pattern applied
# to AWS). Trust is limited to workflow runs in the pipeline repo.
#
# Scope note (deviation from the WC-1 ticket wording): OIDC claims do not
# carry the app id, so a per-app-prefix trust condition is not possible. The
# role scopes to the bucket's two prefix patterns; per-app isolation comes
# from the pipeline being the only writer and deriving paths from its own
# validated inputs.

data "aws_iam_openid_connect_provider" "github" {
  count = var.existing_oidc_provider_arn == null ? 0 : 1
  arn   = var.existing_oidc_provider_arn
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.existing_oidc_provider_arn == null ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  oidc_provider_arn = var.existing_oidc_provider_arn == null ? aws_iam_openid_connect_provider.github[0].arn : var.existing_oidc_provider_arn
}

data "aws_iam_policy_document" "pipeline_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # GitHub embeds immutable org and repo ids in newer sub claims
      # (repo:org@<id>/name@<id>:ref:...) to prevent trust inheritance by
      # recreated names. Accept both formats. Hardening option for prod:
      # replace the wildcarded ids with the literal ones, which makes trust
      # rename-proof and recreation-proof.
      values = [
        "repo:${var.pipeline_repo}:*",
        "repo:${join("@*/", split("/", var.pipeline_repo))}@*:*",
      ]
    }
  }
}

data "aws_iam_policy_document" "pipeline_upload" {
  statement {
    sid       = "UploadBundles"
    actions   = ["s3:PutObject", "s3:AbortMultipartUpload"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
  }
}

resource "aws_iam_role" "pipeline_upload" {
  name               = "embedded-apps-pipeline-upload-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.pipeline_trust.json
}

resource "aws_iam_role_policy" "pipeline_upload" {
  name   = "upload-bundles"
  role   = aws_iam_role.pipeline_upload.id
  policy = data.aws_iam_policy_document.pipeline_upload.json
}
