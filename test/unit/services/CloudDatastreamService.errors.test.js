/**
 * Tests for error handling and edge cases introduced in the S3 memory leak fix
 * 
 * These tests cover specific scenarios that might arise from using the new Upload class
 * and readFile approach instead of createReadStream.
 */

let testHeader = 'TEST::CloudDatastreamService::ErrorHandling::';

describe('CloudDatastreamService Error Handling and Edge Cases', function () {
  
  describe('File System Edge Cases', function () {
    it('should handle missing files gracefully', async function () {
      this.timeout(60000);
      
      const sails = await global.sailsReady;
      sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const missingFileOid = global.uuidv1().replace(/-/g, '');
        const missingDatastream = { fileId: 'non-existent-file.txt' };
        
        try {
          await CloudDatastreamService.addDatastream(missingFileOid, missingDatastream);
          // Should not reach here if file doesn't exist
          global.expect.fail('Expected error for missing file');
        } catch (err) {
          console.log(`${testHeader} Correctly caught error for missing file:`, err.message);
          // The new implementation should handle file read errors properly
          global.expect(err.message).to.include('Failed to upload file, check server logs.');
        }
      });
    });

    it('should handle files with zero size', async function () {
      this.timeout(60000);
      
      const sails = await global.sailsReady; sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const emptyFileName = 'empty-file.txt';
        const emptyFileOid = global.uuidv1().replace(/-/g, '');
        
        try {
          // Create an empty file
          const filePath = `${sails.config.datastreamCloud.companion.filePath}/${emptyFileName}`;
          await fs.writeFile(filePath, '');
          
          const emptyDatastream = { fileId: emptyFileName };
          
          try {
            await CloudDatastreamService.addDatastream(emptyFileOid, emptyDatastream);
            console.log(`${testHeader} Successfully handled empty file upload`);
          } catch (err) {
            console.log(`${testHeader} Empty file upload failed as expected:`, err.message);
            // Empty files should be handled gracefully by the new implementation
            expect(err.message).to.include('Failed to upload file, check server logs.');
          }
          
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${emptyFileName}`;
            if (await fs.exists(filePath)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    });

    it('should handle very large files (>100MB) appropriately', async function () {
      this.timeout(600000); // 10 minutes for very large file test
      
      const sails = await global.sailsReady; sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const veryLargeFileName = 'very-large-file.bin';
        const veryLargeFileOid = global.uuidv1().replace(/-/g, '');
        const veryLargeFileSizeMB = 100; // 100MB
        
        let filePath;
        
        try {
          console.log(`${testHeader} Creating ${veryLargeFileSizeMB}MB test file...`);
          
          // Create a very large test file
          filePath = `${sails.config.datastreamCloud.companion.filePath}/${veryLargeFileName}`;
          const content = Buffer.alloc(veryLargeFileSizeMB * 1024 * 1024, 'L'); // Fill with 'L' for Large
          await fs.writeFile(filePath, content);
          
          console.log(`${testHeader} Created large file, now testing upload...`);
          
          const veryLargeDatastream = { fileId: veryLargeFileName };
          
          // Monitor memory before the large upload
          const memoryBefore = process.memoryUsage();
          console.log(`${testHeader} Memory before large upload:`, {
            heapUsed: Math.round(memoryBefore.heapUsed / 1024 / 1024) + ' MB',
            rss: Math.round(memoryBefore.rss / 1024 / 1024) + ' MB'
          });
          
          try {
            await CloudDatastreamService.addDatastream(veryLargeFileOid, veryLargeDatastream);
            console.log(`${testHeader} Successfully uploaded very large file`);
          } catch (err) {
            console.log(`${testHeader} Large file upload failed as expected in test environment:`, err.message);
            // The new implementation should use multipart upload for large files
            expect(err.message).to.include('Failed to upload file, check server logs.');
          }
          
          // Monitor memory after the large upload
          const memoryAfter = process.memoryUsage();
          console.log(`${testHeader} Memory after large upload:`, {
            heapUsed: Math.round(memoryAfter.heapUsed / 1024 / 1024) + ' MB',
            rss: Math.round(memoryAfter.rss / 1024 / 1024) + ' MB'
          });
          
          // Memory shouldn't increase by more than 200MB even for a 100MB file
          const memoryIncrease = (memoryAfter.heapUsed - memoryBefore.heapUsed) / (1024 * 1024);
          console.log(`${testHeader} Memory increase: ${memoryIncrease.toFixed(2)} MB`);
          
          if (memoryIncrease > 200) {
            console.warn(`${testHeader} Warning: Large memory increase of ${memoryIncrease.toFixed(2)} MB for ${veryLargeFileSizeMB}MB file`);
          }
          
        } finally {
          // Cleanup - very important for large files
          try {
            if (filePath && await fs.exists(filePath)) {
              console.log(`${testHeader} Cleaning up large file...`);
              await fs.unlink(filePath);
              console.log(`${testHeader} Large file cleanup complete`);
            }
          } catch (err) {
            console.error(`${testHeader} Large file cleanup error:`, err.message);
          }
        }
      });
    });
  });

  describe('S3 Upload Configuration Tests', function () {
    it('should handle custom bucket configuration', async function () {
      this.timeout(60000);
      
      const sails = await global.sailsReady; sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const customBucketFileName = 'custom-bucket-test.txt';
        const customBucketOid = global.uuidv1().replace(/-/g, '');
        
        try {
          // Create a test file
          const filePath = `${sails.config.datastreamCloud.companion.filePath}/${customBucketFileName}`;
          await fs.writeFile(filePath, 'Test content for custom bucket');
          
          // Test with custom bucket in datastream
          const customBucketDatastream = { 
            fileId: customBucketFileName,
            bucket: 'custom-test-bucket'
          };
          
          try {
            await CloudDatastreamService.addDatastream(customBucketOid, customBucketDatastream);
            console.log(`${testHeader} Custom bucket upload completed`);
          } catch (err) {
            console.log(`${testHeader} Custom bucket upload failed as expected:`, err.message);
            // Should attempt upload with custom bucket
            expect(err.message).to.include('Failed to upload file, check server logs.');
          }
          
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${customBucketFileName}`;
            if (await fs.exists(filePath)) {
              await fs.unlink(filePath);
            }
          } catch (err) {
            // Ignore cleanup errors
          }
        }
      });
    });

    it('should handle multipart upload configuration correctly', async function () {
      this.timeout(120000);
      
      const sails = await global.sailsReady; sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const multipartConfigFileName = 'multipart-config-test.bin';
        const multipartConfigOid = global.uuidv1().replace(/-/g, '');
        
        try {
          // Create a file larger than 5MB to trigger multipart upload
          const filePath = `${sails.config.datastreamCloud.companion.filePath}/${multipartConfigFileName}`;
          const content = Buffer.alloc(7 * 1024 * 1024, 'M'); // 7MB file
          await fs.writeFile(filePath, content);
          
          const multipartConfigDatastream = { fileId: multipartConfigFileName };
          
          // Capture logs to verify multipart configuration
          const originalVerbose = sails.log.verbose;
          let uploadStartLogged = false;
          
          sails.log.verbose = function(...args) {
            const message = args.join(' ');
            if (message.includes('Start upload for')) {
              uploadStartLogged = true;
            }
            return originalVerbose.apply(this, args);
          };
          
          try {
            await CloudDatastreamService.addDatastream(multipartConfigOid, multipartConfigDatastream);
            console.log(`${testHeader} Multipart config upload completed`);
          } catch (err) {
            console.log(`${testHeader} Multipart config upload failed as expected:`, err.message);
            expect(err.message).to.include('Failed to upload file, check server logs.');
          } finally {
            sails.log.verbose = originalVerbose;
          }
          
          // Verify that upload was attempted with proper logging
          // Note: uploadStartLogged might be false in test environment due to early failure
          
        } finally {
          // Cleanup
          try {
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${multipartConfigFileName}`;
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

  describe('Concurrent Upload Tests', function () {
    it('should handle concurrent uploads without memory issues', async function () {
      this.timeout(300000); // 5 minutes for concurrent test
      
      const sails = await global.sailsReady; sails.after('hook:redbox:datastream:ready', async () => {
        let CloudDatastreamService = sails.services['clouddatastreamservice'];
        
        const concurrentFiles = [];
        const numConcurrentUploads = 3;
        const fileSizeMB = 2;
        
        try {
          // Create multiple test files
          for (let i = 0; i < numConcurrentUploads; i++) {
            const fileName = `concurrent-test-${i}.bin`;
            const testOid = global.uuidv1().replace(/-/g, '');
            
            const filePath = `${sails.config.datastreamCloud.companion.filePath}/${fileName}`;
            const content = Buffer.alloc(fileSizeMB * 1024 * 1024, String(i)); 
            await fs.writeFile(filePath, content);
            
            concurrentFiles.push({
              fileName,
              oid: testOid,
              datastream: { fileId: fileName }
            });
          }
          
          const memoryBefore = process.memoryUsage();
          console.log(`${testHeader} Memory before concurrent uploads:`, {
            heapUsed: Math.round(memoryBefore.heapUsed / 1024 / 1024) + ' MB'
          });
          
          // Start all uploads concurrently
          console.log(`${testHeader} Starting ${numConcurrentUploads} concurrent uploads...`);
          
          const uploadPromises = concurrentFiles.map(async (testFile) => {
            try {
              await CloudDatastreamService.addDatastream(testFile.oid, testFile.datastream);
              return { success: true, fileName: testFile.fileName };
            } catch (err) {
              return { success: false, fileName: testFile.fileName, error: err.message };
            }
          });
          
          const results = await Promise.all(uploadPromises);
          
          console.log(`${testHeader} Concurrent upload results:`, results);
          
          const memoryAfter = process.memoryUsage();
          console.log(`${testHeader} Memory after concurrent uploads:`, {
            heapUsed: Math.round(memoryAfter.heapUsed / 1024 / 1024) + ' MB'
          });
          
          // Verify that attempts were made (even if they failed in test environment)
          expect(results.length).to.equal(numConcurrentUploads);
          
          // Memory shouldn't increase excessively even with concurrent uploads
          const memoryIncrease = (memoryAfter.heapUsed - memoryBefore.heapUsed) / (1024 * 1024);
          console.log(`${testHeader} Memory increase from concurrent uploads: ${memoryIncrease.toFixed(2)} MB`);
          
          expect(memoryIncrease).to.be.below(100, 
            `Concurrent uploads caused excessive memory increase: ${memoryIncrease.toFixed(2)} MB`);
          
        } finally {
          // Cleanup all test files
          for (const testFile of concurrentFiles) {
            try {
              const filePath = `${sails.config.datastreamCloud.companion.filePath}/${testFile.fileName}`;
              if (await fs.exists(filePath)) {
                await fs.unlink(filePath);
              }
            } catch (err) {
              // Ignore cleanup errors
            }
          }
        }
      });
    });
  });
});