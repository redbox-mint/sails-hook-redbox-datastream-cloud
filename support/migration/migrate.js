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
  console.log(`Running; ${rclone_cmd}`);
  await execAsync(rclone_cmd);
}

const downloadSrcToTemp = async (srcConnStr, srcFileName, fullTempPath) => {
  const mongofiles_cmd = `mongofiles --uri="${srcConnStr}" -d redbox-storage get "${srcFileName}" -l="${fullTempPath}"`;
  console.log(`Error in upload, downloading via mongofiles: ${mongofiles_cmd}`);
  await execAsync(mongofiles_cmd);
  console.log(`Mongofiles downloaded okay: ${fullTempPath}, uploading...`);
  const hash = await hasha.fromFile(fullTempPath, {algorithm: 'md5', encoding: 'hex'});
  return hash;
};

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
  const tempDir = config.mongodb.target.tempDir;
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
      let fileId = attachment.metadata.fileId;
      if (_.isEmpty(fileId)) {
        // try to guess the fileId
        const names = attachment.filename.split('/');
        if (_.size(names) >= 2) {
          if (!_.isEmpty(names[1])) {
            fileId = names[1];
          } else {
            console.error(`Can't guess fileId from name: ${attachment.filename} of ${oid}`);
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
        try {
          sourceMd5 = _.get(await srcDb.command({filemd5: attachment._id, root: "fs"}), 'md5'); 
        } catch (e) {
          console.error(e);
          console.warn(`Failed to get md5 for fileId:${fileId} of ${oid}`);
        }
        if (config.s3.skipUploaded == true) {
          // check if already in the target DB
          const existingAtt = await targetCol.findOne({'metadata.fileId': fileId});
          if (_.size(existingAtt) > 0) {
            // try to see if there's any size change
            if (existingAtt.metadata.size == attachment.length) {
              stats.skipped.push(fileId);
              console.log(`Skipping: ${fileId}`);
              continue;
            } else {
              console.log(`Reuploading '${fileId}' because sizes did not match: '${attachment.length}' != '${existingAtt.metadata.size}'`);
            }
          }
        }
        console.log(`Processing: ${fileId}`);
        let fd = null;
        // if the md5 is empty, most likely it's too big to stream out, using mongofiles to dump the data
        if (_.isEmpty(sourceMd5)) {
          sourceMd5 = await downloadSrcToTemp(srcConnStr, attachment.filename, fullTempPath);
          fd = await fs.open(fullTempPath);
          srcStream = fd.createReadStream();
          // const md5sum_cmd = `md5sum ${fullTempPath}`;
          // sourceMd5 = _.trim(await execAsync(md5sum_cmd));
        } else {
          srcStream = bucket.openDownloadStreamByName(attachment.filename);
        }
        let uploadResp = null;
        let key = `${config.s3.keyPrefix}${oid}/${fileId}`;
        try {
          uploadResp = await uploadToS3(s3Client, bucketName, key, srcStream, config.s3.logS3UploadProgress, sourceMd5);
          if (uploadResp['$metadata'].httpStatusCode != 200) {
            console.error(`Failed to upload: ${key}`);
            stats.errored.push(attachment);
            console.error(uploadResp);
            continue;
          }   
        } catch (error) {
          console.error(error);
          if (fd == null) {
            sourceMd5 = await downloadSrcToTemp(srcConnStr, attachment.filename, fullTempPath);
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
              await rcloneToS3('/etc/rclone/rclone.conf', 'backups', bucketName, `${config.s3.keyPrefix}${oid}`, fullTempPath);
            }
          } else {
            try { 
              await rcloneToS3('/etc/rclone/rclone.conf', 'backups', bucketName, `${config.s3.keyPrefix}${oid}`, fullTempPath);
            } catch (err2) {
              console.log(`Mongofiles already downloaded the file, still failed to upload, adding to errored: ${fileId} of ${oid}, cleaning up...`);
              stats.errored.push(attachment);
            }
          }
          await fs.unlink(fullTempPath);
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
      } catch (err) {
        console.error(`Failed to process: ${fileId} of oid: ${oid}`);
        console.error(err);
        stats.errored.push(attachment);
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
  console.log(JSON.stringify(stats.errored));
  // done
  return 'Migration done!'
};

migrate()
.then(console.log);