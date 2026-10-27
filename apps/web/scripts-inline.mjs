// Junta o build da demonstração num único HTML (CSS e JS embutidos) para publicação.
import fs from 'node:fs';
import path from 'node:path';
const dir = 'dist-demo';
const html = fs.readFileSync(path.join(dir, 'demo.html'), 'utf8');
const js = html.match(/<script[^>]*src="([^"]+)"[^>]*><\/script>/);
const css = html.match(/<link[^>]*href="([^"]+\.css)"[^>]*>/);
const read = (p) => fs.readFileSync(path.join(dir, p.replace(/^\//, '')), 'utf8');
const script = read(js[1]).replace(/<\/script/gi, '<\\/script');
const style = css ? read(css[1]).replace(/<\/style/gi, '<\\/style') : '';
const out = `<title>Bar do Guto Demo</title>
<meta name="description" content="Demonstração interativa do sistema de gestão do Bar do Guto">
<style>${style}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
fs.writeFileSync(process.argv[2], out);
console.log('gerado', process.argv[2], (out.length / 1024).toFixed(0) + ' KB');
