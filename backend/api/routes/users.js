import express from "express";
import { authenticate } from "../src/middleware/auth.js";
import { supabase } from "../src/config/db.js";

const router = express.Router();

/*
  POST /api/users/fcm-token

  Updates the Firebase Cloud Messaging (FCM) token
  for the currently authenticated user.
*/
router.post("/fcm-token", authenticate, async (req, res) => {
  try {
    // Get FCM token from request body
    const { fcmToken } = req.body;

    // Validate FCM token
    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(400).json({
        success: false,
        error: "fcmToken is required",
      });
    }

    // Make sure authenticated user exists
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    // Update FCM token in Supabase
    const { data, error } = await supabase
      .from("profiles")
      .update({
        fcm_token: fcmToken,
      })
      .eq("id", req.user.id)
      .select("id, fcm_token")
      .single();

    // Handle Supabase errors
    if (error) {
      console.error("Supabase FCM token update error:", error);

      // Profile does not exist
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          error: "User profile not found",
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to update FCM token",
      });
    }

    // Successful update
    return res.status(200).json({
      success: true,
      message: "FCM token updated successfully",
      data,
    });
  } catch (error) {
    console.error("FCM token route error:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

export default router;