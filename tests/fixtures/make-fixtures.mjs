// Generates the synthetic fixtures in this folder. The person is invented ("Jordan Example").
// Run: node tests/fixtures/make-fixtures.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

const dir = dirname(fileURLToPath(import.meta.url));
const lines = [
  "Jordan Example",
  "Senior Litigation Associate, Phoenix, AZ",
  "Eight years of commercial litigation experience",
  "Led discovery on a $120M breach of contract matter",
  "First-chaired two jury trials to verdict",
];

const docx = new Document({
  sections: [{ children: lines.map((l) => new Paragraph({ children: [new TextRun(l)] })) }],
});
writeFileSync(join(dir, "resume-fake.docx"), await Packer.toBuffer(docx));

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const page = pdf.addPage([612, 792]);
lines.forEach((l, i) => page.drawText(l, { x: 50, y: 740 - i * 20, size: 12, font }));
writeFileSync(join(dir, "resume-fake.pdf"), await pdf.save());

// Image-only PDF: a blank raster page, no text layer.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const w = 200;
const h = 100;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((w * 3 + 1) * h, 0xff);
for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
const scanned = await PDFDocument.create();
const img = await scanned.embedPng(png);
const sp = scanned.addPage([612, 792]);
sp.drawImage(img, { x: 50, y: 600, width: 400, height: 200 });
writeFileSync(join(dir, "scanned-no-text.pdf"), await scanned.save());
console.log("fixtures written");
