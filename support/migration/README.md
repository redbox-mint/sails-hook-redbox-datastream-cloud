# MongoDB GridFS to Cloud Datastream S3 Migration

This [script](migrate.js) migrates datastream data stored in GridFS into any S3-like Cloud storage backeend.

The script will stream both the download and upload of datastream data.

## Configuration

- Clone the `sample-config.json`
- Edit the `connectionStr` of both `mongodb.source` and `mongodb.target` objects
- Edit the `s3` object. The sample configuration file is based on Minio storage backend. 
  - set `skipUploaded` to `true` if you want the script to check the target DB for the existence of the datastream prior to upload, set to `false` to reupload / update the datastream
  - set `logS3UploadProgress` to `true` log the upload progress 
- Create an entry in `~/.aws/credentials` for the profile to be used in this migration, e.g. for Minio configured with the development environment:
```
[minio]
aws_access_key_id = minioadmin
aws_secret_access_key = minioadmin
```
- Set the profile in the shell environment. e.g. `export AWS_PROFILE=minio`

## Running

`node migrate.js <path to configuration file>`

