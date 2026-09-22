import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { searchRateLimiter } from '../middleware/rateLimiter'
import { search, getTrendingSearches, getSuggestions } from '../controllers/searchController'

const router = Router()

// Search requires authentication — prevents anonymous PII enumeration
router.use(authenticateToken, searchRateLimiter)

router.get('/search', search)
router.get('/search/trending', getTrendingSearches)
router.get('/search/suggest', getSuggestions)

export default router
