const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "assets");
const VIEWBOX = 256;
const POLYGONS = [
  { fill: "#5867e8", points: [[128, 14], [228, 72], [228, 168], [180, 198], [164, 236], [128, 214], [92, 236], [76, 198], [28, 168], [28, 72]] },
  { fill: "#101525", points: [[128, 44], [198, 86], [198, 158], [158, 184], [146, 208], [128, 196], [110, 208], [98, 184], [58, 158], [58, 86]] },
  { fill: "#f6f8fa", points: [[78, 168], [116, 74], [128, 60], [140, 74], [178, 168], [148, 168], [128, 112], [108, 168]] },
  { fill: "#35d9b8", points: [[96, 182], [116, 154], [140, 154], [160, 182], [142, 194], [128, 176], [114, 194]] },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

function main() {
  fs.writeFileSync(path.join(OUT_DIR, "icon.svg"), makeSvg());
  fs.writeFileSync(path.join(OUT_DIR, "icon.png"), makePng(1024));
  fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), makeIco([16, 32, 48, 64, 128, 256]));
  fs.writeFileSync(path.join(OUT_DIR, "icon.icns"), makeIcns([
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ]));
}

function makeSvg() {
  const shapes = POLYGONS.map((polygon) => {
    const points = polygon.points.map((point) => point.join(",")).join(" ");
    return `  <polygon fill="${polygon.fill}" points="${points}" />`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img" aria-label="Accord">\n${shapes}\n</svg>\n`;
}

function makePng(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const colors = POLYGONS.map((polygon) => hexToRgba(polygon.fill));

  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const vx = ((x + 0.5) / size) * VIEWBOX;
      const vy = ((y + 0.5) / size) * VIEWBOX;
      let color = null;
      for (let index = 0; index < POLYGONS.length; index += 1) {
        if (isPointInPolygon(vx, vy, POLYGONS[index].points)) color = colors[index];
      }
      if (!color) continue;
      const offset = y * stride + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }

  return makePngFile(size, size, raw);
}

function makeIco(sizes) {
  const images = sizes.map((size) => ({ size, data: makePng(size) }));
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const entry = 6 + index * 16;
    header[entry] = image.size === 256 ? 0 : image.size;
    header[entry + 1] = image.size === 256 ? 0 : image.size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

function makeIcns(entries) {
  const blocks = entries.map(([type, size]) => {
    const data = makePng(size);
    const block = Buffer.alloc(8);
    block.write(type, 0, 4, "ascii");
    block.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([block, data]);
  });
  const total = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...blocks]);
}

function makePngFile(width, height, raw) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function isPointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = ((yi > y) !== (yj > y)) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function hexToRgba(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255,
  ];
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

main();
