# Deploying

## Sub-features
- Creates or updates: S3 bucket `skill-relay-<account>` (public access blocked), IAM role `skill-relay-lambda` (S3 get/put on `tenants/*`, ListBucket on the `tenants/` prefix), Lambda `skill-relay` (nodejs22.x, 512 MB, 10 s), public Function URL
- Prints the Function URL; safe to rerun

## How to get to it (user POV)
`./deploy.sh` from the repo root with an AWS session (`aws sts get-caller-identity` works).

## Driving it with verify.sh
`./deploy.sh`, then `$V doctor`: `LastModified` should move to now and the landing page return 200. Then a full `up`/`push`/`call` pass against the new code.

## Gotchas
- Without `s3:ListBucket`, a missing bundle reads as AccessDenied and every MCP call to a new tenant 500s. The policy grants it on purpose.
- Deploying replaces production for every user. Only deploy changes you mean to ship.
- Account verification once blocked Bedrock on this account; Skill Relay doesn't use Bedrock.
