import { Sails, Model } from "sails";
import {
  Observable
} from 'rxjs/Rx';

import { Services as services, DatastreamService, DatastreamServiceResponse, Datastream, Attachment } from '@researchdatabox/redbox-core-types';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { v1 as uuidv1 } from 'uuid';

const fs = require('fs-extra');

declare var sails: Sails;
declare var _;
declare var CloudAttachment: Model, FormsService;

export module Services {
  /**
   * Goal: Support storing ReDBox record attachments in Cloud environments, initially focusing on S3-like APIs: AWS S3, Minio, etc.
   * 
   * Notes: 
   * - Calling `addDatastream` directy will use AWS' S3 client lib (if configured)
   * - Currently working alongside the TUS server found in the core to upload files to the cloud destination.
   * 
   * Author: <a href='https://github.com/shilob' target='_blank'>Shilo Banihit</a>
   * 
   */
  export class CloudDatastreamService extends services.Core.Service implements DatastreamService {

    protected s3Client: S3Client;
    protected s3BucketParams: any;

    protected _exportedMethods: any = [
      'addDatastreams',
      'updateDatastream',
      'removeDatastream',
      'addDatastream',
      'addAndRemoveDatastreams',
      'getDatastream',
      'listDatastreams'
    ];

    constructor() {
      super();
      this.logHeader = 'CloudDatastreamService::';
      let that = this;
      const initPreReqEvents = sails.config.datastreamCloud.initPreReqEvents;
      sails.log.verbose(`${this.logHeader} Waiting for these events before initing: ${JSON.stringify(initPreReqEvents)}`);
      sails.after(initPreReqEvents, async ()=> {
        sails.log.verbose(`${that.logHeader} Initialising Service...`);
        await that.init();
        sails.after('hook:redbox:storage:ready', async ()=> {
          await that.initDb();
          sails.emit('hook:redbox:datastream:ready');
        });
      });

    }

    /**
     * Verify:
     *  - required config is present
     *  - credentials to s3 is valid
     */
    private async init() {
      let that = this;
      const companionConfig = sails.config.datastreamCloud.companion;
      if (sails.config.datastreamCloud.enableCompanion) {
        const companion = require('@uppy/companion');
        // TODO: complete implemntation
        if (_.isEmpty(companionConfig)) {
          sails.log.error(`${this.logHeader} Companion configuration is missing, please set sails.config.record.attachments.companion`);
          return;
        }
        if (_.isEmpty(companionConfig.maxFileSize)) {
          companionConfig.maxFileSize = sails.config.record.maxUploadSize;
        }
        const stagingDir = companionConfig.filePath;
        if (! await fs.exists(stagingDir)) {
          await fs.mkdir(stagingDir);
        }
  
        const { app:companionApp, emitter } = companion.app(companionConfig);
        sails.config.policies[`/${sails.config.api.additionalClientConfig.companionPath}/*`] = [
          'isAuthenticated',
          companionApp
        ];
        // companion.socket(sails.hooks.http.server);
        emitter.on('upload-start', ({ token }) => {
          sails.log.verbose(`${that.logHeader} -> Upload started`, token)
        
          function onUploadEvent ({ action, payload }) {
            if (action === 'success') {
              emitter.off(token, onUploadEvent) // avoid listener leak
              sails.log.verbose(`${that.logHeader} -> Upload finished`, token, payload.url)
            } else if (action === 'error') {
              emitter.off(token, onUploadEvent) // avoid listener leak
              sails.log.error(`${that.logHeader} -> Upload failed`, payload)
            }
          }
          emitter.on(token, onUploadEvent)
        });
      }
      // start of S3 specific config
      if (!_.isUndefined(companionConfig.s3)) {
        // init the local S3 client
        const clientConfig = {     
          region: companionConfig.s3.region 
        };
        sails.log.verbose(JSON.stringify(clientConfig));
        this.s3Client = new S3Client(clientConfig);

        this.s3BucketParams = {
          Bucket: companionConfig.s3.bucket
        };
      }
      sails.log.verbose(`${this.logHeader} Initialised successfully`);
    }

    private async initDb() {
      sails.log.verbose(`${this.logHeader} Initialising DB...`);
      const db = CloudAttachment.getDatastore().manager;
      // create collection 
      try {
        const collectionInfo = await db.collection(CloudAttachment.tableName, {strict:true});
        sails.log.verbose(`${this.logHeader} Collection '${CloudAttachment.tableName}' info:`);
        sails.log.verbose(JSON.stringify(collectionInfo));
      } catch (err) {
        sails.log.verbose(`${this.logHeader} initDb() -> Collection doesn't exist, creating: ${CloudAttachment.tableName}`);
        const uuid = this.getUuid();
        const initRec = {redboxOid: uuid};
        await CloudAttachment.create(initRec);
        await CloudAttachment.destroyOne({redboxOid: uuid});
      }
      // creating indices...
      // Version as of writing: http://mongodb.github.io/node-mongodb-native/3.6/api/Collection.html#createIndexes
      const currentIndices = await db.collection(CloudAttachment.tableName).indexes();
      try {
        const indices = sails.config.datastreamCloud.mongodb.indices;
        if (_.size(indices) > 0) {
          // TODO: check if indices already exists
          await db.collection(CloudAttachment.tableName).createIndexes(indices);
        }
      } catch (err) {
        sails.log.error(`${this.logHeader} initDb() -> Failed to create indices:`);
        sails.log.error(JSON.stringify(err));
      }
      sails.log.verbose(`${this.logHeader} DB Inited.`);
    }

    /**
     * Implementation to support uploads using TUS as the first stage.
     * 
     * @param oid 
     * @param datastreams 
     * @returns 
     */
    public async addDatastreams(oid: string, datastreams: Datastream[]): Promise<DatastreamServiceResponse> {
      const response = new DatastreamServiceResponse();
      response.message = '';
      let hasFailure = false;
      for (const fileId of datastreams) {
        try {
          await this.addDatastream(oid, fileId);
          const successMessage = `Successfully uploaded: ${JSON.stringify(fileId)}`;
          response.message = _.isEmpty(response.message) ? successMessage :  `${response.message}\n${successMessage}`;
        } catch (err) {
          hasFailure = true;
          const failureMessage = `Failed to upload: ${JSON.stringify(fileId)}, error is:\n${JSON.stringify(err)}`;
          response.message = _.isEmpty(response.message) ? failureMessage :  `${response.message}\n${failureMessage}`;
        }
      }
      response.success = !hasFailure;
      return response;
    }

    public updateDatastream(oid: string, record, newMetadata, fileRoot, fileIdsAdded): any {
      // loop thru the attachment fields and determine if we need to add or remove
      return FormsService.getFormByName(record.metaMetadata.form, true)
      .flatMap(form => {
        const reqs = [];
        record.metaMetadata.attachmentFields = form.attachmentFields;
        _.each(form.attachmentFields, async (attField) => {
          const oldAttachments = record.metadata[attField];
          const newAttachments = newMetadata[attField];
          const removeIds = [];
          // process removals
          if (!_.isUndefined(oldAttachments) && !_.isNull(oldAttachments) && !_.isNull(newAttachments)) {
            const toRemove = _.differenceBy(oldAttachments, newAttachments, 'fileId');
            _.each(toRemove, (removeAtt) => {
              if (removeAtt.type == 'attachment') {
                removeIds.push(new Datastream(removeAtt));
              }
            });
          }
          // process additions
          if (!_.isUndefined(newAttachments) && !_.isNull(newAttachments)) {
            const toAdd = _.differenceBy(newAttachments, oldAttachments, 'fileId');
            _.each(toAdd, (addAtt) => {
              if (addAtt.type == 'attachment') {
                fileIdsAdded.push(new Datastream(addAtt));
              }
            });
          }
          reqs.push(this.addAndRemoveDatastreams(oid, fileIdsAdded, removeIds));
        });
        if (_.isEmpty(reqs)) {
          reqs.push(Observable.of({"request": "dummy"}));
        }
        return Observable.of(reqs);
      });
    }

    public async removeDatastream(oid, datastream: Datastream) : Promise<any> {
      if (_.isEmpty(datastream.cloudType) && sails.config.datastreamCloud.defaultCloudType == 's3') {
        // default to S3
        const fileId = datastream.fileId;
        const streamKey = this.getKey(oid, fileId);
        const deleteParams = _.clone(this.s3BucketParams);
        if (!_.isEmpty(datastream['bucket']) && sails.config.datastreamCloud.useObjectBucketMetadata) {
          deleteParams['Bucket'] = datastream['bucket'];
        }
        try {
          deleteParams['Key'] = streamKey;
          sails.log.verbose(`${this.logHeader} removeDatastream() -> Deleting:`);
          sails.log.verbose(JSON.stringify(deleteParams));
          await this.s3Client.send(new DeleteObjectCommand(deleteParams));
          sails.log.verbose(`${this.logHeader} removeDatastream() -> Delete successful.`);
          // remove the state of the upload
          await this.deleteAttachmentRel(oid, fileId);
        } catch (error) {
          sails.log.error(error);
          sails.log.error(`${this.logHeader} removeDatastream() -> Object not found: ${streamKey}`);
          throw new Error("Failed to remove datastream.");
        } 
      } else {
        //TODO: handle other provider types, but for now fail fast
        sails.log.error(`${this.logHeader} removeDatastream() -> Cloud type unsupported: ${datastream.cloudType}`);
        throw new Error(`Unsupported datastream cloud type: ${datastream.cloudType}`);
      }
    }

    private async deleteAttachmentRel(oid, fileId) {
      const criteria = {
        "redboxOid": oid,
        "metadata.fileId": fileId
      };
      try {
        await CloudAttachment.destroyOne(criteria).meta({enableExperimentalDeepTargets:true});
      } catch (error) {
        sails.log.error(`${this.logHeader} deleteAttachmentRel() -> Failed to delete attachment link: ${oid}, ${fileId}`);
        sails.log.error(error);
        sails.log.error(criteria);
        throw new Error("Failed to delete attachment link.");
      }
    }

    private async saveAttachmentRel(oid:string, metadata:any) {
      const attachRel = {
        redboxOid: oid,
        metadata: metadata
      };
      try {
        await CloudAttachment.create(attachRel);
      } catch (err) {
        sails.log.error(`${this.logHeader} saveAttachmentRel() -> Failed to save attachment link: ${oid}, error:`);
        sails.log.error(err);
        sails.log.error(JSON.stringify(attachRel));
        throw new Error("Failed to save attachment link.");
      }
    }

    public async addDatastream(oid, datastream: Datastream): Promise<any> {
      // used for uploading files from the server to the cloud storage provider
      if (_.isEmpty(datastream.cloudType) && sails.config.datastreamCloud.defaultCloudType == 's3') {
        // default to S3
        this.uploadToS3(oid, datastream);
      } else {
        //TODO: handle other provider types, but for now fail fast
        sails.log.error(`${this.logHeader} addDatastream() -> Cloud type unsupported: ${datastream.cloudType}`);
        throw new Error(`Unsupported datastream cloud type: ${datastream.cloudType}`);
      }
    }

    private async uploadToS3(oid: string, datastream: Datastream) {
      const filePath = `${sails.config.datastreamCloud.companion.filePath}/${datastream.fileId}`;
      if (await fs.exists(filePath)) {
        const fileStream = fs.createReadStream(filePath);     
        const uploadParams = _.clone(this.s3BucketParams);
        if (!_.isEmpty(datastream['bucket'])) {
          uploadParams['Bucket'] = datastream['bucket'];
        }
        uploadParams['Key'] = this.getKey(oid, datastream.fileId);
        uploadParams['Body'] = fileStream;
        try {
          sails.log.verbose(`${this.logHeader} addDataStream() -> Uploading: ${filePath}`);
          const uploadResp = await this.s3Client.send(new PutObjectCommand(uploadParams));
          if (_.get(uploadResp, '$metadata.httpStatusCode') == 200) {
            sails.log.verbose(`${this.logHeader} addDataStream() -> Upload success: ${uploadParams['Key']}`);
            // saved the state of the upload
            const attachMetaRel = _.merge(datastream.metadata, {
              source: 'server',
              cloudType: 's3',
              bucket: this.s3BucketParams.Bucket,
              key: uploadParams['Key'],
              filename: datastream.fileId
            });
            await this.saveAttachmentRel(oid, attachMetaRel);
          } else {
            sails.log.error(`${this.logHeader} addDatastream() -> Failed to upload file: ${filePath}`);
            sails.log.error(JSON.stringify(uploadResp));
            throw new Error("Failed to upload file, check server logs.");
          }
        } catch (err) {
          sails.log.error(`${this.logHeader} addDatastream() -> Failed to upload: ${uploadParams['Key']}`);
          sails.log.error(err);
          throw new Error("Failed to upload file, check server logs.");
        }
      } else {
        sails.log.error(`${this.logHeader} addDatastream() -> File not found: ${filePath}`);
        throw new Error(`File not found: ${datastream.fileId}`);
      }
    }

    public async addAndRemoveDatastreams(oid, addDatastreams: Datastream[], removeDatastreams: Datastream[]): Promise<any> {
      for (const addId of addDatastreams) {
        await this.addDatastream(oid, addId);
      }
      for (const removeId of removeDatastreams) {
        await this.removeDatastream(oid, removeId);
      }
    }

    public async getDatastream(oid, fileId) {
      // find the attachment record
      sails.log.verbose(`${this.logHeader} getDatastream() -> FInding: ${oid} with fileId: ${fileId}`);
      try {
        const query = { "redboxOid": oid, "metadata.fileId": fileId };     
        const attachRecord = await CloudAttachment.findOne(query).meta({enableExperimentalDeepTargets:true});
        sails.log.verbose(attachRecord);
        if (!_.isEmpty(attachRecord)) {
          try {
            const datastreamRes = await this.downloadFromS3(oid, fileId, attachRecord);
            const response = new Attachment();
            response.readstream = datastreamRes.Body;
            return response;
          } catch (error) {
            sails.log.error(`${this.logHeader} getDatastream() -> Failed to download datastream: ${oid}/${fileId}`);
            sails.log.error(error);
          }
        } else {
          sails.log.error(`${this.logHeader} getDatastream() -> Can't find datastream: ${oid}, fileId: ${fileId}`);
          throw new Error(`Can't find attachment: ${oid}/${fileId}`);
        }
      } catch (error) {
        sails.log.error(`${this.logHeader} getDatastream() -> Error trying to find datastream: ${oid}, fileId: ${fileId}`);
        sails.log.error(error);
      }
    }

    private async downloadFromS3(oid, fileId, attachRecord) {
      const downloadParams = _.clone(this.s3BucketParams);
      if (sails.config.datastreamCloud.useObjectBucketMetadata) {
        // override what's the default
        downloadParams['Bucket'] = attachRecord['bucket'];
      }
      downloadParams['Key'] = this.getKey(oid, fileId);
      sails.log.verbose(`${this.logHeader} downloadFromS3() -> Downloading:`);
      sails.log.verbose(JSON.stringify(downloadParams));
      return await this.s3Client.send(new GetObjectCommand(downloadParams));
    }

    public async listDatastreams(oid, fileId): Promise<any> {
      let query:any = {"redboxOid": oid};
      if (!_.isEmpty(fileId)) {
        query = {"metadata.fileId": fileId};
      }
      sails.log.verbose(`${this.logHeader} listDatastreams() -> Listing attachments of oid: ${oid}`);
      sails.log.verbose(JSON.stringify(query));
      return this.convertToAttachmentArr(oid, await CloudAttachment.find(query).meta({enableExperimentalDeepTargets:true}));
    }

    private getUuid():string {
      return uuidv1().replace(/-/g, '');
    }

    /**
     * Convert to shape meant for Client consumption, stripping other details, e.g. bucket, etc.
     * 
     * @param attachments 
     * @returns 
     */
    private convertToAttachmentArr(oid:string, attachments: any[]) {
      const attMetaArr = [];
      for (const att of attachments) {
        const attMeta = {};
        attMeta['uploadDate'] = _.get(att, 'lastSaveDate');
        _.set(attMeta, 'metadata.name', _.get(att, 'metadata.name'));
        _.set(attMeta, 'metadata.mimeType', _.get(att, 'metadata.mimeType'));
        _.set(attMeta, 'redboxOid', oid);
        attMetaArr.push(attMeta);
      }
      return attMetaArr;
    }

    private getKey(oid, fileId) {
      return `${sails.config.datastreamCloud.keyPrefix}${oid}/${fileId}`;
    }
  }
}
// TODO: more specific consumers can specify different cloud type / destination
class CloudDatastream extends Datastream {
  public cloudType: string;
  
  constructor(data:any = undefined) {
    super(data);
    if (data) {
      this.cloudType = data['cloudType'];
    }
  }
}

module.exports = new Services.CloudDatastreamService().exports();