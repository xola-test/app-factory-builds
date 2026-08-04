resource "aws_cloudfront_origin_access_control" "artifacts" {
  name                              = "embedded-apps-${var.env}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "csp" {
  name = "embedded-apps-csp-${var.env}"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.csp
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      # frame-ancestors in the CSP is the real control; DENY here would
      # block the Seller app iframes. SAMEORIGIN is ignored by modern
      # browsers when frame-ancestors is present.
      frame_option = "SAMEORIGIN"
      override     = false
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      override                   = true
    }
  }
}

# Bundles are content-addressed, so everything is immutable-cacheable.
resource "aws_cloudfront_cache_policy" "immutable" {
  name        = "embedded-apps-immutable-${var.env}"
  default_ttl = 86400
  max_ttl     = 31536000
  min_ttl     = 3600

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# Signed-cookie key group for preview access (W0-7). Optional so a throwaway
# test environment can skip key management; the output below warns when the
# preview distribution is left open.
resource "aws_cloudfront_public_key" "preview" {
  count       = var.preview_public_key_pem == null ? 0 : 1
  name        = "embedded-apps-preview-${var.env}"
  encoded_key = var.preview_public_key_pem
  comment     = "Preview signed-cookie key (W0-7)"
}

resource "aws_cloudfront_key_group" "preview" {
  count = var.preview_public_key_pem == null ? 0 : 1
  name  = "embedded-apps-preview-${var.env}"
  items = [aws_cloudfront_public_key.preview[0].id]
}

resource "aws_cloudfront_distribution" "release" {
  enabled         = true
  comment         = "Embedded app bundles (release, ${var.env})"
  is_ipv6_enabled = true
  aliases         = var.release_aliases

  origin {
    domain_name              = aws_s3_bucket.artifacts.bucket_regional_domain_name
    origin_id                = "artifacts"
    origin_access_control_id = aws_cloudfront_origin_access_control.artifacts.id
  }

  default_cache_behavior {
    target_origin_id           = "artifacts"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.csp.id
    compress                   = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.release_aliases) == 0
    acm_certificate_arn            = length(var.release_aliases) == 0 ? null : var.acm_certificate_arn
    ssl_support_method             = length(var.release_aliases) == 0 ? null : "sni-only"
    minimum_protocol_version       = length(var.release_aliases) == 0 ? "TLSv1" : "TLSv1.2_2021"
  }
}

resource "aws_cloudfront_distribution" "preview" {
  enabled         = true
  comment         = "Embedded app bundles (preview, ${var.env})"
  is_ipv6_enabled = true
  aliases         = var.preview_aliases

  origin {
    domain_name              = aws_s3_bucket.artifacts.bucket_regional_domain_name
    origin_id                = "artifacts"
    origin_path              = "/preview"
    origin_access_control_id = aws_cloudfront_origin_access_control.artifacts.id
  }

  default_cache_behavior {
    target_origin_id           = "artifacts"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = aws_cloudfront_cache_policy.immutable.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.csp.id
    compress                   = true
    trusted_key_groups         = var.preview_public_key_pem == null ? [] : [aws_cloudfront_key_group.preview[0].id]
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.preview_aliases) == 0
    acm_certificate_arn            = length(var.preview_aliases) == 0 ? null : var.acm_certificate_arn
    ssl_support_method             = length(var.preview_aliases) == 0 ? null : "sni-only"
    minimum_protocol_version       = length(var.preview_aliases) == 0 ? "TLSv1" : "TLSv1.2_2021"
  }
}
