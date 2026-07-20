/**
 * Curated Khmer health-EDUCATION topics for the /health surface.
 *
 * ⚠️ SCOPE (see docs/HEALTH-AI.md): information only — NOT diagnosis, NOT a
 * substitute for a health worker. These are standard, widely-agreed public-health
 * messages (WHO / UNICEF / MoH-style). They are a STARTER set and should be
 * reviewed and extended by health professionals before any production use. Each
 * topic ends with a "when to seek care" note so the app always routes to real care.
 */

export interface HealthTopic {
  id: string
  emoji: string
  titleEn: string
  titleKm: string
  bodyEn: string[]
  bodyKm: string[]
  /** When to see a health worker (danger signs) — shown highlighted. */
  seekEn: string
  seekKm: string
  source: string
}

export const HEALTH_TOPICS: HealthTopic[] = [
  {
    id: 'diarrhoea',
    emoji: '💧',
    titleEn: 'Diarrhoea — rehydrate',
    titleKm: 'រាគ — បំពេញជាតិទឹក',
    bodyEn: [
      'Give ORS (oral rehydration solution) after each loose stool.',
      'Give zinc for 10–14 days for children (as advised locally).',
      'Keep eating and breastfeeding — do not stop feeding.',
      'Give clean, safe water often.',
    ],
    bodyKm: [
      'ផ្ដល់ ORS (ទឹកបំពេញជាតិទឹក) បន្ទាប់ពីរាគម្ដងៗ។',
      'ផ្ដល់ស័ង្កសី (zinc) ១០–១៤ ថ្ងៃសម្រាប់កុមារ (តាមការណែនាំ)។',
      'បន្តញ៉ាំ និងបំបៅដោះ — កុំឈប់ឲ្យអាហារ។',
      'ផ្ដល់ទឹកស្អាតឲ្យញឹកញាប់។',
    ],
    seekEn: 'Seek care now if: blood in stool, cannot drink, sunken eyes, very weak, or no better in 2 days.',
    seekKm: 'ស្វែងរកការព្យាបាលភ្លាមៗ បើ៖ មានឈាមក្នុងលាមក ផឹកមិនបាន ភ្នែកលិច ខ្សោយខ្លាំង ឬមិនធូរក្នុង ២ ថ្ងៃ។',
    source: 'WHO / UNICEF',
  },
  {
    id: 'handwashing',
    emoji: '🧼',
    titleEn: 'Handwashing with soap',
    titleKm: 'លាងដៃដោយសាប៊ូ',
    bodyEn: [
      'Wash with soap and clean water for ~20 seconds.',
      'Key moments: before eating or cooking, after the toilet, after cleaning a child.',
      'It prevents diarrhoea and many infections.',
    ],
    bodyKm: [
      'លាងដៃដោយសាប៊ូ និងទឹកស្អាតប្រហែល ២០ វិនាទី។',
      'ពេលសំខាន់៖ មុនញ៉ាំ ឬធ្វើម្ហូប បន្ទាប់ពីបង្គន់ បន្ទាប់ពីសម្អាតកូន។',
      'វាការពាររាគ និងការឆ្លងជាច្រើន។',
    ],
    seekEn: 'Basic prevention — no test needed. See a health worker for any ongoing illness.',
    seekKm: 'ការការពារមូលដ្ឋាន។ សូមជួបបុគ្គលិកសុខាភិបាល បើមានជំងឺបន្ត។',
    source: 'WHO',
  },
  {
    id: 'child-fever',
    emoji: '🌡️',
    titleEn: 'Child fever — danger signs',
    titleKm: 'កុមារគ្រុនក្ដៅ — សញ្ញាគ្រោះថ្នាក់',
    bodyEn: [
      'Give plenty of fluids and keep the child comfortable.',
      'Use paracetamol at the correct dose for weight if needed.',
      'A fever can be many things — watch for the danger signs below.',
    ],
    bodyKm: [
      'ផ្ដល់ទឹកឲ្យបានច្រើន និងរក្សាកូនឲ្យស្រួល។',
      'ប្រើប៉ារ៉ាសេតាម៉ុលតាមទម្ងន់ត្រឹមត្រូវ បើចាំបាច់។',
      'គ្រុនក្ដៅអាចមានមូលហេតុច្រើន — សូមតាមដានសញ្ញាគ្រោះថ្នាក់ខាងក្រោម។',
    ],
    seekEn: 'Go to a health facility NOW if: a baby under 2 months has fever, convulsions, trouble breathing, cannot drink/feed, very sleepy, or a stiff neck/rash.',
    seekKm: 'ទៅមណ្ឌលសុខភាពភ្លាមៗ បើ៖ ទារកក្រោម ២ ខែមានគ្រុន ប្រកាច់ ដកដង្ហើមពិបាក ផឹក/បៅមិនបាន ងងុយខ្លាំង ឬករឹង/កន្ទួល។',
    source: 'WHO IMCI',
  },
  {
    id: 'breastfeeding',
    emoji: '🤱',
    titleEn: 'Breastfeeding',
    titleKm: 'ការបំបៅដោះ',
    bodyEn: [
      'Breastfeed within the first hour after birth.',
      'Give only breast milk for the first 6 months (no water needed).',
      'Continue breastfeeding up to 2 years with other foods after 6 months.',
    ],
    bodyKm: [
      'បំបៅដោះក្នុងម៉ោងដំបូងក្រោយសម្រាល។',
      'ឲ្យតែទឹកដោះម្ដាយ ៦ ខែដំបូង (មិនចាំបាច់ទឹក)។',
      'បន្តបំបៅដល់ ២ ឆ្នាំ ជាមួយអាហារផ្សេងក្រោយ ៦ ខែ។',
    ],
    seekEn: 'See a health worker if feeding is painful, the baby is not gaining weight, or has fewer wet nappies.',
    seekKm: 'ជួបបុគ្គលិកសុខាភិបាល បើបំបៅឈឺ កូនមិនឡើងទម្ងន់ ឬនោមតិច។',
    source: 'WHO / UNICEF',
  },
  {
    id: 'dengue',
    emoji: '🦟',
    titleEn: 'Dengue — prevent & watch',
    titleKm: 'គ្រុនឈាម — ការពារ និងតាមដាន',
    bodyEn: [
      'Remove standing water (pots, tyres, containers) weekly — mosquitoes breed there.',
      'Sleep under a net; cover water storage.',
      'For fever: rest and drink fluids. Avoid ibuprofen/aspirin.',
    ],
    bodyKm: [
      'យកទឹកស្ថិតនៅ (ក្អម កង់ ភាជនៈ) ចេញរៀងរាល់សប្ដាហ៍ — មូសពងនៅទីនោះ។',
      'ដេកក្នុងមុង គ្របភាជនៈផ្ទុកទឹក។',
      'ពេលគ្រុន៖ សម្រាក និងផឹកទឹក។ ជៀសវាង ibuprofen/aspirin។',
    ],
    seekEn: 'Go NOW if: severe belly pain, vomiting, bleeding gums/nose, black stool, cold clammy skin, or restlessness — these are warning signs.',
    seekKm: 'ទៅភ្លាមៗ បើ៖ ឈឺពោះខ្លាំង ក្អួត ឈាមធ្មេញ/ច្រមុះ លាមកខ្មៅ ស្បែកត្រជាក់សើម ឬមិនស្ងប់ — ទាំងនេះជាសញ្ញាព្រមាន។',
    source: 'WHO',
  },
  {
    id: 'safe-water',
    emoji: '🚰',
    titleEn: 'Safe drinking water',
    titleKm: 'ទឹកផឹកមានសុវត្ថិភាព',
    bodyEn: [
      'Boil water to a rolling boil, or treat it (filter / chlorine) before drinking.',
      'Store treated water in a clean, covered container.',
      'Use a clean cup — do not dip hands into stored water.',
    ],
    bodyKm: [
      'ស្ងោរទឹកឲ្យពុះ ឬ ដំណើរការ (ត្រង / គ្លរ) មុនផឹក។',
      'ផ្ទុកទឹកស្អាតក្នុងភាជនៈស្អាតមានគម្រប។',
      'ប្រើពែងស្អាត — កុំលិចដៃក្នុងទឹកផ្ទុក។',
    ],
    seekEn: 'Prevention — no test needed. Seek care for ongoing diarrhoea or vomiting (see Diarrhoea).',
    seekKm: 'ការការពារ។ ស្វែងរកការព្យាបាល បើរាគ ឬក្អួតបន្ត (មើលប្រធានបទ រាគ)។',
    source: 'WHO',
  },
  {
    id: 'arsenic',
    emoji: '☠️',
    titleEn: 'Arsenic in well water',
    titleKm: 'អាសេនិចក្នុងទឹកអណ្ដូង',
    bodyEn: [
      'Some tube wells (especially in the Mekong basin) have natural arsenic — you cannot see, taste, or smell it.',
      'Long-term drinking can cause skin changes and serious illness.',
      'Boiling does NOT remove arsenic. Use a tested-safe source, a proper arsenic filter, or rainwater.',
      'Have wells tested (a test strip or a lab) — the /water tool helps read a strip.',
    ],
    bodyKm: [
      'អណ្ដូងបំពង់ខ្លះ (ជាពិសេសក្នុងអាងទន្លេមេគង្គ) មានអាសេនិចធម្មជាតិ — មើលមិនឃើញ គ្មានរស់ គ្មានក្លិន។',
      'ការផឹករយៈពេលវែងបណ្ដាលឲ្យប្រែស្បែក និងជំងឺធ្ងន់ធ្ងរ។',
      'ការស្ងោរ មិនយកអាសេនិចចេញ។ ប្រើប្រភពដែលបានតេស្តថាមានសុវត្ថិភាព តម្រងអាសេនិច ឬទឹកភ្លៀង។',
      'តេស្តអណ្ដូង (បន្ទះតេស្ត ឬមន្ទីរពិសោធន៍) — ឧបករណ៍ /water ជួយអានបន្ទះ។',
    ],
    seekEn: 'See a health worker if you have unexplained skin patches/thickening. Test your well if it has never been checked.',
    seekKm: 'ជួបបុគ្គលិកសុខាភិបាល បើមានប្រឡាក់/ក្រាស់ស្បែកមិនដឹងមូលហេតុ។ តេស្តអណ្ដូង បើមិនធ្លាប់ពិនិត្យ។',
    source: 'WHO',
  },
  {
    id: 'antenatal',
    emoji: '🤰',
    titleEn: 'Pregnancy care',
    titleKm: 'ការថែទាំពេលមានផ្ទៃពោះ',
    bodyEn: [
      'Attend antenatal check-ups (at least 4, more if advised).',
      'Take iron/folic acid as given; eat a varied diet.',
      'Plan a birth with a skilled attendant.',
    ],
    bodyKm: [
      'ទៅពិនិត្យផ្ទៃពោះ (យ៉ាងតិច ៤ ដង ច្រើនជាងបើណែនាំ)។',
      'ញ៉ាំ ជាតិដែក/អាស៊ីតហ្វូលិក តាមការផ្ដល់ ញ៉ាំអាហារចម្រុះ។',
      'រៀបចំសម្រាលជាមួយអ្នកជំនាញ។',
    ],
    seekEn: 'Go NOW if: bleeding, severe headache, blurred vision, swelling of face/hands, strong belly pain, or the baby stops moving.',
    seekKm: 'ទៅភ្លាមៗ បើ៖ ចេញឈាម ឈឺក្បាលខ្លាំង ភ្នែកព្រិល ហើមមុខ/ដៃ ឈឺពោះខ្លាំង ឬកូនឈប់កម្រើក។',
    source: 'WHO',
  },
  {
    id: 'vaccination',
    emoji: '💉',
    titleEn: 'Childhood vaccines',
    titleKm: 'វ៉ាក់សាំងកុមារ',
    bodyEn: [
      'Follow the national immunization schedule — keep the vaccination card.',
      'Vaccines protect against measles, polio, TB, and more.',
      'Mild fever or a sore arm after a shot is common and passes.',
    ],
    bodyKm: [
      'អនុវត្តតាមកាលវិភាគចាក់វ៉ាក់សាំងជាតិ — រក្សាកាតវ៉ាក់សាំង។',
      'វ៉ាក់សាំងការពារកញ្ជ្រិល ប៉ូលីយ៉ូ របេង និងជំងឺផ្សេងៗ។',
      'គ្រុនស្រាល ឬឈឺដៃក្រោយចាក់ ជារឿងធម្មតា ហើយបាត់ទៅ។',
    ],
    seekEn: 'See a health worker to catch up missed doses, or for a strong reaction after a vaccine.',
    seekKm: 'ជួបបុគ្គលិកសុខាភិបាល ដើម្បីបំពេញដូសដែលខកខាន ឬពេលមានប្រតិកម្មខ្លាំង។',
    source: 'WHO EPI',
  },
]
