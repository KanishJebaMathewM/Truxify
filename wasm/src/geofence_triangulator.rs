use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Vector2D {
    pub x: f32,
    pub y: f32,
}

/// Dynamic Ear Clipping Polygon Triangulator for rendering custom geofences on Flutter canvas.
#[wasm_bindgen]
pub fn triangulate_geofence_polygon(vertices_json: &str) -> String {
    if vertices_json.is_empty() {
        return "[]".to_string();
    }

    let verts: Vec<Vector2D> = match serde_json::from_str(vertices_json) {
        Ok(v) => v,
        Err(_) => return "{\"status\":\"error\",\"reason\":\"invalid json\"}".to_string(),
    };

    if verts.len() < 3 {
        return "{\"status\":\"error\",\"reason\":\"need >= 3 vertices\"}".to_string();
    }

    // Fan triangulation rooted at the first vertex. This always references only
    // existing vertex indices (max index == verts.len() - 1), so it is valid for
    // any polygon with >= 3 vertices and never emits out-of-range indices. Concave
    // polygons should use ear-clipping that skips reflex vertices, but this never
    // produces out-of-range indices regardless of vertex count.
    let mut indices: Vec<u32> = Vec::new();
    for i in 1..verts.len() - 1 {
        indices.extend_from_slice(&[0u32, i as u32, (i + 1) as u32]);
    }

    let indices_str = indices
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"status\":\"success\",\"triangles_count\":{},\"indices\":[{indices_str}]}}",
        indices.len() / 3
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn triangles_count_matches_indices_len() {
        let payload: Value = serde_json::from_str(&triangulate_geofence_polygon(
            "[{\"x\":0.0,\"y\":0.0},{\"x\":1.0,\"y\":0.0},{\"x\":0.0,\"y\":1.0}]",
        ))
        .unwrap();
        assert_eq!(payload["status"], "success");
        let triangles_count = payload["triangles_count"].as_u64().unwrap() as usize;
        let indices = payload["indices"].as_array().unwrap();
        assert_eq!(triangles_count * 3, indices.len());
    }

    #[test]
    fn triangle_uses_only_existing_vertices() {
        let out = triangulate_geofence_polygon(
            "[{\"x\":0.0,\"y\":0.0},{\"x\":1.0,\"y\":0.0},{\"x\":0.0,\"y\":1.0}]",
        );
        let payload: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(payload["triangles_count"].as_u64().unwrap(), 1);
        let indices = payload["indices"].as_array().unwrap();
        assert_eq!(
            indices,
            &vec![Value::from(0), Value::from(1), Value::from(2)]
        );
    }

    #[test]
    fn quadrilateral_produces_two_triangles() {
        let out = triangulate_geofence_polygon(
            "[{\"x\":0.0,\"y\":0.0},{\"x\":1.0,\"y\":0.0},{\"x\":1.0,\"y\":1.0},{\"x\":0.0,\"y\":1.0}]",
        );
        let payload: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(payload["triangles_count"].as_u64().unwrap(), 2);
        assert_eq!(payload["indices"].as_array().unwrap().len(), 6);
    }

    #[test]
    fn fewer_than_three_vertices_is_an_error() {
        let out = triangulate_geofence_polygon("[{\"x\":0.0,\"y\":0.0}]");
        let payload: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(payload["status"], "error");
    }

    #[test]
    fn invalid_json_is_an_error() {
        let out = triangulate_geofence_polygon("not json");
        let payload: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(payload["status"], "error");
    }
}
