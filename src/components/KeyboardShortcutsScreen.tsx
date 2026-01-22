import { FiCommand } from 'react-icons/fi';
import PageHeader from './PageHeader';

interface KeyboardShortcutsScreenProps {
  onBackToMenu: () => void;
}

interface ShortcutInfo {
  keys: string;
  description: string;
  details?: string;
}

const shortcuts: ShortcutInfo[] = [
  {
    keys: 'ALT + SHIFT + A',
    description: 'Värvi saabunud detailid roheliseks',
    details: 'Värvib kõik saabunud (kinnitatud) aga paigaldamata detailid roheliseks, ülejäänud mudel värvitakse valgeks.'
  },
  {
    keys: 'ALT + SHIFT + M',
    description: 'Lisa mustade tekstidega markupid',
    details: 'Lisab valitud detailidele markupid musta tekstiga ja 500mm joonega. Kui detailid on üksteisele lähemal kui 4m, kasutatakse 2m kõrguserinevust.'
  },
  {
    keys: 'ALT + SHIFT + S',
    description: 'Ava otsingumodaal',
    details: 'Avab kiirotsingu modaali, mis võimaldab otsida detaile assembly margi järgi ükskõik milliselt lehelt.'
  },
  {
    keys: 'ALT + SHIFT + W',
    description: 'Värvi mudel valgeks',
    details: 'Värvib kogu mudeli valgeks - sama funktsioon mis Tööriistad lehel.'
  },
  {
    keys: 'ALT + SHIFT + B',
    description: 'Lisa poltide markupid',
    details: 'Lisab valitud detailidele poltide markupid tumesinises värvis.'
  },
  {
    keys: 'ALT + SHIFT + I',
    description: 'Ava Paigaldamiste leht',
    details: 'Avab Paigaldamiste sisestamise lehe otse.'
  },
  {
    keys: 'ALT + SHIFT + D',
    description: 'Lisa tarne markupid',
    details: 'Lisab valitud detailidele kaherealised markupid veoki lühendi ja tarnekuupäevaga. Iga veok saab erineva värvi, lähedased markupid saavad erineva kõrguse.'
  }
];

export default function KeyboardShortcutsScreen({ onBackToMenu }: KeyboardShortcutsScreenProps) {
  return (
    <div className="screen-container" style={{ background: '#f5f5f5', minHeight: '100%' }}>
      <PageHeader
        title="Klaviatuuri otseteed"
        onBack={onBackToMenu}
      />

      <div style={{ padding: '16px', maxWidth: '600px' }}>
        <div style={{
          background: '#fff',
          borderRadius: '8px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #e5e7eb',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <FiCommand size={20} style={{ color: '#6366f1' }} />
            <span style={{ fontWeight: 600, color: '#1f2937' }}>Globaalsed otseteed</span>
          </div>

          <div style={{ padding: '8px 0' }}>
            {shortcuts.map((shortcut, index) => (
              <div
                key={index}
                style={{
                  padding: '12px 16px',
                  borderBottom: index < shortcuts.length - 1 ? '1px solid #f3f4f6' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <code style={{
                    background: '#f1f5f9',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#475569',
                    whiteSpace: 'nowrap',
                    border: '1px solid #e2e8f0'
                  }}>
                    {shortcut.keys}
                  </code>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, color: '#1f2937', fontSize: '13px', marginBottom: '4px' }}>
                      {shortcut.description}
                    </div>
                    {shortcut.details && (
                      <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.4 }}>
                        {shortcut.details}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: '#fef3c7',
          borderRadius: '6px',
          border: '1px solid #fcd34d',
          fontSize: '12px',
          color: '#92400e'
        }}>
          <strong>Vihje:</strong> Otseteed töötavad igal lehel. Mõned otseteed (nt markupid) vajavad, et mudelis oleks detail valitud.
        </div>
      </div>
    </div>
  );
}
