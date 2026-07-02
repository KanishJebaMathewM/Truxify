import fs from 'fs';
import path from 'path';

const command = process.argv[2];

const profileRoutesPath = path.resolve('backend/api/src/routes/profileRoutes.js');
const supportRoutesPath = path.resolve('backend/api/src/routes/supportRoutes.js');
const tripRoutesPath = path.resolve('backend/api/src/routes/tripRoutes.js');
const truckRoutesPath = path.resolve('backend/api/src/routes/truckRoutes.js');

function replaceInFile(filePath, target, replacement) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(target)) {
    console.error(`Target not found in ${filePath}:\n${target}`);
    process.exit(1);
  }
  content = content.replace(target, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Successfully updated ${filePath}`);
}

switch (command) {
  case 'driver-statement-csv': {
    const target = `    if (format === 'csv') {
      const csvRows = [
        ['ID', 'Order Display ID', 'Pickup Address', 'Drop Address', 'Pickup Date', 'Base Freight', 'Platform Fee', 'Toll Estimate', 'Net Earnings', 'Status'],
        ...tripsList.map(t => [t.id, t.order_display_id, t.pickup_address, t.drop_address, t.pickup_date, t.base_freight, t.platform_fee, t.toll_estimate, t.net_earnings, t.status])
      ];
      const csvString = csvRows.map(row => row.map(val => \`"\${String(val).replace(/"/g, '""')}"\`).join(',')).join('\\n');
      res.setHeader('Content-Type', 'text/csv');
      return res.send(csvString);
    }`;

    const replacement = `    if (format === 'csv') {
      // Optimize memory: construct CSV string directly using string builder/loop
      const headers = ['ID', 'Order Display ID', 'Pickup Address', 'Drop Address', 'Pickup Date', 'Base Freight', 'Platform Fee', 'Toll Estimate', 'Net Earnings', 'Status'];
      let csvString = headers.map(val => \`"\${String(val).replace(/"/g, '""')}"\`).join(',') + '\\n';
      for (const t of tripsList) {
        const row = [t.id, t.order_display_id, t.pickup_address, t.drop_address, t.pickup_date, t.base_freight, t.platform_fee, t.toll_estimate, t.net_earnings, t.status];
        csvString += row.map(val => \`"\${String(val).replace(/"/g, '""')}"\`).join(',') + '\\n';
      }
      res.setHeader('Content-Type', 'text/csv');
      return res.send(csvString.trimEnd());
    }`;

    replaceInFile(profileRoutesPath, target, replacement);
    break;
  }

  case 'driver-statement-sorting': {
    const target = `    if (sort_by === 'net_earnings') {
      tripsList.sort((a, b) => b.net_earnings - a.net_earnings);
    } else if (sort_by === 'base_freight') {
      tripsList.sort((a, b) => b.base_freight - a.base_freight);
    }`;

    const replacement = `    if (sort_by === 'net_earnings') {
      // Optimize sorting: use net_earnings descending, fallback to pickup_date descending
      tripsList.sort((a, b) => (b.net_earnings - a.net_earnings) || new Date(b.pickup_date) - new Date(a.pickup_date));
    } else if (sort_by === 'base_freight') {
      // Optimize sorting: use base_freight descending, fallback to pickup_date descending
      tripsList.sort((a, b) => (b.base_freight - a.base_freight) || new Date(b.pickup_date) - new Date(a.pickup_date));
    }`;

    replaceInFile(profileRoutesPath, target, replacement);
    break;
  }

  case 'support-categories-descriptions': {
    const target = `router.get('/categories', (_req, res) => {
  res.json({
    categories: VALID_CATEGORIES,
    labels: CATEGORY_LABELS,
    sla_hours: CATEGORY_SLA,
    descriptions: CATEGORY_DESCRIPTIONS,
  });
});`;

    const replacement = `router.get('/categories', (_req, res) => {
  // Optimize: Add caching header for static support categories
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({
    categories: VALID_CATEGORIES,
    labels: CATEGORY_LABELS,
    sla_hours: CATEGORY_SLA,
    descriptions: CATEGORY_DESCRIPTIONS,
  });
});`;

    replaceInFile(supportRoutesPath, target, replacement);
    break;
  }

  case 'support-categories-sla': {
    const target = `const CATEGORY_SLA = {
  payment: 24,
  order: 12,
  technical: 4,
  general: 48,
  account: 24,
};`;

    const replacement = `const CATEGORY_SLA = Object.freeze({
  payment: 24,
  order: 12,
  technical: 4,
  general: 48,
  account: 24,
});`;

    replaceInFile(supportRoutesPath, target, replacement);
    break;
  }

  case 'support-ticket-comments-pagination': {
    const target = `    const parsedLimit = parseIntegerQuery(req.query.limit, 100, 'limit', { min: 1 });
    if (parsedLimit.error) {
      return res.status(400).json({ error: parsedLimit.error });
    }
    const parsedOffset = parseIntegerQuery(req.query.offset, 0, 'offset', { min: 0 });
    if (parsedOffset.error) {
      return res.status(400).json({ error: parsedOffset.error });
    }

    const limit = Math.min(100, parsedLimit.value);
    const offset = parsedOffset.value;
    const rawLimit = req.query.limit;
    const rawOffset = req.query.offset;
    if (rawLimit !== undefined && (!Number.isFinite(Number(rawLimit)) || Number(rawLimit) < 1)) {
      return res.status(400).json({ error: 'limit must be a positive integer' });
    }
    if (rawOffset !== undefined && (!Number.isFinite(Number(rawOffset)) || Number(rawOffset) < 0)) {
      return res.status(400).json({ error: 'offset must be a non-negative integer' });
    }
    const limit = Math.min(100, Math.max(1, Number(rawLimit) || 100));
    const offset = Math.max(0, Number(rawOffset) || 0);`;

    const replacement = `    const parsedLimit = parseIntegerQuery(req.query.limit, 100, 'limit', { min: 1 });
    if (parsedLimit.error) {
      return res.status(400).json({ error: parsedLimit.error });
    }
    const parsedOffset = parseIntegerQuery(req.query.offset, 0, 'offset', { min: 0 });
    if (parsedOffset.error) {
      return res.status(400).json({ error: parsedOffset.error });
    }

    const limit = Math.min(100, parsedLimit.value);
    const offset = parsedOffset.value;`;

    replaceInFile(supportRoutesPath, target, replacement);
    break;
  }

  case 'support-ticket-comments-sorting': {
    const target = `  const ticketId = req.params.id;
  const { sort } = req.query;
  const isAscending = sort !== 'desc';`;

    const replacement = `  const ticketId = req.params.id;
  const { sort } = req.query;
  if (sort !== undefined && sort !== 'asc' && sort !== 'desc') {
    return res.status(400).json({ error: "sort parameter must be 'asc' or 'desc'" });
  }
  const isAscending = sort !== 'desc';`;

    replaceInFile(supportRoutesPath, target, replacement);
    break;
  }

  case 'trip-events-bounding-box': {
    const target = `    const { data: events, error: eventsErr } = await supabase
      .from('trip_events')
      .select('event_id, user_id, trip_id, event_type, event_timestamp, latitude, longitude, metadata, created_at')
      .eq('trip_id', tripId)
      .order('event_timestamp', { ascending: isAscending });

    if (eventsErr) {
      return res.status(500).json({ error: 'Failed to fetch trip events.', details: eventsErr.message });
    }

    if (!events || events.length === 0) {
      return res.json({ trip_id: tripId, events: [] });
    }

    // 5. Optional type filter
    let filteredEvents = events;
    if (type && typeof type === 'string') {
      filteredEvents = events.filter(e => e.event_type === type);
    }

    if (min_lat !== undefined || max_lat !== undefined || min_lng !== undefined || max_lng !== undefined) {
      if (min_lat !== undefined && !Number.isFinite(Number(min_lat))) {
        return res.status(400).json({ error: 'min_lat must be a valid number' });
      }
      if (max_lat !== undefined && !Number.isFinite(Number(max_lat))) {
        return res.status(400).json({ error: 'max_lat must be a valid number' });
      }
      if (min_lng !== undefined && !Number.isFinite(Number(min_lng))) {
        return res.status(400).json({ error: 'min_lng must be a valid number' });
      }
      if (max_lng !== undefined && !Number.isFinite(Number(max_lng))) {
        return res.status(400).json({ error: 'max_lng must be a valid number' });
      }
      filteredEvents = filteredEvents.filter(e => {
        if (e.latitude === null || e.longitude === null || e.latitude === undefined || e.longitude === undefined) return false;
        const lat = Number(e.latitude);
        const lng = Number(e.longitude);
        if (minLat.value !== undefined && lat < minLat.value) return false;
        if (maxLat.value !== undefined && lat > maxLat.value) return false;
        if (minLng.value !== undefined && lng < minLng.value) return false;
        if (maxLng.value !== undefined && lng > maxLng.value) return false;
        return true;
      });
    }`;

    const replacement = `    let query = supabase
      .from('trip_events')
      .select('event_id, user_id, trip_id, event_type, event_timestamp, latitude, longitude, metadata, created_at')
      .eq('trip_id', tripId);

    if (type && typeof type === 'string') {
      query = query.eq('event_type', type);
    }

    if (minLat.value !== undefined) {
      query = query.gte('latitude', minLat.value);
    }
    if (maxLat.value !== undefined) {
      query = query.lte('latitude', maxLat.value);
    }
    if (minLng.value !== undefined) {
      query = query.gte('longitude', minLng.value);
    }
    if (maxLng.value !== undefined) {
      query = query.lte('longitude', maxLng.value);
    }

    const { data: events, error: eventsErr } = await query
      .order('event_timestamp', { ascending: isAscending });

    if (eventsErr) {
      return res.status(500).json({ error: 'Failed to fetch trip events.', details: eventsErr.message });
    }

    const filteredEvents = events || [];`;

    replaceInFile(tripRoutesPath, target, replacement);
    break;
  }

  case 'trip-events-sorting': {
    const target = `  if (sort !== undefined && sort !== 'asc' && sort !== 'desc') {
    return res.status(400).json({ error: 'sort must be asc or desc' });
  }`;

    const replacement = `  if (sort !== undefined && sort !== 'asc' && sort !== 'desc') {
    return res.status(400).json({ error: 'sort must be asc or desc' });
  }
  // Database-optimized chronological sorting is enforced on order query`;

    replaceInFile(tripRoutesPath, target, replacement);
    break;
  }

  case 'truck-management-filtering': {
    const target = `    if (min_capacity) {
      query = query.gte('max_capacity_tons', Number(min_capacity));
    }
    if (max_capacity) {
      query = query.lte('max_capacity_tons', Number(max_capacity));
    }`;

    const replacement = `    if (min_capacity !== undefined) {
      const minCapNum = Number(min_capacity);
      if (Number.isNaN(minCapNum) || minCapNum < 0) {
        return res.status(400).json({ error: 'min_capacity must be a positive number' });
      }
      query = query.gte('max_capacity_tons', minCapNum);
    }
    if (max_capacity !== undefined) {
      const maxCapNum = Number(max_capacity);
      if (Number.isNaN(maxCapNum) || maxCapNum < 0) {
        return res.status(400).json({ error: 'max_capacity must be a positive number' });
      }
      query = query.lte('max_capacity_tons', maxCapNum);
    }`;

    replaceInFile(truckRoutesPath, target, replacement);
    break;
  }

  case 'truck-management-search': {
    const target = `    if (name) {
      query = query.ilike('name', \`%\${name}%\`);
    }`;

    const replacement = `    if (name && typeof name === 'string') {
      const cleanName = name.trim();
      if (cleanName) {
        query = query.ilike('name', \`%\${cleanName}%\`);
      }
    }`;

    replaceInFile(truckRoutesPath, target, replacement);
    break;
  }

  default:
    console.error('Unknown command');
    process.exit(1);
}
