const sails = require('sails');

const _ = require('lodash');
global._ = _;

// Set up chai globals immediately (before any tests load)
let chai;
try {
  // Try CommonJS require first (for chai < 5.0)
  chai = require('chai');
} catch (requireErr) {
  if (requireErr.code === 'ERR_REQUIRE_ESM') {
    // For ES module chai, we need to use a different approach
    console.warn('Chai ES module detected, using fallback approach');
    chai = { expect: () => { throw new Error('Chai expect not available'); }};
  } else {
    throw requireErr;
  }
}

global.chai = chai;
global.should = chai.should ? chai.should() : null;
global.expect = chai.expect;

const fs = require('fs-extra');
global.fs = fs;
// Fix UUID import - get the v1 function specifically
const { v1: uuidv1 } = require('uuid');
global.uuidv1 = uuidv1;

const appPath = '/opt/redbox-portal';
let sailsInstance;
let liftingPromise = null;

function liftSails() {
  if (liftingPromise) {
    return liftingPromise;
  }

  liftingPromise = new Promise((resolve, reject) => {
    sails.lift({
      appPath: appPath,
      models: {
        migrate: 'drop',
        datastore: 'redboxStorage'
      },
      datastores: {
        mongodb: {
          adapter: require(appPath + '/node_modules/sails-mongo'),
          url: 'mongodb://mongodb:27017/redbox-portal'
        },
        redboxStorage: {
          adapter: require(appPath + '/node_modules/sails-mongo'),
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
        grunt: false
      },
      log: { level: 'verbose' }
    }, (err, instance) => {
      if (err) {
        liftingPromise = null;
        return reject(err);
      }

      sailsInstance = instance;
      global.sails = instance;
      return resolve(instance);
    });
  });

  global.sailsReady = liftingPromise;
  return liftingPromise;
}

async function lowerSails() {
  if (!sailsInstance) {
    liftingPromise = null;
    global.sailsReady = null;
    global.sails = undefined;
    return;
  }

  await new Promise((resolve, reject) => {
    sailsInstance.lower((err) => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });
  });

  sailsInstance = null;
  liftingPromise = null;
  global.sailsReady = null;
  global.sails = undefined;
}

module.exports.mochaHooks = {
  beforeAll: async function () {
    if (typeof this.timeout === 'function') {
      this.timeout(500000);
    }
    await liftSails();
  },

  afterAll: async function () {
    if (typeof this.timeout === 'function') {
      this.timeout(120000);
    }

    try {
      await lowerSails();
    } catch (err) {
      console.error('Failed to lower Sails:', err);
    }
  }
};
