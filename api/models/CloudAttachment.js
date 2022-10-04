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
    uploadDate: {
      type: 'string',
      autoCreatedAt: true
    }
  },
  datastore: 'redboxStorage'
};
