import express from 'express';
import { Driver } from '../models/Driver.js'; // adjust to your actual model
const router = express.Router();

// POST /api/users/fcm-token — update FCM token on login
router.post('/fcm-token', async (req, res) => {
  try {
    const { userId, fcmToken, userType } = req.body; // userType: 'driver' | 'manufacturer'
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });
    
    // Update token in DB (adapt to your schema)
    await Driver.findByIdAndUpdate(userId, { fcmToken });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;