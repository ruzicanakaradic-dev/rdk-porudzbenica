import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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
      date,
      time,
      occasion,
      notes
    } = req.body;

    // Validate required fields
    if (!cart || !cart.length || !name || !phone || !delivery || !date) {
      return res.status(400).json({ error: 'Nedostaju obavezni podaci.' });
    }

    // Build cart rows for email
    const cartRows = cart.map(item => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#2D2A33;">${item.product}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:13px;color:#6B6573;">${item.catName}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#7B5EA7;font-weight:600;text-align:right;">${item.qty} ${item.unit}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #F0EBF3;font-size:14px;color:#7B5EA7;font-weight:600;text-align:right;">${(item.qty * item.price).toLocaleString('sr-RS')} RSD</td>
      </tr>
    `).join('');

    // Delivery cost note
    const deliveryCostNote = delivery === 'Lično preuzimanje'
      ? ''
      : total >= 10000
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
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${name}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Telefon</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${phone}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Preuzimanje</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${delivery}</td>
          </tr>
          ${address ? `<tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Adresa</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${address}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Datum isporuke</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${date}</td>
          </tr>
          ${time ? `<tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Vreme</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${time}</td>
          </tr>` : ''}
          ${occasion ? `<tr>
            <td style="padding:6px 0;color:#6B6573;font-size:13px;">Povod</td>
            <td style="padding:6px 0;color:#2D2A33;font-size:14px;font-weight:600;">${occasion}</td>
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
          <p style="font-size:28px;font-weight:700;color:#4A3566;margin:0;">${total.toLocaleString('sr-RS')} RSD</p>
          ${deliveryCostNote}
        </div>
      </div>

      ${notes ? `
      <!-- Notes -->
      <div style="background:#fff;padding:24px;border-top:1px solid #E8E2EE;">
        <h2 style="color:#4A3566;font-size:16px;margin:0 0 8px;">Napomena kupca</h2>
        <p style="color:#2D2A33;font-size:14px;line-height:1.6;margin:0;background:#FAF6F0;padding:12px 16px;border-radius:8px;">${notes}</p>
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
      subject: `🎂 Nova porudžbina — ${name} (${date})`,
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
