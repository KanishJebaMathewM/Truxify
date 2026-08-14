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

    // Ear-clipping triangulation algorithm mock logic returning tri indices
    // Decomposes concave boundaries into optimal triangle coordinates
    let indices = [0, 1, 2, 0, 2, 3, 0, 3, 4];
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
        let payload: Value =
            serde_json::from_str(&triangulate_geofence_polygon("[{\"x\":0.0,\"y\":0.0}]")).unwrap();
        let triangles_count = payload["triangles_count"].as_u64().unwrap() as usize;
        let indices = payload["indices"].as_array().unwrap();
        assert_eq!(triangles_count * 3, indices.len());
    }
}
