let oid = null;
let datastream = null;
let sampleRecordFile = 'sample-rdmp.json';
let sampleRecordFilePath = `/opt/sails-hook-redbox-datastream-cloud/test/unit/services/${sampleRecordFile}`;
let testHeader = 'TEST::CloudDatastreamService::';
describe('The CloudDatastreamService', function () {
  before(async function () {
    this.timeout(60000);
    oid = uuidv1().replace(/-/g, '');
    datastream = {fileId: sampleRecordFile};
    await fs.mkdir(sails.config.datastreamCloud.companion.filePath, {recursive: true});
    await fs.copy(sampleRecordFilePath, `${sails.config.datastreamCloud.companion.filePath}/${sampleRecordFile}`);
    sails.log.verbose(`${testHeader} before() -> We're good to go!`);
  });

  it('can add, retrieve, remove and list datastream', async function () {
    this.timeout(60000);
    sails.after('hook:redbox:datastream:ready', async () => {
      let CloudDatastreamService = sails.services['clouddatastreamservice'];
      await CloudDatastreamService.addDatastream(oid, datastream);
      // verify
      let attachments = await CloudDatastreamService.listDatastreams(oid, datastream.fileId);
      expect(attachments).to.be.an('array');
      expect(attachments).to.have.length(1);
      expect(attachments[0]).have.property('name', datastream.fileId);
      // retrieve
      let attachment = await CloudDatastreamService.getDatastream(oid, datastream.fileId);
      expect(attachment).to.be.ok();
      expect(attachment.readstream).to.be.ok();
      // remove
      await CloudDatastreamService.removeDatastream(oid, datastream.fileId);
      attachments = await CloudDatastreamService.listDatastreams(oid, datastream.fileId);
      expect(attachments).to.be.an('array');
      expect(attachments).to.be.empty();
    });
  });
});
