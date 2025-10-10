describe('Bootstrap tests ::', function() {
  // Test that Sails can lift with the hook in place
  it ('Bootstrap:: Sails does not crash with the hook installed.', async function() {
    this.timeout(500000);
    const sailsInstance = await global.sailsReady;
    expect(sailsInstance).to.exist;
  });
});
