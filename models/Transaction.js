const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Transaction Basic Info
  transactionId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Transaction Type
  type: {
    type: String,
    enum: ['recharge', 'contact_view', 'featured_post', 'subscription', 'refund'],
    required: true
  },
  
  // Amount Information
  amount: { type: Number, required: true },
  currency: { type: String, default: 'BDT' },
  
  // Payment Method
  paymentMethod: {
    type: String,
    enum: ['bkash', 'nagad', 'rocket', 'bank_transfer', 'card', 'admin_credit'],
    required: true
  },
  
  // Payment Gateway Information
  paymentGateway: {
    provider: String, // bKash, Nagad, etc.
    transactionId: String, // Gateway transaction ID
    paymentId: String, // Gateway payment ID
    reference: String, // Gateway reference number
    status: String, // Gateway status
    fee: Number // Gateway fee
  },
  
  // Transaction Status
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  
  // Transaction Details
  description: String,
  metadata: {
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // For contact views
    contactOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Whose contact was viewed
    subscriptionType: String, // For subscription payments
    subscriptionDuration: Number, // In days
    adminNote: String // For admin-initiated transactions
  },
  
  // Timestamps
  initiatedAt: { type: Date, default: Date.now },
  completedAt: Date,
  failedAt: Date,
  
  // User Balance Before/After
  balanceBefore: Number,
  balanceAfter: Number,
  
  // Refund Information
  refundDetails: {
    reason: String,
    requestedAt: Date,
    processedAt: Date,
    refundTransactionId: String
  },
  
  // Additional Info
  ipAddress: String,
  userAgent: String,
  deviceInfo: String
}, {
  timestamps: true
});

// Indexes
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });
transactionSchema.index({ 'paymentGateway.transactionId': 1 });
transactionSchema.index({ status: 1, createdAt: -1 });

// Static method to generate transaction ID
transactionSchema.statics.generateTransactionId = function() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substr(2, 9).toUpperCase();
  return `FND${timestamp}${random}`;
};

// Method to mark transaction as completed
transactionSchema.methods.markCompleted = function(gatewayData = {}) {
  this.status = 'completed';
  this.completedAt = new Date();
  
  if (gatewayData.transactionId) {
    this.paymentGateway.transactionId = gatewayData.transactionId;
  }
  if (gatewayData.reference) {
    this.paymentGateway.reference = gatewayData.reference;
  }
  if (gatewayData.fee) {
    this.paymentGateway.fee = gatewayData.fee;
  }
  
  return this.save();
};

// Method to mark transaction as failed
transactionSchema.methods.markFailed = function(reason) {
  this.status = 'failed';
  this.failedAt = new Date();
  this.description = reason || this.description;
  return this.save();
};

// Virtual for formatted amount
transactionSchema.virtual('formattedAmount').get(function() {
  return `৳${this.amount.toLocaleString('en-BD')}`;
});

// Virtual for transaction duration
transactionSchema.virtual('duration').get(function() {
  if (this.completedAt) {
    return this.completedAt - this.initiatedAt;
  }
  return Date.now() - this.initiatedAt;
});

module.exports = mongoose.model('Transaction', transactionSchema);
