uniform float uTimeline;
void main() { vec2 p = cameraPosition.xy; gl_Position = modelViewMatrix * vec4(p, 0., 1.); }
