const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const educationSchema = new mongoose.Schema({
  institution: { type: String, required: true },
  degree: { type: String, required: true },
  department: String,
  passingYear: Number,
  result: String,
  description: String
});

const userSchema = new mongoose.Schema({
  // Basic Information
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true, minlength: 6 },
  profileImage: { type: String, default: '' },
  
  // User Type and Roles
  userType: {
    type: String,
    enum: ['teacher', 'guardian', 'student', 'house_owner', 'general_buyer'],
    required: true
  },
  isTeacher: { type: Boolean, default: false },
  isGuardian: { type: Boolean, default: false },
  
  // Location Information
  location: {
    division: String,
    district: String,
    upazila: String,
    address: String,
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },
  
  // Teacher Specific Fields
  teacherProfile: {
    education: [educationSchema],
    specializations: [String], // Subjects they can teach
    preferredClasses: [String], // Class levels (1-12, HSC, etc.)
    coverageAreas: [String], // Areas they can travel to teach
    salaryRange: {
      min: Number,
      max: Number
    },
    experience: Number, // Years of experience
    teachingType: {
      type: String,
      enum: ['home_tuition', 'online', 'both'],
      default: 'both'
    },
    availableTime: [String], // Time slots
    bio: String
  },
  
  // Guardian/Student Specific Fields
  guardianProfile: {
    studentInfo: {
      name: String,
      class: String,
      subjects: [String],
      studyLevel: String // SSC, HSC, etc.
    },
    requirements: {
      preferredGender: { type: String, enum: ['male', 'female', 'any'], default: 'any' },
      budgetRange: {
        min: Number,
        max: Number
      },
      preferredTime: [String],
      tutionType: { type: String, enum: ['home', 'online', 'both'], default: 'both' }
    }
  },
  
  // Account Information
  accountBalance: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  
  // Verification and Rating
  isVerified: { type: Boolean, default: false },
  verificationDocuments: [String], // URLs to uploaded documents
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalRatings: { type: Number, default: 0 },
  reviews: [{
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    createdAt: { type: Date, default: Date.now }
  }],
  
  // Activity Tracking
  lastActive: { type: Date, default: Date.now },
  joinedAt: { type: Date, default: Date.now },
  
  // Privacy Settings
  showPhone: { type: Boolean, default: false },
  showEmail: { type: Boolean, default: false },
  profileVisibility: { type: String, enum: ['public', 'private'], default: 'public' },
  
  // Account Status
  isActive: { type: Boolean, default: true },
  isBanned: { type: Boolean, default: false },
  banReason: String,
  
  // Preferences
  preferences: {
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true }
    },
    language: { type: String, default: 'bn' },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ userType: 1 });
userSchema.index({ 'location.coordinates': '2dsphere' });
userSchema.index({ 'teacherProfile.specializations': 1 });
userSchema.index({ 'teacherProfile.preferredClasses': 1 });
userSchema.index({ rating: -1 });
userSchema.index({ createdAt: -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return this.name;
});

// Virtual for average rating calculation
userSchema.virtual('averageRating').get(function() {
  if (this.totalRatings === 0) return 0;
  return this.rating;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update rating
userSchema.methods.updateRating = function(newRating) {
  const totalRating = (this.rating * this.totalRatings) + newRating;
  this.totalRatings += 1;
  this.rating = totalRating / this.totalRatings;
  return this.save();
};

// Method to check if user can view contact
userSchema.methods.canViewContact = function() {
  return this.accountBalance >= 5; // BDT 5 required to view contact
};

// Method to deduct contact view cost
userSchema.methods.deductContactViewCost = function() {
  if (this.accountBalance >= 5) {
    this.accountBalance -= 5;
    this.totalSpent += 5;
    return this.save();
  }
  throw new Error('Insufficient balance');
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);
