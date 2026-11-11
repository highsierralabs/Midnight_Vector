// The sky is one fullscreen triangle. vRd is the world-axis view direction, rebuilt from the projection and view
// matrices, so any pose and FOV work, and no world position reaches a float.
out vec3 vRd;
void main() {
  vec3 v = vec3(position.x / projectionMatrix[0][0], position.y / projectionMatrix[1][1], -1.);
  vRd = transpose(mat3(viewMatrix)) * v;
  gl_Position = vec4(position.xy, 1., 1.);
}
