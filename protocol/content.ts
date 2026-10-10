import type { ChoiceQuestion, LikertItem, WordStimulus } from './types';

export const ENCODING_WORDS: readonly WordStimulus[] = [
  { id: 'miz', text: 'میز', domain: 'furniture' },
  { id: 'sandali', text: 'صندلی', domain: 'furniture' },
  { id: 'ketab', text: 'کتاب', domain: 'study' },
  { id: 'kaghaz', text: 'کاغذ', domain: 'study' },
  { id: 'panjere', text: 'پنجره', domain: 'architecture' },
  { id: 'divar', text: 'دیوار', domain: 'architecture' },
  { id: 'otagh', text: 'اتاق', domain: 'architecture' },
  { id: 'derakht', text: 'درخت', domain: 'nature' },
  { id: 'fenjan', text: 'فنجان', domain: 'kitchen' },
  { id: 'cheragh', text: 'چراغ', domain: 'light' },
  { id: 'saat', text: 'ساعت', domain: 'time' },
  { id: 'telefon', text: 'تلفن', domain: 'communication' },
  { id: 'kafsh', text: 'کفش', domain: 'clothing' },
  { id: 'koole', text: 'کوله‌پشتی', domain: 'bag' },
  { id: 'aks', text: 'عکس', domain: 'image' },
  { id: 'sib', text: 'سیب', domain: 'food' },
];

export const EDUCATION_LEVELS = [
  { code: 1, label: 'بی‌سواد' },
  { code: 2, label: 'خواندن و نوشتن' },
  { code: 3, label: 'ابتدایی' },
  { code: 4, label: 'راهنمایی' },
  { code: 5, label: 'دیپلم' },
  { code: 6, label: 'کاردانی' },
  { code: 7, label: 'کارشناسی' },
  { code: 8, label: 'کارشناسی ارشد' },
  { code: 9, label: 'دکتری' },
] as const;

export const APPLIANCES = [
  { id: 'fridge', label: 'یخچال' },
  { id: 'tv', label: 'تلویزیون' },
  { id: 'car', label: 'خودرو' },
  { id: 'washer', label: 'ماشین لباس‌شویی' },
  { id: 'dishwasher', label: 'ماشین ظرف‌شویی' },
  { id: 'stove', label: 'اجاق گاز' },
  { id: 'sofa', label: 'مبلمان' },
  { id: 'dining', label: 'میز ناهارخوری' },
  { id: 'chandelier', label: 'لوستر' },
] as const;

export const HOME_AREA_LEVELS = [
  { code: 1, label: 'کوچک' },
  { code: 2, label: 'متوسط' },
  { code: 3, label: 'بزرگ' },
  { code: 4, label: 'خیلی بزرگ' },
] as const;

export const EMOTION_ITEMS = [
  { id: 'happy', text: 'شاد', valence: 'positive' },
  { id: 'motivated', text: 'باانگیزه', valence: 'positive' },
  { id: 'excited', text: 'هیجان‌زده', valence: 'positive' },
  { id: 'energetic', text: 'باانرژی', valence: 'positive' },
  { id: 'calm', text: 'آرام', valence: 'positive' },
  { id: 'sad', text: 'غمگین', valence: 'negative' },
  { id: 'nervous', text: 'عصبی', valence: 'negative' },
  { id: 'angry', text: 'خشمگین', valence: 'negative' },
  { id: 'guilty', text: 'احساس گناه', valence: 'negative' },
  { id: 'tired', text: 'خسته', valence: 'negative' },
] as const;

export const MANIPULATION_ITEMS: readonly LikertItem[] = [
  { id: 'worry', text: 'در طول بازی نگران بودم توکن‌هایم تمام شود.', reverse: false },
  { id: 'stress', text: 'وضعیت توکن‌ها در طول بازی برایم استرس‌آور بود.', reverse: false },
  {
    id: 'enough',
    text: 'احساس می‌کردم برای ادامه بازی و حفظ شانس دریافت جایزه، توکن کافی دارم.',
    reverse: true,
  },
  { id: 'control', text: 'احساس می‌کردم روی وضعیت توکن‌هایم کنترل دارم.', reverse: true },
];

export const LIKERT_7 = [
  'کاملاً مخالفم',
  'مخالفم',
  'تاحدی مخالفم',
  'نه موافقم و نه مخالف',
  'تاحدی موافقم',
  'موافقم',
  'کاملاً موافقم',
] as const;

const scarcityRecall: ChoiceQuestion[] = [
  {
    id: 'scar-frequency',
    prompt: 'آیا تا حالا پیش اومده که پول کافی برای خرید چیزی که می‌خواستی نداشته باشی؟',
    options: [
      { id: 'often', label: 'بله، زیاد پیش اومده', allowsText: false },
      { id: 'sometimes', label: 'بله، گاهی پیش اومده', allowsText: false },
      { id: 'rarely', label: 'خیلی کم پیش اومده', allowsText: false },
      { id: 'never', label: 'اصلاً پیش نیومده', allowsText: false },
    ],
  },
  {
    id: 'scar-feeling',
    prompt: 'وقتی نتونستی اون چیز رو بخری، چه احساسی داشتی؟',
    options: [
      { id: 'upset', label: 'ناراحتی یا دلخوری', allowsText: false },
      { id: 'stress', label: 'استرس یا نگرانی', allowsText: false },
      { id: 'indifferent', label: 'بی‌تفاوت بودم', allowsText: false },
      { id: 'glad-saved', label: 'خوشحال شدم که پولم رو نگه داشتم', allowsText: false },
    ],
  },
  {
    id: 'scar-item',
    prompt: 'چه چیزی بوده که خیلی دوست داشتی بخری ولی به خاطر کمبود پول نتونستی؟',
    options: [
      { id: 'toy', label: 'وسیله بازی یا سرگرمی (مثل کنسول، بازی ویدیویی)', allowsText: false },
      { id: 'clothes', label: 'لباس یا کفش مورد علاقه', allowsText: false },
      { id: 'treat', label: 'خوراکی یا تفریح خاص (مثلاً رفتن به سینما، شهربازی)', allowsText: false },
      { id: 'other', label: 'چیز دیگه‌ای', allowsText: true },
    ],
  },
  {
    id: 'scar-borrow',
    prompt: 'آیا حاضر شدی برای رسیدن به چیزی که پولش رو نداشتی از دوستات پول قرض بگیری؟',
    options: [
      { id: 'always', label: 'بله، همیشه این کار رو می‌کنم', allowsText: false },
      { id: 'sometimes', label: 'بعضی وقت‌ها این کار رو کردم', allowsText: false },
      { id: 'rarely', label: 'خیلی کم پیش اومده', allowsText: false },
      { id: 'never', label: 'هیچ وقت این کار رو نکردم', allowsText: false },
    ],
  },
];

const controlRecall: ChoiceQuestion[] = [
  {
    id: 'ctrl-activity',
    prompt: 'معمولاً شب‌ها قبل از خواب چه کار می‌کنی؟',
    options: [
      { id: 'tv', label: 'تماشای تلویزیون یا فیلم', allowsText: false },
      { id: 'game', label: 'بازی با موبایل یا کامپیوتر', allowsText: false },
      { id: 'study', label: 'مطالعه یا انجام تکالیف مدرسه', allowsText: false },
      { id: 'family', label: 'وقت گذراندن با خانواده', allowsText: false },
      { id: 'other', label: 'کار دیگری', allowsText: true },
    ],
  },
  {
    id: 'ctrl-bedtime',
    prompt: 'معمولاً چه ساعتی می‌خوابی؟',
    options: [
      { id: 'early', label: 'زود (قبل از ۱۰ شب)', allowsText: false },
      { id: 'ten', label: 'بین ۱۰ تا ۱۱ شب', allowsText: false },
      { id: 'eleven', label: 'بین ۱۱ تا ۱۲ شب', allowsText: false },
      { id: 'late', label: 'خیلی دیر (بعد از نیمه شب)', allowsText: false },
    ],
  },
  {
    id: 'ctrl-bed',
    prompt: 'وقتی به تخت می‌ری، اولین کاری که انجام می‌دی چیه؟',
    options: [
      { id: 'music', label: 'گوش دادن به موسیقی یا پادکست', allowsText: false },
      { id: 'think', label: 'فکر کردن به اتفاقات روز', allowsText: false },
      { id: 'phone', label: 'چک کردن گوشی', allowsText: false },
      { id: 'sleep', label: 'مستقیم خوابیدن', allowsText: false },
    ],
  },
  {
    id: 'ctrl-late-reason',
    prompt: 'چه چیزی بیشتر باعث می‌شه شب‌ها دیرتر بخوابی؟',
    options: [
      { id: 'homework', label: 'تکالیف مدرسه', allowsText: false },
      { id: 'fun', label: 'سرگرمی (فیلم، بازی، موبایل)', allowsText: false },
      { id: 'talk', label: 'صحبت با دوستان یا خانواده', allowsText: false },
      { id: 'nothing', label: 'هیچ‌چیز، همیشه زود می‌خوابم', allowsText: false },
    ],
  },
];

export function recallQuestions(group: 'scarcity' | 'control'): ChoiceQuestion[] {
  return group === 'scarcity' ? scarcityRecall : controlRecall;
}

export function normalizeFa(value: string): string {
  return value
    .trim()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, '');
}

export function findEncodingWord(text: string): WordStimulus | undefined {
  const key = normalizeFa(text);
  return ENCODING_WORDS.find((word) => normalizeFa(word.text) === key);
}
