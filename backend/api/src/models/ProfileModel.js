export class ProfileModel {
    /**
     * Normalize raw profile data into a consistent object
     */
    static fromProfile(profile = {}) {
        if (!profile) return null;

        return {
            id: profile.id ? ? null,
            firebaseUid: profile.firebase_uid ? ? null,
            role: profile.role ? ? "user",
            fullName: profile.full_name ? ? "",
            phone: profile.phone ? ? "",
            email: profile.email ? ? "",
            companyName: profile.company_name ? ? "",
            avatarUrl: profile.avatar_url ? ? "",
            language: profile.language ? ? "en",
            darkMode: Boolean(profile.dark_mode),
            isActive: Boolean(profile.is_active),
            walletAddress: profile.wallet_address ? ? null,
            polygonWalletAddress: profile.polygon_wallet_address ? ? null,
        };
    }

    /**
     * Map customer stats safely
     */
    static fromCustomerStats(stats = {}) {
        if (!stats) return null;

        return {
            totalOrders: stats.total_orders ? ? 0,
            totalSaved: stats.total_saved ? ? 0,
            co2ReducedKg: stats.co2_reduced_kg ? ? 0,
        };
    }

    /**
     * Map driver details safely
     */
    static fromDriverDetails(details = {}) {
        if (!details) return null;

        return {
            truckId: details.truck_id ? ? null,
            rating: details.rating ? ? 0,
            totalTrips: details.total_trips ? ? 0,
            completionRate: details.completion_rate ? ? 0,
            isOnline: Boolean(details.is_online),
            walletConfirmed: details.wallet_confirmed ? ? 0,
            walletPending: details.wallet_pending ? ? 0,
            walletTotal: details.wallet_total ? ? 0,
        };
    }

    /**
     * Utility: merge multiple sources into one profile object
     */
    static mergeProfileData(profile, stats, driverDetails) {
        return {
            ...ProfileModel.fromProfile(profile),
            customerStats: ProfileModel.fromCustomerStats(stats),
            driverDetails: ProfileModel.fromDriverDetails(driverDetails),
        };
    }
}