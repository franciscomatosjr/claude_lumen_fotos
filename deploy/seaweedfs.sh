#!/bin/sh
# Writes the S3 identity from environment variables, then starts SeaweedFS with its S3 gateway.
set -eu
cat > /tmp/s3.json <<JSON
{"identities":[{"name":"lumen","credentials":[{"accessKey":"$S3_ACCESS_KEY","secretKey":"$S3_SECRET_KEY"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
exec weed server -dir=/data -s3 -s3.port=8333 -s3.config=/tmp/s3.json -volume.max=0
