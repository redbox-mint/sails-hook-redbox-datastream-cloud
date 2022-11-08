#! /bin/sh
HOOK_VERSION=1.0.6
cd /tmp
npm pack /opt/sails-hook-redbox-datastream-cloud
cd /opt/redbox-portal
npm i --legacy-peer-deps /tmp/researchdatabox-sails-hook-redbox-datastream-cloud-$HOOK_VERSION.tgz
ls -l /opt/redbox-portal/node_modules/@researchdatabox/sails-hook-redbox-datastream-cloud