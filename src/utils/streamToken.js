/**
 * Stream token utilities for encoding/decoding stream parameters
 * This allows external players to receive all parameters in the URL path
 * instead of query parameters, which may get stripped by some players.
 */

/**
 * Encode stream parameters into a URL-safe token
 * @param {object} params - Stream parameters
 * @returns {string} Base64-encoded token
 */
function encodeStreamToken(params) {
  const json = JSON.stringify(params);
  const base64 = Buffer.from(json).toString('base64');
  // Make URL-safe by replacing characters
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decode stream token back to parameters
 * @param {string} token - Base64-encoded token
 * @returns {object|null} Decoded parameters or null if invalid
 */
function decodeStreamToken(token) {
  try {
    // Reverse URL-safe encoding
    let base64 = token
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }

    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    console.error('[TOKEN] Failed to decode stream token:', error.message);
    return null;
  }
}

/**
 * Extract stream parameters from request (supports both token and query params)
 * @param {object} req - Express request object
 * @returns {object|null} Stream parameters or null if invalid
 */
function extractStreamParams(req) {
  // Try token-based URL first (preferred for external players)
  if (req.params && req.params.token) {
    console.log('[TOKEN] Extracting parameters from token');
    const params = decodeStreamToken(req.params.token);
    if (params) {
      console.log('[TOKEN] Successfully decoded token parameters');
      return params;
    }
    console.warn('[TOKEN] Failed to decode token, falling back to query params');
  }

  // Fallback to query parameters (for backward compatibility)
  if (req.query && req.query.downloadUrl) {
    console.log('[TOKEN] Using query parameters (legacy mode)');
    return {
      downloadUrl: req.query.downloadUrl,
      type: req.query.type || 'movie',
      id: req.query.id || '',
      title: req.query.title || 'NZB Stream',
      indexerId: req.query.indexerId,
      guid: req.query.guid,
      size: req.query.size,
      historyNzoId: req.query.historyNzoId,
      historyJobName: req.query.historyJobName,
      historyCategory: req.query.historyCategory
    };
  }

  return null;
}

module.exports = {
  encodeStreamToken,
  decodeStreamToken,
  extractStreamParams
};
