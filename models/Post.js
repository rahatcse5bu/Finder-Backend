const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  // Basic Information
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  images: [String], // URLs to uploaded images
  
  // Post Type
  category: {
    type: String,
    enum: ['tuition', 'land', 'house_rent', 'house_buy', 'tolet'],
    required: true
  },
  
  // Post Owner
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Location Information
  location: {
    division: { type: String, required: true },
    district: { type: String, required: true },
    upazila: String,
    area: String,
    address: String,
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },
  
  // Price Information
  price: {
    amount: Number,
    currency: { type: String, default: 'BDT' },
    type: { type: String, enum: ['fixed', 'negotiable', 'range'], default: 'negotiable' },
    range: {
      min: Number,
      max: Number
    }
  },
  
  // Tuition Specific Fields
  tuitionDetails: {
    // For Teacher Posts (Offering tuition)
    subjects: [String],
    classes: [String], // Class levels they can teach
    preferredGender: { type: String, enum: ['male', 'female', 'any'], default: 'any' },
    tutionType: { type: String, enum: ['home', 'online', 'both'], default: 'both' },
    availableTime: [String],
    salaryExpectation: {
      min: Number,
      max: Number
    },
    
    // For Guardian Posts (Looking for teacher)
    studentInfo: {
      class: String,
      subjects: [String],
      studyLevel: String,
      gender: String
    },
    requirements: {
      teacherGender: { type: String, enum: ['male', 'female', 'any'], default: 'any' },
      experience: String,
      qualification: String,
      budget: {
        min: Number,
        max: Number
      }
    }
  },
  
  // Property Specific Fields (Land, House, Tolet)
  propertyDetails: {
    // Common Property Fields
    size: String, // e.g., "1200 sq ft", "5 katha"
    bedrooms: Number,
    bathrooms: Number,
    floors: Number,
    facing: String, // North, South, East, West
    
    // Land Specific
    landType: String, // Residential, Commercial, Agricultural
    ownership: String, // Freehold, Leasehold
    
    // House/Tolet Specific
    houseType: { type: String, enum: ['apartment', 'house', 'duplex', 'studio'] },
    furnishing: { type: String, enum: ['furnished', 'semi_furnished', 'unfurnished'] },
    amenities: [String], // Parking, Generator, Lift, etc.
    utilities: {
      electricity: Boolean,
      water: Boolean,
      gas: Boolean,
      internet: Boolean
    },
    
    // Rent Specific
    advancePayment: Number,
    rentType: { type: String, enum: ['monthly', 'yearly'] },
    availableFrom: Date,
    
    // Additional Features
    nearbyFacilities: [String], // School, Hospital, Market, etc.
    roadWidth: String,
    parking: String
  },
  
  // Contact Information (Hidden until payment)
  contactInfo: {
    name: String,
    phone: String,
    email: String,
    alternatePhone: String,
    preferredContactTime: String
  },
  
  // Post Status and Visibility
  status: {
    type: String,
    enum: ['active', 'sold', 'rented', 'expired', 'draft'],
    default: 'active'
  },
  isActive: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false },
  featuredUntil: Date,
  
  // Engagement Metrics
  views: { type: Number, default: 0 },
  contactViews: { type: Number, default: 0 },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  
  // Post Expiry
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    }
  },
  
  // Moderation
  isApproved: { type: Boolean, default: true },
  moderationNotes: String,
  reportCount: { type: Number, default: 0 },
  reports: [{
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    description: String,
    reportedAt: { type: Date, default: Date.now }
  }],
  
  // SEO and Search
  tags: [String],
  searchKeywords: [String]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
postSchema.index({ category: 1, status: 1 });
postSchema.index({ 'location.coordinates': '2dsphere' });
postSchema.index({ 'location.district': 1, 'location.division': 1 });
postSchema.index({ postedBy: 1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ expiresAt: 1 });
postSchema.index({ 'tuitionDetails.subjects': 1 });
postSchema.index({ 'tuitionDetails.classes': 1 });
postSchema.index({ 'price.amount': 1 });
postSchema.index({ tags: 1 });
postSchema.index({ isActive: 1, isApproved: 1 });

// Virtual for days remaining
postSchema.virtual('daysRemaining').get(function() {
  const now = new Date();
  const expiry = new Date(this.expiresAt);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
});

// Virtual for formatted price
postSchema.virtual('formattedPrice').get(function() {
  if (!this.price.amount) return 'Price on request';
  
  const amount = this.price.amount.toLocaleString('en-BD');
  return `৳${amount}`;
});

// Method to increment view count
postSchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

// Method to increment contact views
postSchema.methods.incrementContactViews = function() {
  this.contactViews += 1;
  return this.save();
};

// Method to check if post is expired
postSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

// Method to extend expiry
postSchema.methods.extendExpiry = function(days = 30) {
  this.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return this.save();
};

// Pre-save middleware to generate search keywords
postSchema.pre('save', function(next) {
  if (this.isModified('title') || this.isModified('description')) {
    const keywords = [];
    
    // Add title words
    keywords.push(...this.title.toLowerCase().split(' '));
    
    // Add location keywords
    if (this.location.district) keywords.push(this.location.district.toLowerCase());
    if (this.location.division) keywords.push(this.location.division.toLowerCase());
    if (this.location.area) keywords.push(this.location.area.toLowerCase());
    
    // Add category specific keywords
    if (this.category === 'tuition' && this.tuitionDetails) {
      if (this.tuitionDetails.subjects) {
        keywords.push(...this.tuitionDetails.subjects.map(s => s.toLowerCase()));
      }
      if (this.tuitionDetails.classes) {
        keywords.push(...this.tuitionDetails.classes.map(c => c.toLowerCase()));
      }
    }
    
    // Remove duplicates and empty strings
    this.searchKeywords = [...new Set(keywords.filter(k => k.trim()))];
  }
  next();
});

module.exports = mongoose.model('Post', postSchema);
