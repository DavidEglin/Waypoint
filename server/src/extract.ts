import { convert } from 'html-to-text';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { ReadError } from './claude.js';

export type FileKind = 'pdf' | 'docx' | 'jpeg' | 'png' | 'webp';

export const MIME_BY_KIND: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const EXT_BY_KIND: Record<FileKind, string> = { pdf: 'pdf', docx: 'docx', jpeg: 'jpg', png: 'png', webp: 'webp' };

/** Identify a file by its contents, never by the name or type the client claims. */
export function sniffKind(buf: Buffer): FileKind | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  // A .docx is a zip whose directory names include word/document.xml.
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes('word/document.xml')) return 'docx';
  return null;
}

export const isImage = (kind: FileKind): kind is 'jpeg' | 'png' | 'webp' => kind === 'jpeg' || kind === 'png' || kind === 'webp';

/** Notifications longer than this are refused rather than silently cut short. */
export const MAX_TEXT_CHARS = 120_000;
/** A PDF with less text than this is treated as a scan and read visually instead. */
const MIN_PDF_TEXT_CHARS = 40;

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'table', format: 'dataTable', options: { uppercaseHeaderCells: false } },
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
    ],
  })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractDocxText(buf: Buffer): Promise<string> {
  try {
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    return htmlToPlainText(value);
  } catch {
    throw new ReadError('unreadable');
  }
}

/** Text layer of a PDF. An empty string means there is none (a scan). */
export async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    throw new ReadError('unreadable');
  }
}

export const hasUsableText = (text: string): boolean => text.replace(/\s/g, '').length >= MIN_PDF_TEXT_CHARS;

export function assertNotTooLong(text: string): void {
  if (text.length > MAX_TEXT_CHARS) throw new ReadError('too_long');
}
