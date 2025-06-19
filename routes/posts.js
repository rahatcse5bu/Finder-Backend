const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Post = require('../models/Post');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth, optionalAuth } = require('../middleware/auth');
const router = express.Router();

// @route   GET /api/posts
// @desc    Get posts with filters and pagination
// @access  Public (with optional auth for personalized feed)
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('category').optional().isIn(['tuition', 'land', 'house_rent', 'house_buy', 'tolet']),
  query('division').optional().isString(),
  query('district').optional().isString(),
  query('minPrice').optional().isNumeric(),
  query('maxPrice').optional().isNumeric()
], optionalAuth, async (req, res) => {
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
      category,
      division,
      district,
      minPrice,
      maxPrice,
      search,
      userType,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {
      isActive: true,
      isApproved: true,
      status: 'active',
      expiresAt: { $gt: new Date() }
    };

    if (category) filter.category = category;
    if (division) filter['location.division'] = new RegExp(division, 'i');
    if (district) filter['location.district'] = new RegExp(district, 'i');

    // Price filter
    if (minPrice || maxPrice) {
      filter['price.amount'] = {};
      if (minPrice) filter['price.amount'].$gte = parseFloat(minPrice);
      if (maxPrice) filter['price.amount'].$lte = parseFloat(maxPrice);
    }

    // Search filter
    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { searchKeywords: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [posts, totalCount] = await Promise.all([
      Post.find(filter)
        .populate('postedBy', 'name profileImage rating totalRatings location userType isVerified')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Post.countDocuments(filter)
    ]);

    // Remove contact info for non-authenticated users or insufficient balance
    const sanitizedPosts = posts.map(post => {
      const sanitizedPost = { ...post };
      
      // Always hide contact info initially
      delete sanitizedPost.contactInfo;
      
      // Add calculated fields
      sanitizedPost.canViewContact = req.user ? req.user.canViewContact() : false;
      sanitizedPost.isFavorited = req.user ? post.favorites.includes(req.user._id) : false;
      
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
    console.error('Get posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching posts'
    });
  }
});

// @route   GET /api/posts/:id
// @desc    Get single post by ID
// @access  Public (with optional auth)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('postedBy', 'name profileImage rating totalRatings location userType isVerified')
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Increment view count
    await Post.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    // Remove contact info unless user has paid
    const sanitizedPost = { ...post };
    delete sanitizedPost.contactInfo;
    
    sanitizedPost.canViewContact = req.user ? req.user.canViewContact() : false;
    sanitizedPost.isFavorited = req.user ? post.favorites.includes(req.user._id) : false;

    res.json({
      success: true,
      data: { post: sanitizedPost }
    });

  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching post'
    });
  }
});

// @route   POST /api/posts
// @desc    Create a new post
// @access  Private
router.post('/', auth, [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('category').isIn(['tuition', 'land', 'house_rent', 'house_buy', 'tolet']).withMessage('Invalid category'),
  body('location.division').notEmpty().withMessage('Division is required'),
  body('location.district').notEmpty().withMessage('District is required'),
  body('contactInfo.name').notEmpty().withMessage('Contact name is required'),
  body('contactInfo.phone').notEmpty().withMessage('Contact phone is required')
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

    const postData = {
      ...req.body,
      postedBy: req.userId
    };

    const post = new Post(postData);
    await post.save();

    const populatedPost = await Post.findById(post._id)
      .populate('postedBy', 'name profileImage rating totalRatings location userType isVerified');

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: { post: populatedPost }
    });

  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating post'
    });
  }
});

// @route   PUT /api/posts/:id
// @desc    Update a post
// @access  Private (post owner only)
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post
    if (post.postedBy.toString() !== req.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this post'
      });
    }

    const updates = req.body;
    delete updates.postedBy; // Prevent changing post owner

    const updatedPost = await Post.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('postedBy', 'name profileImage rating totalRatings location userType isVerified');

    res.json({
      success: true,
      message: 'Post updated successfully',
      data: { post: updatedPost }
    });

  } catch (error) {
    console.error('Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while updating post'
    });
  }
});

// @route   DELETE /api/posts/:id
// @desc    Delete a post
// @access  Private (post owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user owns the post
    if (post.postedBy.toString() !== req.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this post'
      });
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting post'
    });
  }
});

// @route   POST /api/posts/:id/contact
// @desc    View contact information (requires payment)
// @access  Private
router.post('/:id/contact', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const user = await User.findById(req.userId);
    
    // Check if user has sufficient balance
    if (!user.canViewContact()) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance. Please recharge your account.'
      });
    }

    // Deduct cost and update balance
    await user.deductContactViewCost();

    // Create transaction record
    const transaction = new Transaction({
      transactionId: Transaction.generateTransactionId(),
      user: req.userId,
      type: 'contact_view',
      amount: 5,
      paymentMethod: 'account_balance',
      status: 'completed',
      description: `Contact view for post: ${post.title}`,
      metadata: {
        postId: post._id,
        contactOwnerId: post.postedBy
      },
      balanceBefore: user.accountBalance + 5,
      balanceAfter: user.accountBalance,
      completedAt: new Date()
    });

    await transaction.save();

    // Increment contact view count
    await post.incrementContactViews();

    res.json({
      success: true,
      message: 'Contact information retrieved successfully',
      data: {
        contactInfo: post.contactInfo,
        transaction: {
          id: transaction.transactionId,
          amount: transaction.amount,
          remainingBalance: user.accountBalance
        }
      }
    });

  } catch (error) {
    console.error('View contact error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error occurred while viewing contact'
    });
  }
});

// @route   POST /api/posts/:id/favorite
// @desc    Add/Remove post from favorites
// @access  Private
router.post('/:id/favorite', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const userId = req.userId;
    const isFavorited = post.favorites.includes(userId);

    if (isFavorited) {
      // Remove from favorites
      post.favorites = post.favorites.filter(id => id.toString() !== userId.toString());
    } else {
      // Add to favorites
      post.favorites.push(userId);
    }

    await post.save();

    res.json({
      success: true,
      message: isFavorited ? 'Removed from favorites' : 'Added to favorites',
      data: {
        isFavorited: !isFavorited,
        favoritesCount: post.favorites.length
      }
    });

  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while updating favorites'
    });
  }
});

// @route   GET /api/posts/user/my-posts
// @desc    Get current user's posts
// @access  Private
router.get('/user/my-posts', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const filter = { postedBy: req.userId };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [posts, totalCount] = await Promise.all([
      Post.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Post.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        posts,
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
    console.error('Get my posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching posts'
    });
  }
});

module.exports = router;
