const express = require('express');
const router = express.Router();
const tireWearController = require('../controllers/tireWearController');

router.get('/:driverId/prediction', tireWearController.getTireWearPrediction);

module.exports = router;
