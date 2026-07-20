import { useI18n } from '../i18n'

/**
 * iAny landing / front page (served at /). Marketing entry point that sits in
 * front of the app (now at /app) and the community tools (/voice, /scan, /sign,
 * /braille). Self-contained + bilingual (EN/KM) with its own styles (landing.css)
 * so it stays a tiny, fast-loading page separate from the app bundle.
 */

const GITHUB_URL = 'https://github.com/sengtha/iAny'
const HF_URL = 'https://huggingface.co/sengtha'
const APP_URL = '/app'
const APK_URL = '/download/iany-android-preview.apk'
const COMPANY_URL = 'https://www.e-khmer.com'
const COMPANY_NAME = 'E-KHMER Technology Co., Ltd'
const COMPANY_YEAR = 2026

export function LandingView() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  const L = (en: string, khmer: string) => (km ? khmer : en)

  return (
    <div className="lp" lang={km ? 'km' : 'en'}>
      {/* ---------------------------------------------------------------- nav */}
      <header className="lp-nav">
        <a className="lp-logo" href="/">
          <img src="/icon.svg" alt="" width={30} height={30} />
          <span>iAny</span>
        </a>
        <nav className="lp-nav-links">
          <a href="#features">{L('Features', 'មុខងារ')}</a>
          <a href="#open">{L('Open Khmer AI', 'AI ខ្មែរបើកចំហ')}</a>
          <a href="/contribute">{L('Contribute', 'ចូលរួម')}</a>
          <a href={HF_URL} target="_blank" rel="noreferrer">
            {L('Models', 'ម៉ូឌែល')}
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="lp-nav-actions">
          <button className="lp-lang" onClick={() => setLang(km ? 'en' : 'km')}>
            {km ? 'EN' : 'ខ្មែរ'}
          </button>
          <a className="lp-btn lp-btn-sm" href={APP_URL}>
            {L('Open app', 'បើកកម្មវិធី')}
          </a>
        </div>
      </header>

      {/* --------------------------------------------------------------- hero */}
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden />
        <p className="lp-eyebrow">{L('Offline · On-device · Open source', 'ក្រៅបណ្ដាញ · លើឧបករណ៍ · បើកចំហ')}</p>
        <h1 className="lp-title">
          {L('Khmer AI that runs ', 'AI ខ្មែរ ដែលដំណើរការ')}
          <span className="lp-grad">{L('on your device', 'នៅលើឧបករណ៍របស់អ្នក')}</span>
        </h1>
        <p className="lp-sub">
          {L(
            'Chat with your own knowledge, and use free, open Khmer speech-to-text, text-to-speech, OCR, Braille and sign language — 100% private, works without internet.',
            'សន្ទនាជាមួយចំណេះដឹងផ្ទាល់ខ្លួន និងប្រើ ការបំប្លែងសំឡេងជាអក្សរ អក្សរជាសំឡេង OCR អក្សរផុស និងភាសាសញ្ញាខ្មែរ ដោយឥតគិតថ្លៃ — ឯកជន ១០០% ដំណើរការដោយគ្មានអ៊ីនធឺណិត។',
          )}
        </p>
        <div className="lp-cta">
          <a className="lp-btn lp-btn-lg" href={APP_URL}>
            {L('Open the app', 'បើកកម្មវិធី')} →
          </a>
          <a className="lp-btn lp-btn-ghost lp-btn-lg" href="#open">
            {L('Explore Khmer AI tools', 'ស្វែងយល់ឧបករណ៍ AI ខ្មែរ')}
          </a>
        </div>
        <ul className="lp-trust">
          <li>🔒 {L('No account, no tracking', 'គ្មានគណនី គ្មានតាមដាន')}</li>
          <li>📴 {L('Works fully offline', 'ដំណើរការក្រៅបណ្ដាញ')}</li>
          <li>🇰🇭 {L('Khmer + English', 'ខ្មែរ + អង់គ្លេស')}</li>
          <li>🆓 {L('Free & open source', 'ឥតគិតថ្លៃ & បើកចំហ')}</li>
        </ul>
        <p className="lp-apk">
          {L('On Android? ', 'ប្រើ Android? ')}
          <a href={APK_URL}>
            📱 {L('Download the app (APK)', 'ទាញយកកម្មវិធី (APK)')} · {L('Preview', 'មើលជាមុន')}
          </a>
          <br />
          <span className="lp-apk-note">
            {L('Preview build — not an official release yet.', 'កំណែសាកល្បង — មិនទាន់ជាការចេញផ្សាយផ្លូវការទេ។')}
          </span>
        </p>

        {/* Hero visual — a device mock showing the app answering in Khmer,
            on-device. Pure CSS/HTML, so it stays crisp and loads instantly. */}
        <div className="lp-hero-visual" aria-hidden>
          <div className="lp-phone">
            <div className="lp-phone-screen">
              <div className="lp-phone-head">
                <img src="/icon.svg" width={18} height={18} alt="" />
                <span>iAny</span>
                <span className="lp-phone-dot" />
              </div>
              <div className="lp-bubble lp-bubble-user">
                {L('What is iAny?', 'តើ iAny ជាអ្វី?')}
              </div>
              <div className="lp-bubble lp-bubble-bot">
                {L(
                  'A Khmer AI assistant that runs on your device — no internet needed.',
                  'ជំនួយការ AI ខ្មែរ ដែលដំណើរការលើឧបករណ៍របស់អ្នក ដោយឥតបាច់អ៊ីនធឺណិត។',
                )}
              </div>
              <div className="lp-phone-input">
                <span className="lp-phone-mic">🎙️</span>
                <span className="lp-phone-ph">{L('Ask a question…', 'សួរសំណួរ…')}</span>
                <span className="lp-phone-send">➤</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- features */}
      <section id="features" className="lp-section">
        <h2 className="lp-h2">{L('Your private knowledge base', 'មូលដ្ឋានចំណេះដឹងឯកជនរបស់អ្នក')}</h2>
        <p className="lp-lead">
          {L(
            'Feed iAny text and documents; it indexes them in a real database inside your browser and answers your questions with sources — grounded in your own knowledge, never leaving your device.',
            'បញ្ចូលអត្ថបទ និងឯកសារទៅ iAny; វារៀបចំសន្ទស្សន៍ក្នុងមូលដ្ឋានទិន្នន័យពិតប្រាកដក្នុងកម្មវិធីរុករករបស់អ្នក ហើយឆ្លើយសំណួរជាមួយប្រភព — ផ្អែកលើចំណេះដឹងផ្ទាល់ខ្លួន មិនចេញពីឧបករណ៍ឡើយ។',
          )}
        </p>
        <div className="lp-grid">
          <Feature icon="💬" title={L('Ask your docs', 'សួរឯកសាររបស់អ្នក')}
            desc={L('On-device RAG chat with hybrid Khmer/English search and cited sources.', 'ការសន្ទនា RAG លើឧបករណ៍ ជាមួយការស្វែងរកខ្មែរ/អង់គ្លេស និងប្រភពយោង។')} />
          <Feature icon="📚" title={L('Library', 'បណ្ណាល័យ')}
            desc={L('Import text, PDFs and photos (Khmer OCR) into your knowledge base.', 'នាំចូលអត្ថបទ PDF និងរូបភាព (OCR ខ្មែរ) ចូលមូលដ្ឋានចំណេះដឹង។')} />
          <Feature icon="📦" title={L('Knowledge packs', 'កញ្ចប់ចំណេះដឹង')}
            desc={L('Share a ready-made knowledge base as a file — no internet needed.', 'ចែករំលែកមូលដ្ឋានចំណេះដឹងជាឯកសារ — មិនត្រូវការអ៊ីនធឺណិត។')} />
          <Feature icon="📻" title={L('Radio', 'វិទ្យុ')}
            desc={L('Khmer news read aloud by the on-device voice.', 'ព័ត៌មានខ្មែរអានឮៗដោយសំឡេងលើឧបករណ៍។')} />
          <Feature icon="🎙️" title={L('Voice input', 'បញ្ចូលដោយសំឡេង')}
            desc={L('Speak in Khmer — on-device speech-to-text, no cloud.', 'និយាយជាភាសាខ្មែរ — បំប្លែងសំឡេងជាអក្សរលើឧបករណ៍ គ្មានពពក។')} />
          <Feature icon="⚙️" title={L('Your models', 'ម៉ូឌែលរបស់អ្នក')}
            desc={L('Download models once, share device-to-device, encrypted backup.', 'ទាញយកម៉ូឌែលម្ដង ចែករំលែករវាងឧបករណ៍ បម្រុងទុកបំបាំង។')} />
        </div>
      </section>

      {/* --------------------------------------------------------- open Khmer AI */}
      <section id="open" className="lp-section lp-section-alt">
        <h2 className="lp-h2">{L('Open Khmer AI, for everyone', 'AI ខ្មែរបើកចំហ សម្រាប់អ្នកគ្រប់គ្នា')}</h2>
        <p className="lp-lead">
          {L(
            'Our mission: build the best free Khmer speech, vision and accessibility AI — and release the models open source, with the community and for the community.',
            'បេសកកម្មរបស់យើង៖ បង្កើត AI ខ្មែរ ផ្នែកសំឡេង រូបភាព និងភាពងាយស្រួល ដ៏ល្អបំផុតដោយឥតគិតថ្លៃ — ហើយចេញផ្សាយម៉ូឌែលជាបែបបើកចំហ ជាមួយ និងសម្រាប់សហគមន៍។',
          )}
        </p>
        <div className="lp-grid">
          <Feature icon="🗣️" title={L('Speech-to-Text', 'សំឡេងទៅអក្សរ')}
            desc={L('Khmer STT you can run on-device and in the app.', 'STT ខ្មែរ ដែលអ្នកអាចដំណើរការលើឧបករណ៍ និងក្នុងកម្មវិធី។')} />
          <Feature icon="🔊" title={L('Text-to-Speech', 'អក្សរទៅសំឡេង')}
            desc={L('Natural Khmer voices that read text aloud, offline.', 'សំឡេងខ្មែរធម្មជាតិ អានអត្ថបទឮៗ ក្រៅបណ្ដាញ។')} />
          <Feature icon="📷" title={L('Khmer OCR', 'OCR ខ្មែរ')}
            desc={L('Read Khmer text from photos, right on your phone.', 'អានអក្សរខ្មែរពីរូបថត នៅលើទូរស័ព្ទរបស់អ្នក។')} link="/scan" linkLabel={L('Try /scan', 'សាកល្បង /scan')} />
          <Feature icon="⠿" title={L('Khmer Braille', 'អក្សរផុសខ្មែរ')}
            desc={L('Convert Khmer text to Braille dots and BRF files.', 'បម្លែងអក្សរខ្មែរទៅជាចំណុចផុស និងឯកសារ BRF។')} link="/braille" linkLabel={L('Open /braille', 'បើក /braille')} />
          <Feature icon="🤟" title={L('Khmer Sign Language', 'ភាសាសញ្ញាខ្មែរ')}
            badge={L('Collecting data', 'កំពុងប្រមូលទិន្នន័យ')} badgeTone="collecting"
            desc={L('Building an open sign-language dataset, with the Deaf community.', 'កំពុងបង្កើតទិន្នន័យភាសាសញ្ញាបើកចំហ ជាមួយសហគមន៍ថ្លង់។')} link="/sign" linkLabel={L('Open /sign', 'បើក /sign')} />
          <Feature icon="🎤" title={L('Contribute your voice', 'ចូលរួមសំឡេងរបស់អ្នក')}
            desc={L('Help train a better open Khmer speech model.', 'ជួយបង្រៀនម៉ូឌែលសំឡេងខ្មែរបើកចំហ ឲ្យប្រសើរ។')} link="/voice" linkLabel={L('Open /voice', 'បើក /voice')} />
          <Feature icon="🔖" title={L('Trace', 'Trace')} badge={L('Experiment', 'ពិសោធន៍')}
            desc={L('Offline proof of origin for honest makers — a phone-only trust score built on iAny’s on-device OCR & STT.', 'ភស្តុតាងប្រភពដើមក្រៅបណ្ដាញ សម្រាប់អ្នកផលិតស្មោះត្រង់ — ពិន្ទុទំនុកចិត្តដោយប្រើតែទូរស័ព្ទ ផ្អែកលើ OCR និង STT លើឧបករណ៍របស់ iAny។')} link="/trace" linkLabel={L('Try /trace', 'សាកល្បង /trace')} />
          <Feature icon="🌱" title={L('Crop health', 'សុខភាពដំណាំ')}
            badge={L('Collecting data', 'កំពុងប្រមូលទិន្នន័យ')} badgeTone="collecting"
            desc={L('Building an open, offline crop-disease AI for farmers — spot problems early with just a phone, no lab or internet.', 'កំពុងបង្កើត AI ជំងឺដំណាំបើកចំហ ក្រៅបណ្ដាញ សម្រាប់កសិករ — រកឃើញបញ្ហាឆាប់ ដោយប្រើតែទូរស័ព្ទ។')} link="/crop" linkLabel={L('Open /crop', 'បើក /crop')} />
          <Feature icon="🩺" title={L('Health info', 'ព័ត៌មានសុខភាព')}
            desc={L('Offline Khmer health education — read or listen to basic public-health topics. Information only, not a diagnosis.', 'ការអប់រំសុខភាពខ្មែរ ក្រៅបណ្ដាញ — អាន ឬស្ដាប់ប្រធានបទសុខភាពមូលដ្ឋាន។ ព័ត៌មានតែប៉ុណ្ណោះ មិនមែនការវិនិច្ឆ័យ។')} link="/health" linkLabel={L('Open /health', 'បើក /health')} />
        </div>
      </section>

      {/* -------------------------------------------------------- contribute */}
      <section id="contribute" className="lp-section">
        <div className="lp-band">
          <div>
            <h2 className="lp-h2">{L('Built with the community', 'បង្កើតជាមួយសហគមន៍')}</h2>
            <p className="lp-lead">
              {L(
                'Every recording, photo and sign you contribute becomes an open dataset — and the models trained from them are released free for everyone. Contributors are credited by name.',
                'រាល់ការថត រូបភាព និងសញ្ញាដែលអ្នកចូលរួម ក្លាយជាទិន្នន័យបើកចំហ — ហើយម៉ូឌែលដែលបង្រៀនចេញពីវា ត្រូវបានចេញផ្សាយឥតគិតថ្លៃសម្រាប់អ្នកគ្រប់គ្នា។ អ្នកចូលរួមត្រូវបានផ្ដល់កិត្តិនាម។',
              )}
            </p>
            <p className="lp-band-note">
              🤗 {L('First open dataset released — Khmer voice: ', 'ទិន្នន័យបើកចំហដំបូងបានចេញផ្សាយ — សំឡេងខ្មែរ៖ ')}
              <a href="https://huggingface.co/datasets/sengtha/iany-khmer-voice" target="_blank" rel="noreferrer">
                sengtha/iany-khmer-voice
              </a>
            </p>
          </div>
          <div className="lp-band-links">
            <a className="lp-chip" href="/voice">🎤 {L('Voice', 'សំឡេង')}</a>
            <a className="lp-chip" href="/scan">📷 {L('Scan', 'ស្កេន')}</a>
            <a className="lp-chip" href="/sign">🤟 {L('Sign', 'សញ្ញា')}</a>
            <a className="lp-chip" href="/crop">🌱 {L('Crop', 'ដំណាំ')}</a>
            <a className="lp-chip" href="/health-test">🧪 {L('Test', 'តេស្ត')}</a>
            <a className="lp-chip" href="/braille">⠿ {L('Braille', 'អក្សរផុស')}</a>
            <a className="lp-chip" href="/contribute">
              {L('All ways to help', 'គ្រប់មធ្យោបាយជួយ')} →
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- open source */}
      <section className="lp-section lp-section-alt">
        <div className="lp-os">
          <h2 className="lp-h2">{L('Free & open source', 'ឥតគិតថ្លៃ & បើកចំហ')}</h2>
          <p className="lp-lead">
            {L(
              'iAny is open source under Apache-2.0 — free to use, self-host, and build on, including commercially. No lock-in, no secrets. Help us build the best open Khmer AI.',
              'iAny ជាកម្មវិធីបើកចំហក្រោមអាជ្ញាបណ្ណ Apache-2.0 — ឥតគិតថ្លៃក្នុងការប្រើ ដំឡើងផ្ទាល់ខ្លួន និងបង្កើតបន្ថែម រួមទាំងពាណិជ្ជកម្ម។ គ្មានចាក់សោ គ្មានអាថ៌កំបាំង។ សូមជួយយើងបង្កើត AI ខ្មែរបើកចំហ ដ៏ល្អបំផុត។',
            )}
          </p>
          <div className="lp-cta">
            <a className="lp-btn lp-btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              ★ {L('Star on GitHub', 'ផ្ដល់ផ្កាយនៅ GitHub')}
            </a>
            <a className="lp-btn lp-btn-ghost lp-btn-lg" href={HF_URL} target="_blank" rel="noreferrer">
              🤗 {L('Models & datasets on Hugging Face', 'ម៉ូឌែល & ទិន្នន័យនៅ Hugging Face')}
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- footer */}
      <footer className="lp-footer">
        <div className="lp-foot-brand">
          <img src="/icon.svg" alt="" width={22} height={22} />
          <span>iAny</span>
        </div>
        <p className="lp-foot-note">
          {L(
            'Offline, on-device Khmer AI — with the community, for the community.',
            'AI ខ្មែរ ក្រៅបណ្ដាញ លើឧបករណ៍ — ជាមួយសហគមន៍ សម្រាប់សហគមន៍។',
          )}
        </p>
        <div className="lp-foot-links">
          <a href={APP_URL}>{L('App', 'កម្មវិធី')}</a>
          <a href={APK_URL}>{L('Android APK (Preview)', 'Android APK (សាកល្បង)')}</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={HF_URL} target="_blank" rel="noreferrer">Hugging Face</a>
          <a href="/voice">/voice</a>
          <a href="/scan">/scan</a>
          <a href="/sign">/sign</a>
          <a href="/crop">/crop</a>
          <a href="/health">/health</a>
          <a href="/braille">/braille</a>
          <a href="/trace">/trace · {L('experiment', 'ពិសោធន៍')}</a>
        </div>
        <p className="lp-foot-co">
          © {COMPANY_YEAR}{' '}
          <a href={COMPANY_URL} target="_blank" rel="noreferrer">
            {COMPANY_NAME}
          </a>{' '}
          · {L('Apache-2.0 · "iAny" is a trademark of', 'Apache-2.0 · "iAny" ជាពាណិជ្ជសញ្ញារបស់')}{' '}
          {COMPANY_NAME}
        </p>
      </footer>
    </div>
  )
}

function Feature({
  icon,
  title,
  desc,
  link,
  linkLabel,
  badge,
  badgeTone,
}: {
  icon: string
  title: string
  desc: string
  link?: string
  linkLabel?: string
  badge?: string
  badgeTone?: 'experiment' | 'collecting'
}) {
  return (
    <div className="lp-card">
      <div className="lp-card-icon" aria-hidden>
        {icon}
      </div>
      <h3>
        {title}
        {badge ? (
          <span className={`lp-badge${badgeTone === 'collecting' ? ' lp-badge-info' : ''}`}>{badge}</span>
        ) : null}
      </h3>
      <p>{desc}</p>
      {link ? (
        <a className="lp-card-link" href={link}>
          {linkLabel ?? link} →
        </a>
      ) : null}
    </div>
  )
}
