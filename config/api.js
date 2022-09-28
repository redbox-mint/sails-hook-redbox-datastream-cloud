module.exports.api = {
  additionalClientConfig: {
    uppyAttachmentTarget: "s3",
    companionPath: "companion",
    companionConfig: {
      // See https://uppy.io/docs/aws-s3/#Options
      allowedMetaFields: null,
      limit: 1
    }
  }
};