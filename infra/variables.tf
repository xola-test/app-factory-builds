variable "env" {
  description = "Environment name (test, sandbox, staging, prod). Becomes part of the bucket name."
  type        = string
}

variable "region" {
  description = "AWS region for the bucket."
  type        = string
  default     = "us-east-1"
}

variable "api_origin" {
  description = "Xola API origin for the CSP connect-src (for example https://api.xola.app)."
  type        = string
}

variable "frame_ancestors" {
  description = "Origins allowed to embed the bundles (the Seller app), for the CSP frame-ancestors."
  type        = list(string)
}

variable "pipeline_repo" {
  description = "GitHub org/repo of the central pipeline allowed to upload (for example xola/app-factory-builds)."
  type        = string
}

variable "preview_ttl_days" {
  description = "Days before preview-channel objects expire (W0-7)."
  type        = number
  default     = 14
}

variable "release_aliases" {
  description = "Custom domain aliases for the release distribution (for example embeddedapps.xola.app). Empty for the default CloudFront domain."
  type        = list(string)
  default     = []
}

variable "preview_aliases" {
  description = "Custom domain aliases for the preview distribution. Empty for the default CloudFront domain."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ACM certificate (us-east-1) covering the aliases. Required when aliases are set."
  type        = string
  default     = null
}

variable "preview_public_key_pem" {
  description = "Public key PEM for CloudFront signed cookies on the preview distribution (W0-7). When null, preview is served WITHOUT access control; acceptable only for a throwaway test environment."
  type        = string
  default     = null
}

variable "existing_oidc_provider_arn" {
  description = "ARN of an existing GitHub OIDC provider in the account. When null, one is created."
  type        = string
  default     = null
}
