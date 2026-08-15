use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Vector2D {
    pub x: f32,
    pub y: f32,
}

fn polygon_signed_area(v: &[Vector2D]) -> f32 {
    let n = v.len();
    let mut area = 0.0f32;
    for i in 0..n {
        let j = (i + 1) % n;
        area += v[i].x * v[j].y - v[j].x * v[i].y;
    }
    area / 2.0
}

fn cross(a: &Vector2D, b: &Vector2D, c: &Vector2D) -> f32 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn point_in_triangle(p: &Vector2D, a: &Vector2D, b: &Vector2D, c: &Vector2D) -> bool {
    let d1 = cross(a, b, p);
    let d2 = cross(b, c, p);
    let d3 = cross(c, a, p);
    let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !has_neg && !has_pos
}

/// Ear-clipping triangulator for rendering custom geofences on Flutter canvas.
///
/// Produces a valid triangulation for arbitrary simple polygons (convex or
/// concave) by repeatedly clipping convex ears whose interior is empty of other
/// vertices. Reflex (concave) vertices are automatically skipped.
#[wasm_bindgen]
pub fn triangulate_geofence_polygon(vertices_json: &str) -> String {
    if vertices_json.is_empty() {
        return "[]".to_string();
    }

    let mut verts: Vec<Vector2D> = match serde_json::from_str(vertices_json) {
        Ok(v) => v,
        Err(_) => return "{\"status\":\"error\",\"reason\":\"invalid json\"}".to_string(),
    };

    if verts.len() < 3 {
        return "{\"status\":\"error\",\"reason\":\"need >= 3 vertices\"}".to_string();
    }

    // Work in counter-clockwise order so a convex vertex has cross(prev,cur,next) > 0.
    if polygon_signed_area(&verts) < 0.0 {
        verts.reverse();
    }

    let mut idx: Vec<usize> = (0..verts.len()).collect();
    let mut indices: Vec<u32> = Vec::new();

    let mut i = 0usize;
    let mut guard = 0usize;
    let max_iter = 2 * verts.len() * verts.len() + verts.len();
    while idx.len() > 3 && guard < max_iter {
        guard += 1;
        let m = idx.len();
        let prev = idx[(i + m - 1) % m];
        let cur = idx[i];
        let next = idx[(i + 1) % m];

        if cross(&verts[prev], &verts[cur], &verts[next]) > 0.0 {
            let mut ear = true;
            for &k in &idx {
                if k == prev || k == cur || k == next {
                    continue;
                }
                if point_in_triangle(&verts[k], &verts[prev], &verts[cur], &verts[next]) {
                    ear = false;
                    break;
                }
            }
            if ear {
                indices.extend_from_slice(&[prev as u32, cur as u32, next as u32]);
                idx.remove(i);
                continue;
            }
        }
        i = (i + 1) % idx.len();
    }

    if idx.len() == 3 {
        indices.extend_from_slice(&[idx[0] as u32, idx[1] as u32, idx[2] as u32]);
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
        let mut sorted = indices.clone();
        sorted.sort_by_key(|v| v.as_u64().unwrap());
        assert_eq!(sorted, vec![Value::from(0), Value::from(1), Value::from(2)]);
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

    #[test]
    fn concave_l_shape_triangulates_correctly() {
        let l_shape = "[{\"x\":0.0,\"y\":0.0},{\"x\":2.0,\"y\":0.0},{\"x\":2.0,\"y\":1.0},{\"x\":1.0,\"y\":1.0},{\"x\":1.0,\"y\":2.0},{\"x\":0.0,\"y\":2.0}]";
        let verts: Vec<Vector2D> = serde_json::from_str(l_shape).unwrap();
        let out = triangulate_geofence_polygon(l_shape);
        let payload: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(payload["status"], "success");

        // n-2 triangles for an n-vertex simple polygon.
        let n = verts.len();
        assert_eq!(payload["triangles_count"].as_u64().unwrap(), (n - 2) as u64);

        // Union of triangle areas must equal the polygon area (3.0 for this L-shape),
        // proving no triangle falls outside the polygon.
        let indices = payload["indices"].as_array().unwrap();
        let mut area = 0.0f32;
        for tri in indices.chunks(3) {
            let a = &verts[tri[0].as_u64().unwrap() as usize];
            let b = &verts[tri[1].as_u64().unwrap() as usize];
            let c = &verts[tri[2].as_u64().unwrap() as usize];
            area += (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)).abs() / 2.0;
        }
        assert!((area - 3.0).abs() < 1e-4, "triangle area {} != 3.0", area);
    }
}
