const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const path = require('path');

// Configuration
const { PORT, MANIFEST_AUTH_PASSWORD } = require('./src/config/environment');
const { getManifestConfig } = require('./src/config/manifest');

// Handlers
const { handleStreamRequest } = require('./src/handlers/stream');
const { handleNzbdavStream } = require('./src/handlers/nzbStream');

// Middleware
const { validateUserData } = require('./src/middleware/auth');

// Utils
const { generateLandingPage } = require('./src/utils/landingPage');

// Create addon builder with base manifest
// If password is set, include config fields in manifest
const manifest = getManifestConfig(!!MANIFEST_AUTH_PASSWORD);
const builder = new addonBuilder(manifest);

// Define stream handler
builder.defineStreamHandler(async (args) => {
  try {
    return await handleStreamRequest(args);
  } catch (error) {
    console.error('[ERROR] Stream handler failed:', error.message);
    return { streams: [] };
  }
});

// Get the addon interface
const addonInterface = builder.getInterface();

// Create Express app for custom routes
const app = express();

// Serve static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Landing page routes
app.get('/', (req, res) => {
  if (MANIFEST_AUTH_PASSWORD) {
    res.redirect('/configure');
  } else {
    const manifest = getManifestConfig(false);
    res.send(generateLandingPage(manifest));
  }
});

app.get('/configure', (req, res) => {
  const manifest = getManifestConfig(MANIFEST_AUTH_PASSWORD ? true : false);
  res.send(generateLandingPage(manifest));
});

// Manifest routes (handled by SDK but we add auth middleware for user data)
// The SDK automatically adds these routes:
// - GET /manifest.json
// - GET /:userData/manifest.json
// - GET /stream/:type/:id.json
// - GET /:userData/stream/:type/:id.json

// However, we need to handle authentication for the user data routes
// This is done by wrapping the addon interface

// NZB stream endpoint (custom route not handled by SDK)
app.get('/nzb/stream', handleNzbdavStream);
app.head('/nzb/stream', handleNzbdavStream);

// Custom manifest endpoints to handle authentication properly
// These override the SDK's default manifest routes
app.get('/manifest.json', (req, res) => {
  if (MANIFEST_AUTH_PASSWORD) {
    // Return manifest with config requirement
    const manifest = getManifestConfig(true);
    res.json(manifest);
  } else {
    // No password, use SDK's manifest
    res.json(addonInterface.manifest);
  }
});

app.get('/:userData/manifest.json', validateUserData, (req, res) => {
  // User authenticated, return manifest without config requirement
  const manifest = getManifestConfig(false);
  res.json(manifest);
});

// Authentication middleware for stream routes with userData prefix
if (MANIFEST_AUTH_PASSWORD) {
  app.use('/:userData/stream', validateUserData);
}

// Mount the addon interface routes for stream endpoints
// The SDK's getRouter handles stream endpoints
const addonRouter = getRouter(addonInterface);
app.use(addonRouter);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`UsenetStreamer addon running at http://0.0.0.0:${PORT}`);
  console.log(`Manifest available at: http://0.0.0.0:${PORT}/manifest.json`);
});
