const _ = require('lodash');
const fs = require('fs-extra');

module.exports = function (sails) {
  return {
    initialize: function (cb) {
      const configMergePreReqEvents = require(`${__dirname}/config/datastreamCloud.js`).datastreamCloud.configMergePreReqEvents;
      sails.log.verbose(`DatastreamCloud::Waiting for dependent hooks to load before merging my config: ${JSON.stringify(configMergePreReqEvents)}...`);
      sails.after(configMergePreReqEvents, function() {
        var appPath = sails.config.appPath;
        if (!fs.pathExistsSync(appPath)) {
          appPath = "../../..";
        } 
        const configServicePath = `${appPath}/api/services/ConfigService.js`;
        sails.log.verbose(`DatastreamCloud:: Merging config using: ${configServicePath}`);
        var configService = require(configServicePath);
        // merge this Hook's configuration with RB's
        configService.mergeHookConfig('@researchdatabox/sails-hook-redbox-datastream-cloud', sails.config);
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
