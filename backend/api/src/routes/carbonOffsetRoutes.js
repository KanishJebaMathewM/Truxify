const express = require('express');
const router = express.Router();
const carbonOffsetController = require('../controllers/carbonOffsetController');

router.get('/footprint', carbonOffsetController.getFootprint);
router.get('/packages', carbonOffsetController.listPackages);
router.post('/purchase', carbonOffsetController.buyOffset);

module.exports = router;
