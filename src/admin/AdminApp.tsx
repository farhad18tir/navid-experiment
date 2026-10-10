import { useEffect, useState, type FormEvent } from 'react';
import { APPLIANCES, EDUCATION_LEVELS, HOME_AREA_LEVELS } from '../../protocol/content';
import { api } from '../api';

interface School {
  id: string;
  name: string;
  gender: string;
  region: string | null;
}

interface Participant {
  id: string;
  school_id: string;
  group_name: string;
  consent_parent: number;
  consent_student: number;
  school_name: string;
  has_demographics: number;
}

interface SessionRow {
  id: string;
  participant_id: string;
  mode: string;
  status: string;
  save_status: string;
  group_name: string;
  final_tokens: number | null;
  reward_count: number | null;
}

interface ShoppingChoice {
  product_id: string;
  final_selected: number;
}

interface SessionDetail {
  plan: { stages: Array<{ stage: string; trials?: Array<{ productId: string; nameFa: string; practice?: boolean }> }> };
  shopping?: ShoppingChoice[];
  rewards?: Array<{ product_id: string; delivered: number }>;
  notes?: Array<{ id: string; note: string; created_at: string }>;
  session: { reward_count: number | null; final_tokens: number | null; status: string };
}

export function AdminApp() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [note, setNote] = useState('');
  const [delivered, setDelivered] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [manifest, schoolBody, people, sessionBody] = await Promise.all([
      api<{ ok: boolean; issues: string[] }>('/api/admin/manifest'),
      api<{ schools: School[] }>('/api/admin/schools'),
      api<{ participants: Participant[] }>('/api/admin/participants'),
      api<{ sessions: SessionRow[] }>('/api/admin/sessions'),
    ]);
    setIssues(manifest.issues);
    setSchools(schoolBody.schools);
    setParticipants(people.participants);
    setSessions(sessionBody.sessions);
  }

  useEffect(() => {
    void api('/api/admin/schools')
      .then(() => {
        setAuthed(true);
        return refresh();
      })
      .catch(() => setAuthed(false));
  }, []);

  async function login(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      setAuthed(true);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ورود ناموفق بود');
    }
  }

  if (!authed) {
    return (
      <main className="admin">
        <h1>ورود پژوهشگر</h1>
        <form onSubmit={(event) => void login(event)} className="card">
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="رمز" />
          <button type="submit">ورود</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </main>
    );
  }

  return (
    <main className="admin">
      <h1>مدیریت آزمایش</h1>
      {issues.length > 0 ? (
        <div className="banner">
          <strong>جلسهٔ واقعی شروع نمی‌شود تا فایل محرک‌ها کامل شود.</strong>
          <p className="error">{issues.join('\n')}</p>
        </div>
      ) : (
        <p>فایل محرک‌ها کامل است.</p>
      )}
      <SchoolForm
        schools={schools}
        onSaved={() => void refresh().catch((caught: Error) => setError(caught.message))}
        onError={setError}
      />
      <ParticipantForm
        schools={schools}
        onSaved={() => void refresh().catch((caught: Error) => setError(caught.message))}
        onError={setError}
      />
      <section className="card">
        <h2>شرکت‌کنندگان</h2>
        <table>
          <tbody>
            {participants.map((person) => (
              <tr key={person.id}>
                <td>{person.id}</td>
                <td>{person.school_name}</td>
                <td>{person.group_name === 'scarcity' ? 'کمبود' : 'کنترل'}</td>
                <td>{person.consent_parent && person.consent_student ? 'رضایت کامل' : 'رضایت ناقص'}</td>
                <td>{person.has_demographics ? 'جمعیت‌شناختی ثبت شده' : 'بدون جمعیت‌شناختی'}</td>
                <td>
                  <button type="button" onClick={() => setSelected(person.id)}>
                    جزئیات
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {selected ? (
        <ParticipantDetail
          participantId={selected}
          onChanged={() => void refresh()}
          onError={setError}
        />
      ) : null}
      <section className="card">
        <h2>جلسه‌ها</h2>
        {sessions.map((session) => (
          <div key={session.id} className="row">
            <span>{session.participant_id}</span>
            <span>{session.mode === 'baseline' ? 'پایه' : 'اصلی'}</span>
            <span>{session.status}</span>
            <span>{session.save_status}</span>
            <button
              type="button"
              onClick={() => {
                void loadDetail(session.id);
              }}
            >
              یادداشت و پاداش
            </button>
            <a href={`/api/admin/sessions/${session.id}/export.json`}>JSON</a>
            <a href={`/api/admin/sessions/${session.id}/report.docx`}>Word مرحلهٔ اول</a>
          </div>
        ))}
        <div className="row">
          <a href="/api/admin/export/trials.csv">جدول آزمون‌ها</a>
          <a href="/api/admin/export/questionnaires.csv">جدول پرسشنامه‌ها</a>
          <a href="/api/admin/export/participant-period.csv">جدول فرد × نوبت</a>
        </div>
      </section>
      {detail ? (
        <SessionTools
          detail={detail}
          note={note}
          setNote={setNote}
          delivered={delivered}
          setDelivered={setDelivered}
          onSaveNote={() => void saveNote()}
          onSaveRewards={() => void saveRewards()}
        />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );

  async function loadDetail(sessionId: string): Promise<void> {
    const body = await api<SessionDetail>(`/api/admin/sessions/${sessionId}`);
    setActiveSessionId(sessionId);
    setDetail(body);
    setDelivered((body.rewards ?? []).filter((item) => item.delivered === 1).map((item) => item.product_id));
  }

  async function saveNote(): Promise<void> {
    if (!activeSessionId) return;
    await api(`/api/admin/sessions/${activeSessionId}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
    setNote('');
    await loadDetail(activeSessionId);
  }

  async function saveRewards(): Promise<void> {
    if (!activeSessionId) return;
    await api(`/api/admin/sessions/${activeSessionId}/rewards`, {
      method: 'PUT',
      body: JSON.stringify({ productIds: delivered }),
    });
    await loadDetail(activeSessionId);
  }
}

function SchoolForm({ schools, onSaved, onError }: { schools: School[]; onSaved: () => void; onError: (message: string) => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'girls' | 'boys'>('girls');
  const [region, setRegion] = useState('9');
  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        void api('/api/admin/schools', { method: 'POST', body: JSON.stringify({ id, name, gender, region }) })
          .then(onSaved)
          .catch((caught: unknown) => onError(caught instanceof Error ? caught.message : 'ثبت مدرسه ناموفق بود'));
      }}
    >
      <h2>مدرسه</h2>
      <div className="row">
        <input value={id} onChange={(event) => setId(event.target.value)} placeholder="شناسه" />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="نام" />
        <select value={gender} onChange={(event) => setGender(event.target.value as 'girls' | 'boys')}>
          <option value="girls">دخترانه</option>
          <option value="boys">پسرانه</option>
        </select>
        <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="منطقه" />
        <button type="submit">ثبت مدرسه</button>
      </div>
      {schools.map((school) => (
        <div key={school.id}>
          {school.name} — {school.gender === 'girls' ? 'دخترانه' : 'پسرانه'} — منطقه {school.region}
        </div>
      ))}
    </form>
  );
}

function ParticipantForm({
  schools,
  onSaved,
  onError,
}: {
  schools: School[];
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [id, setId] = useState('');
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? '');
  const [parentConsent, setParentConsent] = useState(false);
  const [studentConsent, setStudentConsent] = useState(false);
  useEffect(() => {
    if (!schoolId && schools[0]) setSchoolId(schools[0].id);
  }, [schoolId, schools]);
  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        void api('/api/admin/participants', {
          method: 'POST',
          body: JSON.stringify({ id, schoolId, consentParent: parentConsent, consentStudent: studentConsent }),
        })
          .then(onSaved)
          .catch((caught: unknown) => onError(caught instanceof Error ? caught.message : 'ثبت شرکت‌کننده ناموفق بود'));
      }}
    >
      <h2>شرکت‌کننده</h2>
      <div className="row">
        <input value={id} onChange={(event) => setId(event.target.value)} placeholder="شناسهٔ پایدار" />
        <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={parentConsent} onChange={(event) => setParentConsent(event.target.checked)} /> رضایت والد
        </label>
        <label>
          <input type="checkbox" checked={studentConsent} onChange={(event) => setStudentConsent(event.target.checked)} /> رضایت دانش‌آموز
        </label>
        <button type="submit">ثبت و تخصیص گروه</button>
      </div>
    </form>
  );
}

function ParticipantDetail({
  participantId,
  onChanged,
  onError,
}: {
  participantId: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [appliances, setAppliances] = useState<Record<string, string>>({});
  const [ownership, setOwnership] = useState('');

  function setField(name: string, value: string): void {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function save(): Promise<void> {
    const missing = APPLIANCES.some((item) => appliances[item.id] !== 'yes' && appliances[item.id] !== 'no');
    if (missing) {
      onError('وضعیت هر ۹ وسیله را مشخص کنید.');
      return;
    }
    const applianceValues = Object.fromEntries(APPLIANCES.map((item) => [item.id, appliances[item.id] === 'yes']));
    await api(`/api/admin/participants/${participantId}/demographics`, {
      method: 'PUT',
      body: JSON.stringify({
        ageYears: integerOrNull(form.ageYears ?? ''),
        recentGpa: numberOrNull(form.recentGpa ?? ''),
        siblingCount: integerOrNull(form.siblingCount ?? ''),
        fatherEducation: integerOrNull(form.fatherEducation ?? ''),
        motherEducation: integerOrNull(form.motherEducation ?? ''),
        homeBookCount: integerOrNull(form.homeBookCount ?? ''),
        monthlyIncomePerCapita: numberOrNull(form.monthlyIncomePerCapita ?? ''),
        incomeCollectedOn: form.incomeCollectedOn || null,
        homeOwnership: ownership === '' ? null : Number(ownership),
        homeAreaLevel: integerOrNull(form.homeAreaLevel ?? ''),
        appliances: applianceValues,
      }),
    });
    onChanged();
  }

  async function start(mode: 'baseline' | 'main'): Promise<void> {
    try {
      await api(`/api/admin/participants/${participantId}/sessions`, { method: 'POST', body: JSON.stringify({ mode }) });
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'شروع جلسه ناموفق بود');
    }
  }

  return (
    <section className="card">
      <h2>پروندهٔ {participantId}</h2>
      <p>دانش‌آموز این شناسه را در رایانهٔ خود وارد می‌کند.</p>
      <div className="row">
        <button type="button" onClick={() => void start('baseline')}>
          شروع نوبت پایه
        </button>
        <button type="button" onClick={() => void start('main')}>
          شروع نوبت اصلی
        </button>
      </div>
      <div className="row">
        <input placeholder="سن" value={form.ageYears ?? ''} onChange={(event) => setField('ageYears', event.target.value)} />
        <input placeholder="معدل" value={form.recentGpa ?? ''} onChange={(event) => setField('recentGpa', event.target.value)} />
        <input placeholder="خواهر و برادر" value={form.siblingCount ?? ''} onChange={(event) => setField('siblingCount', event.target.value)} />
        <input placeholder="کتاب غیردرسی" value={form.homeBookCount ?? ''} onChange={(event) => setField('homeBookCount', event.target.value)} />
        <input placeholder="درآمد سرانهٔ ماهانه (تومان)" value={form.monthlyIncomePerCapita ?? ''} onChange={(event) => setField('monthlyIncomePerCapita', event.target.value)} />
        <input type="date" value={form.incomeCollectedOn ?? ''} onChange={(event) => setField('incomeCollectedOn', event.target.value)} />
      </div>
      <div className="row">
        <select value={form.fatherEducation ?? ''} onChange={(event) => setField('fatherEducation', event.target.value)}>
          <option value="">تحصیلات پدر</option>
          {EDUCATION_LEVELS.map((level) => (
            <option key={level.code} value={level.code}>
              {level.label}
            </option>
          ))}
        </select>
        <select value={form.motherEducation ?? ''} onChange={(event) => setField('motherEducation', event.target.value)}>
          <option value="">تحصیلات مادر</option>
          {EDUCATION_LEVELS.map((level) => (
            <option key={level.code} value={level.code}>
              {level.label}
            </option>
          ))}
        </select>
        <select value={ownership} onChange={(event) => setOwnership(event.target.value)}>
          <option value="">مالکیت خانه</option>
          <option value="1">مالک</option>
          <option value="0">مستأجر</option>
        </select>
        <select value={form.homeAreaLevel ?? ''} onChange={(event) => setField('homeAreaLevel', event.target.value)}>
          <option value="">مساحت خانه</option>
          {HOME_AREA_LEVELS.map((level) => (
            <option key={level.code} value={level.code}>
              {level.label}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        {APPLIANCES.map((item) => (
          <label key={item.id}>
            {item.label}
            <select value={appliances[item.id] ?? ''} onChange={(event) => setAppliances((prev) => ({ ...prev, [item.id]: event.target.value }))}>
              <option value="">نامشخص</option>
              <option value="yes">دارد</option>
              <option value="no">ندارد</option>
            </select>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => void save()}>
        ذخیرهٔ جمعیت‌شناختی
      </button>
    </section>
  );
}

function SessionTools({
  detail,
  note,
  setNote,
  delivered,
  setDelivered,
  onSaveNote,
  onSaveRewards,
}: {
  detail: SessionDetail;
  note: string;
  setNote: (value: string) => void;
  delivered: string[];
  setDelivered: (value: string[]) => void;
  onSaveNote: () => void;
  onSaveRewards: () => void;
}) {
  const shopping = detail.plan.stages.find((stage) => stage.stage === 'shopping');
  const selected = new Set((detail.shopping ?? []).filter((item) => item.final_selected === 1).map((item) => item.product_id));
  const products = (shopping?.trials ?? []).filter((trial) => selected.has(trial.productId));
  return (
    <section className="card">
      <h2>یادداشت ناظر و تحویل پاداش</h2>
      <p>
        توکن نهایی: {detail.session.final_tokens ?? '—'} / تعداد پاداش تعیین‌شده: {detail.session.reward_count ?? '—'}
      </p>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="یادداشت ناظر" />
      <button type="button" onClick={onSaveNote}>
        ثبت یادداشت
      </button>
      {(detail.notes ?? []).map((item) => (
        <p key={item.id}>
          {item.created_at}: {item.note}
        </p>
      ))}
      {products.map((product) => (
        <label key={product.productId} className="row">
          <input
            type="checkbox"
            checked={delivered.includes(product.productId)}
            onChange={(event) => {
              setDelivered(event.target.checked ? [...delivered, product.productId] : delivered.filter((id) => id !== product.productId));
            }}
          />
          تحویل شد: {product.nameFa}
        </label>
      ))}
      {products.length > 0 ? (
        <button type="button" onClick={onSaveRewards}>
          ثبت کالاهای تحویل‌شده
        </button>
      ) : null}
    </section>
  );
}

function integerOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
