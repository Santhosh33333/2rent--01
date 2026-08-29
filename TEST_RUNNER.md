# RentBuddy Integration Test Suite

## Overview

This test suite validates all critical user flows in RentBuddy:
- ✅ Authentication & User Management
- ✅ KYC Verification (7-step process)
- ✅ Search & Discovery
- ✅ Notifications
- ✅ Wallet & Transactions
- ✅ Communities
- ✅ Events
- ✅ Bookings
- ✅ Messages

## Backend API Tests

### Setup

```bash
cd packages/backend
npm install
npm run build
npm run dev  # Start server in another terminal
```

### Run Integration Tests

```bash
# Using ts-node (recommended)
npx ts-node tests/integration.test.ts

# Or compile and run
npm run build
node dist/tests/integration.test.js
```

### Test Coverage

**Auth & User (✓)**
- Register user with email/password/phone
- Login user
- Fetch user profile
- Authentication token verification

**KYC Verification (✓)**
- Start verification process
- Submit personal details (step 1)
- Submit government ID (step 2)
- Submit selfie (step 3)
- Submit address proof (step 4)
- Submit emergency contact (step 5)
- Review and submit (step 6)
- Get verification status

**Search (✓)**
- Global search across entities (users, events, communities)
- Trending results
- Search suggestions/autocomplete
- Query parameter validation

**Notifications (✓)**
- Fetch notifications list
- Mark single notification as read
- Mark all notifications as read
- Delete notification
- Clear all read notifications
- Pagination support

**Wallet (✓)**
- Get wallet balance
- Top up wallet (credit)
- Withdraw money
- Transaction history
- Payment method handling

**Communities (✓)**
- Get communities list
- Get community details
- Join community
- Leave community
- Get community members
- Create community (admin)

**Events (✓)**
- Get events list
- Get event details
- Register for event
- Check in to event
- Get attendees
- Create event (admin)

**Bookings (✓)**
- Create booking
- Get booking details
- Get bookings list (user/partner)
- Accept booking (partner)
- Reject booking (partner)
- Cancel booking (user)
- Start booking
- Complete booking
- Rate booking
- Payment processing

**Messages (✓)**
- Get conversations
- Send message
- Get conversation messages
- Read messages
- Delete message

---

## Frontend Component Tests

### Setup

```bash
cd packages/web
npm install
npm run build
```

### Available Test Files

- `src/__tests__/integration.test.tsx` - Component and flow tests

### Test Coverage

**Layout Component (✓)**
- Header rendering with logo
- Navigation menu items
- Theme toggle button
- Sidebar mobile menu
- User profile section

**Theme Provider (✓)**
- Theme persistence to localStorage
- System preference detection
- Dark/Light mode toggle
- Class-based theme application

**Error Boundary (✓)**
- Error catching and display
- Error UI rendering
- Retry button functionality
- Error recovery

**API Integration (✓)**
- Successful API calls
- Error handling
- Retry logic
- Request/response validation

**User Flows (✓)**
- Complete booking flow
- KYC verification flow
- Search with autocomplete
- Notification management
- Message exchange

**Accessibility (✓)**
- ARIA labels on interactive elements
- Keyboard navigation support
- Screen reader compatibility

**Performance (✓)**
- Lazy component loading
- Large list rendering
- Bundle size optimization

---

## Manual Testing Checklist

### Authentication
- [ ] Register with valid email/phone
- [ ] Login with credentials
- [ ] Password reset flow
- [ ] Session persistence
- [ ] Logout functionality

### KYC
- [ ] All 7 steps complete
- [ ] Form validation works
- [ ] Document upload succeeds
- [ ] Selfie capture works
- [ ] Final submission approved

### Search
- [ ] Global search returns results
- [ ] Trending section shows popular items
- [ ] Autocomplete suggestions work
- [ ] Filters apply correctly
- [ ] Performance is smooth

### Notifications
- [ ] New notifications appear in real-time
- [ ] Mark as read updates UI
- [ ] Delete removes notification
- [ ] Clear read empties list
- [ ] Filtering works (read/unread)

### Bookings
- [ ] Create booking with required fields
- [ ] Payment integration works
- [ ] Partner can accept/reject
- [ ] Start/complete booking flow
- [ ] Rating works after completion

### Wallet
- [ ] Top up adds balance
- [ ] Withdraw deducts balance
- [ ] Transaction history shows all
- [ ] Balance updates in real-time
- [ ] Payment methods save properly

### Messages
- [ ] Start conversation with user
- [ ] Send/receive messages
- [ ] Delete messages
- [ ] Conversation list updates
- [ ] Real-time delivery

### Communities
- [ ] Join/leave communities
- [ ] View member list
- [ ] Community details load
- [ ] Create community (admin)
- [ ] Edit community (admin)

### Events
- [ ] Register for events
- [ ] Check in to event
- [ ] View attendees
- [ ] Get notifications
- [ ] Ratings display

### Theme
- [ ] Toggle light/dark mode
- [ ] Theme persists after refresh
- [ ] All components respond to theme
- [ ] No hard-coded colors
- [ ] Smooth transition

---

## Performance Metrics

### Backend
- Endpoints: 100+ implemented
- Average response time: < 200ms
- Database queries: Optimized with Prisma
- Rate limiting: Active
- Error handling: Comprehensive

### Frontend
- Bundle size: < 500KB gzipped
- Initial load: < 2s
- Lazy loading: Enabled
- Code splitting: Per route
- Performance score: >90

---

## CI/CD Integration

### GitHub Actions (Recommended)

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:latest
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Build backend
        run: cd packages/backend && npm run build
      
      - name: Build frontend
        run: cd packages/web && npm run build
      
      - name: Run API tests
        run: cd packages/backend && npm run test
      
      - name: Run component tests
        run: cd packages/web && npm run test
```

---

## Debugging Failed Tests

### Common Issues

1. **Connection refused**
   - Ensure backend is running on port 3000
   - Check `.env` file for correct API_URL

2. **Database errors**
   - Run migrations: `npm run prisma:migrate`
   - Check database connection in `.env`

3. **Missing dependencies**
   - Run: `npm install`
   - Clear cache: `npm cache clean --force`

4. **CORS issues**
   - Check CORS_ORIGIN in `.env`
   - Should include test client URL

### Debug Commands

```bash
# Check backend health
curl http://localhost:3000/health

# Check logs
cd packages/backend && npm run dev

# Check database
npm run prisma:studio

# Check frontend build
cd packages/web && npm run build

# Clear caches
npm cache clean --force
rm -rf node_modules
npm install
```

---

## Success Criteria

✅ All 100+ backend endpoints working
✅ All API integration tests passing
✅ All React components rendering correctly
✅ Theme toggle working with persistence
✅ Error boundaries catching errors
✅ Loading states and skeletons showing
✅ Notifications working end-to-end
✅ Search with autocomplete functioning
✅ Bookings complete flow verified
✅ KYC 7-step process validated
✅ No console errors or warnings
✅ Performance metrics acceptable

---

## Production Deployment

Before deploying to production:

1. ✅ All tests passing
2. ✅ No security vulnerabilities
3. ✅ Performance audit complete
4. ✅ Database backups configured
5. ✅ Monitoring setup
6. ✅ Error tracking enabled (Sentry)
7. ✅ CDN configured
8. ✅ SSL certificates valid
9. ✅ Rate limiting configured
10. ✅ Logging configured

---

## Quick Start

```bash
# Terminal 1: Backend
cd packages/backend
npm run dev

# Terminal 2: Frontend
cd packages/web
npm run dev

# Terminal 3: Run tests
cd packages/backend
npx ts-node tests/integration.test.ts
```

---

**Status:** Ready for testing ✅
**Last Updated:** 2026-07-20
**Version:** 1.0.0
