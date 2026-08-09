#version 460 core

#include <flutter/runtime_effect.glsl>

uniform vec2 uSize;
uniform float uTime;
uniform vec2 uHazardCenter;
uniform float uDangerRadius;

out vec4 fragColor;

void main() {
    vec2 st = FlutterFragCoord().xy / uSize;
    float dist = distance(st, uHazardCenter);

    // Pulse radar ring wave
    float wave = sin(dist * 50.0 - uTime * 5.0);
    float alpha = smoothstep(uDangerRadius, uDangerRadius - 0.05, dist) * step(0.8, wave);

    vec3 dangerColor = vec3(0.95, 0.25, 0.15); // Crimson Red Danger Overlay
    fragColor = vec4(dangerColor * alpha, alpha * 0.7);
}
