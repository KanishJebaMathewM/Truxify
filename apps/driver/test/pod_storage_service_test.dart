import 'package:flutter_test/flutter_test.dart';
import 'package:truxify_driver/services/pod_storage_service.dart';

void main() {
  group('PodRecord', () {
    test('creates PodRecord with required fields', () {
      final record = PodRecord(
        orderId: 'order-123',
        createdAt: 1234567890,
      );

      expect(record.orderId, 'order-123');
      expect(record.signaturePath, isNull);
      expect(record.photoPath, isNull);
      expect(record.synced, 0);
      expect(record.createdAt, 1234567890);
    });

    test('creates PodRecord with all fields', () {
      final record = PodRecord(
        id: 1,
        orderId: 'order-123',
        signaturePath: '/path/to/sign.png',
        photoPath: '/path/to/photo.jpg',
        synced: 1,
        createdAt: 1234567890,
      );

      expect(record.id, 1);
      expect(record.orderId, 'order-123');
      expect(record.signaturePath, '/path/to/sign.png');
      expect(record.photoPath, '/path/to/photo.jpg');
      expect(record.synced, 1);
      expect(record.createdAt, 1234567890);
    });

    test('toMap produces correct map', () {
      final record = PodRecord(
        id: 1,
        orderId: 'order-123',
        signaturePath: '/path/to/sign.png',
        photoPath: '/path/to/photo.jpg',
        synced: 0,
        createdAt: 1234567890,
      );

      final map = record.toMap();
      expect(map['id'], 1);
      expect(map['order_id'], 'order-123');
      expect(map['signature_path'], '/path/to/sign.png');
      expect(map['photo_path'], '/path/to/photo.jpg');
      expect(map['synced'], 0);
      expect(map['created_at'], 1234567890);
    });

    test('fromMap creates PodRecord correctly', () {
      final map = {
        'id': 2,
        'order_id': 'order-456',
        'signature_path': '/sig/path',
        'photo_path': '/photo/path',
        'synced': 1,
        'created_at': 9876543210,
      };

      final record = PodRecord.fromMap(map);
      expect(record.id, 2);
      expect(record.orderId, 'order-456');
      expect(record.signaturePath, '/sig/path');
      expect(record.photoPath, '/photo/path');
      expect(record.synced, 1);
      expect(record.createdAt, 9876543210);
    });

    test('fromMap handles null optional fields', () {
      final map = {
        'id': 3,
        'order_id': 'order-789',
        'signature_path': null,
        'photo_path': null,
        'synced': 0,
        'created_at': 1111111111,
      };

      final record = PodRecord.fromMap(map);
      expect(record.signaturePath, isNull);
      expect(record.photoPath, isNull);
    });
  });
}
