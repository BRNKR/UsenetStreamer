/**
 * Detect language from title
 * @param {string} title - Release title
 * @returns {string|null} Detected language or null
 */
function detectLanguage(title) {
  if (!title) return null;

  const languagePatterns = {
    'Spanish': /\b(spanish|español|castellano|lat|latino)\b/i,
    'French': /\b(french|français|vf|vff)\b/i,
    'German': /\b(german|deutsch)\b/i,
    'Italian': /\b(italian|italiano)\b/i,
    'Portuguese': /\b(portuguese|português|pt-br)\b/i,
    'Russian': /\b(russian|русский)\b/i,
    'Japanese': /\b(japanese|日本語)\b/i,
    'Korean': /\b(korean|한국어)\b/i,
    'Chinese': /\b(chinese|中文|mandarin)\b/i,
    'Arabic': /\b(arabic|العربية)\b/i,
    'Hindi': /\b(hindi|हिन्दी)\b/i,
    'Dutch': /\b(dutch|nederlands)\b/i,
    'Polish': /\b(polish|polski)\b/i,
    'Turkish': /\b(turkish|türkçe)\b/i
  };

  for (const [language, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(title)) {
      return language;
    }
  }

  // Default to English if no other language detected
  return 'English';
}

/**
 * Extract quality from title
 * @param {string} title - Release title
 * @returns {string|null} Quality (4K, 1080p, 720p, 480p) or null
 */
function extractQuality(title) {
  if (!title) return null;

  const qualityMatch = title.match(/(2160p|4K|UHD|1080p|720p|480p)/i);
  if (!qualityMatch) return null;

  const quality = qualityMatch[0].toUpperCase();
  if (quality === '2160P' || quality === 'UHD') return '4K';
  if (quality === '1080P') return '1080p';
  if (quality === '720P') return '720p';
  if (quality === '480P') return '480p';

  return quality;
}

/**
 * Check if quality matches filter
 * @param {string} quality - Detected quality (4K, 1080p, etc.)
 * @param {string} filter - Quality filter setting
 * @returns {boolean} True if quality matches filter
 */
function matchesQualityFilter(quality, filter) {
  if (!filter || filter === 'All') return true;
  if (!quality) return false;

  const filterMap = {
    '4K/2160p': ['4K'],
    '1080p': ['1080p'],
    '720p': ['720p'],
    '480p': ['480p'],
    '4K + 1080p': ['4K', '1080p'],
    '1080p + 720p': ['1080p', '720p'],
    '720p + 480p': ['720p', '480p']
  };

  const allowedQualities = filterMap[filter] || [];
  return allowedQualities.includes(quality);
}

/**
 * Get quality rank for sorting
 * @param {string} quality - Quality string
 * @returns {number} Rank (higher is better)
 */
function getQualityRank(quality) {
  const ranks = {
    '4K': 4,
    '1080p': 3,
    '720p': 2,
    '480p': 1
  };
  return ranks[quality] || 0;
}

/**
 * Sort streams based on method
 * @param {Array} results - Array of Prowlarr results
 * @param {string} sortMethod - Sorting method
 * @param {string} preferredLanguage - Preferred language for language-first sorting
 * @returns {Array} Sorted results
 */
function sortStreams(results, sortMethod, preferredLanguage) {
  const sortedResults = [...results];

  switch (sortMethod) {
    case 'Quality First':
      sortedResults.sort((a, b) => {
        const qualityA = extractQuality(a.title);
        const qualityB = extractQuality(b.title);
        const rankA = getQualityRank(qualityA);
        const rankB = getQualityRank(qualityB);

        if (rankA !== rankB) return rankB - rankA;
        return (b.size || 0) - (a.size || 0);
      });
      break;

    case 'Size First':
      sortedResults.sort((a, b) => (b.size || 0) - (a.size || 0));
      break;

    case 'Date First':
      sortedResults.sort((a, b) => {
        const ageA = a.age || 0;
        const ageB = b.age || 0;
        return ageA - ageB; // Lower age = newer
      });
      break;

    default:
      // Default to Quality First
      sortedResults.sort((a, b) => {
        const qualityA = extractQuality(a.title);
        const qualityB = extractQuality(b.title);
        const rankA = getQualityRank(qualityA);
        const rankB = getQualityRank(qualityB);

        if (rankA !== rankB) return rankB - rankA;
        return (b.size || 0) - (a.size || 0);
      });
  }

  // If preferred language is set, boost those to the top
  if (preferredLanguage && preferredLanguage !== 'No Preference') {
    sortedResults.sort((a, b) => {
      const langA = detectLanguage(a.title);
      const langB = detectLanguage(b.title);
      const aMatches = langA === preferredLanguage;
      const bMatches = langB === preferredLanguage;

      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });
  }

  return sortedResults;
}

module.exports = {
  detectLanguage,
  extractQuality,
  matchesQualityFilter,
  sortStreams
};
