const express = require('express');
const router = express.Router();
const escrowController = require('../controllers/escrowController');
const authMiddleware = require('../middleware/authMiddleware');
const escrowAuth = require('../middleware/escrowAuth');

router.post(
    '/deposit',
    authMiddleware,
    escrowAuth,
    escrowController.depositEscrow
);

router.post(
    '/release/:bookingId',
    authMiddleware,
    escrowAuth,
    escrowController.releaseEscrow
);

module.exports = router;
