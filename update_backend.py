import re

file_path = 'backend/api/src/routes/driverRoutes.js'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add import
import_stmt = "import { checkBypassEligibility } from '../services/weighStationService.js';"
# insert at top after other imports
match = re.search(r'import\s+.*?;', content)
if match:
    content = content[:match.end()] + '\n' + import_stmt + content[match.end():]
else:
    content = import_stmt + '\n' + content

# Add route
route = '''
router.get('/weigh-stations/bypass-status', requireAuth, requireDriver, async (req, res) => {
  try {
    const driverId = req.user.id;
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const status = await checkBypassEligibility(driverId, lat, lng);
    return res.status(200).json(status);
  } catch (err) {
    logger.error(`[weigh-station] Error getting bypass status for driver ${req.user.id}: ${err.message}`);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
'''

# insert before export default router;
content = content.replace('export default router;', route + '\nexport default router;')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
