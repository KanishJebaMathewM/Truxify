import { supabaseAdmin } from '../config/db.js';

export class ProfileModel {
    /**
     * Normalize raw profile data into a consistent object
     */
    static fromProfile(profile) {
        if (!profile) return null;

        return {
            id: profile.id ?? null,
            firebaseUid: profile.firebase_uid ?? null,
            role: profile.role ?? "user",
            fullName: profile.full_name ?? "",
            phone: profile.phone ?? "",
            email: profile.email ?? "",
            companyName: profile.company_name ?? "",
            avatarUrl: profile.avatar_url ?? "",
            language: profile.language ?? "en",
            darkMode: Boolean(profile.dark_mode),
            isActive: Boolean(profile.is_active),
            walletAddress: profile.wallet_address ?? null,
            polygonWalletAddress: profile.polygon_wallet_address ?? null,
        };
    }

    /**
     * Map customer stats safely
     */
    static fromCustomerStats(stats) {
        if (!stats) return null;

        return {
            totalOrders: stats.total_orders ?? 0,
            totalSaved: stats.total_saved ?? 0,
            co2ReducedKg: stats.co2_reduced_kg ?? 0,
        };
    }

    /**
     * Map driver details safely
     */
    static fromDriverDetails(details) {
        if (!details) return null;

        const totalTrips = details.total_trips ?? 0;
        const rating = details.rating ?? 0;
        const walletTotal = details.wallet_total ?? 0;

        const badges = [];
        if (totalTrips >= 1) badges.push({ id: 'first_delivery', label: 'First Delivery', icon: '📦' });
        if (totalTrips >= 100) badges.push({ id: '100_deliveries', label: '100 Deliveries Completed', icon: '💯' });
        if (rating >= 4.9 && totalTrips > 0) badges.push({ id: '5_star', label: '5-Star Driver', icon: '⭐' });
        if (walletTotal >= 1000) badges.push({ id: 'top_earner', label: 'Top Earner', icon: '💰' });
        if (totalTrips >= 500) badges.push({ id: 'long_distance_champion', label: 'Long Distance Champion', icon: '🏆' });

        return {
            truckId: details.truck_id ?? null,
            rating: rating,
            totalTrips: totalTrips,
            completionRate: details.completion_rate ?? 0,
            isOnline: Boolean(details.is_online),
            walletConfirmed: details.wallet_confirmed ?? 0,
            walletPending: details.wallet_pending ?? 0,
            walletTotal: walletTotal,
            kycStatus: details.kyc_status ?? 'Unverified',
            kycDocNumber: details.kyc_doc_number ?? null,
            badges: badges,
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

    /**
     * Find a profile by ID
     */
    static async findById(id, client = supabaseAdmin) {
        if (!id) return null;
        if (!client) throw new Error('Supabase client not configured');

        const { data, error } = await client
            .from('profiles')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        return data ? ProfileModel.fromProfile(data) : null;
    }

    /**
     * Create a new profile
     */
    static async create(profileData, client = supabaseAdmin) {
        if (!profileData || typeof profileData !== 'object') {
            throw new Error('Invalid profile data');
        }
        if (!client) throw new Error('Supabase client not configured');

        const { data, error } = await client
            .from('profiles')
            .insert(profileData)
            .select()
            .single();

        if (error) throw error;
        return data ? ProfileModel.fromProfile(data) : null;
    }

    /**
     * Update an existing profile by ID
     */
    static async update(id, updateData, client = supabaseAdmin) {
        if (!id) throw new Error('Profile id is required');
        if (!updateData || typeof updateData !== 'object') {
            throw new Error('Invalid update data');
        }
        if (!client) throw new Error('Supabase client not configured');

        const { data, error } = await client
            .from('profiles')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data ? ProfileModel.fromProfile(data) : null;
    }

    /**
     * Delete a profile by ID
     */
    static async delete(id, client = supabaseAdmin) {
        if (!id) throw new Error('Profile id is required');
        if (!client) throw new Error('Supabase client not configured');

        const { data, error } = await client
            .from('profiles')
            .delete()
            .eq('id', id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return data ? ProfileModel.fromProfile(data) : null;
    }
}