// TIFF support. Chrome can't decode TIFF natively, so we use the bundled geotiff.js (vendor/geotiff.js, MIT).
// Handles 8/16/32-bit integer and float, 1-N bands, LZW/Deflate/PackBits/JPEG/LERC/Zstd, strips and tiles,
// palette, YCbCr, CMYK and CIELab. Only the first page (IFD) of multi-page files is shown.

export const isTiff = path => /\.tiff?$/i.test(path);

const MAX_PIXELS = 268e6; // ~16k x 16k; beyond this the browser can't hold the decoded RGBA image

function lib() {
  if (!window.GeoTIFF) throw new Error('TIFF decoder failed to load');
  return window.GeoTIFF;
}

export async function tiffInfo(file) {
  const tiff = await lib().fromBlob(file);
  const image = await tiff.getImage(0);
  return { width: image.getWidth(), height: image.getHeight(), pages: await tiff.getImageCount() };
}

// Percentile range over a sampled subset of the given bands (ignores NaN and nodata).
function stretchRange(bands, nodata) {
  const n = bands[0].length;
  const step = Math.max(1, Math.floor((n * bands.length) / 2e6));
  const vals = [];
  for (const b of bands) {
    for (let i = 0; i < n; i += step) {
      const v = b[i];
      if (Number.isFinite(v) && v !== nodata) vals.push(v);
    }
  }
  if (!vals.length) return [0, 1];
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.005)];
  const hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.995))];
  return hi > lo ? [lo, hi] : [vals[0], vals[vals.length - 1] > vals[0] ? vals[vals.length - 1] : vals[0] + 1];
}

export async function decodeTiff(file) {
  try {
    return await decodeWithGeoTiff(file);
  } catch (e) {
    // geotiff lacks CCITT fax (G3/G4) and old-style JPEG; UTIF.js (vendor/UTIF.js, MIT) covers those.
    if (!/compression|not supported|unsupported/i.test(String(e?.message)) || !window.UTIF) throw e;
    return await decodeWithUTIF(file);
  }
}

async function decodeWithUTIF(file) {
  const buf = await file.arrayBuffer();
  const ifd = window.UTIF.decode(buf)[0];
  window.UTIF.decodeImage(buf, ifd);
  const w = ifd.width, h = ifd.height;
  if (w * h > MAX_PIXELS) throw new Error(`${file.name} is too large to open in the browser`);
  const rgba = new Uint8ClampedArray(window.UTIF.toRGBA8(ifd).buffer);
  return { bitmap: await createImageBitmap(new ImageData(rgba, w, h)), width: w, height: h };
}

async function decodeWithGeoTiff(file) {
  const tiff = await lib().fromBlob(file);
  const image = await tiff.getImage(0);
  const w = image.getWidth(), h = image.getHeight();
  if (w * h > MAX_PIXELS) throw new Error(`${file.name} is ${w}×${h}; images above about 268 megapixels can't be opened in the browser`);
  const fd = image.fileDirectory;
  const photometric = fd.getValue ? fd.getValue('PhotometricInterpretation') : fd.PhotometricInterpretation;
  const spp = image.getSamplesPerPixel();
  const rgba = new Uint8ClampedArray(w * h * 4);

  // Colour models geotiff converts for us: palette (3), CMYK (5), YCbCr (6), CIELab (8)
  if ([3, 5, 6, 8].includes(photometric)) {
    const rgb = await image.readRGB({ interleave: true, enableAlpha: true });
    const ch = rgb.length / (w * h);
    for (let i = 0, j = 0; i < w * h; i++, j += ch) {
      rgba[i * 4] = rgb[j]; rgba[i * 4 + 1] = rgb[j + 1]; rgba[i * 4 + 2] = rgb[j + 2];
      rgba[i * 4 + 3] = ch === 4 ? rgb[j + 3] : 255;
    }
    return { bitmap: await createImageBitmap(new ImageData(rgba, w, h)), width: w, height: h };
  }

  const rasters = await image.readRasters({ interleave: false });
  const color = spp >= 3 ? [rasters[0], rasters[1], rasters[2]] : [rasters[0]];
  // A 2nd/4th band is alpha only when ExtraSamples says so (otherwise it's e.g. a NIR band)
  const extra = fd.getValue ? fd.getValue('ExtraSamples') : fd.ExtraSamples;
  const extra0 = extra == null ? null : (typeof extra === 'number' ? extra : extra[0]);
  const alpha = (spp === 4 || spp === 2) && (extra0 === 1 || extra0 === 2) ? rasters[spp - 1] : null;
  const bits = image.getBitsPerSample(0);
  const isFloat = image.getSampleFormat(0) === 3;
  const nodata = image.getGDALNoData?.() ?? null;

  let lo = 0, hi = 255;
  const plain8 = bits === 8 && !isFloat;
  if (!plain8) {
    [lo, hi] = stretchRange(color, nodata);
    // 16-bit colour photos that use the full range: scale linearly so colours stay true.
    // Sensor/scientific data (e.g. 12-bit in a 16-bit container, single band) keeps the contrast stretch.
    const full = 2 ** bits - 1;
    if (!isFloat && color.length === 3 && hi > full * 0.5) { lo = 0; hi = full; }
  }
  const scale = 255 / (hi - lo || 1);
  const invert = photometric === 0; // WhiteIsZero
  let alphaMax = 1;
  if (alpha) {
    if (bits === 8) alphaMax = 255;
    else for (let i = 0, n = Math.min(alpha.length, 1e6); i < n; i++) if (alpha[i] > alphaMax) alphaMax = alpha[i];
  }

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const band = color[color.length === 1 ? 0 : c];
      let v = plain8 ? band[i] : (band[i] - lo) * scale;
      if (invert) v = 255 - v;
      rgba[o + c] = v; // Uint8ClampedArray clamps and rounds
    }
    const raw = color[0][i];
    rgba[o + 3] = alpha ? (alpha[i] / alphaMax) * 255 : (raw === nodata || (isFloat && !Number.isFinite(raw)) ? 0 : 255);
  }
  return { bitmap: await createImageBitmap(new ImageData(rgba, w, h)), width: w, height: h };
}
