const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const router = express.Router();

// @route   GET /api/users/profile/:id
// @desc    Get user profile by ID
// @access  Public
router.get('/profile/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -accountBalance -totalSpent -totalEarned')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's active posts count
    const postsCount = await Post.countDocuments({
      postedBy: user._id,
      isActive: true,
      status: 'active'
    });

    // Get recent posts (last 5)
    const recentPosts = await Post.find({
      postedBy: user._id,
      isActive: true,
      status: 'active'
    })
    .select('title category price location createdAt')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          postsCount,
          recentPosts
        }
      }
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching user profile'
    });
  }
});

// @route   GET /api/users/teachers
// @desc    Get list of teachers with filters
// @access  Public
router.get('/teachers', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('subjects').optional().isString(),
  query('classes').optional().isString(),
  query('division').optional().isString(),
  query('district').optional().isString(),
  query('minRating').optional().isFloat({ min: 0, max: 5 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      page = 1,
      limit = 10,
      subjects,
      classes,
      division,
      district,
      minRating,
      search,
      sortBy = 'rating',
      sortOrder = 'desc'
    } = req.query;

    // Build filter
    const filter = {
      isTeacher: true,
      isActive: true,
      isBanned: false
    };

    if (subjects) {
      filter['teacherProfile.specializations'] = { $in: subjects.split(',') };
    }

    if (classes) {
      filter['teacherProfile.preferredClasses'] = { $in: classes.split(',') };
    }

    if (division) {
      filter['location.division'] = new RegExp(division, 'i');
    }

    if (district) {
      filter['location.district'] = new RegExp(district, 'i');
    }

    if (minRating) {
      filter.rating = { $gte: parseFloat(minRating) };
    }

    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { 'teacherProfile.specializations': { $in: [new RegExp(search, 'i')] } },
        { 'teacherProfile.bio': new RegExp(search, 'i') }
      ];
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [teachers, totalCount] = await Promise.all([
      User.find(filter)
        .select('-password -accountBalance -totalSpent -totalEarned -reviews')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        teachers,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPreviousPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Get teachers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching teachers'
    });
  }
});

// @route   POST /api/users/:id/review
// @desc    Add review for a user
// @access  Private
router.post('/:id/review', auth, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().isLength({ max: 500 }).withMessage('Comment must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { rating, comment } = req.body;
    const revieweeId = req.params.id;
    const reviewerId = req.userId;

    if (revieweeId === reviewerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot review yourself'
      });
    }

    const reviewee = await User.findById(revieweeId);
    if (!reviewee) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has already reviewed this person
    const existingReview = reviewee.reviews.find(
      review => review.reviewerId.toString() === reviewerId
    );

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this user'
      });
    }

    // Add review
    reviewee.reviews.push({
      reviewerId,
      rating,
      comment,
      createdAt: new Date()
    });

    // Update rating
    await reviewee.updateRating(rating);

    const updatedUser = await User.findById(revieweeId)
      .select('name rating totalRatings reviews')
      .populate('reviews.reviewerId', 'name profileImage');

    res.json({
      success: true,
      message: 'Review added successfully',
      data: {
        user: updatedUser
      }
    });

  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while adding review'
    });
  }
});

// @route   GET /api/users/favorites
// @desc    Get user's favorite posts
// @access  Private
router.get('/favorites', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [posts, totalCount] = await Promise.all([
      Post.find({
        favorites: req.userId,
        isActive: true,
        status: 'active'
      })
      .populate('postedBy', 'name profileImage rating totalRatings location userType isVerified')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
      Post.countDocuments({
        favorites: req.userId,
        isActive: true,
        status: 'active'
      })
    ]);

    // Remove contact info
    const sanitizedPosts = posts.map(post => {
      const sanitizedPost = { ...post };
      delete sanitizedPost.contactInfo;
      sanitizedPost.isFavorited = true;
      return sanitizedPost;
    });

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        posts: sanitizedPosts,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPreviousPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching favorites'
    });
  }
});

// @route   GET /api/users/dashboard
// @desc    Get user dashboard data
// @access  Private
router.get('/dashboard', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    
    // Get user's posts statistics
    const [
      totalPosts,
      activePosts,
      totalViews,
      totalContactViews,
      recentTransactions,
      favoritePostsCount
    ] = await Promise.all([
      Post.countDocuments({ postedBy: req.userId }),
      Post.countDocuments({ postedBy: req.userId, status: 'active', isActive: true }),
      Post.aggregate([
        { $match: { postedBy: user._id } },
        { $group: { _id: null, totalViews: { $sum: '$views' } } }
      ]),
      Post.aggregate([
        { $match: { postedBy: user._id } },
        { $group: { _id: null, totalContactViews: { $sum: '$contactViews' } } }
      ]),
      Transaction.find({ user: req.userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Post.countDocuments({ favorites: req.userId, isActive: true, status: 'active' })
    ]);

    const dashboardData = {
      user,
      statistics: {
        totalPosts,
        activePosts,
        totalViews: totalViews[0]?.totalViews || 0,
        totalContactViews: totalContactViews[0]?.totalContactViews || 0,
        favoritePostsCount,
        accountBalance: user.accountBalance,
        totalSpent: user.totalSpent,
        totalEarned: user.totalEarned
      },
      recentTransactions
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching dashboard data'
    });
  }
});

// @route   GET /api/users/search
// @desc    Search users
// @access  Public
router.get('/search', [
  query('q').notEmpty().withMessage('Search query is required'),
  query('type').optional().isIn(['teacher', 'guardian', 'house_owner', 'general_buyer']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 20 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { q, type, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {
      isActive: true,
      isBanned: false,
      $or: [
        { name: new RegExp(q, 'i') },
        { 'location.district': new RegExp(q, 'i') },
        { 'location.division': new RegExp(q, 'i') }
      ]
    };

    if (type) {
      filter.userType = type;
    }

    const [users, totalCount] = await Promise.all([
      User.find(filter)
        .select('name profileImage rating totalRatings location userType isVerified')
        .sort({ rating: -1, totalRatings: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      User.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPreviousPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while searching users'
    });
  }
});

module.exports = router;
