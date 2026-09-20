import { crc32 } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** A stand-in for the real Year 8 Geography notification (no real one is in the repo yet). */
export const geographyText = readFileSync(join(here, 'fixtures', 'geography-notification.txt'), 'utf8');

/** What a correct read of the geography notification looks like: the ground truth the tests compare against. */
export const geographyParsed = {
  title: 'Weather, People & Place — Midterm Exam',
  course: 'GEOG201 Human & Physical Geography',
  parts: [
    { label: 'Part A', description: 'Research notes, no word limit', dueDate: '2026-09-23', dueTime: '23:59', dueText: 'Wednesday 23 September, 11:59pm' },
    { label: 'Part B', description: 'In-class test, 40 minutes of writing time', dueDate: '2026-09-25', dueTime: null, dueText: 'Friday 25 September, in class' },
  ],
  weightingText: '30% of your course grade',
  weightingPercent: 30,
  aiUse: 'Idea generation and brainstorming only, before Part A is submitted. Not permitted at all during Part B.',
  topics: [
    { text: 'atmospheric circulation', kind: 'keyword' },
    { text: 'urban growth', kind: 'keyword' },
    { text: 'land degradation', kind: 'keyword' },
    { text: 'rainfall patterns and climate zones', kind: 'keyword' },
    { text: 'population distribution', kind: 'keyword' },
    { text: 'rural to urban migration', kind: 'keyword' },
    { text: 'ecosystems and biomes', kind: 'keyword' },
    { text: 'sustainable land management', kind: 'keyword' },
    { text: 'communicates using a range of examples and geographical concepts', kind: 'skill' },
  ],
  needsOwnFocus: true,
  focusPrompt: 'Choose one commodity to research: coffee or chocolate.',
  transcript: null,
};

/** A Response shaped like the Anthropic Messages API answering with this JSON as text. */
export function claudeReply(parsed: unknown, extra: { stop_reason?: string } = {}): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: JSON.stringify(parsed) }],
      stop_reason: extra.stop_reason ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

export const claudeError = (status: number, type = 'error') =>
  new Response(JSON.stringify({ type: 'error', error: { type, message: 'nope' } }), { status, headers: { 'content-type': 'application/json' } });

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

// ---- Tiny file builders, so tests use real DOCX/PDF/image bytes without checked-in binaries ----

function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

/** A zip with stored (uncompressed) entries. */
export function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(33), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data]);
    centrals.push(
      Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(33), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]),
    );
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, central, end]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A real .docx: paragraphs, plus an optional table (rows of cells). */
export function makeDocx(paragraphs: string[], table?: string[][]): Buffer {
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const tbl = table
    ? `<w:tbl>${table.map((row) => `<w:tr>${row.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
    : '';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p).join('')}${tbl}</w:body></w:document>`;
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') },
    { name: 'word/document.xml', data: Buffer.from(document) },
  ]);
}

/** A real one-page PDF. With lines it has a text layer; with none it is drawn shapes only (like a scan). */
export function makePdf(lines: string[]): Buffer {
  const pdfEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = lines.length
    ? `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${pdfEsc(l)}) Tj T*`).join(' ')} ET`
    : '0.5 g 50 50 400 400 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Smallest bytes that sniff as each image type (contents are not decoded by the server). */
export const fakeJpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 1)]);
export const fakePng = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
/** HEIC files start with an ftyp box; the server must refuse them. */
export const fakeHeic = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(100, 3)]);
