const _ = require('lodash');
const fs = require('fs-extra');

module.exports = function (sails) {
  return {
    initialize: function (cb) {
      const logHeader = "DatastreamCloud::"
      const configMergePreReqEvents = require(`${__dirname}/config/datastreamCloud.js`).datastreamCloud.configMergePreReqEvents;
      sails.log.verbose(`${logHeader} Waiting for dependent hooks to load before merging my config: ${JSON.stringify(configMergePreReqEvents)}...`);
      sails.after(configMergePreReqEvents, function() {
        var appPath = sails.config.appPath;
        if (!fs.pathExistsSync(appPath)) {
          appPath = "../../..";
        } 
        const configServicePath = `${appPath}/api/services/ConfigService.js`;
        sails.log.verbose(`${logHeader} Merging config using: ${configServicePath}`);
        var configService = require(configServicePath);
        // merge this Hook's configuration with RB's
        configService.mergeHookConfig('@researchdatabox/sails-hook-redbox-datastream-cloud', sails.config);
        // special processing of variables present in docker-compose files
        if (!_.isEmpty(process.env.HOOK_S3_ENDPOINT)) {
          sails.config.datastreamCloud.companion.s3.endpoint = process.env.HOOK_S3_ENDPOINT;
          sails.log.verbose(`${logHeader} Using endpoint: ${sails.config.datastreamCloud.companion.s3.endpoint}`);
        }
        if (!_.isEmpty(process.env.HOOK_S3_REGION)) {
          sails.config.datastreamCloud.companion.s3.region = process.env.HOOK_S3_REGION;
          sails.log.verbose(`${logHeader} Using region: ${sails.config.datastreamCloud.companion.s3.region}`);
        }
        if (!_.isEmpty(process.env.HOOK_S3_BUCKET)) {
          sails.config.datastreamCloud.companion.s3.bucket = process.env.HOOK_S3_BUCKET;
          sails.log.verbose(`${logHeader} Using bucket: ${sails.config.datastreamCloud.companion.s3.bucket}`);
        }
        return cb();
      });
    },
    //If each route middleware do not exist sails.lift will fail during hook.load()
    routes: {
      before: {},
      after: {}
    },
    configure: function () {
      
    },
    defaults: {
    }
  }
};
