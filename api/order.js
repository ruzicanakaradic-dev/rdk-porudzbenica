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

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      cart,
      total,
      name,
      phone,
      delivery,
      address,
      dateISO,
      time,
      occasion,
      notes
    } = req.body;

    // Validate required fields
    if (!Array.isArray(cart) || !cart.length || !name || !phone || !delivery || !dateISO) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci.' });
    }
    if (cart.some(item => !item || typeof item !== 'object')) {
      return res.status(400).json({ error: 'Neispravna porudžbina.' });
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

    // Build cart rows for email
    const cartRows = cart.map(item => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#2D2A33;">${esc(item.product)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:13px;color:#6B6573;">${esc(item.catName)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#7B5EA7;font-weight:600;text-align:right;">${num(item.qty)} ${esc(item.unit)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#7B5EA7;font-weight:600;text-align:right;">${(num(item.qty) * num(item.price)).toLocaleString('sr-RS')} RSD</td>
      </tr>
    `).join('');

    // Delivery cost note
    const deliveryCostNote = delivery === 'Lično preuzimanje'
      ? ''
      : num(total) >= 10000
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
          <p style="font-size:28px;font-weight:700;color:#4A3566;margin:0;">${num(total).toLocaleString('sr-RS')} RSD</p>
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
