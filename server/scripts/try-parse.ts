// Read one notification file with the real Claude API and print what Waypoint would store.
//   ANTHROPIC_API_KEY=sk-ant-... npm run try-parse -w @waypoint/server -- /full/path/to/notification.(pdf|docx|jpg|png|webp|txt)
//   (npm runs this from the server/ folder, so use a full path or one relative to it)
// This makes one real API call with your key (a few cents at most). Nothing is saved anywhere.
import { readFileSync } from 'node:fs';
import { makeClaudeClient } from '../src/claude.js';
import { extractDocxText, extractPdfText, hasUsableText, isImage, sniffKind } from '../src/extract.js';
import { parseNotification, type ParseInput } from '../src/parse.js';
import { todayIn } from '../src/timezone.js';
import { parseTimezone } from '../src/config.js';

const [path] = process.argv.slice(2);
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!path || !apiKey) {
  console.error('Usage: ANTHROPIC_API_KEY=sk-ant-... npm run try-parse -w @waypoint/server -- <file>');
  process.exit(1);
}

const buf = readFileSync(path);
const kind = sniffKind(buf);
let input: ParseInput;
if (kind && isImage(kind)) input = { mode: 'image', data: buf, mediaType: `image/${kind}` };
else if (kind === 'docx') input = { mode: 'text', text: await extractDocxText(buf) };
else if (kind === 'pdf') {
  const text = await extractPdfText(buf);
  input = hasUsableText(text) ? { mode: 'text', text } : { mode: 'pdf', data: buf };
} else input = { mode: 'text', text: buf.toString('utf8') }; // treat anything else as plain text

const timezone = parseTimezone(process.env.TIMEZONE);
const model = process.env.CLAUDE_MODEL || 'claude-opus-5';
console.error(`Reading ${path} as ${input.mode} with ${model} (${timezone})…`);
const parsed = await parseNotification(makeClaudeClient(apiKey), model, input, { today: todayIn(timezone, new Date()), timezone });
console.log(JSON.stringify(parsed, null, 2));
