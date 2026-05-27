# RDK Porudžbenica — Vercel Projekat

## Struktura
```
rdk-vercel/
├── api/
│   └── order.js          ← Serverless function (šalje email)
├── public/
│   └── index.html        ← Forma za poručivanje
├── package.json
├── vercel.json
└── README.md
```

## Deploy na Vercel — korak po korak

### 1. Postavi fajlove na GitHub
- Napravi **novi repo** na GitHubu (npr. `rdk-porudzbenica`)
- Upload-uj sve fajlove iz ovog foldera

### 2. Deploy na Vercel
- Idi na **vercel.com/new**
- Izaberi novi GitHub repo
- Framework Preset: **Other**
- Klikni **Deploy**

### 3. Dodaj Environment Variables
U Vercel dashboard-u za ovaj projekat:
**Settings → Environment Variables** — dodaj:

| Key | Value | Opis |
|-----|-------|------|
| `RESEND_API_KEY` | `re_xxxx...` | Tvoj Resend API key |
| `RESEND_TO_EMAIL` | `ruzica@email.com` | Email na koji stižu porudžbine |
| `RESEND_FROM_EMAIL` | `Porudžbine RDK <onboarding@resend.dev>` | Pošiljalac (ili custom domen) |

**VAŽNO:** Posle dodavanja varijabli, klikni **Redeploy** da se primene.

### 4. Resend setup
- Napravi nalog na **resend.com**
- Za početak koristi njihov test domen (`onboarding@resend.dev`)
- Kasnije dodaj custom domen za profesionalniji izgled emailova

## Kako radi
1. Kupac otvara formu
2. Forma čita proizvode iz **Google Sheets-a** (dinamički)
3. Kupac popunjava i šalje porudžbinu
4. Vercel serverless function prima podatke
5. Resend API šalje **formatiran email** Ružici
6. Kupac vidi potvrdu na formi

## Google Sheets
Sheet ID: `1DYsLCakk2BdCkfYC2fSrr0esW6nMXYJkimZW19ADjiM`
Ružica menja proizvode u Sheet-u → forma automatski prikazuje ažurirane podatke.
