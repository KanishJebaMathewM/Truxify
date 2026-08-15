use std::collections::HashMap;

use wasm_bindgen::prelude::*;

/// Zero-copy Protocol Buffer parser compiled to WebAssembly for telemetry payload parsing.
///
/// Decodes the protobuf wire format (varint tags + fixed64/fixed32/varint/length-delimited
/// values) and reads `lat` (field 1) and `lng` (field 2) as floating-point values. Unlike the
/// previous stub, the returned coordinates come from the supplied bytes rather than a constant.
#[wasm_bindgen]
pub fn decode_protobuf_telemetry_zero_copy(protobuf_bytes: &[u8]) -> String {
    if protobuf_bytes.is_empty() {
        return "{}".to_string();
    }

    let mut fields: HashMap<u64, f64> = HashMap::new();
    let mut idx = 0usize;
    while idx < protobuf_bytes.len() {
        let (tag, consumed) = match read_varint(protobuf_bytes, idx) {
            Some(v) => v,
            None => break,
        };
        idx += consumed;

        let field_num = tag >> 3;
        let wire_type = tag & 0x7;
        match wire_type {
            0 => {
                // varint
                let (val, c) = match read_varint(protobuf_bytes, idx) {
                    Some(v) => v,
                    None => break,
                };
                idx += c;
                fields.insert(field_num, val as f64);
            }
            1 => {
                // 64-bit fixed (e.g. double lat/lng)
                if idx + 8 > protobuf_bytes.len() {
                    break;
                }
                let mut buf = [0u8; 8];
                buf.copy_from_slice(&protobuf_bytes[idx..idx + 8]);
                idx += 8;
                fields.insert(field_num, f64::from_le_bytes(buf));
            }
            5 => {
                // 32-bit fixed (e.g. float lat/lng)
                if idx + 4 > protobuf_bytes.len() {
                    break;
                }
                let mut buf = [0u8; 4];
                buf.copy_from_slice(&protobuf_bytes[idx..idx + 4]);
                idx += 4;
                fields.insert(field_num, f32::from_le_bytes(buf) as f64);
            }
            2 => {
                // length-delimited — skip payload (telemetry lat/lng are numeric fields)
                let (len, c) = match read_varint(protobuf_bytes, idx) {
                    Some(v) => v,
                    None => break,
                };
                idx += c;
                let remaining = (protobuf_bytes.len() - idx) as u64;
                if len > remaining {
                    break;
                }
                let len = len as usize;
                idx += len;
            }
            _ => break,
        }
    }

    let bytes_parsed = protobuf_bytes.len();
    let lat = fields.get(&1).copied();
    let lng = fields.get(&2).copied();

    match (lat, lng) {
        (Some(lat), Some(lng)) => format!(
            "{{\"status\":\"success\",\"bytes_parsed\":{},\"lat\":{},\"lng\":{}}}",
            bytes_parsed, lat, lng
        ),
        _ => format!(
            "{{\"status\":\"error\",\"bytes_parsed\":{},\"reason\":\"missing_lat_lng_fields\"}}",
            bytes_parsed
        ),
    }
}

/// Reads a base-128 varint starting at `idx`, returning the value and the number of bytes read.
fn read_varint(bytes: &[u8], mut idx: usize) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift: u32 = 0;
    let start = idx;
    loop {
        if idx >= bytes.len() {
            return None;
        }
        let byte = bytes[idx];
        idx += 1;
        if shift < 64 {
            result |= ((byte & 0x7f) as u64) << shift;
        }
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    Some((result, idx - start))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encodes a single protobuf field (tag + payload) for a 64-bit fixed value (double).
    fn encode_fixed64(field_num: u64, value: f64) -> Vec<u8> {
        let tag = (field_num << 3) | 1;
        let mut out = encode_varint(tag);
        out.extend_from_slice(&value.to_le_bytes());
        out
    }

    fn encode_varint(mut v: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let mut byte = (v & 0x7f) as u8;
            v >>= 7;
            if v != 0 {
                byte |= 0x80;
            }
            out.push(byte);
            if v == 0 {
                break;
            }
        }
        out
    }

    #[test]
    fn empty_input_returns_empty_object() {
        assert_eq!(decode_protobuf_telemetry_zero_copy(&[]), "{}");
    }

    #[test]
    fn decodes_actual_lat_lng_from_input() {
        let mut payload = Vec::new();
        payload.extend(encode_fixed64(1, 12.9716)); // lat
        payload.extend(encode_fixed64(2, 77.5946)); // lng
        let out = decode_protobuf_telemetry_zero_copy(&payload);
        assert!(out.contains("\"lat\":12.9716"));
        assert!(out.contains("\"lng\":77.5946"));
        assert!(out.contains("\"status\":\"success\""));
    }

    #[test]
    fn different_payload_yields_different_coordinates() {
        let mut payload = Vec::new();
        payload.extend(encode_fixed64(1, 19.076)); // Mumbai lat
        payload.extend(encode_fixed64(2, 72.8777)); // Mumbai lng
        let out = decode_protobuf_telemetry_zero_copy(&payload);
        assert!(out.contains("\"lat\":19.076"));
        assert!(out.contains("\"lng\":72.8777"));
    }

    #[test]
    fn missing_fields_is_flagged_not_fabricated() {
        // Single field 3 only — no lat/lng, must not return the old constant.
        let mut payload = encode_fixed64(3, 1.0);
        let out = decode_protobuf_telemetry_zero_copy(&payload);
        assert!(out.contains("\"status\":\"error\""));
        assert!(!out.contains("28.6139"));
    }

    #[test]
    fn oversized_length_delimited_field_is_rejected() {
        // Length-delimited field (tag wire_type 2) with a u64::MAX declared length.
        // Must not truncate/overflow or hang; parsing should safely stop.
        let tag = (3u64 << 3) | 2;
        let mut payload = encode_varint(tag);
        payload.extend(encode_varint(u64::MAX));
        payload.extend_from_slice(&[0u8; 16]);
        let out = decode_protobuf_telemetry_zero_copy(&payload);
        assert!(out.contains("\"status\":\"error\""));
    }
}
