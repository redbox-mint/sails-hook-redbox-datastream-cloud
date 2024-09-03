const { Upload } = require("@aws-sdk/lib-storage");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mongodb = require("mongodb");
const fs = require("node:fs/promises");
const _ = require("lodash");
const util = require("util");
const execAsync = util.promisify(require("child_process").exec);
const hasha = require('hasha');

const uploadToS3 = (s3Client, bucketName, key, srcStream, logS3Upload, md5Hex) => {
  const md5 = Buffer.from(md5Hex, 'hex').toString('base64');
  const uploadParams = {
    Bucket: bucketName,
    Key: `${key}`,
    Body: srcStream, 
    ContentMD5: `${md5}`
  };
  const parallelUploads = new Upload({
    client: s3Client,
    params: uploadParams,
    leavePartsOnError: false, // optional manually handle dropped parts
  });
  if (logS3Upload) {
    parallelUploads.on("httpUploadProgress", (progress) => {
      console.log(progress);
    });
  }
  console.log(`Uploading: ${key}`);
  return parallelUploads.done();
};

const rcloneToS3 = async (rcloneConfigPath, configName, bucketName, key, fullTempPath) => {
  const rclone_cmd = `rclone --config=${rcloneConfigPath} copy ${fullTempPath} ${configName}:${bucketName}/${key}`;
  console.log(`Running: ${rclone_cmd}`);
  await execAsync(rclone_cmd);
}

const downloadSrcToTemp = async (srcConnStr, srcDb, srcFileId, fullTempPath) => {
  const mongofiles_cmd = `mongofiles --uri="${srcConnStr}" -d ${srcDb} get_id '{"$oid": "${srcFileId}"}' -l="${fullTempPath}"`;
  console.log(`Downloading via mongofiles: ${mongofiles_cmd}`);
  await execAsync(mongofiles_cmd);
  console.log(`Mongofiles downloaded okay: ${fullTempPath}, uploading...`);
  const hash = await hasha.fromFile(fullTempPath, {algorithm: 'md5', encoding: 'hex'});
  return hash;
};

const migrate = async () => {
  const startTime = new Date();
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
  const tempDir = config.mongodb.target.tempDir;
  if (_.isEmpty(config.rclone.configPath) || _.isEmpty(config.rclone.remoteName)) {
    console.error(`Please set 'config.rclone.configPath' or 'config.rclone.remoteName'.`);
    return;
  }
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
    console.log(`Start time: ${startTime.toLocaleString()}`);
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
      const oid = attachment.metadata.redboxOid || attachment.metadata.oid;
      let fileId = attachment.metadata.fileId;
      if (_.isEmpty(fileId)) {
        // try to guess the fileId
        const names = attachment.filename.split('/');
        if (_.size(names) >= 2) {
          if (!_.isEmpty(names[1])) {
            fileId = names[1];
          } else {
            console.error(`Error, can't guess fileId from name: ${attachment.filename} of ${oid}`);
            stats.errored.push(oid);
            continue;
          }
        }
      }
      stats.processed.push(fileId);
      try {
        let sourceMd5 = "";
        let srcStream = null;
        const fullTempPath = `${tempDir}/${fileId}`
        console.log(`Processing: ${fileId}`);
        // check if already in the target DB
        const existingAtt = await targetCol.findOne({'metadata.fileId': fileId, 'redboxOid': oid});
        if (config.s3.skipUploaded == true) {
          if (_.size(existingAtt) > 0) {
            // try to see if there's any size change
            if (existingAtt.metadata.size == attachment.length) {
              stats.skipped.push(fileId);
              console.log(`Skipping: ${fileId} of ${oid}`);
              continue;
            }
          }
        }
        let fd = null;
        try {
          sourceMd5 = _.get(await srcDb.command({filemd5: attachment._id, root: "fs"}), 'md5'); 
        } catch (e) {
          console.error(e);
          console.warn(`Failed to get md5 for fileId:${fileId} of ${oid}`);
        }
        // if the md5 is empty, most likely it's too big to stream out, using mongofiles to dump the data
        if (_.isEmpty(sourceMd5)) {
          console.info(`File has no md5 or could be too big to stream out, using mongofiles to download: ${fileId} of ${oid}`);
          sourceMd5 = await downloadSrcToTemp(srcConnStr, srcDbName, attachment._id, fullTempPath);
          fd = await fs.open(fullTempPath);
          srcStream = fd.createReadStream();
        } else {
          srcStream = bucket.openDownloadStreamByName(attachment.filename);
        }
        if (config.s3.skipUploaded == true) {
          if (_.size(existingAtt) > 0) {
            // try to see if there's any size change
            if (existingAtt.metadata.md5 == sourceMd5) {
              stats.skipped.push(fileId);
              console.log(`Skipping: ${fileId} of ${oid}`);
              if (!_.isEmpty(fd)) {
                try {
                  fd.close();
                } catch (err) {
                  console.error(`Error closing fd: ${fileId} of ${oid}, ignoring...`);
                }
              }
              continue;
            } else {
              console.log(`Reuploading '${fileId}' of ${oid} because md5 did not match: ${existingAtt.metadata.md5} != ${sourceMd5}`);
            }
          }
        }
        let uploadResp = null;
        let key = `${config.s3.keyPrefix}${oid}/${fileId}`;
        try {
          uploadResp = await uploadToS3(s3Client, bucketName, key, srcStream, config.s3.logS3UploadProgress, sourceMd5);
          if (uploadResp['$metadata'].httpStatusCode != 200) {
            console.error(`Failed to upload: ${key}`);
            console.error(uploadResp);
            // Note: we try again with rclone
            throw new Error(`Failed to upload ${key} of ${oid}`);
          }   
        } catch (error) {
          console.error(`Error in streamed upload: ${fileId} of ${oid}`);
          console.error(error);
          if (fd == null) {
            sourceMd5 = await downloadSrcToTemp(srcConnStr, srcDbName, attachment._id, fullTempPath);
            fd = await fs.open(fullTempPath);
            srcStream = fd.createReadStream();
            try {
              uploadResp = await uploadToS3(s3Client, bucketName, key, srcStream, config.s3.logS3UploadProgress, sourceMd5);
              if (uploadResp['$metadata'].httpStatusCode != 200) {
                console.error(`Failed to upload: ${key}`);
                stats.errored.push(attachment);
                console.error(uploadResp);
                continue;
              }
              console.log(`Mongofiles uploaded okay: ${fullTempPath}, cleaning up...`);
            } catch (err2) {
              await rcloneToS3(config.rclone.configPath, config.rclone.remoteName, bucketName, `${config.s3.keyPrefix}${oid}`, fullTempPath);
            }
          } else {
            try { 
              await rcloneToS3(config.rclone.configPath, config.rclone.remoteName, bucketName, `${config.s3.keyPrefix}${oid}`, fullTempPath);
            } catch (err2) {
              console.error(`Mongofiles already downloaded the file, still failed to upload, adding to errored: ${fileId} of ${oid}, cleaning up...`);
              stats.errored.push(attachment);
              throw (err2);
            }
          }
          try {
            await fs.unlink(fullTempPath);
          } catch (ferr) {
            console.error(`Failed to clean up: ${fullTempPath}`);
          }
        }
        console.log(`Uploaded okay, saving metadata ${fileId} of ${oid}`);
        // save the state of the upload
        const attachMetaRel = _.merge(attachment.metadata, {
          source: 'migration',
          cloudType: 's3',
          bucket: bucketName,
          key: key,
          filename: fileId,
          ETag: uploadResp ? uploadResp['ETag'] : undefined,
          fileId: fileId,
          md5: sourceMd5,
          size: attachment.length
        });
        await targetCol.replaceOne({'metadata.fileId': fileId}, { redboxOid: oid, uploadDate: attachment.uploadDate, metadata: attachMetaRel }, {upsert:true});
        stats.uploaded.push(fileId);
        if (!_.isEmpty(fd)) {
          try {
            fd.close();
          } catch (err) {
            console.error(`Error closing fd: ${fileId} of ${oid}, ignoring...`);
          }
        }
      } catch (err) {
        console.error(`Failed to process: ${fileId} of oid: ${oid}`);
        console.error(err);
        stats.errored.push(attachment);
      }      
    }
  } catch (error) {
    console.error(`Generic error thrown: `);
    console.error(error);
  }
  srcClient.close();
  targetClient.close();
  console.log(`Processed: ${_.size(stats.processed)}`);
  console.log(`Uploaded: ${_.size(stats.uploaded)}`);
  console.log(`Skipped: ${_.size(stats.skipped)}`);
  console.log(`Errored: ${_.size(stats.errored)}`);
  console.log(JSON.stringify(stats.errored));
  // done
  const endTime = new Date();
  const elapsedTime = (endTime - startTime) / 60000; // Convert milliseconds to minutes
  const elapsedTimeHours = elapsedTime / 60; // Convert minutes to hours
  console.log(`Elapsed time: ${elapsedTime} minutes`);
  console.log(`Elapsed time hours: ${elapsedTimeHours} hours`);
  return 'Migration done!'
};

migrate()
.then(console.log);