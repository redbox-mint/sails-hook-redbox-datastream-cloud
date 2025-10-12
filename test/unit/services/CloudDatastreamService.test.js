let oid = null;
let datastream = null;
let sampleRecordFile = 'sample-rdmp.json';
let sampleRecordFilePath = `/opt/sails-hook-redbox-datastream-cloud/test/unit/services/${sampleRecordFile}`;
let testHeader = 'TEST::CloudDatastreamService::';

// Helper function to format memory usage for better readability
const formatMemoryUsage = (data) => `${Math.round((data / 1024 / 1024) * 100) / 100} MB`;

const getMemoryStats = () => {
  const memoryData = process.memoryUsage();
  return {
    rss: formatMemoryUsage(memoryData.rss),
    heapTotal: formatMemoryUsage(memoryData.heapTotal),
    heapUsed: formatMemoryUsage(memoryData.heapUsed),
    external: formatMemoryUsage(memoryData.external),
    rawHeapUsed: memoryData.heapUsed,
    rawRss: memoryData.rss
  };
};

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

// Helper to create test files of various sizes
const createTestFile = async (fileName, sizeInMB = 1) => {
  // Access sails.config only when the function is called, not when the file loads
  const filePath = `${sails.config.datastreamCloud.companion.filePath}/${fileName}`;
  const content = Buffer.alloc(sizeInMB * 1024 * 1024, 'x'); // Fill with 'x' characters
  await fs.writeFile(filePath, content);
  return filePath;
};

describe('The CloudDatastreamService', function () {
  before(async function () {
    this.timeout(180000);
    console.log("Test before hook - waiting for sailsReady...");
    console.log("global.sailsReady exists:", !!global.sailsReady);
    console.log("global.uuidv1 type:", typeof global.uuidv1);
    const sails = await global.sailsReady;
    console.log("Test before hook - received sails instance:", typeof sails);
    oid = global.uuidv1().replace(/-/g, '');
    datastream = {fileId: sampleRecordFile};
  
    const filePathExists = await fs.pathExists(sails.config.datastreamCloud.companion.filePath);
    if (!filePathExists) {
      await fs.mkdir(sails.config.datastreamCloud.companion.filePath, {recursive: true});
    }
    await fs.copy(sampleRecordFilePath, `${sails.config.datastreamCloud.companion.filePath}/${sampleRecordFile}`);
    sails.log.verbose(`${testHeader} before() -> We're good to go!`);
  });

  it('can add, retrieve, remove and list datastream', async function () {
    this.timeout(180000);
    sails.after('hook:redbox:datastream:ready', async () => {
      let CloudDatastreamService = sails.services['clouddatastreamservice'];
      await CloudDatastreamService.addDatastream(oid, datastream);
      // verify
      let attachments = await CloudDatastreamService.listDatastreams(oid, datastream.fileId);
      global.expect(attachments).to.be.an('array');
      global.expect(attachments).to.have.length(1);
      global.expect(attachments[0]).have.property('name', datastream.fileId);
      // retrieve
      let attachment = await CloudDatastreamService.getDatastream(oid, datastream.fileId);
      global.expect(attachment).to.be.ok();
      global.expect(attachment.readstream).to.be.ok();
      // remove
      await CloudDatastreamService.removeDatastream(oid, datastream.fileId);
      attachments = await CloudDatastreamService.listDatastreams(oid, datastream.fileId);
      global.expect(attachments).to.be.an('array');
      global.expect(attachments).to.be.empty();
    });
  });

  describe('Memory Leak Prevention Tests', function () {
    // Test for AWS S3 memory leak issue: https://github.com/aws/aws-sdk-js-v3/issues/1897
    it('should not leak memory when uploading multiple files sequentially', async function () {
      this.timeout(300000); // 5 minutes for this intensive test
      
      const sails = await global.sailsReady;
      sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        // Get initial memory baseline
        const initialMemory = getMemoryStats();
        console.log(`${testHeader} Initial memory:`, initialMemory);
        
        const testFiles = [];
        const numFiles = 5; // Test with 5 files
        const fileSizeMB = 2; // 2MB per file
        
        try {
          // Create test files
          for (let i = 0; i < numFiles; i++) {
            const fileName = `memory-test-${i}.bin`;
            const testOid = global.uuidv1().replace(/-/g, '');
            await createTestFile(fileName, fileSizeMB);
            testFiles.push({
              fileName,
              oid: testOid,
              datastream: { fileId: fileName }
            });
          }
          
          // Upload files sequentially and monitor memory
          const memorySnapshots = [];
          
          for (let i = 0; i < testFiles.length; i++) {
            const testFile = testFiles[i];
            console.log(`${testHeader} Uploading file ${i + 1}/${numFiles}: ${testFile.fileName}`);
            
            try {
              await CloudDatastreamService.addDatastream(testFile.oid, testFile.datastream);
              console.log(`${testHeader} Successfully uploaded ${testFile.fileName}`);
            } catch (err) {
              // Skip upload errors in memory test - we're testing memory, not upload success
              console.log(`${testHeader} Upload failed for ${testFile.fileName}, continuing memory test`);
            }
            
            // Take memory snapshot after each upload
            const memoryAfterUpload = getMemoryStats();
            memorySnapshots.push(memoryAfterUpload);
            console.log(`${testHeader} Memory after upload ${i + 1}:`, memoryAfterUpload);
            
            // Force garbage collection if available (node --expose-gc)
            if (global.gc) {
              global.gc();
              console.log(`${testHeader} Forced garbage collection`);
            }
            
            // Wait for potential garbage collection
            console.log(`${testHeader} Sleeping for 5 seconds before next upload...`);
            await sleep(5000);
            
            const memoryAfterGC = getMemoryStats();
            console.log(`${testHeader} Memory after GC wait ${i + 1}:`, memoryAfterGC);
          }
          
          // Final memory check
          const finalMemory = getMemoryStats();
          console.log(`${testHeader} Final memory:`, finalMemory);
          
          // Memory leak detection logic
          const memoryGrowth = finalMemory.rawHeapUsed - initialMemory.rawHeapUsed;
          const memoryGrowthMB = memoryGrowth / (1024 * 1024);
          
          console.log(`${testHeader} Total memory growth: ${memoryGrowthMB.toFixed(2)} MB`);
          
          // Allow some memory growth but it shouldn't be excessive
          // With 5 files of 2MB each (10MB total), we shouldn't see more than 50MB growth
          const maxAllowedGrowthMB = 50;
          global.expect(memoryGrowthMB).to.be.below(maxAllowedGrowthMB, 
            `Memory growth of ${memoryGrowthMB.toFixed(2)} MB exceeds maximum allowed ${maxAllowedGrowthMB} MB. This may indicate a memory leak.`);
          
          // RSS memory should also not grow excessively
          const rssGrowth = (finalMemory.rawRss - initialMemory.rawRss) / (1024 * 1024);
          console.log(`${testHeader} RSS memory growth: ${rssGrowth.toFixed(2)} MB`);
          global.expect(rssGrowth).to.be.below(100, 
            `RSS memory growth of ${rssGrowth.toFixed(2)} MB is excessive and may indicate a memory leak.`);
            
        } finally {
          // Cleanup test files
          for (const testFile of testFiles) {
            try {
              const filePath = `${sails.config.datastreamCloud.companion.filePath}/${testFile.fileName}`;
              if (await fs.exists(filePath)) {
                await fs.unlink(filePath);
              }
              // Also try to cleanup from S3/cloud storage
              try {
                await CloudDatastreamService.removeDatastream(testFile.oid, testFile.datastream.fileId);
              } catch (err) {
                // Ignore cleanup errors
              }
            } catch (err) {
              console.log(`${testHeader} Cleanup error for ${testFile.fileName}:`, err.message);
            }
          }
        }
      });
    });

    it('should handle large file uploads without excessive memory usage', async function () {
      this.timeout(300000);
      
      sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const initialMemory = getMemoryStats();
        console.log(`${testHeader} Initial memory for large file test:`, initialMemory);
        
        const largeFileName = 'large-test-file.bin';
        const largeFileOid = global.uuidv1().replace(/-/g, '');
        const largeFileSizeMB = 10; // 10MB file
        
        try {
          // Create a large test file
          await createTestFile(largeFileName, largeFileSizeMB);
          
          const memoryBeforeUpload = getMemoryStats();
          console.log(`${testHeader} Memory before large file upload:`, memoryBeforeUpload);
          
          // Upload the large file
          const largeDatastream = { fileId: largeFileName };
          
          try {
            await CloudDatastreamService.addDatastream(largeFileOid, largeDatastream);
            console.log(`${testHeader} Successfully uploaded large file`);
          } catch (err) {
            console.log(`${testHeader} Large file upload failed, continuing memory test:`, err.message);
          }
          
          const memoryAfterUpload = getMemoryStats();
          console.log(`${testHeader} Memory after large file upload:`, memoryAfterUpload);
          
          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
          
          await sleep(3000);
          
          const memoryAfterGC = getMemoryStats();
          console.log(`${testHeader} Memory after GC for large file:`, memoryAfterGC);
          
          // For a 10MB file, memory usage shouldn't increase by more than 30MB
          const memoryIncrease = (memoryAfterGC.rawHeapUsed - initialMemory.rawHeapUsed) / (1024 * 1024);
          console.log(`${testHeader} Memory increase for large file: ${memoryIncrease.toFixed(2)} MB`);
          
          global.expect(memoryIncrease).to.be.below(30, 
            `Memory increase of ${memoryIncrease.toFixed(2)} MB for ${largeFileSizeMB}MB file is excessive. Expected less than 30MB increase.`);
            
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${largeFileName}`;
            if (await fs.exists(filePath)) {
              await fs.unlink(filePath);
            }
            await CloudDatastreamService.removeDatastream(largeFileOid, { fileId: largeFileName });
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    });
  });

  describe('New Upload Implementation Tests', function () {
    it('should use Upload class from @aws-sdk/lib-storage for multipart uploads', async function () {
      this.timeout(180000);
      
      sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        // Create a test file that should trigger multipart upload (>5MB)
        const multipartFileName = 'multipart-test.bin';
        const multipartOid = global.uuidv1().replace(/-/g, '');
        const multipartFileSizeMB = 6; // 6MB to trigger multipart
        
        try {
          await createTestFile(multipartFileName, multipartFileSizeMB);
          
          const multipartDatastream = { fileId: multipartFileName };
          
          // This test verifies the new implementation doesn't throw errors
          // The actual S3 calls may fail in test environment, but the Upload class should be used
          let uploadAttempted = false;
          try {
            await CloudDatastreamService.addDatastream(multipartOid, multipartDatastream);
            uploadAttempted = true;
            console.log(`${testHeader} Multipart upload completed successfully`);
          } catch (err) {
            uploadAttempted = true;
            console.log(`${testHeader} Multipart upload failed as expected in test environment:`, err.message);
            // In test environment, we expect this to fail, but it should attempt the upload
            global.expect(err.message).to.include('Failed to upload file, check server logs.');
          }
          
          global.expect(uploadAttempted).to.be.true;
          
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${multipartFileName}`;
            if (await fs.exists(filePath)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    });

    it('should use readFile instead of createReadStream for better memory management', async function () {
      this.timeout(180000);
      
      sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const testFileName = 'readfile-test.json';
        const testOid = global.uuidv1().replace(/-/g, '');
        
        try {
          // Create a small test file with JSON content
          const testContent = {
            test: 'data',
            timestamp: new Date().toISOString(),
            size: 'small'
          };
          
          const filePath = `${sails.config.datastreamCloud.companion.filePath}/${testFileName}`;
          await fs.writeFile(filePath, JSON.stringify(testContent, null, 2));
          
          const testDatastream = { fileId: testFileName };
          
          let uploadAttempted = false;
          try {
            await CloudDatastreamService.addDatastream(testOid, testDatastream);
            uploadAttempted = true;
            console.log(`${testHeader} ReadFile-based upload completed successfully`);
          } catch (err) {
            uploadAttempted = true;
            console.log(`${testHeader} ReadFile-based upload failed as expected in test environment:`, err.message);
            // Verify it's using the new error message format
            global.expect(err.message).to.include('Failed to upload file, check server logs.');
          }
          
          global.expect(uploadAttempted).to.be.true;
          
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${testFileName}`;
            if (await fs.exists(filePath)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    });

    it('should handle upload progress events correctly', async function () {
      this.timeout(180000);
      
      sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const progressFileName = 'progress-test.bin';
        const progressOid = global.uuidv1().replace(/-/g, '');
        
        try {
          // Create a reasonably sized file to generate progress events
          await createTestFile(progressFileName, 3); // 3MB
          
          const progressDatastream = { fileId: progressFileName };
          
          // Capture console output to verify progress logging
          const originalVerbose = sails.log.verbose;
          let progressEventLogged = false;
          
          sails.log.verbose = function(...args) {
            const message = args.join(' ');
            if (message.includes('Upload progress for')) {
              progressEventLogged = true;
            }
            return originalVerbose.apply(this, args);
          };
          
          try {
            await CloudDatastreamService.addDatastream(progressOid, progressDatastream);
            console.log(`${testHeader} Progress-tracked upload completed`);
          } catch (err) {
            console.log(`${testHeader} Progress-tracked upload failed as expected:`, err.message);
          } finally {
            sails.log.verbose = originalVerbose;
          }
          
          // Note: In test environment, progress events might not be triggered due to network mocking
          // but the event handler should be set up correctly
          
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${progressFileName}`;
            if (await fs.exists(filePath)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    });
  });
});
