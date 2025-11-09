const axios = require('axios');
const xml2js = require('xml2js');
const {
  INDEXER_MANAGER,
  INDEXER_MANAGER_URL,
  INDEXER_MANAGER_API_KEY,
  INDEXER_MANAGER_STRICT_ID_MATCH,
  INDEXER_MANAGER_INDEXERS,
  INDEXER_MANAGER_BASE_URL,
  INDEXER_MANAGER_CACHE_MINUTES,
  INDEXER_MANAGER_LABEL,
  // Legacy exports for backward compatibility
  PROWLARR_URL,
  PROWLARR_API_KEY,
  PROWLARR_STRICT_ID_MATCH
} = require('../config/environment');
const { isTorrentResult } = require('../utils/parsers');
const { ensureProwlarrConfigured } = require('../utils/validators');

/**
 * Check if using Prowlarr as the indexer manager
 * @returns {boolean}
 */
function isUsingProwlarr() {
  return INDEXER_MANAGER === 'prowlarr';
}

/**
 * Check if using NZBHydra as the indexer manager
 * @returns {boolean}
 */
function isUsingNzbhydra() {
  return INDEXER_MANAGER === 'nzbhydra';
}

/**
 * Map plan type to NZBHydra search type
 * @param {string} planType - The search plan type
 * @returns {string} NZBHydra search type
 */
function mapHydraSearchType(planType) {
  if (planType === 'tvsearch' || planType === 'movie' || planType === 'search' || planType === 'book') {
    return planType;
  }
  return 'search';
}

/**
 * Apply a token to NZBHydra search params
 * @param {string} token - Token like {ImdbId:tt1234}
 * @param {object} params - Search params object to modify
 */
function applyTokenToHydraParams(token, params) {
  const match = token.match(/^\{([^:]+):(.*)\}$/);
  if (!match) {
    return;
  }
  const key = match[1].trim().toLowerCase();
  const rawValue = match[2].trim();

  switch (key) {
    case 'imdbid': {
      const value = rawValue.replace(/^tt/i, '');
      if (value) params.imdbid = value;
      break;
    }
    case 'tmdbid':
      if (rawValue) params.tmdbid = rawValue;
      break;
    case 'tvdbid':
      if (rawValue) params.tvdbid = rawValue;
      break;
    case 'season':
      if (rawValue) params.season = rawValue;
      break;
    case 'episode':
      if (rawValue) params.ep = rawValue;
      break;
    default:
      break;
  }
}

/**
 * Build search params for NZBHydra
 * @param {object} plan - Search plan
 * @returns {object} NZBHydra search params
 */
function buildHydraSearchParams(plan) {
  const params = {
    apikey: INDEXER_MANAGER_API_KEY,
    t: mapHydraSearchType(plan.type),
    o: 'json'
  };

  if (INDEXER_MANAGER_INDEXERS) {
    params.indexers = INDEXER_MANAGER_INDEXERS;
  }

  if (INDEXER_MANAGER_CACHE_MINUTES > 0) {
    params.cachetime = String(INDEXER_MANAGER_CACHE_MINUTES);
  }

  if (Array.isArray(plan.tokens)) {
    plan.tokens.forEach((token) => applyTokenToHydraParams(token, params));
  }

  if (plan.rawQuery) {
    params.q = plan.rawQuery;
  } else if ((!plan.tokens || plan.tokens.length === 0) && plan.query) {
    params.q = plan.query;
  }

  return params;
}

/**
 * Extract newznab attributes from NZBHydra item
 * @param {object} item - NZBHydra result item
 * @returns {object} Map of attribute names to values
 */
function extractHydraAttrMap(item) {
  const attrMap = {};
  const attrSources = [];

  const collectSource = (source) => {
    if (!source) return;
    if (Array.isArray(source)) {
      source.forEach((entry) => attrSources.push(entry));
    } else {
      attrSources.push(source);
    }
  };

  collectSource(item.attr);
  collectSource(item.attrs);
  collectSource(item.attributes);
  collectSource(item['newznab:attr']);
  collectSource(item['newznab:attrs']);

  attrSources.forEach((attr) => {
    if (!attr) return;
    const entry = attr['@attributes'] || attr.attributes || attr.$ || attr;
    const rawName =
      entry.name ??
      entry.Name ??
      entry['@name'] ??
      entry['@Name'] ??
      entry.key ??
      entry.Key ??
      entry['@key'] ??
      entry['@Key'] ??
      entry.field ??
      entry.Field ??
      '';
    const name = rawName.toString().trim().toLowerCase();
    if (!name) return;
    const value =
      entry.value ??
      entry.Value ??
      entry['@value'] ??
      entry['@Value'] ??
      entry.val ??
      entry.Val ??
      entry.content ??
      entry.Content ??
      entry['#text'] ??
      entry.text ??
      entry['@text'];
    if (value !== undefined && value !== null) {
      attrMap[name] = value;
    }
  });

  return attrMap;
}

/**
 * Normalize NZBHydra results to standard format
 * @param {object} data - NZBHydra response data
 * @returns {Array} Normalized results array
 */
function normalizeHydraResults(data) {
  if (!data) return [];

  const resolveItems = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.item) return resolveItems(payload.item);
    return [payload];
  };

  const channel = data.channel || data.rss?.channel || data['rss']?.channel;
  const items = resolveItems(channel || data.item || []);

  const results = [];

  for (const item of items) {
    if (!item) continue;
    const title = item.title || item['title'] || null;

    let downloadUrl = null;
    const enclosure = item.enclosure || item['enclosure'];
    if (enclosure) {
      const enclosureObj = Array.isArray(enclosure) ? enclosure[0] : enclosure;
      downloadUrl = enclosureObj?.url || enclosureObj?.['@url'] || enclosureObj?.href || enclosureObj?.link;
    }
    if (!downloadUrl) {
      downloadUrl = item.link || item['link'];
    }
    if (!downloadUrl) {
      const guid = item.guid || item['guid'];
      if (typeof guid === 'string') {
        downloadUrl = guid;
      } else if (guid && typeof guid === 'object') {
        downloadUrl = guid._ || guid['#text'] || guid.url || guid.href;
      }
    }
    if (!downloadUrl) {
      continue;
    }

    const attrMap = extractHydraAttrMap(item);
    const resolveFirst = (...candidates) => {
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        if (Array.isArray(candidate)) {
          const inner = resolveFirst(...candidate);
          if (inner !== undefined && inner !== null) return inner;
          continue;
        }
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (!trimmed) continue;
          return trimmed;
        }
        return candidate;
      }
      return undefined;
    };

    const enclosureObj = Array.isArray(enclosure) ? enclosure?.[0] : enclosure;
    const enclosureLength = enclosureObj?.length || enclosureObj?.['@length'] || enclosureObj?.['$']?.length || enclosureObj?.['@attributes']?.length;

    const sizeValue = resolveFirst(
      attrMap.size,
      attrMap.filesize,
      attrMap['contentlength'],
      attrMap['content-length'],
      attrMap.length,
      attrMap.nzbsize,
      item.size,
      item.Size,
      enclosureLength
    );
    const parsedSize = sizeValue !== undefined ? Number.parseInt(String(sizeValue), 10) : NaN;
    const indexer = resolveFirst(
      attrMap.indexername,
      attrMap.indexer,
      attrMap['hydraindexername'],
      attrMap['hydraindexer'],
      item.hydraIndexerName,
      item.hydraindexername,
      item.hydraIndexer,
      item.hydraindexer,
      item.indexer,
      item.Indexer
    );
    const indexerId = resolveFirst(attrMap.indexerid, attrMap['hydraindexerid'], item.hydraIndexerId, item.hydraindexerid, indexer) || 'nzbhydra';

    const guidRaw = item.guid || item['guid'];
    let guidValue = null;
    if (typeof guidRaw === 'string') {
      guidValue = guidRaw;
    } else if (guidRaw && typeof guidRaw === 'object') {
      guidValue = guidRaw._ || guidRaw['#text'] || guidRaw.url || guidRaw.href || null;
    }

    results.push({
      title: title || downloadUrl,
      downloadUrl,
      guid: guidValue,
      size: Number.isFinite(parsedSize) ? parsedSize : undefined,
      indexer,
      indexerId
    });
  }

  return results;
}

/**
 * Execute NZBHydra search
 * @param {object} plan - Search plan
 * @returns {Promise<Array>} Search results
 */
async function executeNzbhydraSearch(plan) {
  const params = buildHydraSearchParams(plan);
  const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api`, {
    params,
    timeout: 60000
  });
  return normalizeHydraResults(response.data);
}

/**
 * Build search params for Prowlarr
 * @param {object} plan - Search plan
 * @returns {object} Prowlarr search params
 */
function buildProwlarrSearchParams(plan) {
  return {
    limit: '100',
    offset: '0',
    type: plan.type,
    query: plan.query,
    indexerIds: INDEXER_MANAGER_INDEXERS || '-1'
  };
}

/**
 * Execute Prowlarr search
 * @param {object} plan - Search plan
 * @returns {Promise<Array>} Search results
 */
async function executeProwlarrSearch(plan) {
  const params = buildProwlarrSearchParams(plan);
  const response = await axios.get(`${INDEXER_MANAGER_BASE_URL}/api/v1/search`, {
    params,
    headers: { 'X-Api-Key': INDEXER_MANAGER_API_KEY },
    timeout: 60000
  });
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * Execute indexer search plan (routes to Prowlarr or NZBHydra)
 * @param {object} plan - Search plan
 * @returns {Promise<Array>} Search results
 */
function executeIndexerPlan(plan) {
  if (isUsingNzbhydra()) {
    return executeNzbhydraSearch(plan);
  }
  return executeProwlarrSearch(plan);
}

/**
 * Fetch available indexers from Prowlarr with their categories
 * @returns {Promise<Array>} Array of indexer objects with id, name, protocol, and categories
 */
async function getIndexers() {
  ensureProwlarrConfigured();

  try {
    const response = await axios.get(`${PROWLARR_URL}/api/v1/indexer`, {
      headers: { 'X-Api-Key': PROWLARR_API_KEY },
      timeout: 10000
    });

    const indexers = Array.isArray(response.data) ? response.data : [];

    // Filter to only enabled indexers and map to format with categories
    const enabledIndexers = indexers
      .filter(indexer => indexer && indexer.enable === true)
      .map(indexer => {
        // Extract categories from capabilities with error handling
        const categories = [];
        try {
          if (indexer.capabilities && indexer.capabilities.categories && Array.isArray(indexer.capabilities.categories)) {
            indexer.capabilities.categories.forEach(cat => {
              if (!cat || !cat.id || !cat.name) return;

              // Main category
              categories.push({
                id: cat.id,
                name: cat.name
              });

              // Subcategories if they exist
              if (cat.subCategories && Array.isArray(cat.subCategories)) {
                cat.subCategories.forEach(subCat => {
                  if (!subCat || !subCat.id || !subCat.name) return;
                  categories.push({
                    id: subCat.id,
                    name: `${cat.name} > ${subCat.name}`
                  });
                });
              }
            });
          }
        } catch (error) {
          console.warn(`[PROWLARR] Failed to extract categories for indexer ${indexer.name}:`, error.message);
        }

        return {
          id: indexer.id,
          name: indexer.name,
          protocol: indexer.protocol,
          priority: indexer.priority || 25,
          categories: categories
        };
      })
      .sort((a, b) => {
        // Sort by priority (lower number = higher priority), then by name
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.name.localeCompare(b.name);
      });

    console.log(`[PROWLARR] Retrieved ${enabledIndexers.length} enabled indexers with categories`);
    return enabledIndexers;
  } catch (error) {
    console.error('[PROWLARR] Failed to fetch indexers:', error.message);
    throw new Error(`Failed to fetch Prowlarr indexers: ${error.message}`);
  }
}

/**
 * Search Prowlarr for content
 * @param {object} params - Search parameters
 * @param {object} params.metaIds - Object with imdb, tmdb, tvdb IDs
 * @param {string} params.type - Content type (movie, series, etc.)
 * @param {string} params.movieTitle - Title of the content
 * @param {number} params.releaseYear - Release year
 * @param {number} params.seasonNum - Season number (for series)
 * @param {number} params.episodeNum - Episode number (for series)
 * @param {string} params.primaryId - Primary IMDb ID
 * @param {Array<number>} params.selectedIndexers - Array of indexer IDs to search (optional, defaults to all)
 * @param {object} params.selectedCategories - Object mapping indexer IDs to category IDs (optional)
 * @returns {Promise<Array>} Array of search results
 */
async function searchProwlarr({ metaIds, type, movieTitle, releaseYear, seasonNum, episodeNum, primaryId, selectedIndexers, selectedCategories }) {
  ensureProwlarrConfigured();

  let searchType;
  if (type === 'series') {
    searchType = 'tvsearch';
  } else if (type === 'movie') {
    searchType = 'movie';
  } else {
    searchType = 'search';
  }

  const seasonToken = Number.isFinite(seasonNum) ? `{Season:${seasonNum}}` : null;
  const episodeToken = Number.isFinite(episodeNum) ? `{Episode:${episodeNum}}` : null;

  const searchPlans = [];
  const seenPlans = new Set();

  const addPlan = (planType, { tokens = [], rawQuery = null } = {}) => {
    let query = rawQuery;
    if (!query) {
      const tokenList = [...tokens];
      if (planType === 'tvsearch') {
        if (seasonToken) tokenList.push(seasonToken);
        if (episodeToken) tokenList.push(episodeToken);
      }
      query = tokenList.filter(Boolean).join(' ');
    }
    if (!query) {
      return false;
    }
    const planKey = `${planType}|${query}`;
    if (seenPlans.has(planKey)) {
      return false;
    }
    seenPlans.add(planKey);
    searchPlans.push({ type: planType, query, tokens });
    return true;
  };

  // Add ID-based searches
  if (metaIds.imdb) {
    addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
  }

  if (type === 'series' && metaIds.tvdb) {
    addPlan('tvsearch', { tokens: [`{TvdbId:${metaIds.tvdb}}`] });
  }

  if (type === 'movie' && metaIds.tmdb) {
    addPlan('movie', { tokens: [`{TmdbId:${metaIds.tmdb}}`] });
  }

  if (searchPlans.length === 0 && metaIds.imdb) {
    addPlan(searchType, { tokens: [`{ImdbId:${metaIds.imdb}}`] });
  }

  // Add text-based search if not in strict mode
  if (!INDEXER_MANAGER_STRICT_ID_MATCH) {
    const textQueryParts = [];
    if (movieTitle) {
      textQueryParts.push(movieTitle);
    }
    if (type === 'movie' && Number.isFinite(releaseYear)) {
      textQueryParts.push(String(releaseYear));
    } else if (type === 'series' && Number.isFinite(seasonNum) && Number.isFinite(episodeNum)) {
      textQueryParts.push(`S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`);
    }

    const textQueryFallback = (textQueryParts.join(' ').trim() || primaryId).trim();
    const addedTextPlan = addPlan('search', { rawQuery: textQueryFallback, tokens: [] });
    if (addedTextPlan) {
      console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Added text search plan`, { query: textQueryFallback });
    } else {
      console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Text search plan already present`, { query: textQueryFallback });
    }
  } else {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Strict ID matching enabled; skipping text-based search`);
  }

  // Determine which indexers to use (Prowlarr-specific)
  let indexerIds = '-1'; // Default: all indexers
  if (selectedIndexers && Array.isArray(selectedIndexers) && selectedIndexers.length > 0) {
    // Use only selected indexers
    indexerIds = selectedIndexers.join(',');
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Using selected indexers: ${indexerIds}`);
  } else {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] No indexers selected, using all available indexers`);
  }

  // Determine which categories to use (Prowlarr-specific)
  // Collect all unique category IDs from all selected indexers
  let categories = null;
  if (selectedCategories && typeof selectedCategories === 'object' && Object.keys(selectedCategories).length > 0) {
    const categorySet = new Set();

    // If specific indexers are selected, only use categories for those indexers
    if (selectedIndexers && Array.isArray(selectedIndexers) && selectedIndexers.length > 0) {
      selectedIndexers.forEach(indexerId => {
        const indexerCategories = selectedCategories[String(indexerId)] || selectedCategories[indexerId];
        if (Array.isArray(indexerCategories) && indexerCategories.length > 0) {
          indexerCategories.forEach(catId => categorySet.add(catId));
        }
      });
    } else {
      // No specific indexers selected, use all category selections
      Object.values(selectedCategories).forEach(indexerCategories => {
        if (Array.isArray(indexerCategories) && indexerCategories.length > 0) {
          indexerCategories.forEach(catId => categorySet.add(catId));
        }
      });
    }

    if (categorySet.size > 0) {
      categories = Array.from(categorySet).join(',');
      console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Using selected categories: ${categories}`);
    } else {
      console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] No valid categories found in selection, using all categories`);
    }
  } else {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] No category filtering applied, using all categories`);
  }

  const deriveResultKey = (result) => {
    if (!result) return null;
    const indexerId = result.indexerId || result.IndexerId || 'unknown';
    const indexer = result.indexer || result.Indexer || '';
    const title = (result.title || result.Title || '').trim();
    const size = result.size || result.Size || 0;
    return `${indexerId}|${indexer}|${title}|${size}`;
  };

  const usingStrictIdMatching = INDEXER_MANAGER_STRICT_ID_MATCH;
  const resultsByKey = usingStrictIdMatching ? null : new Map();
  const aggregatedResults = usingStrictIdMatching ? [] : null;
  const planSummaries = [];

  const planExecutions = searchPlans.map((plan) => {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Dispatching plan`, plan);

    // For Prowlarr, add indexer and category params
    if (isUsingProwlarr()) {
      plan.indexerIds = indexerIds;
      // For text-based searches, include categories
      // For ID-based searches, Prowlarr might not support category filtering
      if (plan.type === 'search' && categories) {
        plan.categories = categories;
      }
    }

    return executeIndexerPlan(plan)
      .then((data) => ({ plan, status: 'fulfilled', data }))
      .catch((error) => {
        // If search fails with categories, log it
        if (error.response && error.response.status === 400 && plan.categories) {
          console.warn(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Search failed with categories, might not be supported for this search type`, {
            type: plan.type,
            query: plan.query,
            categories: plan.categories
          });
        }
        return { plan, status: 'rejected', error };
      });
  });

  const planResultsSettled = await Promise.all(planExecutions);

  for (const result of planResultsSettled) {
    const { plan } = result;
    if (result.status === 'rejected') {
      console.error(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ❌ Search plan failed`, {
        message: result.error.message,
        type: plan.type,
        query: plan.query
      });
      planSummaries.push({
        planType: plan.type,
        query: plan.query,
        total: 0,
        filtered: 0,
        uniqueAdded: 0,
        error: result.error.message
      });
      continue;
    }

    const planResults = Array.isArray(result.data) ? result.data : [];
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ ${plan.type} returned ${planResults.length} total results for query "${plan.query}"`);

    const filteredResults = planResults.filter((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      if (!item.downloadUrl) {
        return false;
      }
      return !isTorrentResult(item);
    });

    let addedCount = 0;
    if (usingStrictIdMatching) {
      aggregatedResults.push(...filteredResults.map((item) => ({ result: item, planType: plan.type })));
      addedCount = filteredResults.length;
    } else {
      const beforeSize = resultsByKey.size;
      for (const item of filteredResults) {
        const key = deriveResultKey(item);
        if (!key) continue;
        if (!resultsByKey.has(key)) {
          resultsByKey.set(key, { result: item, planType: plan.type });
        }
      }
      addedCount = resultsByKey.size - beforeSize;
    }

    planSummaries.push({
      planType: plan.type,
      query: plan.query,
      total: planResults.length,
      filtered: filteredResults.length,
      uniqueAdded: addedCount
    });
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ Plan summary`, planSummaries[planSummaries.length - 1]);
  }

  const aggregationCount = usingStrictIdMatching ? aggregatedResults.length : resultsByKey.size;
  if (aggregationCount === 0) {
    console.warn(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ⚠ All ${searchPlans.length} search plans returned no NZB results`);
  } else if (usingStrictIdMatching) {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ Aggregated NZB results with strict ID matching`, {
      plansRun: searchPlans.length,
      totalResults: aggregationCount
    });
  } else {
    console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] ✅ Aggregated unique NZB results`, {
      plansRun: searchPlans.length,
      uniqueResults: aggregationCount
    });
  }

  const dedupedNzbResults = usingStrictIdMatching
    ? aggregatedResults.map((entry) => entry.result)
    : Array.from(resultsByKey.values()).map((entry) => entry.result);

  const finalNzbResults = dedupedNzbResults
    .filter((result, index) => {
      if (!result.downloadUrl || !result.indexerId) {
        console.warn(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Skipping NZB result ${index} missing required fields`, {
          hasDownloadUrl: !!result.downloadUrl,
          hasIndexerId: !!result.indexerId,
          title: result.title
        });
        return false;
      }
      return true;
    })
    .map((result) => ({ ...result, _sourceType: 'nzb' }));

  console.log(`[${INDEXER_MANAGER_LABEL.toUpperCase()}] Final NZB selection: ${finalNzbResults.length} results`);

  return finalNzbResults;
}

module.exports = {
  searchProwlarr,
  getIndexers
};
