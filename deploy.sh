#!/usr/bin/env bash
# Creates or updates every AWS resource Skill Relay needs. Safe to rerun.
# ListBucket is granted so a missing bundle reads as NoSuchKey, not AccessDenied.
set -euo pipefail
cd "$(dirname "$0")"

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="skill-relay-$ACCOUNT"
ROLE="skill-relay-lambda"
FN="skill-relay"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name bundle-access --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/tenants/*\"},{\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",\"Resource\":\"arn:aws:s3:::$BUCKET\",\"Condition\":{\"StringLike\":{\"s3:prefix\":\"tenants/*\"}}}]}"
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"

ZIP="$(mktemp -d)/fn.zip"
(cd lambda && zip -q "$ZIP" index.mjs)

if aws lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated --function-name "$FN"
  aws lambda update-function-configuration --function-name "$FN" --environment "Variables={BUCKET=$BUCKET}" >/dev/null
else
  aws lambda create-function --function-name "$FN" --runtime nodejs22.x --handler index.handler \
    --role "$ROLE_ARN" --zip-file "fileb://$ZIP" --timeout 10 --memory-size 512 \
    --environment "Variables={BUCKET=$BUCKET}" >/dev/null
fi
aws lambda wait function-updated --function-name "$FN"

if ! aws lambda get-function-url-config --function-name "$FN" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FN" --auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FN" --statement-id public-url \
    --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FN" --statement-id public-invoke \
    --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
fi

aws lambda get-function-url-config --function-name "$FN" --query FunctionUrl --output text
