# WC-1: artifact store and CDN for embedded-app bundles.
# One environment per workspace/tfvars: bucket, two CloudFront distributions
# (release and preview), the Phase 1 CSP pinned as response headers, and the
# GitHub OIDC upload role for the central pipeline.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# CloudFront requires ACM certificates and key groups in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  bucket_name = "xola-embedded-apps-${var.env}"

  # Phase 1 section 1.4 CSP, parameterized per environment. Pinned at the
  # CDN so every bundle serves with it regardless of bundle contents.
  csp = join("; ", [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' ${var.api_origin}",
    "frame-ancestors ${join(" ", var.frame_ancestors)}",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ])
}
