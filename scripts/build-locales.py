from pathlib import Path
import json
data=json.loads(Path('extension/lib/locales.json').read_text())
Path('extension/lib/locales.js').write_text('export const CATALOGS = '+json.dumps(data,ensure_ascii=False,indent=2)+';\n')
