import { describe, expect, it } from 'vitest';
import { ReadError } from '../src/claude.js';
import { extractDocxText, extractPdfText, hasUsableText, htmlToPlainText, sniffKind } from '../src/extract.js';
import { fakeHeic, fakeJpeg, fakePng, geographyText, makeDocx, makePdf } from './fixtures.js';

describe('sniffKind', () => {
  it('identifies files by content', () => {
    expect(sniffKind(makePdf(['hello world here']))).toBe('pdf');
    expect(sniffKind(makeDocx(['hello world here']))).toBe('docx');
    expect(sniffKind(fakeJpeg())).toBe('jpeg');
    expect(sniffKind(fakePng())).toBe('png');
    expect(sniffKind(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.alloc(50)]))).toBe('webp');
  });

  it('refuses HEIC, plain text, other zips, and files that lie about being PDFs', () => {
    expect(sniffKind(fakeHeic())).toBeNull();
    expect(sniffKind(Buffer.from('just some text, definitely not a document'))).toBeNull();
    expect(sniffKind(Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(100)]))).toBeNull(); // a zip, but not a .docx
    expect(sniffKind(Buffer.from('MZ' + 'x'.repeat(100)))).toBeNull();
    expect(sniffKind(Buffer.alloc(3))).toBeNull();
  });
});

describe('text extraction', () => {
  it('reads paragraphs and tables from a .docx, keeping table cells on their rows', async () => {
    const text = await extractDocxText(makeDocx(['Assessment task', 'Due Friday'], [['Criterion', 'Marks'], ['Atmospheric circulation', '10']]));
    expect(text).toContain('Assessment task');
    expect(text).toContain('Due Friday');
    const row = text.split('\n').find((l) => l.includes('Atmospheric circulation'))!;
    expect(row).toContain('10');
  });

  it('reads the text layer of a PDF', async () => {
    const lines = geographyText.split('\n').filter(Boolean).slice(0, 12).map((l) => l.replace(/[^\x20-\x7e]/g, '-'));
    const text = await extractPdfText(makePdf(lines));
    expect(text).toContain('GEOG201 Human & Physical Geography');
    expect(text).toContain('Part A: Research notes');
    expect(hasUsableText(text)).toBe(true);
  });

  it('reports a PDF with no text layer as having no usable text', async () => {
    const text = await extractPdfText(makePdf([]));
    expect(hasUsableText(text)).toBe(false);
  });

  it('turns a broken document into an "unreadable" error, not a crash', async () => {
    await expect(extractDocxText(Buffer.from('PK\x03\x04 word/document.xml but not a real zip'))).rejects.toMatchObject({ code: 'unreadable' });
    await expect(extractPdfText(Buffer.from('%PDF-1.4 truncated'))).rejects.toBeInstanceOf(ReadError);
  });

  it('turns Canvas HTML into clean text without links or images', () => {
    const text = htmlToPlainText(
      '<h2>Task</h2><p>Read <a href="https://x.test/secret">the notes</a>.</p><img src="a.png"><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table>',
    );
    expect(text).toContain('Task');
    expect(text).toContain('Read the notes.');
    expect(text).not.toContain('x.test');
    expect(text).toMatch(/\* One/);
    expect(text).toMatch(/A\s+B/);
  });
});
