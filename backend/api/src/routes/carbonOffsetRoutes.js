const express = require('express');
const router = express.Router();
const carbonOffsetController = require('../controllers/carbonOffsetController');
const { authenticate } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimiter');

router.get('/footprint', authenticate, userLimiter, carbonOffsetController.getFootprint);
router.get('/packages', authenticate, userLimiter, carbonOffsetController.listPackages);
router.post('/purchase', authenticate, userLimiter, carbonOffsetController.buyOffset);

module.exports = router;
