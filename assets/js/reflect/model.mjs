// Direct port of the supplied SpeedyWeather C45 conditional-mean equations.
// Inputs use metres, kelvin, m³/m³ soil moisture, and fractional vegetation cover.
export const FIELDS = ['cvh', 'cvl', 'swvl1', 'stl1', 'swvl4', 'stl4', 'height', 'lai_hv', 'lai_lv', 'snow_depth', 't2m', 'ice'];
export const STRIDE = FIELDS.length;
const tanh = Math.tanh;
export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const nodes = [0.38676060450055738, 1.1638291005549648, 1.9519803457163336, 2.7602450476307019, 3.6008736241715487, 4.492955302520012, 5.472225705949343, 6.6308781983931295];
const weights = [0.28656852123801213, 0.15833837275094964, 0.04728475235401403, 0.007266937601184743, 0.0005259849265739094, 1.5300032162487316e-5, 1.3094732162868187e-7, 1.4978147231618314e-10];
export function brdf(input, scale = 0.05) {
  let [cvh, cvl, swvl1, stl1, swvl4, stl4, height, lai_hv, lai_lv, snowDepth, t2m] = input;
  let z = height * 9.80665;
  let snowc = 100 * snowDepth / (snowDepth + scale);
  cvh = (cvh - 0.133532435) / 0.308668464;
  cvl = (cvl - 0.337337554) / 0.434981227;
  swvl1 = (swvl1 - 0.199335992) / 0.144049704;
  stl1 = (stl1 - 272.927063) / 27.9744835;
  swvl4 = (swvl4 - 0.188011795) / 0.126259446;
  stl4 = (stl4 - 272.838135) / 28.1154652;
  z = (z - 12325.2734) / 11136.7861;
  lai_hv = (lai_hv - 0.726260066) / 1.4615227;
  lai_lv = (lai_lv - 0.594841719) / 0.793866992;
  snowc = (snowc - 40.004837) / 49.8801575;
  t2m = (t2m - 272.998016) / 24.5919514;
  // The five affine-in-noise expressions are evaluated at noise = 0.
  const visIso = ((tanh(stl4 + tanh(stl1)) + tanh(lai_lv + cvh) + 2.7464638) * -0.027389338 * (tanh(snowc) + 1.4331475)) * (cvl + cvh + 3.4503622) + (snowc + (-6.544513 + swvl4) * -0.043655884) * 0.94943845;
  const visVol = tanh(((2.9663298 - t2m * (t2m - cvh)) * stl4 + lai_lv + cvh + 0.8054831 + cvl) * snowc + 2.6775892) / 0.826817 * (tanh((stl4 - snowc + 0.91944665) * snowc - (z - tanh(1.3589956)) * -0.44828266) + 1.4221689);
  const visGeo = -(tanh(stl4 - (t2m * (lai_lv + cvh - snowc) - z)) + 0.5595558) * tanh(-1.4731935 - z - swvl4) * (-(tanh(stl4) + tanh(z)) * (t2m - snowc * swvl4) + 2.4880857) * 0.4425772;
  function nirNoise(noise) {
    return tanh(((tanh(z * (swvl1 * (1.5148919 - swvl1)) - (stl1 + 1.252149) - cvl * 0.7264098) * 1.4019876 - swvl4) - cvh) * 0.35748067 + noise * 0.17402178 + snowc * 0.7264098) / 0.954435 + (noise + 0.19925372 + snowc) * 0.1744688;
  }
  let nirIso = 0;
  for (let k = 0; k < nodes.length; k++) nirIso += weights[k] * (nirNoise(nodes[k]) + nirNoise(-nodes[k]));
  const nirVol = (-(stl4 - 0.6491491) * tanh(t2m * (t2m + 0.9325455) + tanh(tanh(cvl)) + (stl4 + z) * (stl4 * 1.4077162 + z * z) - 0.2268725) + (tanh(swvl4) / 0.9325455 + 0.6491491) * stl1 - 0.08895658) / 1.7196642;
  const nirGeo = tanh(tanh(stl4 * 3.3250651 + z + 2.0542192 - cvl) * (z / 1.810424 + tanh(stl4 * (swvl4 + 2.5083585) + 0.5238071 + swvl4)) - tanh(tanh(cvl * lai_hv + 2.1756017) + snowc)) * 1.060858;
  return [0.461719573 + 0.388600379 * visIso, 0.0503934845 + 0.0374130346 * visVol, 0.0195207894 + 0.0172091164 * visGeo, 0.454524219 + 0.174554765 * nirIso, 0.114233129 + 0.0610273033 * nirVol, 0.0346314497 + 0.0259347353 * nirGeo];
}
export function spectralAlbedo(iso, vol, geo, theta, direct, diffuse) {
  const cv = -0.007574 + theta * theta * (-0.070987 + 0.307588 * theta);
  const cg = -1.284909 + theta * theta * (-0.166314 + 0.04184 * theta);
  return direct * (iso + cv * vol + cg * geo) + diffuse * (iso + 0.189184 * vol - 1.377622 * geo);
}
export function learnedAlbedo(parameters, theta, direct, diffuse) {
  return clamp(0.5395 * spectralAlbedo(parameters[0], parameters[1], parameters[2], theta, direct, diffuse) + 0.4689 * spectralAlbedo(parameters[3], parameters[4], parameters[5], theta, direct, diffuse));
}
export function simpleAlbedo(input, kind, linear = false) {
  if (kind < 2) return 0.06 + clamp(input[11]) * 0.54;
  const snow = linear ? clamp(input[9] / 0.05) : input[9] / (input[9] + 0.05);
  return clamp(input[0] * 0.15 + input[1] * 0.2 + (1 - input[0] - input[1]) * 0.4 + snow * 0.4);
}
// Heightfield horizons: march along each east–west row. Diffuse light is unoccluded.
export function shadows(data, size, phase, enabled = true, cellWidth = 100, target = null) {
  const result = target || new Uint8Array(size * size);
  result.fill(0);
  if (!enabled) return result;
  const elevation = Math.sin(phase * Math.PI);
  if (elevation <= 0) { result.fill(1); return result; }
  const gradient = elevation / Math.max(1e-9, Math.abs(Math.cos(phase * Math.PI)));
  const morning = phase < 0.5;
  for (let y = 0; y < size; y++) {
    let horizon = -Infinity;
    for (let k = 0; k < size; k++) {
      const x = morning ? k : size - 1 - k;
      const i = y * size + x;
      const height = data[i * STRIDE + 6];
      horizon -= gradient * cellWidth;
      result[i] = height + 0.01 < horizon ? 1 : 0;
      horizon = Math.max(horizon, height);
    }
  }
  return result;
}
// Only these four coefficients per cell are retained; no per-timestep maps.
export function surfaceCache({ data, kinds, size, scheme = 'learned' }) {
  const cache = new Float64Array(size * size * 4);
  for (let i = 0; i < kinds.length; i++) {
    const input = data.subarray(i * STRIDE, (i + 1) * STRIDE), offset = i * 4;
    if (scheme === 'learned' && kinds[i] >= 2) {
      const p = brdf(input);
      for (let j = 0; j < 3; j++) cache[offset + j] = 0.5395 * p[j] + 0.4689 * p[j + 3];
      cache[offset + 3] = NaN; // Distinguishes angular C45 albedo from a constant.
    } else cache[offset + 3] = simpleAlbedo(input, kinds[i], scheme === 'linear');
  }
  return cache;
}
export function createFrame(size) {
  return { albedos: new Float32Array(size * size), shades: new Uint8Array(size * size), watts: 0, reflectionWatts: 0 };
}
export function evaluateFrame({ data, size, cloud = 0.15, terrainShadows = true }, cache, phase, frame = createFrame(size)) {
  phase = clamp(phase);
  const sine = phase === 0 || phase === 1 ? 0 : Math.sin(phase * Math.PI);
  const theta = Math.acos(clamp(sine));
  const cv = -0.007574 + theta * theta * (-0.070987 + 0.307588 * theta);
  const cg = -1.284909 + theta * theta * (-0.166314 + 0.04184 * theta);
  const beam = 900 * (1 - cloud), sky = 80 + 250 * cloud;
  shadows(data, size, phase, terrainShadows, 100, frame.shades);
  let sumIn = 0, sumOut = 0;
  for (let i = 0; i < size * size; i++) {
    const dir = frame.shades[i] ? 0 : beam, light = dir + sky;
    const direct = dir / light, diffuse = sky / light, offset = i * 4;
    const fixed = cache[offset + 3];
    const a = Number.isNaN(fixed) ? clamp(cache[offset] + (direct * cv + diffuse * 0.189184) * cache[offset + 1] + (direct * cg - diffuse * 1.377622) * cache[offset + 2]) : fixed;
    frame.albedos[i] = a;
    sumIn += light; sumOut += light * a;
  }
  frame.watts = sumIn * sine / (size * size);
  frame.reflectionWatts = sumOut * sine / (size * size);
  return frame;
}
export function simulate(config) {
  const { size, hours = 12, steps = 1440 } = config;
  const cache = surfaceCache(config), frame = createFrame(size);
  const incident = new Float64Array(steps + 1), reflected = new Float64Array(steps + 1);
  const watts = new Float32Array(steps + 1), reflectionWatts = new Float32Array(steps + 1);
  const dt = hours / steps;
  // Eight times finer quadrature, with one reusable map instead of 1,441 maps.
  for (let step = 1; step <= steps; step++) {
    evaluateFrame(config, cache, (step - 0.5) / steps, frame);
    watts[step] = frame.watts; reflectionWatts[step] = frame.reflectionWatts;
    incident[step] = incident[step - 1] + frame.watts * dt;
    reflected[step] = reflected[step - 1] + frame.reflectionWatts * dt;
  }
  return { cache, incident, reflected, watts, reflectionWatts, steps, count: size * size };
}
