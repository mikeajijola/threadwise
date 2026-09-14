import PDFDocument from 'pdfkit';
import { gunzipSync } from 'node:zlib';
import { regular } from './report-fonts';
import type { Call, SavedBrief, Segment } from './schema';
export async function reportPdf(call: Call, segments: Segment[], cards: SavedBrief[]) {
  const doc = new PDFDocument({ font: '', margin: 45, info: { Title: call.title + ' — Call notes' } });
  doc.registerFont('Report', gunzipSync(Buffer.from(regular, 'base64'))).font('Report');
  const chunks: Buffer[] = []; const done = new Promise<Buffer>((resolve,reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.fontSize(22).text('Call notes'); doc.moveDown().fontSize(13).text(call.title);
  doc.fontSize(9).text('Started ' + call.createdAt + '\nPrivate coaching suggestions; not a record of agreed commitments unless confirmed in the transcript.');
  for (const card of cards) {
    const b = card.brief; doc.moveDown().fontSize(15).text(b.headline); doc.fontSize(9).text(card.createdAt);
    for (const [label,value] of Object.entries({ Priority: `${b.importance} importance / ${b.urgency}`, Rationale: b.rationale, Evidence: b.evidence, 'What changed': b.changed, 'Next question': b.nextQuestion, 'Private advice for you': b.suggestedResponse, Capability: b.capability, Owner: b.owner, References: b.references.join(', '), 'Follow-ups': b.followUps.join('\n') })) doc.moveDown(0.5).fontSize(10).text(label + ': ' + value);
  }
  doc.addPage().fontSize(18).text('Captured transcript');
  for (const s of segments) doc.moveDown().fontSize(9).text(s.capturedAt + ' · ' + s.source + (s.provisional ? ' · Draft speech transcript' : '')).fontSize(11).text(s.text);
  doc.end(); return done;
}
