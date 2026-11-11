// Integer hashing and value noise, used by the stars and the nebula target. All inputs are small sky coordinates.
uint skyHu(uint x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
float skyHash(ivec2 c, uint s) { return float(skyHu(uint(c.x) * 0x9E3779B1U ^ uint(c.y) * 0x85EBCA77U ^ s)) / 4294967296.; }
float skyVn(vec2 p) {
  vec2 i = floor(p), f = p - i; f = f * f * (3. - 2. * f); ivec2 c = ivec2(i);
  return mix(mix(skyHash(c, 1U), skyHash(c + ivec2(1, 0), 1U), f.x), mix(skyHash(c + ivec2(0, 1), 1U), skyHash(c + ivec2(1, 1), 1U), f.x), f.y);
}
float skyFbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * skyVn(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
