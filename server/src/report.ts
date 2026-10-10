import { AlignmentType, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { Database } from './db';

export async function stage1Report(db: Database, sessionId: string): Promise<Buffer> {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('جلسه پیدا نشد.');
  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(String(session.participant_id));
  const trials = db
    .prepare("SELECT * FROM trials WHERE session_id = ? AND stage = 'encoding' ORDER BY trial_index")
    .all(sessionId);
  const notes = db.prepare('SELECT note, stage, created_at FROM observer_notes WHERE session_id = ? ORDER BY created_at').all(sessionId);
  const header = [
    paragraph(`گزارش مرحلهٔ اول`),
    paragraph(`شرکت‌کننده: ${String(participant?.id ?? '')}`),
    paragraph(`جلسه: ${sessionId}`),
    paragraph(`گروه: ${String(participant?.group_name ?? '')}`),
    paragraph(`وضعیت جلسه: ${String(session.status)}`),
    paragraph(''),
    paragraph('ترتیب واژه‌ها'),
  ];
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ['ردیف', 'واژه', 'شروع', 'پایان', 'وضعیت'].map((text) => cell(text, true)),
      }),
      ...trials.map((trial) => {
        const stimulus = JSON.parse(String(trial.stimulus_json ?? '{}')) as { text?: string };
        return new TableRow({
          children: [
            cell(String(Number(trial.trial_index) + 1)),
            cell(stimulus.text ?? String(trial.stimulus_id ?? '')),
            cell(String(trial.onset_at ?? '')),
            cell(String(trial.offset_at ?? '')),
            cell(String(trial.response_kind ?? '')),
          ],
        });
      }),
    ],
  });
  const noteLines = [paragraph(''), paragraph('یادداشت ناظر'), ...notes.map((note) => paragraph(`${String(note.created_at)} — ${String(note.note)}`))];
  if (notes.length === 0) noteLines.push(paragraph('یادداشتی ثبت نشده است.'));
  const doc = new Document({
    sections: [{ children: [...header, table, ...noteLines] }],
  });
  return Packer.toBuffer(doc);
}

function paragraph(text: string): Paragraph {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text, font: 'Tahoma', rightToLeft: true })],
  });
}

function cell(text: string, header = false): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text, font: 'Tahoma', bold: header, rightToLeft: true })],
      }),
    ],
  });
}
