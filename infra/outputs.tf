# The three values the build workflow reads as repository variables.
output "workflow_variables" {
  value = {
    AWS_UPLOAD_ROLE_ARN = aws_iam_role.pipeline_upload.arn
    AWS_REGION          = var.region
    ARTIFACT_BUCKET     = aws_s3_bucket.artifacts.bucket
  }
}

output "release_domain" {
  value = length(var.release_aliases) > 0 ? var.release_aliases[0] : aws_cloudfront_distribution.release.domain_name
}

output "preview_domain" {
  value = length(var.preview_aliases) > 0 ? var.preview_aliases[0] : aws_cloudfront_distribution.preview.domain_name
}

output "preview_access_warning" {
  value = var.preview_public_key_pem == null ? "WARNING: no preview_public_key_pem; the preview distribution has NO access control. Acceptable only for a throwaway test environment." : "Preview requires signed cookies (key group attached)."
}

output "preview_key_group_id" {
  value = var.preview_public_key_pem == null ? null : aws_cloudfront_key_group.preview[0].id
}
