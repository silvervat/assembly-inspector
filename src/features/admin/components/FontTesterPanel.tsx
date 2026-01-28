import { FiCopy } from 'react-icons/fi';

export default function FontTesterPanel() {

  return (
    <div className="admin-content" style={{ padding: '16px' }}>
      <div style={{ marginBottom: '20px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
          Testi kas Trimble Connecti ikoonifondid töötavad sinu extensionis.
          Ikoonid peaksid kuvama kui TC font on saadaval.
        </p>
      </div>

      {/* Test Section 1: Direct icon-font class usage */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
          Variant 1: icon-font klass (TC iframe'is)
        </h3>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px' }}>
          Kui extension töötab TC sees, siis font peaks olema juba laetud.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '8px'
        }}>
          {[
            'tc-icon-background',
            'tc-icon-eye-visibility',
            'tc-icon-eye-visibility-off',
            'tc-icon-check',
            'tc-icon-delete',
            'tc-icon-settings',
            'tc-icon-search',
            'tc-icon-folder',
            'tc-icon-measure',
            'tc-icon-ghost',
            'tc-icon-transparency',
            'tc-icon-show-all',
            'tc-icon-info',
            'tc-icon-add-circle-outline',
            'tc-icon-close',
            'tc-icon-arrow-left',
            'tc-icon-arrow-right',
            'tc-icon-chevron-down',
            'tc-icon-chevron-up',
            'tc-icon-download',
            'tc-icon-upload',
            'tc-icon-refresh',
            'tc-icon-edit',
            'tc-icon-save',
            'tc-icon-cancel',
            'tc-icon-warning',
            'tc-icon-error',
            'tc-icon-success',
            'tc-icon-filter',
            'tc-icon-sort'
          ].map(iconClass => (
            <div
              key={iconClass}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                background: '#f9fafb',
                borderRadius: '6px',
                border: '1px solid #e5e7eb'
              }}
            >
              <i className={`icon-font ${iconClass}`} style={{ fontSize: '20px' }} />
              <code style={{ fontSize: '9px', color: '#6b7280', wordBreak: 'break-all' }}>
                {iconClass.replace('tc-icon-', '')}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* Test Section 2: Check if font is loaded */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
          Variant 2: Kontrolli kas font on laetud
        </h3>
        <button
          onClick={() => {
            // Check if icon-font is available
            const testEl = document.createElement('span');
            testEl.className = 'icon-font tc-icon-check';
            testEl.style.cssText = 'position:absolute;visibility:hidden;';
            document.body.appendChild(testEl);

            const style = window.getComputedStyle(testEl);
            const fontFamily = style.getPropertyValue('font-family');
            const content = window.getComputedStyle(testEl, '::before').getPropertyValue('content');

            document.body.removeChild(testEl);

            let result = `Font-family: ${fontFamily}\n`;
            result += `::before content: ${content}\n\n`;

            // Check stylesheets
            let foundFontFace = false;
            try {
              Array.from(document.styleSheets).forEach(sheet => {
                try {
                  Array.from(sheet.cssRules || []).forEach(rule => {
                    if (rule.cssText && rule.cssText.includes('icon-font')) {
                      foundFontFace = true;
                      result += `Found in stylesheet: ${sheet.href || 'inline'}\n`;
                    }
                  });
                } catch(e) {
                  // Cross-origin stylesheets
                }
              });
            } catch(e) {}

            result += foundFontFace ? '\n✅ icon-font CSS leitud!' : '\n❌ icon-font CSS pole leitud';

            alert(result);
          }}
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            background: '#3b82f6',
            color: 'white',
            cursor: 'pointer',
            fontSize: '13px',
            marginRight: '8px'
          }}
        >
          Kontrolli fondi saadavust
        </button>

        <button
          onClick={() => {
            // Try to find Unicode codes
            const icons = [
              'tc-icon-background',
              'tc-icon-eye-visibility',
              'tc-icon-check',
              'tc-icon-delete',
              'tc-icon-settings',
              'tc-icon-search'
            ];

            let results = 'Unicode koodid:\n\n';

            icons.forEach(iconClass => {
              const el = document.createElement('i');
              el.className = `icon-font ${iconClass}`;
              el.style.cssText = 'position:absolute;visibility:hidden;';
              document.body.appendChild(el);

              const content = window.getComputedStyle(el, '::before').getPropertyValue('content');
              results += `${iconClass}: ${content}\n`;

              document.body.removeChild(el);
            });

            alert(results);
          }}
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            background: '#8b5cf6',
            color: 'white',
            cursor: 'pointer',
            fontSize: '13px'
          }}
        >
          Leia Unicode koodid
        </button>
      </div>

      {/* Test Section 3: Console script */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
          Variant 3: Kopeeri script konsooli
        </h3>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
          Käivita see script Trimble Connecti konsolis (DevTools → Console):
        </p>

        <div style={{ position: 'relative' }}>
          <pre style={{
            background: '#1e293b',
            color: '#e2e8f0',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '11px',
            overflow: 'auto',
            maxHeight: '200px'
          }}>
{`// Leia kõik TC ikoonide Unicode koodid
const allIcons = [
  'tc-icon-background', 'tc-icon-eye-visibility',
  'tc-icon-delete', 'tc-icon-settings', 'tc-icon-check',
  'tc-icon-search', 'tc-icon-folder', 'tc-icon-measure',
  'tc-icon-ghost', 'tc-icon-transparency', 'tc-icon-show-all',
  'tc-icon-info', 'tc-icon-add-circle-outline'
];

const div = document.createElement('div');
div.style.cssText = 'position:fixed;top:10px;right:10px;background:white;padding:20px;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;overflow:auto;';
div.innerHTML = '<h3 style="margin:0 0 10px">TC Icons</h3><button onclick="this.parentElement.remove()" style="position:absolute;top:5px;right:5px;border:none;background:#eee;cursor:pointer;padding:4px 8px;border-radius:4px;">✕</button>' +
  allIcons.map(ic => \`
    <div style="display:flex;align-items:center;gap:10px;padding:5px;border-bottom:1px solid #eee;">
      <i class="icon-font \${ic}" style="font-size:24px;"></i>
      <code style="font-size:11px;">\${ic}</code>
    </div>
  \`).join('');
document.body.appendChild(div);`}
          </pre>
          <button
            onClick={() => {
              const code = `// Leia kõik TC ikoonide Unicode koodid
const allIcons = ['tc-icon-background', 'tc-icon-eye-visibility', 'tc-icon-delete', 'tc-icon-settings', 'tc-icon-check', 'tc-icon-search', 'tc-icon-folder', 'tc-icon-measure', 'tc-icon-ghost', 'tc-icon-transparency', 'tc-icon-show-all', 'tc-icon-info', 'tc-icon-add-circle-outline'];

const div = document.createElement('div');
div.style.cssText = 'position:fixed;top:10px;right:10px;background:white;padding:20px;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;overflow:auto;';
div.innerHTML = '<h3 style="margin:0 0 10px">TC Icons</h3><button onclick="this.parentElement.remove()" style="position:absolute;top:5px;right:5px;border:none;background:#eee;cursor:pointer;padding:4px 8px;border-radius:4px;">✕</button>' + allIcons.map(ic => '<div style="display:flex;align-items:center;gap:10px;padding:5px;border-bottom:1px solid #eee;"><i class="icon-font ' + ic + '" style="font-size:24px;"></i><code style="font-size:11px;">' + ic + '</code></div>').join('');
document.body.appendChild(div);`;
              navigator.clipboard.writeText(code);
            }}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              padding: '6px 12px',
              borderRadius: '4px',
              border: 'none',
              background: '#3b82f6',
              color: 'white',
              cursor: 'pointer',
              fontSize: '11px'
            }}
          >
            <FiCopy size={12} style={{ marginRight: '4px' }} />
            Kopeeri
          </button>
        </div>
      </div>

      {/* Modus Icons Section */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        border: '1px solid #e5e7eb'
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
          Modus Icons (CDN)
        </h3>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px' }}>
          Trimble Modus Icons laetud CDN-ist. Kasutamine: <code>&lt;i className="modus-icons"&gt;icon_name&lt;/i&gt;</code>
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '8px'
        }}>
          {[
            'apps', 'settings', 'search', 'check', 'close', 'add',
            'remove', 'edit', 'delete', 'save', 'download', 'upload',
            'folder', 'folder_open', 'file', 'visibility', 'visibility_off',
            'lock', 'lock_open', 'person', 'people', 'group',
            'calendar', 'schedule', 'event', 'alarm', 'notifications',
            'warning', 'error', 'info', 'help', 'check_circle',
            'cancel', 'refresh', 'sync', 'cloud', 'cloud_upload',
            'cloud_download', 'arrow_back', 'arrow_forward', 'arrow_upward', 'arrow_downward',
            'expand_more', 'expand_less', 'chevron_left', 'chevron_right',
            'menu', 'more_vert', 'more_horiz', 'filter_list', 'sort',
            'zoom_in', 'zoom_out', 'fullscreen', 'fullscreen_exit',
            'home', 'dashboard', 'list', 'view_list', 'grid_view',
            'table_view', 'print', 'share', 'link', 'copy',
            'content_copy', 'content_paste', 'drag_indicator', 'tune',
            'color_lens', 'palette', 'brush', 'format_paint',
            'location_on', 'map', 'layers', 'terrain', '3d_rotation',
            'view_in_ar', 'model_training', 'category', 'inventory',
            'construction', 'engineering', 'architecture', 'foundation'
          ].map(iconName => (
            <div
              key={iconName}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                background: '#f9fafb',
                borderRadius: '6px',
                border: '1px solid #e5e7eb'
              }}
            >
              <i className="modus-icons" style={{ fontSize: '20px', color: '#374151' }}>{iconName}</i>
              <code style={{ fontSize: '10px', color: '#6b7280', wordBreak: 'break-all' }}>
                {iconName}
              </code>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
          <p style={{ margin: 0, fontSize: '12px', color: '#166534' }}>
            <strong>Kasutamine React-is:</strong><br/>
            <code style={{ fontSize: '11px' }}>&lt;i className="modus-icons"&gt;settings&lt;/i&gt;</code><br/>
            <code style={{ fontSize: '11px' }}>&lt;i className="modus-icons" style=&#123;&#123; fontSize: '24px' &#125;&#125;&gt;folder&lt;/i&gt;</code>
          </p>
        </div>
      </div>

      {/* Info Section */}
      <div style={{
        background: '#eff6ff',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid #bfdbfe'
      }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: '600', color: '#1e40af' }}>
          ℹ️ Kuidas kasutada TC ikoone oma extensionis
        </h4>
        <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#1e40af', lineHeight: '1.6' }}>
          <li>Kui ikoonid kuvatakse siin korrektselt, saad kasutada <code>&lt;i class="icon-font tc-icon-xxx"&gt;</code></li>
          <li>Kui ikoonid EI kuva, pead fondi faili kopeerima oma reposse</li>
          <li>Vaata Network tabist .woff või .woff2 faile</li>
          <li>Loo @font-face CSS ja viita oma fondi failile</li>
        </ol>
      </div>
    </div>
  );
}
