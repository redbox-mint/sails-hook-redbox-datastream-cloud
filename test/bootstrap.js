var Sails = require('sails').Sails;

var _ = require('lodash');
global._ = _;
global.chai = require('chai');
global.should = chai.should();
global.expect = chai.expect;
const fs = require('fs-extra');
global.fs = fs;
const moment = require('moment');
global.moment = moment;
const uuidv1 = require('uuid');
global.uuidv1 = uuidv1;

describe('Bootstrap tests ::', function() {
  // Var to hold a running sails app instance
  var _sails;
  var appPath = '/opt/redbox-portal'

  // Before running any tests, attempt to lift Sails
  before(function (done) {

    // Hook will timeout in 10 seconds
    this.timeout(10000);

    // Attempt to lift sails
    Sails().lift({
      appPath: appPath,
      models: {
        migrate: 'drop',
        datastore: 'redboxStorage'
      },
      datastores: {
        mongodb: {
          adapter: require(appPath+'/node_modules/sails-mongo'),
          url: "mongodb://mongodb:27017/redbox-portal"
        },
        redboxStorage: {
          adapter: require(appPath+'/node_modules/sails-mongo'),
          url: 'mongodb://mongodb:27017/redbox-storage'
        }
      },
      globals: {
        sails: true,
        _: require('lodash'),
        async: require('async'),
        models: true,
        services: true
      },
      hooks: {
        // Skip grunt (unless your hook uses it)
        "grunt": false
      },
      log: {level: "verbose"}
    },function (err, __sails) {
      if (err) return done(err);
      _sails = __sails;
      console.log("Sails lifted, setting global reference.");
      global.sails = __sails;
      return done();
    });
  });

  // After tests are complete, lower Sails
  after(function (done) {
    // Lower Sails (if it successfully lifted)
    if (_sails) {
      return _sails.lower((err)=>{
        if (err) {
          console.log("Failed to lower Sails: ");
          console.log(err);
        }
        console.log("Sails lowered succesfully, exiting test.");
        done();
      });
    }
    // Otherwise just return
    return done();
  });

  // Test that Sails can lift with the hook in place
  it ('Bootstrap:: Sails does not crash with the hook installed.', function() {
      return true;
  });
});
