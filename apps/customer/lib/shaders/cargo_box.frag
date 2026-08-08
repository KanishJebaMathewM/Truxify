#version 460 core

#include <flutter/runtime_effect.glsl>

uniform vec2 uSize;
uniform float uRotationX;
uniform float uRotationY;
uniform vec3 uBoxDimensions;

out vec4 fragColor;

void main() {
    vec2 st = FlutterFragCoord().xy / uSize;
    vec3 col = vec3(0.15, 0.45, 0.85); // Truxify Primary Blue

    // Simple 3D box shading simulation
    float light = dot(vec3(st, 1.0), normalize(vec3(uRotationX, uRotationY, 1.0)));
    col *= clamp(light, 0.4, 1.0);

    fragColor = vec4(col, 1.0);
}
