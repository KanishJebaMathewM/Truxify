export class ProfileModel {
  static fromProfile(profile) {
    return {
      id: profile.id,
      firebaseUid: profile.firebase_uid,
      role: profile.role,
      fullName: profile.full_name,
      phone: profile.phone,
      email: profile.email,
      companyName: profile.company_name,
      avatarUrl: profile.avatar_url,
      language: profile.language,
      darkMode: profile.dark_mode,
      isActive: profile.is_active,
      walletAddress: profile.wallet_address,
      polygonWalletAddress: profile.polygon_wallet_address
    };
  }

  static fromCustomerStats(stats) {
    if (!stats) return null;

    return {
      totalOrders: stats.total_orders,
      totalSaved: stats.total_saved,
      co2ReducedKg: stats.co2_reduced_kg
    };
  }

  static fromDriverDetails(details) {
    if (!details) return null;

    return {
      truckId: details.truck_id,
      rating: details.rating,
      totalTrips: details.total_trips,
      completionRate: details.completion_rate,
      isOnline: details.is_online,
      walletConfirmed: details.wallet_confirmed,
      walletPending: details.wallet_pending,
      walletTotal: details.wallet_total
    };
  }
}