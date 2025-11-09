const { getNzbdavCategory, buildNzbdavStream, proxyNzbdavStream, streamFailureVideo, buildNzbdavCacheKey } = require('../services/nzbdav');
const { parseRequestedEpisode } = require('../utils/parsers');
const { getOrCreateNzbdavStream } = require('../utils/cache');
const posixPath = require('path').posix;

/**
 * Map of video file extensions to MIME types
 */
const VIDEO_MIME_MAP = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.mov', 'video/quicktime'],
  ['.wmv', 'video/x-ms-wmv'],
  ['.flv', 'video/x-flv'],
  ['.ts', 'video/mp2t'],
  ['.m2ts', 'video/mp2t'],
  ['.mpg', 'video/mpeg'],
  ['.mpeg', 'video/mpeg']
]);

/**
 * Infer MIME type from file name
 * @param {string} fileName - File name with extension
 * @returns {string} MIME type
 */
function inferMimeType(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = posixPath.extname(fileName.toLowerCase());
  return VIDEO_MIME_MAP.get(ext) || 'application/octet-stream';
}

/**
 * Handle NZBDav stream requests
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function handleNzbdavStream(req, res) {
  const { downloadUrl, type = 'movie', id = '', title = 'NZB Stream' } = req.query;

  if (!downloadUrl) {
    res.status(400).json({ error: 'downloadUrl query parameter is required' });
    return;
  }

  try {
    const category = getNzbdavCategory(type);
    const requestedEpisode = parseRequestedEpisode(type, id, req.query || {});

    // Build cache key using service function
    const cacheKey = buildNzbdavCacheKey(downloadUrl, category, requestedEpisode);

    // Extract history slot hint from query params for reuse
    const existingSlotHint = req.query.historyNzoId
      ? {
          nzoId: req.query.historyNzoId,
          jobName: req.query.historyJobName,
          category: req.query.historyCategory
        }
      : null;

    const streamData = await getOrCreateNzbdavStream(cacheKey, () =>
      buildNzbdavStream({ downloadUrl, category, title, requestedEpisode, existingSlot: existingSlotHint })
    );

    // Handle HEAD requests before proxying
    if ((req.method || 'GET').toUpperCase() === 'HEAD') {
      const inferredMime = inferMimeType(streamData.fileName || title || 'stream');
      const totalSize = Number.isFinite(streamData.size) ? streamData.size : undefined;

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', inferredMime);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Content-Type,Accept-Ranges');
      res.setHeader('Content-Disposition', `inline; filename="${(streamData.fileName || 'stream').replace(/[\\/:*?"<>|]+/g, '_')}"`);

      if (Number.isFinite(totalSize)) {
        res.setHeader('Content-Length', String(totalSize));
        res.setHeader('X-Total-Length', String(totalSize));
      }

      res.status(200).end();
      return;
    }

    await proxyNzbdavStream(req, res, streamData.viewPath, streamData.fileName || '', streamData);
  } catch (error) {
    if (error?.isNzbdavFailure) {
      console.warn('[NZBDAV] Stream failure detected:', error.failureMessage || error.message);
      const served = await streamFailureVideo(req, res, error);
      if (!served && !res.headersSent) {
        res.status(502).json({ error: error.failureMessage || error.message });
      } else if (!served) {
        res.end();
      }
      return;
    }

    const statusCode = error.response?.status || 502;
    console.error('[NZBDAV] Stream proxy error:', error.message);
    if (!res.headersSent) {
      res.status(statusCode).json({ error: error.message });
    } else {
      res.end();
    }
  }
}

module.exports = {
  handleNzbdavStream
};
