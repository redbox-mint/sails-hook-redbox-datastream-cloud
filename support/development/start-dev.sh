#! /bin/sh
HOOK_DIR="/opt/sails-hook-redbox-datastream-cloud"
echo "#########################################################"
echo "Running Dev Environment of Hook: sails-hook-redbox-datastream-cloud from '${HOOK_DIR}'"
echo "#########################################################"
PREP_MINIO_SCRIPT="${HOOK_DIR}/support/prepare-minio.sh"
PREP_HOOK_SCRIPT="${HOOK_DIR}/support/prepare-hook.sh"
PDF_VERSION=1.2.9
chmod +x $HOOK_DIR/support/*.sh
$PREP_MINIO_SCRIPT "development"
echo "Installing S3 Datastream...."
$PREP_HOOK_SCRIPT
cd /opt/redbox-portal
echo "Installing PDF Gen"
npm i --legacy-peer-deps "@researchdatabox/sails-hook-redbox-pdfgen@$PDF_VERSION"
echo "Running App..."
node app.js 