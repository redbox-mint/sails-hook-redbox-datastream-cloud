/**
 * CloudAttachment.js
 *
 * @description :: Tracks attachments saved in the Cloud
 *
 * @docs        :: http://sailsjs.org/documentation/concepts/models-and-orm/models
 */

 module.exports = {
  attributes: {
    redboxOid: {
      type: 'string'
    },
    metadata: {
      type: 'json'
    },
    createdAt: false,
    updatedAt: false,
    dateCreated: {
      type: 'string',
      autoCreatedAt: true
    },
    lastSaveDate: {
      type: 'string',
      autoUpdatedAt: true
    }
  },
  datastore: 'redboxStorage'
};
