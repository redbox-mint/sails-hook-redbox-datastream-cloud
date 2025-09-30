#! /bin/sh
HOOK_DIR="/opt/sails-hook-redbox-datastream-cloud"
echo "#########################################################"
echo "Running Dev Environment of Hook: sails-hook-redbox-datastream-cloud from '${HOOK_DIR}'"
echo "#########################################################"
PREP_MINIO_SCRIPT="${HOOK_DIR}/support/prepare-minio.sh"
PREP_HOOK_SCRIPT="${HOOK_DIR}/support/prepare-hook.sh"
chmod +x $HOOK_DIR/support/*.sh
$PREP_MINIO_SCRIPT "test"
$PREP_HOOK_SCRIPT
cd /opt/redbox-portal/node_modules/@researchdatabox/sails-hook-redbox-datastream-cloud
echo "Installing mocha...."
npm i mocha -g
echo "Running Mocha tests..."
NODE_ENV=test; mocha --exit test/bootstrap.js test/unit/**/*.test.js
if [ $? -eq 0 ]
then
  echo "Mocha Tests passed"
else
  echo "Mocha Tests failed"
  exit 1
fi
