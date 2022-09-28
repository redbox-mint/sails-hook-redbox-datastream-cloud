#! /bin/sh
RUN_ENV="$1"
BASE_DIR="/opt/sails-hook-redbox-datastream-cloud/support/"
ATTACH_DIR="${BASE_DIR}${RUN_ENV}/.dev/minio-data/${HOOK_S3_BUCKET}"
if [ ! -d "${ATTACH_DIR}" ]; then 
  # install
  wget -O /tmp/mc https://dl.min.io/client/mc/release/linux-amd64/mc
  chmod +x /tmp/mc
  # Configure
  /tmp/mc alias set local http://minio:9000 minioadmin minioadmin
  /tmp/mc mb local/$HOOK_S3_BUCKET
else 
  echo "Attachments Bucket exists, skipping creation."
fi
CREDS_DIR=/home/node/.aws
CREDS_FILE="${CREDS_DIR}/credentials"
if [ ! -f "${CREDS_FILE}" ]; then 
  echo "Creating credentials file..."
  mkdir -p "${CREDS_DIR}"
  cat > $CREDS_FILE<<EOF
[default]
aws_access_key_id = ${HOOK_S3_ACCESS_KEY}
aws_secret_access_key = ${HOOK_S3_SECRET_KEY}
EOF
else 
  echo "Reusing existing credentials file: ${CREDS_FILE}"
fi
