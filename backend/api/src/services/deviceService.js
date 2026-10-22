// backend/api/src/services/deviceService.js (Excerpt)

import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

export async function getUniquePlatforms() {
  try {
    const { data, error } = await supabase
      .from('devices')
      .select('platform')
      .not('platform', 'is', null);

    if (error) {
      throw error;
    }

    // Extract unique platforms and normalize casing
    const uniquePlatforms = [...new Set(data.map((d) => d.platform?.toLowerCase()))].filter(Boolean);

    return {
      success: true,
      platforms: uniquePlatforms,
    };
  } catch (err) {
    logger.error({ err }, '[deviceService] Failed to retrieve unique platforms');
    return {
      success: false,
      error: `Database query failed: ${err.message}`,
    };
  }
}
