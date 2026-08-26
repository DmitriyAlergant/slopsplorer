# Terraform accepts hash, slash, and block comments.
terraform {
  required_version = ">= 1.5"
}

// A slash comment.
resource "aws_s3_bucket" "artifacts" {
  bucket = "corpus-artifacts"   # trailing

  /* A block comment
     over two lines. */
  force_destroy = false
}
