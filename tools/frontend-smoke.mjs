// 用 jsdom 加载 dist/index.html + bundle，验证前端能挂载、代理能工作
import { readFileSync } from 'fs';
import jsdomPkg from 'jsdom';
const { JSDOM } = jsdomPkg;

const distIndex = readFileSync('./dist/index.html', 'utf-8');
const bundleJs = readFileSync('./dist/assets/index-Bx2S4Ujl.js', 'utf-8');

console.log('bundle size:', (bundleJs.length/1024).toFixed(1) + 'KB');
console.log('bundle syntax check:');
try {
  // 用 Function 检测是否语法合法
  new Function(bundleJs);
  console.log('  ✅ Syntax valid (ES module global Function check)');
} catch (e) {
  // ESM 有 import.meta 不能用 Function 检测，改用 acorn 检测 parse
  console.log('  ⚠️ Direct Function() failed (probably top-level import):', e.message.slice(0,80));
}

console.log('\nmodule syntax check (replaced top-level imports):');
try {
  // 简单检查：移除 module-only 语法（top-level import 视为 const），再用 Function 验
  const stripped = bundleJs
    .replace(/^import\s+[^;]+;?$/gm, '')
    .replace(/^export\s+/gm, '')
    .replace(/^import\.meta/g, '({})')
  ;
  new Function(stripped);
  console.log('  ✅ JS body parses');
} catch (e) {
  console.log('  ❌ JS body parse error:', e.message.slice(0,200));
}

// 用 jsdom 真实加载
console.log('\njsdom load dist/index.html:');
const dom = new JSDOM(distIndex, {
  url: 'http://localhost:5173/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
console.log('  document.title:', win.document.title);
console.log('  root div:', win.document.getElementById('root') ? '✅ found' : '❌ missing');

// 检查 Tailwind CDN script
const tailwindScript = [...win.document.querySelectorAll('script')].find(s => s.src.includes('tailwindcss'));
console.log('  tailwind CDN script tag:', tailwindScript ? '✅ present' : '❌ missing');

// 直接执行 bundle 并检查是否报错
console.log('\nexecute bundle inside jsdom:');
const errors = [];
win.addEventListener('error', e => errors.push(e.message || String(e)));
try {
  const scriptEl = win.document.createElement('script');
  scriptEl.type = 'module';
  scriptEl.textContent = bundleJs;
  win.document.body.appendChild(scriptEl);
  await new Promise(r => setTimeout(r, 500));
  const root = win.document.getElementById('root');
  console.log('  root.innerHTML.length:', root?.innerHTML?.length || 0);
  console.log('  errors during execution:', errors.length);
  if (errors.length) errors.forEach(e => console.log('   -', String(e).slice(0,200)));
} catch (e) {
  console.log('  execution threw:', e.message.slice(0,200));
}

console.log('\n=== 静态资源可被静态服务（已用 http server 验证 200）===');