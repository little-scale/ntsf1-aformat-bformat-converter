"""Assemble the distributable single HTML file; no runtime external files."""
import base64
import json
from pathlib import Path
REPO=Path(__file__).resolve().parent.parent
ROOT=REPO/'src/standalone'
source=ROOT.parent/'browser'/'dist'
worker=(ROOT/'runtime_worker.js').read_text().replace('__WASM_BASE64__',base64.b64encode((ROOT/'ntsf1.wasm').read_bytes()).decode())
html=(source/'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','<style>'+ (source/'style.css').read_text()+'</style>')
html=html.replace('<script src="/app.js"></script>', '<script>const WORKER_SOURCE='+json.dumps(worker).replace('</','<\\/')+';</script><script>'+(ROOT/'bridge.js').read_text().replace('</','<\\/')+'</script><script>'+(ROOT/'app.js').read_text().replace('</','<\\/')+'</script>')
html=html.replace('</body>', '<script>'+(ROOT/'omnitone.min.js').read_text().replace('</','<\\/')+'</script><script>'+(ROOT/'audio_preview.js').read_text()+'</script></body>')
import html as html_module
html=html.replace('<pre id="decoder-license"></pre>', '<pre id="decoder-license">'+html_module.escape((ROOT/'OMNITONE_LICENSE.txt').read_text())+'</pre>')
html=html.replace('</body>', '<script>'+(ROOT/'frequency_colour.js').read_text()+'</script></body>')
html=html.replace('</body>', '<script>'+(ROOT/'sphere.js').read_text()+'</script></body>')
html=html.replace('Your audio stays on this computer.','All processing stays in your browser. No server or uploads.')
html=html.replace('W-channel LUFS and true peak','W-channel LUFS and estimated true peak')
html=html.replace('<footer>A-format', '<footer>Self-contained browser converter · A-format')
output=REPO/'index.html';output.write_text(html)
print(f'{output.resolve()} ({output.stat().st_size:,} bytes)')
