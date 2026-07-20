import { useI18n } from '../i18n'

/**
 * Standalone "Contribute / Build" page (served at /contribute). Two audiences:
 *  - the community — contribute voice / photos / signs, translate, test, share.
 *  - AI engineers & researchers — the open models, datasets, and training recipes.
 *
 * Reuses the landing styles (landing.css, lp-* classes) so it matches the front
 * page. Bilingual (EN/KM).
 */

const GITHUB_URL = 'https://github.com/sengtha/iAny'
const HF_URL = 'https://huggingface.co/sengtha'
const REPO_BLOB = 'https://github.com/sengtha/iAny/blob/main'
const COMPANY_URL = 'https://www.e-khmer.com'
const COMPANY_NAME = 'E-KHMER Technology Co., Ltd'
const COMPANY_YEAR = 2026
const EMAIL = 'sengtha@gmail.com'

export function ContributePageView() {
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
          <a href="#community">{L('Community', 'សហគមន៍')}</a>
          <a href="#engineers">{L('AI engineers', 'វិស្វករ AI')}</a>
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
          <a className="lp-btn lp-btn-sm" href="/">
            ← {L('Home', 'ទំព័រដើម')}
          </a>
        </div>
      </header>

      {/* --------------------------------------------------------------- hero */}
      <section className="lp-hero">
        <div className="lp-hero-glow" aria-hidden />
        <p className="lp-eyebrow">{L('Open · Community-driven', 'បើកចំហ · ដឹកនាំដោយសហគមន៍')}</p>
        <h1 className="lp-title">
          {L('Help build the best ', 'ជួយបង្កើត ')}
          <span className="lp-grad">{L('open Khmer AI', 'AI ខ្មែរបើកចំហ ដ៏ល្អបំផុត')}</span>
        </h1>
        <p className="lp-sub">
          {L(
            'iAny is open source and built in the open. Whether you want to contribute your voice or verify a sign, or you are an AI engineer who wants to use and improve the models — there is a place for you here.',
            'iAny ជាកម្មវិធីបើកចំហ ហើយបង្កើតឡើងជាសាធារណៈ។ មិនថាអ្នកចង់ចូលរួមថតសំឡេង ផ្ទៀងផ្ទាត់សញ្ញា ឬអ្នកជាវិស្វករ AI ដែលចង់ប្រើ និងកែលម្អម៉ូឌែល — មានកន្លែងសម្រាប់អ្នកនៅទីនេះ។',
          )}
        </p>
        <div className="lp-cta">
          <a className="lp-btn lp-btn-lg" href="#community">
            {L('I want to contribute', 'ខ្ញុំចង់ចូលរួម')}
          </a>
          <a className="lp-btn lp-btn-ghost lp-btn-lg" href="#engineers">
            {L('I build with AI', 'ខ្ញុំបង្កើតជាមួយ AI')}
          </a>
        </div>
      </section>

      {/* ---------------------------------------------------------- community */}
      <section id="community" className="lp-section">
        <h2 className="lp-h2">🙌 {L('For everyone — contribute', 'សម្រាប់អ្នកគ្រប់គ្នា — ចូលរួម')}</h2>
        <p className="lp-lead">
          {L(
            'Every contribution becomes an open dataset (CC-BY-SA-4.0), and the models trained from it are released free for everyone. Contributors are credited by name (opt-in). No coding required.',
            'រាល់ការចូលរួមក្លាយជាទិន្នន័យបើកចំហ (CC-BY-SA-4.0) ហើយម៉ូឌែលដែលបង្រៀនចេញពីវាត្រូវបានចេញផ្សាយឥតគិតថ្លៃសម្រាប់អ្នកគ្រប់គ្នា។ អ្នកចូលរួមត្រូវបានផ្ដល់កិត្តិនាម (ស្ម័គ្រចិត្ត)។ មិនត្រូវការចេះកូដទេ។',
          )}
        </p>
        <div className="lp-grid">
          <Card icon="🎤" title={L('Contribute your voice', 'ចូលរួមសំឡេងរបស់អ្នក')}
            desc={L('Read short Khmer sentences aloud to train an open speech-to-text model.', 'អានប្រយោគខ្មែរខ្លីៗ ដើម្បីបង្រៀនម៉ូឌែលបំប្លែងសំឡេងជាអក្សរបើកចំហ។')}
            link="/voice" linkLabel={L('Open /voice', 'បើក /voice')} />
          <Card icon="📷" title={L('Contribute Khmer text photos', 'ចូលរួមរូបថតអក្សរខ្មែរ')}
            desc={L('Photograph Khmer text and correct what the OCR reads — helps build a better Khmer OCR.', 'ថតរូបអក្សរខ្មែរ ហើយកែអ្វីដែល OCR អាន — ជួយបង្កើត OCR ខ្មែរឲ្យប្រសើរ។')}
            link="/scan" linkLabel={L('Open /scan', 'បើក /scan')} />
          <Card icon="🤟" title={L('Contribute sign language', 'ចូលរួមភាសាសញ្ញា')}
            desc={L('Sign Khmer words to the camera — only hand landmarks are stored, never video.', 'ធ្វើសញ្ញាពាក្យខ្មែរទៅកាមេរ៉ា — រក្សាទុកតែចំណុចដៃ មិនមែនវីដេអូ។')}
            link="/sign" linkLabel={L('Open /sign', 'បើក /sign')} />
          <Card icon="🌱" title={L('Contribute crop photos', 'ចូលរួមរូបថតដំណាំ')}
            desc={L('Photograph crops and tag their health — builds an offline crop-disease AI for farmers.', 'ថតរូបដំណាំ ហើយដាក់ស្លាកសុខភាព — បង្កើត AI ជំងឺដំណាំក្រៅបណ្ដាញសម្រាប់កសិករ។')}
            link="/crop" linkLabel={L('Open /crop', 'បើក /crop')} />
          <Card icon="🧪" title={L('Contribute rapid-test photos', 'ចូលរួមរូបតេស្តរហ័ស')}
            desc={L('Photograph rapid-test strips + tag the result — helps build an offline test-reading AI (the strip only, no faces).', 'ថតបន្ទះតេស្តរហ័ស + ដាក់ស្លាកលទ្ធផល — ជួយបង្កើត AI អានលទ្ធផលក្រៅបណ្ដាញ (តែបន្ទះ គ្មានមុខ)។')}
            link="/health-test" linkLabel={L('Open /health-test', 'បើក /health-test')} />
          <Card icon="💧" title={L('Contribute water-test photos', 'ចូលរួមរូបតេស្តទឹក')}
            desc={L('Photograph water test strips + tag the reading — builds an offline water-safety reader for rural areas.', 'ថតបន្ទះតេស្តទឹក + ដាក់ស្លាកលទ្ធផល — បង្កើតឧបករណ៍អានសុវត្ថិភាពទឹកក្រៅបណ្ដាញសម្រាប់ជនបទ។')}
            link="/water" linkLabel={L('Open /water', 'បើក /water')} />
          <Card icon="♻️" title={L('Contribute waste photos', 'ចូលរួមរូបថតសំរាម')}
            desc={L('Photograph waste items + tag the material — builds an offline waste-sorting AI for recycling.', 'ថតរូបសំណល់ + ដាក់ស្លាកសម្ភារៈ — បង្កើត AI តម្រៀបសំណល់ក្រៅបណ្ដាញសម្រាប់កែច្នៃ។')}
            link="/waste" linkLabel={L('Open /waste', 'បើក /waste')} />
          <Card icon="🌿" title={L('Contribute nature photos', 'ចូលរួមរូបធម្មជាតិ')}
            desc={L('Photograph plants, birds, insects, mosquitoes + tag the group — builds an offline nature-ID AI.', 'ថតរុក្ខជាតិ បក្សី សត្វល្អិត មូស + ដាក់ស្លាកក្រុម — បង្កើត AI ចាំណាំធម្មជាតិក្រៅបណ្ដាញ។')}
            link="/species" linkLabel={L('Open /species', 'បើក /species')} />
          <Card icon="📣" title={L('Report a community issue', 'រាយការណ៍បញ្ហាសហគមន៍')}
            desc={L('Photograph + map local problems (rubbish, flooding, potholes) — helps communities + an offline report AI.', 'ថត + ធ្វើផែនទីបញ្ហា (សំរាម ទឹកជំនន់ ផ្លូវខូច) — ជួយសហគមន៍ + AI របាយការណ៍ក្រៅបណ្ដាញ។')}
            link="/report" linkLabel={L('Open /report', 'បើក /report')} />
          <Card icon="🌐" title={L('Translate & improve Khmer', 'បកប្រែ & កែលម្អខ្មែរ')}
            desc={L('Improve the Khmer wording, prompts, and app text. Great first contribution.', 'កែលម្អពាក្យខ្មែរ ប្រយោគ និងអត្ថបទកម្មវិធី។ ការចូលរួមដំបូងដ៏ល្អ។')}
            link={`${GITHUB_URL}/issues`} linkLabel={L('Good first issues', 'កិច្ចការសម្រាប់អ្នកចាប់ផ្ដើម')} external />
          <Card icon="🐛" title={L('Report bugs & test', 'រាយការណ៍កំហុស & សាកល្បង')}
            desc={L('Try the app, tell us what breaks, or suggest a feature on GitHub.', 'សាកល្បងកម្មវិធី ប្រាប់យើងពីអ្វីដែលខូច ឬស្នើមុខងារនៅ GitHub។')}
            link={`${GITHUB_URL}/issues/new`} linkLabel={L('Open an issue', 'បើកបញ្ហា')} external />
          <Card icon="📣" title={L('Spread the word', 'ផ្សព្វផ្សាយ')}
            desc={L('Share iany.app with schools, teachers, and anyone who needs offline Khmer AI.', 'ចែករំលែក iany.app ជាមួយសាលា គ្រូ និងអ្នកដែលត្រូវការ AI ខ្មែរក្រៅបណ្ដាញ។')} />
        </div>
        <p className="lp-lead" style={{ marginTop: '28px' }}>
          {L('Organizing a classroom or a community drive? See the guides: ', 'កំពុងរៀបចំថ្នាក់រៀន ឬយុទ្ធនាការសហគមន៍? សូមមើលការណែនាំ៖ ')}
          <a href={`${REPO_BLOB}/docs/VOICE-COLLECTION.md`} target="_blank" rel="noreferrer">Voice</a>{' · '}
          <a href={`${REPO_BLOB}/docs/OCR-COLLECTION.md`} target="_blank" rel="noreferrer">OCR</a>{' · '}
          <a href={`${REPO_BLOB}/docs/SIGN-COLLECTION.md`} target="_blank" rel="noreferrer">Sign</a>
        </p>
      </section>

      {/* --------------------------------------------------------- engineers */}
      <section id="engineers" className="lp-section lp-section-alt">
        <h2 className="lp-h2">🧑‍💻 {L('For AI engineers & researchers', 'សម្រាប់វិស្វករ AI & អ្នកស្រាវជ្រាវ')}</h2>
        <p className="lp-lead">
          {L(
            'The models and datasets are open. Use them, evaluate them, fine-tune them, and build your own products — the code is Apache-2.0. Here is everything you need.',
            'ម៉ូឌែល និងទិន្នន័យគឺបើកចំហ។ ប្រើវា វាយតម្លៃ បង្វឹកបន្ថែម ហើយបង្កើតផលិតផលផ្ទាល់ខ្លួន — កូដគឺ Apache-2.0។ នេះជាអ្វីៗដែលអ្នកត្រូវការ។',
          )}
        </p>

        <div className="lp-band" style={{ marginBottom: '18px' }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.2rem' }}>🤗 {L('Models on Hugging Face', 'ម៉ូឌែលនៅ Hugging Face')}</h3>
            <p className="lp-lead" style={{ textAlign: 'left', margin: 0 }}>
              {L(
                'All the open Khmer models — speech-to-text, text-to-speech, OCR, and the Khmer LLM — live on the Hugging Face profile below. Each repo card has the license and usage.',
                'ម៉ូឌែលខ្មែរបើកចំហទាំងអស់ — STT, TTS, OCR និង LLM ខ្មែរ — មាននៅលើ Hugging Face ខាងក្រោម។ រាល់ repo មានអាជ្ញាបណ្ណ និងការប្រើប្រាស់។',
              )}
            </p>
          </div>
          <div className="lp-band-links">
            <a className="lp-chip" href={HF_URL} target="_blank" rel="noreferrer">🤗 huggingface.co/sengtha</a>
            <a className="lp-chip" href={`${REPO_BLOB}/docs/MODELS.md`} target="_blank" rel="noreferrer">📋 {L('Model catalog', 'បញ្ជីម៉ូឌែល')}</a>
          </div>
        </div>

        <div className="lp-grid">
          <Card icon="🗂️" title={L('Open datasets', 'ទិន្នន័យបើកចំហ')}
            desc={L('Community voice/photo/sign data (CC-BY-SA-4.0). Export scripts pull training-ready sets with credits.', 'ទិន្នន័យសំឡេង/រូបភាព/សញ្ញាពីសហគមន៍ (CC-BY-SA-4.0)។ ស្គ្រីបនាំចេញផ្ដល់ទិន្នន័យត្រៀមបង្វឹក ព្រមទាំងកិត្តិនាម។')}
            link={`${REPO_BLOB}/docs/MODELS.md`} linkLabel={L('Datasets & licenses', 'ទិន្នន័យ & អាជ្ញាបណ្ណ')} external />
          <Card icon="📘" title={L('Training recipes', 'របៀបបង្វឹក')}
            desc={L('Reproducible fine-tuning guides for Khmer STT, TTS, OCR, and the Khmer LLM (RunPod).', 'ការណែនាំបង្វឹកឡើងវិញបានសម្រាប់ STT, TTS, OCR និង LLM ខ្មែរ (RunPod)។')}
            link={`${REPO_BLOB}/docs/RUNPOD-KHMER-STT.md`} linkLabel={L('STT · TTS · OCR guides', 'ការណែនាំ STT · TTS · OCR')} external />
          <Card icon="🧩" title={L('Build on iAny', 'បង្កើតលើ iAny')}
            desc={L('Apache-2.0 code — PWA, React Native app, and a Cloudflare Worker that mirrors models. Self-host or fork freely.', 'កូដ Apache-2.0 — PWA កម្មវិធី React Native និង Cloudflare Worker ដែលចម្លងម៉ូឌែល។ ដំឡើងផ្ទាល់ខ្លួន ឬ fork ដោយសេរី។')}
            link={GITHUB_URL} linkLabel={L('Source on GitHub', 'កូដនៅ GitHub')} external />
          <Card icon="🧪" title={L('Evaluate & report', 'វាយតម្លៃ & រាយការណ៍')}
            desc={L('Benchmark the Khmer models, open issues with results, or propose better data and training.', 'វាស់ស្ទង់ម៉ូឌែលខ្មែរ បើកបញ្ហាជាមួយលទ្ធផល ឬស្នើទិន្នន័យ និងការបង្វឹកឲ្យប្រសើរ។')}
            link={`${GITHUB_URL}/issues`} linkLabel={L('GitHub issues', 'បញ្ហានៅ GitHub')} external />
        </div>

        <p className="lp-lead" style={{ marginTop: '28px' }}>
          {L('Want to collaborate on Khmer AI research or a deployment? ', 'ចង់សហការលើការស្រាវជ្រាវ AI ខ្មែរ ឬការដាក់ឲ្យប្រើ? ')}
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </p>
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
          <a href="/">{L('Home', 'ទំព័រដើម')}</a>
          <a href="/app">{L('App', 'កម្មវិធី')}</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={HF_URL} target="_blank" rel="noreferrer">Hugging Face</a>
          <a href="/voice">/voice</a>
          <a href="/scan">/scan</a>
          <a href="/sign">/sign</a>
        </div>
        <p className="lp-foot-co">
          © {COMPANY_YEAR}{' '}
          <a href={COMPANY_URL} target="_blank" rel="noreferrer">
            {COMPANY_NAME}
          </a>{' '}
          · Apache-2.0
        </p>
      </footer>
    </div>
  )
}

function Card({
  icon,
  title,
  desc,
  link,
  linkLabel,
  external,
}: {
  icon: string
  title: string
  desc: string
  link?: string
  linkLabel?: string
  external?: boolean
}) {
  return (
    <div className="lp-card">
      <div className="lp-card-icon" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {link ? (
        <a
          className="lp-card-link"
          href={link}
          {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        >
          {linkLabel ?? link} →
        </a>
      ) : null}
    </div>
  )
}
