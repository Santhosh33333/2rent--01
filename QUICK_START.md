# 🚀 Quick Start Guide

Get RentBuddy running in 5 minutes!

---

## Prerequisites

```bash
# Required
- Node.js 18+
- npm or yarn
- Git

# Optional (for database)
- PostgreSQL 14+ (production)
- SQLite (included, for development)
```

---

## Setup (First Time)

### 1. Clone & Install

```bash
git clone <repo-url>
cd rent-01-17-07-2025
npm install
```

### 2. Backend Setup

```bash
cd packages/backend

# Install dependencies
npm install

# Setup database
npm run prisma:generate
npm run prisma:migrate

# Create .env file
cp .env.example .env
# Edit .env with your settings
```

### 3. Frontend Setup

```bash
cd ../web

# Install dependencies
npm install

# No additional setup needed!
```

---

## Running the App

### Start Backend

```bash
cd packages/backend
npm run dev
```

**Expected Output:**
```
✓ Server running on http://localhost:3000
✓ Health check: http://localhost:3000/health
```

### Start Frontend (New Terminal)

```bash
cd packages/web
npm run dev
```

**Expected Output:**
```
✓ Local: http://localhost:5173
✓ Press 'q' to quit
```

### Open App

Visit: http://localhost:5173

---

## Build for Production

### Backend

```bash
cd packages/backend
npm run build
npm start  # Run production build
```

### Frontend

```bash
cd packages/web
npm run build
# dist/ folder ready for deployment
```

---

## Testing

### Run API Tests

```bash
cd packages/backend
npm run test
```

**Tests Coverage:**
- ✅ Authentication
- ✅ KYC verification
- ✅ Search
- ✅ Notifications
- ✅ Bookings
- ✅ All 110+ endpoints

### Manual Testing Checklist

1. **Registration**
   - Visit http://localhost:5173/register
   - Fill form and submit
   - Verify email (dev: check console)

2. **Login**
   - Visit http://localhost:5173/login
   - Use registered credentials

3. **KYC**
   - Navigate to /verification
   - Complete 7 steps
   - Submit

4. **Search**
   - Click search in header
   - Type query
   - See results + autocomplete

5. **Notifications**
   - Go to /notifications
   - Verify list loads

6. **Dark Mode**
   - Click moon icon in header
   - Theme persists after refresh

7. **Booking** (if partner exists)
   - Go to /bookings
   - Create booking
   - Complete payment flow

---

## Project Structure

```
rent-01-17-07-2025/
├── packages/
│   ├── backend/              # Express API
│   │   ├── src/
│   │   │   ├── routes/      # 100+ endpoints
│   │   │   ├── controllers/ # Business logic
│   │   │   ├── middleware/  # Auth, validation
│   │   │   └── app.ts       # Express setup
│   │   ├── prisma/          # Database
│   │   └── tests/           # Integration tests
│   │
│   └── web/                 # React Frontend
│       ├── src/
│       │   ├── pages/       # 30+ pages
│       │   ├── components/  # Reusable UI
│       │   ├── lib/         # Contexts, hooks
│       │   └── App.tsx      # Router setup
│       └── public/
│
├── TEST_RUNNER.md           # Test documentation
├── VERIFICATION_CHECKLIST.md # 16 tasks verified
├── PRODUCTION_READY.md       # Deployment guide
└── QUICK_START.md           # This file!
```

---

## Common Commands

```bash
# Backend
npm run dev              # Start dev server
npm run build            # Compile TypeScript
npm start                # Run compiled server
npm run test             # Run integration tests
npm run lint             # Check code quality
npm run prisma:studio    # GUI database viewer
npm run prisma:migrate   # Run migrations
npm run prisma:seed      # Seed database

# Frontend
npm run dev              # Start dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Check code quality
```

---

## Environment Variables

### Backend (.env)

```env
# Database
DATABASE_URL=file:./dev.db

# JWT
JWT_SECRET=your-secret-key-change-this

# Server
API_PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

# Payment
RAZORPAY_KEY_ID=your-key
RAZORPAY_SECRET=your-secret

# Firebase (optional)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# Upload
UPLOAD_DIR=uploads/
MAX_FILE_SIZE=10mb
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:3000/api
VITE_APP_NAME=RentBuddy
```

---

## Troubleshooting

### Backend Won't Start

```bash
# Check if port 3000 is in use
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill process on port 3000
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Try different port
API_PORT=3001 npm run dev
```

### Database Issues

```bash
# Reset database (careful!)
cd packages/backend
npm run prisma:migrate reset

# View database
npm run prisma:studio
```

### Frontend Won't Load

```bash
# Clear cache
rm -rf node_modules package-lock.json
npm install
npm run dev

# Check port 5173 is available
lsof -i :5173
```

### Tests Fail

```bash
# Make sure backend is running
npm run dev  # In packages/backend

# Then run tests in new terminal
cd packages/backend
npm run test
```

---

## API Quick Reference

### Most Used Endpoints

```bash
# Auth
POST   /api/auth/register
POST   /api/auth/login

# User
GET    /api/users/profile
PUT    /api/users/profile

# Bookings
GET    /api/bookings
POST   /api/bookings
GET    /api/bookings/:id

# Notifications
GET    /api/notifications
POST   /api/notifications/:id/read
DELETE /api/notifications/:id

# Search
GET    /api/search?q=query
GET    /api/search/trending
GET    /api/search/suggest?q=query

# Wallet
GET    /api/wallet
POST   /api/wallet/topup
GET    /api/wallet/transactions
```

See full API docs in VERIFICATION_CHECKLIST.md

---

## Performance Tips

1. **Frontend**
   - Lazy loading enabled
   - Code splitting per route
   - Dark mode reduces eye strain

2. **Backend**
   - Indexed database queries
   - Connection pooling active
   - Rate limiting at 100 req/min

3. **Development**
   - Use Chrome DevTools
   - Monitor Network tab
   - Check Console for errors

---

## Next Steps

1. ✅ Setup complete
2. ✅ Backend running
3. ✅ Frontend running
4. 📖 Read TEST_RUNNER.md for testing
5. 🚀 Read PRODUCTION_READY.md for deployment
6. 📋 Check VERIFICATION_CHECKLIST.md for features

---

## Need Help?

1. **Check documentation**
   - TEST_RUNNER.md
   - VERIFICATION_CHECKLIST.md
   - PRODUCTION_READY.md

2. **Review code**
   - Backend: packages/backend/src/
   - Frontend: packages/web/src/

3. **Check logs**
   - Backend terminal
   - Browser console (F12)

4. **Run tests**
   - `npm run test` in packages/backend

---

## Deploy to Production

See PRODUCTION_READY.md for full deployment guide.

Quick version:
```bash
# 1. Build both
npm run build  # Root
cd packages/web && npm run build

# 2. Setup environment
# Set production DATABASE_URL, JWT_SECRET, etc.

# 3. Run migrations
cd packages/backend && npm run prisma:migrate

# 4. Start server
npm start  # Backend
# Deploy frontend dist/ to CDN

# 5. Verify
curl https://yourdomain.com/api/health
```

---

## Success! 🎉

RentBuddy is now running locally!

**What to try:**
- [ ] Register a user
- [ ] Complete KYC
- [ ] Create a booking
- [ ] Try dark mode
- [ ] Search for content
- [ ] Check notifications

**Ready for production?**

See PRODUCTION_READY.md ↑

---

**Questions?** Check the docs! Everything is documented.
