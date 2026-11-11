uniform float uTime;
void main() { float z = cameraPosition.z; gl_Position = modelMatrix * vec4(z); }
