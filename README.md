# sails-hook-redbox-datastream-cloud
A ReDBox Datastream Service implementation for Cloud storage services, e.g. AWS S3, etc.

## Design

### The Dream:

Files are uploaded from the user's browser to Cloud storage. 

For example, when configured with AWS S3:
```
┌─────────────────────┐                  ┌──────────────────────┐
│                     ├────────1─────────►                      │
│                     │                  │                      │
│ Browser Uppy Client ◄────────2─────────┤       ReDBox         │
│                     │                  │                      │
│                     ├────────4─────────►                      │
└─────────┬───────────┘                  └──────────┬───────────┘
          │                                         │
          3                                         5
          │                                         │
 ┌────────▼─────────┐                    ┌──────────▼───────────┐
 │                  │                    │                      │
 │        S3        │                    │       Database       │
 │                  │                    │                      │
 └──────────────────┘                    └──────────────────────┘
```
1. Uppy Client fetches a pre-signed URL from the Uppy Companion service
2. Uppy Companion returns the pre-signed URL. This feature requires the correct CORS configuration set on the S3 bucket. 
3. Uppy Client uploads the file to S3. ReDBox detects the file upload completion and updates the DB when required. 
4. Client saves record
5. ReDBox updates the DB with the file information, and optionally updates the S3 object with the correct metadata / key to indicate the save operation.

Note: As multi-part uploads are enabled, the S3 bucket CORS and Lifecycle configurations must be set to handle successful and failed uploads.

### The Reality:

Pending ReDBox Angular upgrade, none of the `@uppy/aws-s3` client libraries work with the version of Angular used in ReDBox. As such, TUS is retained as the intermediate server used in uploading files.

For example, when configured with AWS S3:

```
┌─────────────────────┐                  ┌──────────────────────┐
│                     ├────────1─────────►                      │
│                     │                  │                      │
│   Client Browser    │                  │        ReDBox        │
│                     ├────────2─────────►                      │
│                     │                  │                      │
└─────────────────────┘                  └────┬────────────┬────┘
                                              │            │
                                              3            4
                                              │            │
                               ┌──────────────▼───┐     ┌──▼────────────────┐
                               │                  │     │                   │
                               │        S3        │     │      Database     │
                               │                  │     │                   │
                               └──────────────────┘     └───────────────────┘
```
1. Client uploads file to ReDBox, saving the file in the staging location.
2. Client saves record.
3. ReDBox uploads to S3
4. ReDBox updates the DB with information about the uploaded file.

## Installation

`npm i @researchdatabox/sails-hook-redbox-datastream-cloud`

## Configuration

The default configuration assumes local development, using [Minio](https://min.io/).

In most cases, you will only need to modify the following S3-specific configuration:

- Endpoint
  - `datastreamCloud.companion.s3.endpoint` or preferably `HOOK_S3_ENDPOINT` environment variable
- Region
  - `datastreamCloud.companion.s3.region` or preferably `HOOK_S3_REGION` environment variable
- Bucket
  - `datastreamCloud.companion.s3.bucket` or preferably `HOOK_S3_BUCKET` environment variable
- Authentication
  - `datastreamCloud.companion.s3.key` & `datastreamCloud.companion.s3.secret`  or preferably, via the [AWS credentials file](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)
  - The development and test environment variable test scripts generate the credentials file using the `HOOK_S3_ACCESS_KEY` & `HOOK_S3_SECRET_KEY` environment variables. These enviroment variables are ignored outside of the development and test start up scripts, use a more production-ready way to populate those sensitive values.

NOTE: Though the current version is not using the Companion library, a bulk of the Companion-specific configuration block is retained for now.

## Migration


