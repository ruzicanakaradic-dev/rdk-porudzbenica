import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Minimalni rok porudžbine u danima — isti broj stoji i u public/index.html
const MIN_LEAD_DAYS = 5;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];

// Najraniji dozvoljeni datum isporuke (YYYY-MM-DD), računato po srpskom vremenu
function minDeliveryDate() {
  const now = new Date();
  let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, d = now.getUTCDate();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const get = type => Number(parts.find(p => p.type === type).value);
    y = get('year'); m = get('month'); d = get('day');
  } catch (_) {}
  return new Date(Date.UTC(y, m - 1, d + MIN_LEAD_DAYS)).toISOString().slice(0, 10);
}

// Da li je string stvaran kalendarski datum u formatu YYYY-MM-DD
function isValidISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// 2026-10-11 -> "11. okt. 2026."
function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return `${d}. ${MONTHS[m - 1]}. ${y}.`;
}

// Sve što je kupac uneo ide u email kao običan tekst, da niko ne može da podmetne HTML (linkove, slike, skripte)
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Broj iz unosa; sve što nije broj postaje 0
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// --- Cenovnik: ista Google tabela i ista pravila kao u formi (public/index.html) ---
const SHEET_ID = '1DYsLCakk2BdCkfYC2fSrr0esW6nMXYJkimZW19ADjiM';
const PRODUCTS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Proizvodi&range=A4:F100&headers=1`;
const CATEGORIES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Kategorije&range=A4:E20&headers=1`;
const MAX_QTY = 20; // isto ograničenje kao u formi

function parseGSheets(text) {
  const json = JSON.parse(text.substring(text.indexOf('(') + 1, text.lastIndexOf(')')));
  const result = [];
  json.table.rows.forEach(r => {
    if (!r.c) return;
    const vals = r.c.map(cell => cell ? (cell.v !== null ? cell.v : '') : '');
    if (vals.some(v => v !== '')) result.push(vals);
  });
  return result;
}

// Važeći cenovnik: Map(naziv kategorije -> { price, min, unit, items }), ili null ako tabela nije dostupna
async function loadPriceList() {
  try {
    const getRows = async url => {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseGSheets(await r.text());
    };
    const [catRows, prodRows] = await Promise.all([getRows(CATEGORIES_URL), getRows(PRODUCTS_URL)]);
    // Kategorije: col0=Naziv, col1=Cena, col2=Min, col3=Aktivan; Proizvodi: col0=Kategorija, col1=Naziv, col4=Aktivan
    const list = new Map();
    catRows.forEach(cr => {
      if (String(cr[3] || '').trim() !== 'DA') return;
      const name = String(cr[0] || '').trim();
      if (!name) return;
      const items = prodRows
        .filter(p => String(p[0] || '').trim() === name && String(p[4] || '').trim() === 'DA')
        .map(p => String(p[1] || '').trim())
        .filter(n => n);
      if (!items.length) return;
      const price = typeof cr[1] === 'number' ? cr[1] : parseInt(String(cr[1]).replace(/[^0-9]/g, ''));
      if (!Number.isFinite(price)) return;
      const minRaw = String(cr[2] || '2 kg');
      list.set(name, { price, min: parseFloat(minRaw) || 2, unit: minRaw.includes('box') ? 'box' : 'kg', items });
    });
    return list.size ? list : null;
  } catch (err) {
    console.error('Price list unavailable:', err);
    return null;
  }
}

// --- Zaštita od lažnih porudžbina ---
const MIN_FILL_MS = 8000;             // niko ne može stvarno da popuni formu brže od 8 sekundi
const MAX_ORDERS_PER_IP = 3;          // najviše 3 porudžbine sa iste mreže (IP adrese) ...
const IP_WINDOW_MS = 10 * 60 * 1000;  // ... u 10 minuta
const MAX_ORDERS_PER_HOUR = 30;       // i najviše 30 ukupno na sat, ako neko šalje sa mnogo adresa
// Brojanje se pamti samo dok je server aktivan; posle duže pauze kreće iz početka
const recentOrders = [];              // [{ ip, at }]

// Isti tekstovi kao u padajućem meniju forme — ako se doda nov grad, dodati ga i ovde
const DELIVERY_OPTIONS = ['Dostava — Beograd', 'Dostava — Novi Sad', 'Dostava — Inđija', 'Lično preuzimanje'];

// Najveća dozvoljena dužina tekstualnih polja (ista ograničenja ima i forma)
const MAX_LEN = { name: 100, phone: 30, delivery: 50, address: 200, time: 50, occasion: 50, notes: 1000 };

function clientIp(req) {
  return String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0].trim();
}

// Proverava ograničenje i odmah beleži porudžbinu; vraća true ako je ograničenje prekoračeno
function overLimit(ip, now = Date.now()) {
  while (recentOrders.length && now - recentOrders[0].at > 60 * 60 * 1000) recentOrders.shift();
  const fromIp = recentOrders.filter(o => o.ip === ip && now - o.at < IP_WINDOW_MS).length;
  if (recentOrders.length >= MAX_ORDERS_PER_HOUR || fromIp >= MAX_ORDERS_PER_IP) return true;
  recentOrders.push({ ip, at: now });
  return false;
}

// Telefon: cifre i + ( ) - . /, od 6 do 15 cifara; razmaci i nevidljivi znakovi (kopiranje iz imenika) se zanemaruju
function isValidPhone(s) {
  const clean = s.replace(/[\s​-‏‪-‮⁠﻿]/g, '');
  const digits = clean.replace(/\D/g, '').length;
  return /^[0-9+()\-./]+$/.test(clean) && digits >= 6 && digits <= 15;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { cart, total, dateISO, hp, elapsedMs } = body;
    const fields = {};
    for (const key of Object.keys(MAX_LEN)) fields[key] = String(body[key] ?? '').trim();
    const { name, phone, delivery, address, time, occasion, notes } = fields;

    // Skriveno polje koje ljudi ne vide, a botovi popune: odgovaramo "uspešno", ali ništa ne šaljemo
    if (hp) {
      console.warn('Spam blocked (hidden field) from', clientIp(req));
      return res.status(200).json({ success: true });
    }
    // Forma popunjena prebrzo ili porudžbina poslata mimo forme
    if (!(num(elapsedMs) >= MIN_FILL_MS)) {
      console.warn('Spam blocked (too fast) from', clientIp(req));
      return res.status(400).json({ error: 'Porudžbina nije poslata. Osvežite stranicu i pokušajte ponovo.' });
    }

    // Validate required fields
    if (!Array.isArray(cart) || !cart.length || !name || !phone || !delivery || !dateISO) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci.' });
    }
    if (cart.length > 50 || cart.some(item => !item || typeof item !== 'object')) {
      return res.status(400).json({ error: 'Neispravna porudžbina.' });
    }
    if (Object.keys(MAX_LEN).some(key => fields[key].length > MAX_LEN[key])) {
      return res.status(400).json({ error: 'Neki od unetih podataka je predugačak.' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Unesite ispravan broj telefona.' });
    }
    if (!DELIVERY_OPTIONS.includes(delivery)) {
      return res.status(400).json({ error: 'Izaberite način preuzimanja.' });
    }
    if (delivery !== 'Lično preuzimanje' && !address) {
      return res.status(400).json({ error: 'Unesite adresu za dostavu.' });
    }

    // Validate delivery date against the minimum lead time
    if (!isValidISODate(dateISO)) {
      return res.status(400).json({ error: 'Neispravan datum isporuke. Izaberite datum ponovo.' });
    }
    const minDate = minDeliveryDate();
    if (dateISO < minDate) {
      return res.status(400).json({
        error: `Rok za porudžbinu je najmanje ${MIN_LEAD_DAYS} dana. Najraniji mogući datum isporuke je ${fmtDate(minDate)}`
      });
    }
    // Datum u emailu se pravi od proverenog datuma, ne od teksta koji je poslao pregledač
    const date = fmtDate(dateISO);

    // Cene i količine se proveravaju po važećem cenovniku — cena koju pošalje pregledač se ne koristi
    const priceList = await loadPriceList();
    const items = [];
    for (const item of cart) {
      const product = String(item.product ?? '').trim();
      const catName = String(item.catName ?? '').trim();
      const qty = Number(item.qty);
      const cat = priceList && priceList.get(catName);
      if (priceList && (!cat || !cat.items.includes(product))) {
        return res.status(400).json({ error: `Proizvod „${product.slice(0, 60)}“ trenutno nije dostupan. Osvežite stranicu i izaberite ponovo.` });
      }
      if (!Number.isFinite(qty) || qty <= 0 || qty < (cat ? cat.min : 0) - 1e-9 || qty > MAX_QTY) {
        return res.status(400).json({ error: `Neispravna količina za „${product.slice(0, 60)}“. Osvežite stranicu i pokušajte ponovo.` });
      }
      items.push({
        product,
        catName,
        qty,
        unit: cat ? cat.unit : String(item.unit ?? '').slice(0, 10),
        price: cat ? cat.price : num(item.price)
      });
    }
    const orderTotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);

    // Upozorenje u emailu ako cene nisu mogle da se provere ili se razlikuju od onoga što je kupac video
    const shownTotal = num(total);
    const priceWarning = !priceList
      ? 'Cene NISU proverene jer Google tabela trenutno nije bila dostupna. Ispod su cene koje je poslao pregledač kupca — proverite ih po cenovniku pre potvrde.'
      : Math.round(shownTotal) !== Math.round(orderTotal)
        ? `Kupac je u formi video ukupno ${shownTotal.toLocaleString('sr-RS')} RSD, a po važećem cenovniku iznos je ${orderTotal.toLocaleString('sr-RS')} RSD. U ovom emailu su važeće cene.`
        : '';

    // Ograničenje broja porudžbina (proverava se tek kada je porudžbina ispravna)
    const ip = clientIp(req);
    if (overLimit(ip)) {
      console.warn('Rate limit hit for', ip);
      return res.status(429).json({ error: 'Primili smo previše porudžbina u kratkom roku. Pokušajte ponovo za nekoliko minuta ili nam pišite direktno u DM.' });
    }

    // Build cart rows for email
    const cartRows = items.map(item => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#2D2A33;">${esc(item.product)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:13px;color:#6B6573;">${esc(item.catName)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#7B5EA7;font-weight:600;text-align:right;">${item.qty} ${esc(item.unit)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#7B5EA7;font-weight:600;text-align:right;">${(item.qty * item.price).toLocaleString('sr-RS')} RSD</td>
      </tr>
    `).join('');

    // Delivery cost note
    const deliveryCostNote = delivery === 'Lično preuzimanje'
      ? ''
      : orderTotal >= 10000
        ? '<p style="color:#27AE60;font-weight:500;">✓ Besplatna dostava</p>'
        : '<p style="color:#C9A96E;">Cenu dostave dogovoriti po lokaciji</p>';

    // Build email HTML
    const emailHtml = `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#FAF6F0;">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#4A3566,#7B5EA7);padding:32px 24px;text-align:center;border-radius:12px 12px 0 0;">
        <h1 style="color:#fff;font-size:24px;margin:0 0 4px;">🎂 Nova porudžbina!</h1>
        <p style="color:rgba(255,255,255,0.75);font-size:14px;margin:0;">Ružini Domaći Kolači</p>
      </div>
${priceWarning ? `
      <!-- Price warning -->
      <div style="background:#FFF4E5;padding:16px 24px;border-left:4px solid #E67E22;">
        <p style="color:#8A4B08;font-size:14px;line-height:1.5;margin:0;"><strong>⚠ Proverite cene:</strong> ${priceWarning}</p>
      </div>
` : ''}
      <!-- Customer info -->
      <div style="background:#fff;padding:24px;border-bottom:1px solid #E8E2EE;">
        <h2 style="color:#4A3566;font-size:16px;margin:0 0 16px;">Podaci o kupcu</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;width:120px;">Ime i prezime</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${esc(name)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Telefon</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${esc(phone)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Preuzimanje</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${esc(delivery)}</td>
          </tr>
          ${address ? `<tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Adresa</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${esc(address)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Datum isporuke</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${date}</td>
          </tr>
          ${time ? `<tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Vreme</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${esc(time)}</td>
          </tr>` : ''}
          ${occasion ? `<tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Povod</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${esc(occasion)}</td>
          </tr>` : ''}
        </table>
      </div>

      <!-- Products -->
      <div style="background:#fff;padding:24px;">
        <h2 style="color:#4A3566;font-size:16px;margin:0 0 16px;">Poručeni proizvodi</h2>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#F5EDE0;">
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6B6573;text-transform:uppercase;letter-spacing:1px;">Proizvod</th>
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6B6573;text-transform:uppercase;letter-spacing:1px;">Kategorija</th>
              <th style="padding:10px 16px;text-align:right;font-size:12px;color:#6B6573;text-transform:uppercase;letter-spacing:1px;">Količina</th>
              <th style="padding:10px 16px;text-align:right;font-size:12px;color:#6B6573;text-transform:uppercase;letter-spacing:1px;">Cena</th>
            </tr>
          </thead>
          <tbody>
            ${cartRows}
          </tbody>
        </table>

        <!-- Total -->
        <div style="background:linear-gradient(135deg,rgba(123,94,167,0.06),rgba(201,169,110,0.08));border-radius:10px;padding:16px;margin-top:16px;text-align:center;">
          <p style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6B6573;margin:0 0 4px;">Okvirna cena proizvoda</p>
          <p style="font-size:28px;font-weight:700;color:#4A3566;margin:0;">${orderTotal.toLocaleString('sr-RS')} RSD</p>
          ${deliveryCostNote}
        </div>
      </div>

      ${notes ? `
      <!-- Notes -->
      <div style="background:#fff;padding:24px;border-top:1px solid #E8E2EE;">
        <h2 style="color:#4A3566;font-size:16px;margin:0 0 8px;">Napomena kupca</h2>
        <p style="color:#2D2A33;font-size:14px;line-height:1.6;margin:0;background:#FAF6F0;padding:12px 16px;border-radius:8px;">${esc(notes).replace(/\r?\n/g, '<br>')}</p>
      </div>` : ''}

      <!-- Footer -->
      <div style="padding:20px 24px;text-align:center;border-radius:0 0 12px 12px;">
        <p style="color:#C4B1D9;font-size:12px;margin:0;">Porudžbina primljena putem online forme · Ružini Domaći Kolači</p>
      </div>
    </div>
    `;

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Porudžbine RDK <onboarding@resend.dev>',
      to: [process.env.RESEND_TO_EMAIL || 'ruzinidomacikolaci@gmail.com'],
      // Naslov je običan tekst: bez novih redova i ograničene dužine
      subject: `🎂 Nova porudžbina — ${String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80)} (${date})`,
      html: emailHtml,
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Greška pri slanju emaila.' });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Serverska greška.' });
  }
}
