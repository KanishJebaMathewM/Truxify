import express from 'express';
import { authenticate } from '../src/middleware/auth.js';
import { supabase } from '../src/config/db.js';

const router = express.Router();

// POST /api/users/fcm-token — update FCM token on login
router.post('/fcm-token', authenticate, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });

    // Update token in Supabase for the authenticated user
    const { error } = await supabase
      .from('profiles')
      .update({ fcm_token: fcmToken })
      .eq('id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;