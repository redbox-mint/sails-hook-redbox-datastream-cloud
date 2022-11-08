module.exports.datastreamCloud = {
  configMergePreReqEvents: [
    'hook:redbox-storage-mongo:loaded'
  ],
  initPreReqEvents: [
    'hook:redbox-datastream-cloud:loaded'
  ],
  defaultCloudType: 's3',
  useObjectBucketMetadata: false, // whether to use the bucket name stored in metadata during download
  keyPrefix: 'attachments/',
  rclone: {
    configPath: '',
    remoteName: ''
  },
  mongodb: {
    indices: [
      {
        key: {
          'redboxOid': 1
        }
      },
      {
        key: {
          'metadata.name': 1
        }
      },
      {
        key: {
          'metadata.fileId': 1
        }
      },
      {
        key: {
          'metadata.filename': 1
        }
      },
      {
        key: {
          'dateCreated': 1
        }
      },
      {
        key: {
          'dateCreated': -1
        }
      },
      {
        key: {
          'lastSaveDate': 1
        }
      },
      {
        key: {
          'lastSaveDate': -1
        }
      }
    ]
  },

  enableCompanion: false, // setting to true will enable the Companion attachment processor instead of TUS
  // the config passed on to companion
  companion: {
    server: {
      path: '/companion',
      host: 'localhost:1500' // WARNING: set elsewhere
    },
    secret: 'very-secretive-secret', // WARNING: set elsewhere
    s3: {
      endpoint: '', // the custom variable for setting the S3 endpoint, must be set for S3-like endpoints, e.g. MINIO
      bucketEndpoint: false,
      tls: false,
      forcePathStyle: true,
      bucket: '', // WARNING: set elsewhere
      region: 'ap-southeast-2', // WARNING: set elsewhere
      key: '', // WARNING: set elsewhere
      secret: '', // WARNING: set elsewhere
      // getKey will be set by the service
      acl: 'private',
      useAccelerateEndpoint: false,
      expires: 3600 // 5 minute pre-signed URL validity 
    },
    debug: true,
    metrics: false,
    streamingUpload: true,
    // maxFileSize will be set to 'record.maxUploadSize' unless specified here
    filePath: '/attachments/staging',
    allowLocalUrls: true, // set to false
    uploadUrls: ['http://localhost:1500'], // WARNING: set elsewhere
    corsOrigins: true
  }
};