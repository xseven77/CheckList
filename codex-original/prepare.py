from pathlib import Path
import re, html
root=Path(__file__).parent
source=Path('/Users/qiizo/.codex/attachments/0a9cb1fa-eb4d-4317-97a0-c26d2db0912e/wedding-timeline.html').read_text()
m=re.search(r'data-srcdoc="([\s\S]*?)"',source)
original=html.unescape(m.group(1))
inner=original.replace('</body>','<script>\n'+(root/'checklist.js').read_text()+'\n</script>\n</body>')
out=source[:m.start(1)]+html.escape(inner,quote=True)+source[m.end(1):]
out=out.replace('</body>','<script>\n'+(root/'export-host.js').read_text()+'\n</script>\n</body>')
csp=lambda s:re.findall(r'<meta http-equiv="Content-Security-Policy"[^>]+>',s)
assert csp(source)==csp(out) and csp(original)==csp(inner)
assert re.findall(r'sandbox="[^"]*"',source)==re.findall(r'sandbox="[^"]*"',out)
(root/'dist/index.html').write_text(out)
print('Prepared static site; original iframe sandbox and both CSP policies preserved.')
