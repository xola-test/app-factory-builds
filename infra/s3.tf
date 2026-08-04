resource "aws_s3_bucket" "artifacts" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    # Release bundles are immutable and retained (PHASE-3 section 3.3);
    # versioning protects against accidental overwrite of a content path.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  # The storage-side backstop for preview expiry (W0-7). The registry's
  # expiresAt and the WA-2 sweep are the system of record; this rule cleans
  # the objects themselves.
  rule {
    id     = "expire-preview"
    status = "Enabled"
    filter {
      prefix = "preview/"
    }
    expiration {
      days = var.preview_ttl_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
}

# Only CloudFront (via OAC) may read; only the pipeline role may write.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values = [
        aws_cloudfront_distribution.release.arn,
        aws_cloudfront_distribution.preview.arn,
      ]
    }
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = data.aws_iam_policy_document.bucket.json
}
