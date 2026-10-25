const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const photoPaths = [...html.matchAll(/photo:'([^']+)'/g)].map(match => match[1]);
assert.equal(new Set(photoPaths).size, photoPaths.length, 'every drink and product card has its own image');
for (const photoPath of photoPaths) assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', photoPath)), `image exists: ${photoPath}`);
assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', 'assets/photos/hero-spa.webp')), 'local hero image exists');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'inline menu script exists');

function element() {
  const listeners = {};
  const classes = new Set();
  return {
    innerHTML: '', textContent: '', value: '', dataset: {}, listeners,
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? classes.delete(name) : classes.add(name)) : (force ? classes.add(name) : classes.delete(name)),
      contains: name => classes.has(name),
    },
    addEventListener: (name, callback) => { listeners[name] = callback; },
    scrollIntoView() {},
  };
}

const ids = new Map();
const filters = ['all', 'coffee', 'tea', 'water'].map(value => Object.assign(element(), { dataset: { filter: value } }));
const tips = [200, 500, 1000].map(value => Object.assign(element(), { dataset: { amount: String(value) } }));
const document = {
  getElementById(id) { if (!ids.has(id)) ids.set(id, element()); return ids.get(id); },
  querySelectorAll(selector) { return selector === '[data-filter]' ? filters : selector === '.tip-choice' ? tips : []; },
  addEventListener() {},
};
const context = { document, Intl, Number, Date, Array, String, Math, setTimeout, clearTimeout, console };
context.window = context;
context.adminRequestAdapter = { send: async () => ({ accepted: false, reason: 'not_configured' }) };
vm.createContext(context);
vm.runInContext(inline, context);

const run = expression => vm.runInContext(expression, context);
async function main() {
assert.equal((ids.get('drink-grid').innerHTML.match(/class="item-card"/g) || []).length, 8, 'eight demo drinks render');
filters.find(x => x.dataset.filter === 'tea').listeners.click();
assert.match(ids.get('drink-grid').innerHTML, /Чёрный чай/);
assert.doesNotMatch(ids.get('drink-grid').innerHTML, /Американо/);
filters.find(x => x.dataset.filter === 'coffee').listeners.click();
assert.match(ids.get('drink-grid').innerHTML, /Капучино/);
assert.doesNotMatch(ids.get('drink-grid').innerHTML, /Зелёный чай/);
filters.find(x => x.dataset.filter === 'water').listeners.click();
assert.match(ids.get('drink-grid').innerHTML, /Вода без газа/);
assert.doesNotMatch(ids.get('drink-grid').innerHTML, /Американо/);
filters.find(x => x.dataset.filter === 'all').listeners.click();

run("addItem('americano','drink'); addItem('americano','drink'); addItem('cream','product'); addItem('massage','service')");
assert.equal(run('cart.length'), 3, 'repeated item increments rather than duplicates');
assert.equal(run("cart.find(x=>x.id==='americano').qty"), 2);
run('openCart()');
assert.match(ids.get('drawer-content').innerHTML, /1\s490 ₽/);
run('changeQty(0, -1)');
assert.equal(run("cart.find(x=>x.id==='americano').qty"), 1);
run('removeItem(1)');
assert.equal(run('cart.length'), 2, 'individual row can be removed');

run("document.getElementById('custom-tip').value='-5'; addTip()");
assert.equal(run('cart.length'), 2, 'negative tip rejected');
run("document.getElementById('custom-tip').value='49'; addTip()");
assert.equal(run('cart.length'), 2, 'tip below configured minimum rejected');
run("document.getElementById('custom-tip').value=''; addTip()");
assert.equal(run('cart.length'), 2, 'empty custom tip rejected');
run("document.getElementById('custom-tip').value='not-a-number'; addTip()");
assert.equal(run('cart.length'), 2, 'invalid custom tip rejected');
run("document.getElementById('custom-tip').value='350'; addTip()");
assert.equal(run("cart.find(x=>x.id==='tip').price"), 350, 'valid custom tip added');
run("cart[0].comment='<note>'; renderCart()");
assert.match(ids.get('drawer-content').innerHTML, /&lt;note&gt;/, 'comments are escaped in markup');
run("customerName='Алексей'; customerPhone='+7 900 123-45-67'; window.adminRequestAdapter.send=async payload=>({accepted:true,requestId:42,telegramSent:false})");
await run('sendDraft()');
assert.match(ids.get('drawer-content').innerHTML, /Заявка №42 сохранена/i);
assert.equal(run('cart.length'), 3, 'unavailable submission keeps the selection');
assert.equal(run('window.lastRequestDraft.customer.name'), 'Алексей');
assert.equal(run("window.lastRequestDraft.customer.phone"), '+7 900 123-45-67');
assert.ok(run('window.lastRequestDraft.createdAt'));
run("window.adminRequestAdapter.send=async()=>{throw new Error('network')}");
await run('sendDraft()');
assert.match(ids.get('drawer-content').innerHTML, /Не удалось отправить заявку/);
assert.equal(run('cart.length'), 3, 'failed attempt keeps the selection for retry');
run('clearCart()');
assert.equal(run('cart.length'), 0, 'clear removes all items');
assert.match(ids.get('drawer-content').innerHTML, /Пока ничего не выбрано/);
run("addItem('still-water','drink'); openCart()");
assert.match(ids.get('drawer-content').innerHTML, /Комплимент от салона/);
assert.doesNotMatch(ids.get('drawer-content').innerHTML, /0 ₽/);

console.log('Menu smoke checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
