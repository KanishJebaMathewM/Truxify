const express = require('express');
const router = express.Router();
const routingController = require('../controllers/routingController');
const authMiddleware = require('../middleware/authMiddleware');

router.get('/route', authMiddleware, routingController.getRoute);
router.post('/matrix', authMiddleware, routingController.getDistanceMatrix);

module.exports = router;
