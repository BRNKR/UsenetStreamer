/**
 * Normalize language codes to full language names
 * @param {string} code - Language code (e.g., "GER", "DE", "GERMAN")
 * @returns {string|null} Normalized language name or null
 */
function normalizeLanguage(code) {
  if (!code) return null;

  const normalized = code.toUpperCase();

  const languageMap = {
    // German
    'DE': 'German',
    'GER': 'German',
    'GERMAN': 'German',
    'DEUTSCH': 'German',

    // French
    'FR': 'French',
    'FRE': 'French',
    'FRENCH': 'French',
    'FRANÇAIS': 'French',
    'VF': 'French',
    'VFF': 'French',

    // Spanish
    'ES': 'Spanish',
    'SPA': 'Spanish',
    'SPANISH': 'Spanish',
    'ESPAÑOL': 'Spanish',
    'CASTELLANO': 'Spanish',
    'LAT': 'Spanish',
    'LATINO': 'Spanish',

    // Italian
    'IT': 'Italian',
    'ITA': 'Italian',
    'ITALIAN': 'Italian',
    'ITALIANO': 'Italian',

    // Portuguese
    'PT': 'Portuguese',
    'POR': 'Portuguese',
    'PORTUGUESE': 'Portuguese',
    'PORTUGUÊS': 'Portuguese',
    'PT-BR': 'Portuguese',

    // Russian
    'RU': 'Russian',
    'RUS': 'Russian',
    'RUSSIAN': 'Russian',
    'РУССКИЙ': 'Russian',

    // Japanese
    'JA': 'Japanese',
    'JAP': 'Japanese',
    'JPN': 'Japanese',
    'JAPANESE': 'Japanese',
    '日本語': 'Japanese',

    // Korean
    'KO': 'Korean',
    'KOR': 'Korean',
    'KOREAN': 'Korean',
    '한국어': 'Korean',

    // Chinese
    'ZH': 'Chinese',
    'CHI': 'Chinese',
    'CHINESE': 'Chinese',
    '中文': 'Chinese',
    'MANDARIN': 'Chinese',

    // English
    'EN': 'English',
    'ENG': 'English',
    'ENGLISH': 'English',

    // Dutch
    'NL': 'Dutch',
    'DUT': 'Dutch',
    'DUTCH': 'Dutch',
    'NEDERLANDS': 'Dutch',

    // Polish
    'PL': 'Polish',
    'POL': 'Polish',
    'POLISH': 'Polish',
    'POLSKI': 'Polish',

    // Turkish
    'TR': 'Turkish',
    'TUR': 'Turkish',
    'TURKISH': 'Turkish',
    'TÜRKÇE': 'Turkish',

    // Arabic
    'AR': 'Arabic',
    'ARA': 'Arabic',
    'ARABIC': 'Arabic',
    'العربية': 'Arabic',

    // Hindi
    'HI': 'Hindi',
    'HIN': 'Hindi',
    'HINDI': 'Hindi',
    'हिन्दी': 'Hindi'
  };

  return languageMap[normalized] || null;
}

/**
 * Check if release is a complete Bluray (may contain multiple audio tracks)
 * @param {string} title - Release title
 * @returns {boolean} True if complete Bluray
 */
function isCompleteBluray(title) {
  if (!title) return false;

  const completeBlurayPatterns = [
    /\bCOMPLETE\.BLURAY\b/i,
    /\bFULL\.BLURAY\b/i,
    /\bBD50\b/i,
    /\bBD25\b/i,
    /\bBDMV\b/i,
    /\bBluRay\.COMPLETE\b/i
  ];

  return completeBlurayPatterns.some(pattern => pattern.test(title));
}

/**
 * Detect language from release title
 * Returns detected language(s) or null if no explicit language tag
 *
 * IMPORTANT: Returns null for releases without explicit language tags
 * (e.g., US/UK releases are assumed English-only but return null)
 *
 * @param {string} title - Release title
 * @returns {string|null} Detected language, "MULTi", or null
 */
function detectLanguage(title) {
  if (!title) return null;

  // Check for MULTi first (multiple audio tracks)
  if (/\bMULTi\b/i.test(title)) {
    return 'MULTi';
  }

  // Extract potential language tags (words between dots or spaces)
  // Look for language codes/names in typical release name format
  const tokens = title.split(/[\.\s\-_]+/);

  for (const token of tokens) {
    const normalizedLang = normalizeLanguage(token);
    if (normalizedLang) {
      return normalizedLang;
    }
  }

  // No explicit language tag found
  // This includes US/UK releases which are English-only but don't have ENG tag
  return null;
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
 * Get quality rank for sorting (video quality)
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
 * Extract audio quality from title
 * @param {string} title - Release title
 * @returns {string|null} Audio quality or null
 */
function extractAudioQuality(title) {
  if (!title) return null;

  // Check for high-quality audio formats (TrueHD, DTS-HD, Atmos)
  if (/TrueHD|DTS-HD|Atmos|DTS\.HD/i.test(title)) {
    return 'HD';
  }

  // Check for enhanced audio (EAC3, DD+, E-AC-3)
  if (/EAC3|E-AC-3|DD\+|DDP/i.test(title)) {
    return 'Enhanced';
  }

  // Check for standard audio (AC3, DTS, DD)
  if (/\bAC3\b|\bDTS\b|\bDD\b/i.test(title)) {
    return 'Standard';
  }

  return null;
}

/**
 * Get audio quality rank for sorting
 * @param {string} audioQuality - Audio quality string
 * @returns {number} Rank (higher is better)
 */
function getAudioQualityRank(audioQuality) {
  const ranks = {
    'HD': 3,        // TrueHD, DTS-HD, Atmos
    'Enhanced': 2,  // EAC3, DD+
    'Standard': 1   // AC3, DTS, DD
  };
  return ranks[audioQuality] || 0;
}

/**
 * Sort items within a single group using the specified method
 * @param {Array} items - Items to sort
 * @param {string} sortMethod - Sorting method
 * @returns {Array} Sorted items
 */
function sortWithinGroup(items, sortMethod) {
  const sorted = [...items];

  sorted.sort((a, b) => {
    // Primary sort based on method
    let primaryComparison = 0;

    switch (sortMethod) {
      case 'Quality First':
        const qualityA = extractQuality(a.title);
        const qualityB = extractQuality(b.title);
        const videoRankA = getQualityRank(qualityA);
        const videoRankB = getQualityRank(qualityB);
        primaryComparison = videoRankB - videoRankA;
        break;

      case 'Size First':
        primaryComparison = (b.size || 0) - (a.size || 0);
        break;

      case 'Date First':
        const ageA = a.age || 0;
        const ageB = b.age || 0;
        primaryComparison = ageA - ageB; // Lower age = newer
        break;

      default:
        // Default to Quality First
        const defaultQualityA = extractQuality(a.title);
        const defaultQualityB = extractQuality(b.title);
        const defaultRankA = getQualityRank(defaultQualityA);
        const defaultRankB = getQualityRank(defaultQualityB);
        primaryComparison = defaultRankB - defaultRankA;
    }

    if (primaryComparison !== 0) return primaryComparison;

    // If primary sort is equal, sort by video quality (if not already sorting by quality)
    if (sortMethod !== 'Quality First') {
      const qualityA = extractQuality(a.title);
      const qualityB = extractQuality(b.title);
      const videoRankA = getQualityRank(qualityA);
      const videoRankB = getQualityRank(qualityB);
      const videoComparison = videoRankB - videoRankA;

      if (videoComparison !== 0) return videoComparison;
    }

    // If video quality is equal, sort by audio quality
    const audioA = extractAudioQuality(a.title);
    const audioB = extractAudioQuality(b.title);
    const audioRankA = getAudioQualityRank(audioA);
    const audioRankB = getAudioQualityRank(audioB);
    const audioComparison = audioRankB - audioRankA;

    if (audioComparison !== 0) return audioComparison;

    // Final tiebreaker - sort by size
    return (b.size || 0) - (a.size || 0);
  });

  return sorted;
}

/**
 * Sort streams with proper 3-group language grouping
 * @param {Array} results - Array of Prowlarr results
 * @param {string} sortMethod - Sorting method
 * @param {string} preferredLanguage - Preferred language for grouping
 * @returns {object} Object with sortedResults array and groupInfo
 */
function sortStreams(results, sortMethod, preferredLanguage) {
  // If no preferred language, just sort everything as one group
  if (!preferredLanguage || preferredLanguage === 'No Preference') {
    const sorted = sortWithinGroup(results, sortMethod);
    return {
      sortedResults: sorted,
      groupInfo: null
    };
  }

  // Split into THREE groups based on language detection rules:
  // 1. Preferred language group (explicit match OR MULTi)
  // 2. Complete Bluray group (may contain multiple audio tracks)
  // 3. Other languages group (everything else, including English-only without tag)
  const preferredGroup = [];
  const completeBlurayGroup = [];
  const otherGroup = [];

  for (const item of results) {
    const detectedLang = detectLanguage(item.title);
    const isComplete = isCompleteBluray(item.title);

    // Group 1: Preferred language OR MULTi releases
    if (detectedLang === preferredLanguage || detectedLang === 'MULTi') {
      preferredGroup.push(item);
    }
    // Group 2: Complete Bluray releases without explicit language tag
    else if (isComplete && detectedLang === null) {
      completeBlurayGroup.push(item);
    }
    // Group 3: Everything else (other languages, English-only, no tag)
    else {
      otherGroup.push(item);
    }
  }

  // Sort each group independently
  const sortedPreferred = sortWithinGroup(preferredGroup, sortMethod);
  const sortedCompleteBluray = sortWithinGroup(completeBlurayGroup, sortMethod);
  const sortedOthers = sortWithinGroup(otherGroup, sortMethod);

  // Combine groups: preferred first, then complete bluray, then others
  const sortedResults = [...sortedPreferred, ...sortedCompleteBluray, ...sortedOthers];

  // Calculate separator indices for visual grouping
  const group1End = sortedPreferred.length;
  const group2End = group1End + sortedCompleteBluray.length;

  // Return sorted results with group boundary information
  return {
    sortedResults,
    groupInfo: {
      preferredLanguage,
      preferredCount: sortedPreferred.length,
      completeBlurayCount: sortedCompleteBluray.length,
      otherCount: sortedOthers.length,
      group1SeparatorIndex: 0, // Before first group
      group2SeparatorIndex: group1End, // Between group 1 and 2
      group3SeparatorIndex: group2End  // Between group 2 and 3
    }
  };
}

module.exports = {
  detectLanguage,
  normalizeLanguage,
  isCompleteBluray,
  extractQuality,
  extractAudioQuality,
  matchesQualityFilter,
  sortStreams
};
