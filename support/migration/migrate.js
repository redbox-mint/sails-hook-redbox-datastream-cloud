const { Upload } = require("@aws-sdk/lib-storage");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mongodb = require("mongodb");
const fs = require("node:fs/promises");
const _ = require("lodash");

const migrate = async () => {
  const configFilePath = process.argv[2];
  if (!configFilePath) {
    console.error(`Please specify config file path.`);
    return;
  }
  let config = null;
  try {
    config = JSON.parse(await fs.readFile(configFilePath));
  } catch (err) {
    console.error(`Cannot access/find config file path: ${configFilePath}`);
    return;
  }
  const srcConnStr = config.mongodb.source.connectionStr;
  const srcDbName = config.mongodb.source.dbName;
  const targetConnStr = config.mongodb.target.connectionStr;
  const targetDbName = config.mongodb.target.dbName;
  const bucketName = config.s3.bucketName;
  let srcClient = null;
  let targetClient = null;
  let s3Client = null;
  const stats = {
    processed: [],
    skipped: [],
    uploaded: [],
    errored: []
  };
  try {
    const clientConfig = config.s3.clientConfig;
    s3Client = new S3Client(clientConfig);
    console.log(`Connecting to source db: ${srcConnStr}`);
    srcClient = new mongodb.MongoClient(srcConnStr);
    await srcClient.connect();
    console.log(`Connected, getting source db...`);
    const srcDb = srcClient.db(srcDbName);
    console.log(`Retrieving Bucket....`);
    const bucket = new mongodb.GridFSBucket(srcDb);
    console.log(`Connecting to target db: ${targetConnStr}`);
    targetClient = new mongodb.MongoClient(targetConnStr);
    await targetClient.connect();
    console.log(`Connected, getting target db...`);
    const targetDb = targetClient.db(targetDbName);
    const targetCol = targetDb.collection(config.mongodb.target.collection);
    console.log(`Getting source records...: ${JSON.stringify(config.mongodb.source.query)}`);
    const cursor = bucket.find(config.mongodb.source.query);
    while (await cursor.hasNext()) {
      const attachment = await cursor.next();
      const oid = attachment.metadata.redboxOid;
      const fileId = attachment.metadata.fileId;
      stats.processed.push(fileId);
      try { 
        if (config.s3.skipUploaded == true) {
          // check if already in the target DB
          const existingAtt = await targetCol.findOne({'metadata.fileId': fileId});
          if (_.size(existingAtt) > 0) {
            stats.skipped.push(fileId);
            console.log(`Skipping: ${fileId}`);
            continue;
          }
        }
        console.log(`Uploading: ${fileId}`);
        const uploadParams = {
          Bucket: bucketName,
          Key: `${config.s3.keyPrefix}${oid}/${fileId}`,
          Body: bucket.openDownloadStreamByName(attachment.filename)
        };
        const parallelUploads3 = new Upload({
          client: s3Client,
          params: uploadParams,
          leavePartsOnError: false, // optional manually handle dropped parts
        });
        if (config.s3.logS3UploadProgress) {
          parallelUploads3.on("httpUploadProgress", (progress) => {
            console.log(progress);
          });
        }
        const uploadResp = await parallelUploads3.done();
        if (uploadResp['$metadata'].httpStatusCode == 200) {
          // save the state of the upload
          const attachMetaRel = _.merge(attachment.metadata, {
            source: 'migration',
            cloudType: 's3',
            bucket: uploadParams['Bucket'],
            key: uploadParams['Key'],
            filename: fileId,
            ETag: uploadResp['ETag']
          });
          await targetCol.replaceOne({'metadata.fileId': fileId}, { redboxOid: oid, uploadDate: attachment.uploadDate, metadata: attachMetaRel }, {upsert:true});
          stats.uploaded.push(fileId);
        } else {
          console.error(`Failed to upload: ${uploadParams.Key}`);
          stats.errored.push(fileId);
          console.error(uploadResp);
        }
      } catch (err) {
        console.error(`Failed to process: ${fileId}`);
        console.error(err);
        stats.errored.push(fileId);
      }      
    }
  } catch (error) {
    console.error(`Error thrown: `);
    console.error(error);
  }
  srcClient.close();
  targetClient.close();
  console.log(`Processed: ${_.size(stats.processed)}`);
  console.log(`Uploaded: ${_.size(stats.uploaded)}`);
  console.log(`Skipped: ${_.size(stats.skipped)}`);
  console.log(`Errored: ${_.size(stats.errored)}`);
  // done
  return 'Migration done!'
};

migrate()
.then(console.log);