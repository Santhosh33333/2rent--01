import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import { search, getTrendingSearches, getSuggestions } from '../controllers/searchController'

const router = Router()

// Search requires authentication — prevents anonymous PII enumeration
router.use(authenticateToken)

router.get('/search', search)
router.get('/search/trending', getTrendingSearches)
router.get('/search/suggest', getSuggestions)

export default router
