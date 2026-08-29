import { Request, Response } from 'express'
import { prisma } from '../config/database'
import { AuthedRequest } from '../middleware/authTypes'

interface SearchResult {
  type: 'user' | 'event' | 'community' | 'booking'
  id: string
  title: string
  subtitle?: string
  description?: string
  imageUrl?: string
  link?: string
  metadata?: Record<string, any>
}

/**
 * Universal search across all entities with pagination
 * GET /search?q=keyword&filter=all|users|events|communities&page=1&limit=20
 */
export async function search(req: AuthedRequest, res: Response) {
  try {
    const { q, filter = 'all', page = '1', limit = '20' } = req.query
    const query = String(q || '').trim().toLowerCase()
    const pageNum = Math.max(1, Number(page) || 1)
    const pageSize = Math.min(Math.max(5, Number(limit) || 20), 100)
    const skip = (pageNum - 1) * pageSize

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: { results: [], total: 0, page: pageNum, limit: pageSize, pages: 0 },
        message: 'Query too short'
      })
    }

    const results: SearchResult[] = []
    let totalCount = 0

    // Search users (name-only matching; ACTIVE accounts only; NO PII in results)
    if (filter === 'all' || filter === 'users') {
      const userWhere = {
        status: 'ACTIVE',
        fullName: { contains: query },
      }

      const [userResults, userCount] = await Promise.all([
        prisma.user.findMany({
          where: userWhere,
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
          skip: filter === 'users' ? skip : 0,
          take: filter === 'users' ? pageSize : pageSize,
        }),
        prisma.user.count({ where: userWhere })
      ])

      results.push(...userResults.map(u => ({
        type: 'user' as const,
        id: u.id,
        title: u.fullName || 'Anonymous',
        subtitle: 'User',
        imageUrl: u.avatarUrl || undefined,
        link: `/profile/${u.id}`,
        metadata: {}
      })))

      if (filter === 'users') {
        totalCount = userCount
      }
    }

    // Search events
    if (filter === 'all' || filter === 'events') {
      const [eventResults, eventCount] = await Promise.all([
        prisma.event.findMany({
          where: {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
              { location: { contains: query } },
            ]
          },
          select: {
            id: true,
            title: true,
            description: true,
            location: true,
            startTime: true,
            attendeeCount: true,
          },
          skip: filter === 'events' ? skip : 0,
          take: filter === 'events' ? pageSize : pageSize,
        }),
        prisma.event.count({
          where: {
            OR: [
              { title: { contains: query } },
              { description: { contains: query } },
              { location: { contains: query } },
            ]
          }
        })
      ])

      results.push(...eventResults.map(e => ({
        type: 'event' as const,
        id: e.id,
        title: e.title,
        subtitle: new Date(e.startTime).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
        description: `${e.location || 'Location TBA'} • ${e.attendeeCount || 0} attending`,
        link: `/events/${e.id}`,
        metadata: {
          startTime: e.startTime,
          location: e.location,
          attendeeCount: e.attendeeCount
        }
      })))

      if (filter === 'events') {
        totalCount = eventCount
      }
    }

    // Search communities
    if (filter === 'all' || filter === 'communities') {
      const [communitiesResults, communitiesCount] = await Promise.all([
        prisma.community.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { description: { contains: query } },
            ]
          },
          select: {
            id: true,
            name: true,
            description: true,
            memberCount: true,
          },
          skip: filter === 'communities' ? skip : 0,
          take: filter === 'communities' ? pageSize : pageSize,
        }),
        prisma.community.count({
          where: {
            OR: [
              { name: { contains: query } },
              { description: { contains: query } },
            ]
          }
        })
      ])

      results.push(...communitiesResults.map(c => ({
        type: 'community' as const,
        id: c.id,
        title: c.name,
        subtitle: 'Community',
        description: `${c.memberCount || 0} members`,
        link: `/communities/${c.id}`,
        metadata: {
          members: c.memberCount
        }
      })))

      if (filter === 'communities') {
        totalCount = communitiesCount
      }
    }

    // For 'all' filter, combine and sort by relevance
    if (filter === 'all') {
      totalCount = results.length
      results.sort((a, b) => {
        const aExact = a.title.toLowerCase() === query ? 0 : 1
        const bExact = b.title.toLowerCase() === query ? 0 : 1
        return aExact - bExact
      })
    } else {
      // For specific filter, sort by relevance
      results.sort((a, b) => {
        const aExact = a.title.toLowerCase() === query ? 0 : 1
        const bExact = b.title.toLowerCase() === query ? 0 : 1
        return aExact - bExact
      })
    }

    const totalPages = Math.ceil(totalCount / pageSize)

    return res.json({
      success: true,
      data: {
        results: results.slice(0, pageSize),
        total: totalCount,
        page: pageNum,
        limit: pageSize,
        pages: totalPages,
        query,
        filter
      }
    })
  } catch (error) {
    console.error('Search error:', error)
    return res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Get trending searches (popular queries)
 * GET /search/trending
 */
export async function getTrendingSearches(req: Request, res: Response) {
  try {
    // Get top communities
    const topCommunities = await prisma.community.findMany({
      select: { id: true, name: true },
      take: 5,
    })

    // Get upcoming events
    const topEvents = await prisma.event.findMany({
      where: { startTime: { gte: new Date() } },
      select: { id: true, title: true, startTime: true },
      take: 5,
      orderBy: { startTime: 'asc' }
    })

    return res.json({
      success: true,
      data: {
        communities: topCommunities,
        events: topEvents,
      }
    })
  } catch (error) {
    console.error('Trending search error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to get trending',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Get search suggestions (autocomplete)
 * GET /search/suggest?q=keyword
 */
export async function getSuggestions(req: Request, res: Response) {
  try {
    const { q } = req.query
    const query = String(q || '').trim().toLowerCase()

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: { suggestions: [] }
      })
    }

    const suggestions: string[] = []

    // Get user name suggestions (ACTIVE accounts only)
    const users = await prisma.user.findMany({
      where: { fullName: { contains: query }, status: 'ACTIVE' },
      select: { fullName: true },
      take: 3,
    })
    suggestions.push(...users.map(u => u.fullName).filter(Boolean))

    // Get event title suggestions
    const events = await prisma.event.findMany({
      where: { title: { contains: query } },
      select: { title: true },
      take: 3,
    })
    suggestions.push(...events.map(e => e.title))

    // Get community name suggestions
    const communities = await prisma.community.findMany({
      where: { name: { contains: query } },
      select: { name: true },
      take: 3,
    })
    suggestions.push(...communities.map(c => c.name))

    // Remove duplicates and limit
    const unique = Array.from(new Set(suggestions)).slice(0, 10)

    return res.json({
      success: true,
      data: { suggestions: unique }
    })
  } catch (error) {
    console.error('Suggestions error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to get suggestions',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
