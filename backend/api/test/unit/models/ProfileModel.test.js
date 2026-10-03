import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileModel } from '../../../src/models/ProfileModel.js';

describe('ProfileModel', () => {
  describe('fromProfile', () => {
    it('normalizes a profile object correctly with proper data shapes', () => {
      const raw = {
        id: 'uuid-1',
        firebase_uid: 'firebase-123',
        role: 'driver',
        full_name: 'John Doe',
        phone: '1234567890',
        email: 'john@example.com',
        company_name: 'Truxify Inc',
        avatar_url: 'https://example.com/avatar.jpg',
        language: 'en',
        dark_mode: true,
        is_active: true,
        wallet_address: '0x1234',
        polygon_wallet_address: '0x5678',
      };

      const result = ProfileModel.fromProfile(raw);

      expect(result).toEqual({
        id: 'uuid-1',
        firebaseUid: 'firebase-123',
        role: 'driver',
        fullName: 'John Doe',
        phone: '1234567890',
        email: 'john@example.com',
        companyName: 'Truxify Inc',
        avatarUrl: 'https://example.com/avatar.jpg',
        language: 'en',
        darkMode: true,
        isActive: true,
        walletAddress: '0x1234',
        polygonWalletAddress: '0x5678',
      });
    });

    it('handles null/undefined input gracefully', () => {
      expect(ProfileModel.fromProfile(null)).toBeNull();
      expect(ProfileModel.fromProfile(undefined)).toBeNull();
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromProfile({ id: 'uuid-1' });

      expect(result.id).toBe('uuid-1');
      expect(result.firebaseUid).toBeNull();
      expect(result.role).toBe('user');
      expect(result.fullName).toBe('');
      expect(result.phone).toBe('');
      expect(result.email).toBe('');
      expect(result.companyName).toBe('');
      expect(result.avatarUrl).toBe('');
      expect(result.language).toBe('en');
      expect(result.darkMode).toBe(false);
      expect(result.isActive).toBe(false);
      expect(result.walletAddress).toBeNull();
      expect(result.polygonWalletAddress).toBeNull();
    });
  });

  describe('fromCustomerStats', () => {
    it('normalizes customer stats correctly', () => {
      const stats = {
        total_orders: 150,
        total_saved: 500,
        co2_reduced_kg: 1200,
      };

      const result = ProfileModel.fromCustomerStats(stats);

      expect(result).toEqual({
        totalOrders: 150,
        totalSaved: 500,
        co2ReducedKg: 1200,
      });
    });

    it('handles null/undefined input gracefully', () => {
      expect(ProfileModel.fromCustomerStats(null)).toBeNull();
      expect(ProfileModel.fromCustomerStats(undefined)).toBeNull();
    });

    it('applies defaults for missing fields', () => {
      const result = ProfileModel.fromCustomerStats({});
      expect(result).toEqual({
        totalOrders: 0,
        totalSaved: 0,
        co2ReducedKg: 0,
      });
    });
  });

  describe('fromDriverDetails', () => {
    it('normalizes driver details correctly', () => {
      const details = {
        truck_id: 'truck-1',
        rating: 4.8,
        total_trips: 500,
        completion_rate: 95.5,
        is_online: true,
        wallet_confirmed: 1000,
        wallet_pending: 500,
        wallet_total: 1500,
        kyc_status: 'Verified',
        kyc_doc_number: 'ABC123',
      };

      const result = ProfileModel.fromDriverDetails(details);

      expect(result.truckId).toBe('truck-1');
      expect(result.rating).toBe(4.8);
      expect(result.totalTrips).toBe(500);
      expect(result.completionRate).toBe(95.5);
      expect(result.isOnline).toBe(true);
      expect(result.walletConfirmed).toBe(1000);
      expect(result.walletPending).toBe(500);
      expect(result.walletTotal).toBe(1500);
      expect(result.kycStatus).toBe('Verified');
      expect(result.kycDocNumber).toBe('ABC123');
    });

    it('handles null/undefined input gracefully', () => {
      expect(ProfileModel.fromDriverDetails(null)).toBeNull();
      expect(ProfileModel.fromDriverDetails(undefined)).toBeNull();
    });

    it('awards badges based on achievements', () => {
      const firstDelivery = ProfileModel.fromDriverDetails({ total_trips: 1 });
      expect(firstDelivery.badges).toContainEqual(expect.objectContaining({ id: 'first_delivery' }));

      const hundredDeliveries = ProfileModel.fromDriverDetails({ total_trips: 100 });
      expect(hundredDeliveries.badges).toContainEqual(expect.objectContaining({ id: '100_deliveries' }));

      const fiveStar = ProfileModel.fromDriverDetails({ rating: 4.9, total_trips: 50 });
      expect(fiveStar.badges).toContainEqual(expect.objectContaining({ id: '5_star' }));

      const topEarner = ProfileModel.fromDriverDetails({ wallet_total: 1000 });
      expect(topEarner.badges).toContainEqual(expect.objectContaining({ id: 'top_earner' }));

      const champion = ProfileModel.fromDriverDetails({ total_trips: 500 });
      expect(champion.badges).toContainEqual(expect.objectContaining({ id: 'long_distance_champion' }));
    });
  });

  describe('mergeProfileData', () => {
    it('merges profile, stats, and driver details', () => {
      const profile = { id: 'uuid-1', full_name: 'John' };
      const stats = { total_orders: 10 };
      const driverDetails = { rating: 4.5 };

      const result = ProfileModel.mergeProfileData(profile, stats, driverDetails);

      expect(result.id).toBe('uuid-1');
      expect(result.fullName).toBe('John');
      expect(result.customerStats.totalOrders).toBe(10);
      expect(result.driverDetails.rating).toBe(4.5);
    });
  });

  describe('Database Operations (findById, create, update, delete)', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        from: vi.fn(),
      };
    });

    describe('findById', () => {
      it('returns null when id is empty, null, or undefined', async () => {
        expect(await ProfileModel.findById(null, mockClient)).toBeNull();
        expect(await ProfileModel.findById(undefined, mockClient)).toBeNull();
        expect(await ProfileModel.findById('', mockClient)).toBeNull();
      });

      it('throws error when database client is not configured', async () => {
        await expect(ProfileModel.findById('usr-1', null)).rejects.toThrow('Supabase client not configured');
      });

      it('fetches and normalizes a profile by ID', async () => {
        const rawDbProfile = {
          id: 'usr-123',
          firebase_uid: 'fb-123',
          role: 'driver',
          full_name: 'Jane Doe',
          phone: '+1234567890',
          email: 'jane@example.com',
          company_name: 'Logistics Co',
          avatar_url: 'https://example.com/avatar.png',
          language: 'en',
          dark_mode: true,
          is_active: true,
          wallet_address: '0x1234',
          polygon_wallet_address: '0x5678',
        };

        const maybeSingleMock = vi.fn().mockResolvedValue({ data: rawDbProfile, error: null });
        const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
        const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ select: selectMock });

        const result = await ProfileModel.findById('usr-123', mockClient);

        expect(mockClient.from).toHaveBeenCalledWith('profiles');
        expect(selectMock).toHaveBeenCalledWith('*');
        expect(eqMock).toHaveBeenCalledWith('id', 'usr-123');
        expect(result).toEqual({
          id: 'usr-123',
          firebaseUid: 'fb-123',
          role: 'driver',
          fullName: 'Jane Doe',
          phone: '+1234567890',
          email: 'jane@example.com',
          companyName: 'Logistics Co',
          avatarUrl: 'https://example.com/avatar.png',
          language: 'en',
          darkMode: true,
          isActive: true,
          walletAddress: '0x1234',
          polygonWalletAddress: '0x5678',
        });
      });

      it('returns null when profile is not found in database', async () => {
        const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
        const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
        const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ select: selectMock });

        const result = await ProfileModel.findById('non-existent-id', mockClient);

        expect(result).toBeNull();
      });

      it('throws an error when the query fails', async () => {
        const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: new Error('Database query error') });
        const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
        const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ select: selectMock });

        await expect(ProfileModel.findById('usr-123', mockClient)).rejects.toThrow('Database query error');
      });
    });

    describe('create', () => {
      it('throws error when profileData is invalid or missing', async () => {
        await expect(ProfileModel.create(null, mockClient)).rejects.toThrow('Invalid profile data');
        await expect(ProfileModel.create('invalid', mockClient)).rejects.toThrow('Invalid profile data');
      });

      it('throws error when database client is not configured', async () => {
        await expect(ProfileModel.create({ full_name: 'Test' }, null)).rejects.toThrow('Supabase client not configured');
      });

      it('creates and returns normalized profile data', async () => {
        const inputData = {
          firebase_uid: 'fb-456',
          full_name: 'Alice Smith',
          email: 'alice@example.com',
          role: 'customer',
        };

        const rawCreatedProfile = {
          id: 'usr-new-1',
          firebase_uid: 'fb-456',
          role: 'customer',
          full_name: 'Alice Smith',
          phone: null,
          email: 'alice@example.com',
          company_name: null,
          avatar_url: null,
          language: 'en',
          dark_mode: false,
          is_active: true,
          wallet_address: null,
          polygon_wallet_address: null,
        };

        const singleMock = vi.fn().mockResolvedValue({ data: rawCreatedProfile, error: null });
        const selectMock = vi.fn().mockReturnValue({ single: singleMock });
        const insertMock = vi.fn().mockReturnValue({ select: selectMock });
        mockClient.from.mockReturnValue({ insert: insertMock });

        const result = await ProfileModel.create(inputData, mockClient);

        expect(mockClient.from).toHaveBeenCalledWith('profiles');
        expect(insertMock).toHaveBeenCalledWith(inputData);
        expect(result).toEqual({
          id: 'usr-new-1',
          firebaseUid: 'fb-456',
          role: 'customer',
          fullName: 'Alice Smith',
          phone: '',
          email: 'alice@example.com',
          companyName: '',
          avatarUrl: '',
          language: 'en',
          darkMode: false,
          isActive: true,
          walletAddress: null,
          polygonWalletAddress: null,
        });
      });

      it('throws error when insertion fails', async () => {
        const singleMock = vi.fn().mockResolvedValue({ data: null, error: new Error('Unique constraint violation') });
        const selectMock = vi.fn().mockReturnValue({ single: singleMock });
        const insertMock = vi.fn().mockReturnValue({ select: selectMock });
        mockClient.from.mockReturnValue({ insert: insertMock });

        await expect(ProfileModel.create({ email: 'duplicate@example.com' }, mockClient)).rejects.toThrow('Unique constraint violation');
      });
    });

    describe('update', () => {
      it('throws error when id or updateData is invalid', async () => {
        await expect(ProfileModel.update(null, { full_name: 'Updated' }, mockClient)).rejects.toThrow('Profile id is required');
        await expect(ProfileModel.update('usr-1', null, mockClient)).rejects.toThrow('Invalid update data');
        await expect(ProfileModel.update('usr-1', 'invalid', mockClient)).rejects.toThrow('Invalid update data');
      });

      it('throws error when database client is not configured', async () => {
        await expect(ProfileModel.update('usr-1', { full_name: 'Updated' }, null)).rejects.toThrow('Supabase client not configured');
      });

      it('updates and returns normalized profile data', async () => {
        const updateData = {
          full_name: 'Alice Updated',
          phone: '9876543210',
          dark_mode: true,
        };

        const rawUpdatedProfile = {
          id: 'usr-1',
          firebase_uid: 'fb-456',
          role: 'customer',
          full_name: 'Alice Updated',
          phone: '9876543210',
          email: 'alice@example.com',
          company_name: '',
          avatar_url: '',
          language: 'en',
          dark_mode: true,
          is_active: true,
          wallet_address: null,
          polygon_wallet_address: null,
        };

        const singleMock = vi.fn().mockResolvedValue({ data: rawUpdatedProfile, error: null });
        const selectMock = vi.fn().mockReturnValue({ single: singleMock });
        const eqMock = vi.fn().mockReturnValue({ select: selectMock });
        const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ update: updateMock });

        const result = await ProfileModel.update('usr-1', updateData, mockClient);

        expect(mockClient.from).toHaveBeenCalledWith('profiles');
        expect(updateMock).toHaveBeenCalledWith(updateData);
        expect(eqMock).toHaveBeenCalledWith('id', 'usr-1');
        expect(result).toEqual({
          id: 'usr-1',
          firebaseUid: 'fb-456',
          role: 'customer',
          fullName: 'Alice Updated',
          phone: '9876543210',
          email: 'alice@example.com',
          companyName: '',
          avatarUrl: '',
          language: 'en',
          darkMode: true,
          isActive: true,
          walletAddress: null,
          polygonWalletAddress: null,
        });
      });

      it('throws error when update fails', async () => {
        const singleMock = vi.fn().mockResolvedValue({ data: null, error: new Error('Update failed') });
        const selectMock = vi.fn().mockReturnValue({ single: singleMock });
        const eqMock = vi.fn().mockReturnValue({ select: selectMock });
        const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ update: updateMock });

        await expect(ProfileModel.update('usr-1', { full_name: 'Error' }, mockClient)).rejects.toThrow('Update failed');
      });
    });

    describe('delete', () => {
      it('throws error when id is missing or invalid', async () => {
        await expect(ProfileModel.delete(null, mockClient)).rejects.toThrow('Profile id is required');
        await expect(ProfileModel.delete('', mockClient)).rejects.toThrow('Profile id is required');
      });

      it('throws error when database client is not configured', async () => {
        await expect(ProfileModel.delete('usr-1', null)).rejects.toThrow('Supabase client not configured');
      });

      it('deletes and returns the normalized deleted profile', async () => {
        const rawDeletedProfile = {
          id: 'usr-delete-1',
          firebase_uid: 'fb-del',
          role: 'user',
          full_name: 'Deleted User',
          phone: '',
          email: 'del@example.com',
          company_name: '',
          avatar_url: '',
          language: 'en',
          dark_mode: false,
          is_active: false,
          wallet_address: null,
          polygon_wallet_address: null,
        };

        const maybeSingleMock = vi.fn().mockResolvedValue({ data: rawDeletedProfile, error: null });
        const selectMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
        const eqMock = vi.fn().mockReturnValue({ select: selectMock });
        const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ delete: deleteMock });

        const result = await ProfileModel.delete('usr-delete-1', mockClient);

        expect(mockClient.from).toHaveBeenCalledWith('profiles');
        expect(deleteMock).toHaveBeenCalled();
        expect(eqMock).toHaveBeenCalledWith('id', 'usr-delete-1');
        expect(result).toEqual({
          id: 'usr-delete-1',
          firebaseUid: 'fb-del',
          role: 'user',
          fullName: 'Deleted User',
          phone: '',
          email: 'del@example.com',
          companyName: '',
          avatarUrl: '',
          language: 'en',
          darkMode: false,
          isActive: false,
          walletAddress: null,
          polygonWalletAddress: null,
        });
      });

      it('returns null when trying to delete non-existent profile', async () => {
        const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
        const selectMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
        const eqMock = vi.fn().mockReturnValue({ select: selectMock });
        const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ delete: deleteMock });

        const result = await ProfileModel.delete('non-existent', mockClient);
        expect(result).toBeNull();
      });

      it('throws error when delete fails', async () => {
        const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: new Error('Delete foreign key violation') });
        const selectMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
        const eqMock = vi.fn().mockReturnValue({ select: selectMock });
        const deleteMock = vi.fn().mockReturnValue({ eq: eqMock });
        mockClient.from.mockReturnValue({ delete: deleteMock });

        await expect(ProfileModel.delete('usr-1', mockClient)).rejects.toThrow('Delete foreign key violation');
      });
    });
  });
});
