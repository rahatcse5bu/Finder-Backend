const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists and is active
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is not valid - user not found'
      });
    }

    if (!user.isActive || user.isBanned) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive or banned'
      });
    }

    // Add user info to request
    req.userId = user._id;
    req.user = user;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

// Optional auth - doesn't require authentication but adds user info if token is present
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (user && user.isActive && !user.isBanned) {
      req.userId = user._id;
      req.user = user;
    }
    
    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

// Admin only middleware
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

// Teacher only middleware
const teacherOnly = (req, res, next) => {
  if (!req.user || !req.user.isTeacher) {
    return res.status(403).json({
      success: false,
      message: 'Teacher access required'
    });
  }
  next();
};

// Guardian only middleware
const guardianOnly = (req, res, next) => {
  if (!req.user || !req.user.isGuardian) {
    return res.status(403).json({
      success: false,
      message: 'Guardian access required'
    });
  }
  next();
};

module.exports = {
  auth,
  optionalAuth,
  adminOnly,
  teacherOnly,
  guardianOnly
};
