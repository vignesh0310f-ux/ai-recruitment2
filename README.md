# AI Recruitment Platform

A full AI-powered hiring assessment system built with React.

## Features
- HR secure login (password: `hr@admin2026`)
- AI-generated assessments from job descriptions
- Timed candidate tests (MCQ + Short Answer + Scenarios)
- AI scoring with strengths/weaknesses analysis
- Leaderboard with override functionality
- Shareable candidate test link

## Deploy to Vercel (Recommended - Free)

1. Go to [vercel.com](https://vercel.com) and sign up free
2. Click "Add New Project"
3. Upload this zip / connect GitHub repo
4. Click Deploy — done!

## Deploy to Netlify (Alternative - Free)

1. Go to [netlify.com](https://netlify.com)
2. Drag and drop the `build` folder after running `npm run build`

## Run Locally

```bash
npm install
npm start
```

## Build for Production

```bash
npm run build
```

## Notes
- HR Password: `hr@admin2026`
- Data is stored in localStorage on deployed version
- All AI scoring uses Claude claude-sonnet-4-20250514
