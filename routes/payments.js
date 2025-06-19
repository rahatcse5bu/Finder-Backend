const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

// bKash API configuration
const bkashConfig = {
  baseURL: process.env.BKASH_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-APP-Key': process.env.BKASH_APP_KEY
  }
};

// Helper function to get bKash token
const getBkashToken = async () => {
  try {
    const response = await axios.post(`${bkashConfig.baseURL}/tokenized/checkout/token/grant`, {
      app_key: process.env.BKASH_APP_KEY,
      app_secret: process.env.BKASH_APP_SECRET
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'username': process.env.BKASH_USERNAME,
        'password': process.env.BKASH_PASSWORD
      }
    });

    return response.data;
  } catch (error) {
    console.error('bKash token error:', error.response?.data || error.message);
    throw new Error('Failed to get bKash token');
  }
};

// @route   POST /api/payments/recharge
// @desc    Initiate account recharge
// @access  Private
router.post('/recharge', auth, [
  body('amount').isFloat({ min: 10, max: 10000 }).withMessage('Amount must be between 10 and 10000 BDT'),
  body('paymentMethod').isIn(['bkash', 'nagad', 'rocket']).withMessage('Invalid payment method')
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

    const { amount, paymentMethod } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create transaction record
    const transaction = new Transaction({
      transactionId: Transaction.generateTransactionId(),
      user: req.userId,
      type: 'recharge',
      amount: parseFloat(amount),
      paymentMethod,
      status: 'pending',
      description: `Account recharge via ${paymentMethod}`,
      balanceBefore: user.accountBalance,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    await transaction.save();

    let paymentResponse = {};

    if (paymentMethod === 'bkash') {
      try {
        // Get bKash token
        const tokenData = await getBkashToken();
        
        // Create payment
        const createPaymentResponse = await axios.post(`${bkashConfig.baseURL}/tokenized/checkout/create`, {
          mode: '0011',
          payerReference: user.phone,
          callbackURL: `${process.env.CLIENT_URL}/payment/callback`,
          amount: amount.toString(),
          currency: 'BDT',
          intent: 'sale',
          merchantInvoiceNumber: transaction.transactionId
        }, {
          headers: {
            ...bkashConfig.headers,
            'authorization': tokenData.id_token,
            'x-app-key': process.env.BKASH_APP_KEY
          }
        });

        paymentResponse = {
          paymentId: createPaymentResponse.data.paymentID,
          paymentUrl: createPaymentResponse.data.bkashURL,
          transactionId: transaction.transactionId
        };

        // Update transaction with payment details
        transaction.paymentGateway.paymentId = createPaymentResponse.data.paymentID;
        transaction.paymentGateway.provider = 'bkash';
        await transaction.save();

      } catch (bkashError) {
        console.error('bKash payment creation error:', bkashError.response?.data || bkashError.message);
        
        // Mark transaction as failed
        await transaction.markFailed('bKash payment creation failed');
        
        return res.status(500).json({
          success: false,
          message: 'Failed to create bKash payment'
        });
      }
    }

    res.json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        transaction: {
          id: transaction.transactionId,
          amount: transaction.amount,
          status: transaction.status
        },
        payment: paymentResponse
      }
    });

  } catch (error) {
    console.error('Recharge initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while initiating payment'
    });
  }
});

// @route   POST /api/payments/callback
// @desc    Handle payment callback from bKash
// @access  Public
router.post('/callback', async (req, res) => {
  try {
    const { paymentID, status, transactionId } = req.body;

    const transaction = await Transaction.findOne({ transactionId });
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    if (status === 'success') {
      try {
        // Get bKash token
        const tokenData = await getBkashToken();
        
        // Execute payment
        const executeResponse = await axios.post(`${bkashConfig.baseURL}/tokenized/checkout/execute`, {
          paymentID
        }, {
          headers: {
            ...bkashConfig.headers,
            'authorization': tokenData.id_token,
            'x-app-key': process.env.BKASH_APP_KEY
          }
        });

        if (executeResponse.data.statusCode === '0000') {
          // Payment successful
          const user = await User.findById(transaction.user);
          
          // Update user balance
          user.accountBalance += transaction.amount;
          await user.save();
          
          // Update transaction
          await transaction.markCompleted({
            transactionId: executeResponse.data.trxID,
            reference: executeResponse.data.merchantInvoiceNumber
          });

          transaction.balanceAfter = user.accountBalance;
          await transaction.save();

          res.json({
            success: true,
            message: 'Payment completed successfully',
            data: {
              transactionId: transaction.transactionId,
              amount: transaction.amount,
              newBalance: user.accountBalance
            }
          });
        } else {
          // Payment failed
          await transaction.markFailed(`bKash execution failed: ${executeResponse.data.statusMessage}`);
          
          res.status(400).json({
            success: false,
            message: 'Payment execution failed'
          });
        }
      } catch (executeError) {
        console.error('bKash execute error:', executeError.response?.data || executeError.message);
        await transaction.markFailed('Payment execution error');
        
        res.status(500).json({
          success: false,
          message: 'Payment execution failed'
        });
      }
    } else {
      // Payment cancelled or failed
      await transaction.markFailed('Payment cancelled by user');
      
      res.json({
        success: false,
        message: 'Payment was cancelled'
      });
    }

  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while processing payment callback'
    });
  }
});

// @route   GET /api/payments/transactions
// @desc    Get user's transaction history
// @access  Private
router.get('/transactions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    
    const filter = { user: req.userId };
    if (type) filter.type = type;
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('metadata.postId', 'title category')
        .populate('metadata.contactOwnerId', 'name')
        .lean(),
      Transaction.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        transactions,
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
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching transactions'
    });
  }
});

// @route   GET /api/payments/transaction/:id
// @desc    Get transaction details
// @access  Private
router.get('/transaction/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      transactionId: req.params.id,
      user: req.userId
    })
    .populate('metadata.postId', 'title category')
    .populate('metadata.contactOwnerId', 'name')
    .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      data: { transaction }
    });

  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching transaction'
    });
  }
});

// @route   POST /api/payments/verify
// @desc    Verify payment status
// @access  Private
router.post('/verify', auth, [
  body('transactionId').notEmpty().withMessage('Transaction ID is required')
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

    const { transactionId } = req.body;
    
    const transaction = await Transaction.findOne({
      transactionId,
      user: req.userId
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // If transaction is already completed, return success
    if (transaction.status === 'completed') {
      return res.json({
        success: true,
        message: 'Transaction already completed',
        data: { transaction }
      });
    }

    // If transaction is pending and uses bKash, verify with bKash
    if (transaction.paymentMethod === 'bkash' && transaction.status === 'pending') {
      try {
        const tokenData = await getBkashToken();
        
        const queryResponse = await axios.post(`${bkashConfig.baseURL}/tokenized/checkout/payment/status`, {
          paymentID: transaction.paymentGateway.paymentId
        }, {
          headers: {
            ...bkashConfig.headers,
            'authorization': tokenData.id_token,
            'x-app-key': process.env.BKASH_APP_KEY
          }
        });

        if (queryResponse.data.statusCode === '0000') {
          // Update transaction status
          const user = await User.findById(transaction.user);
          user.accountBalance += transaction.amount;
          await user.save();
          
          await transaction.markCompleted({
            transactionId: queryResponse.data.trxID
          });

          transaction.balanceAfter = user.accountBalance;
          await transaction.save();
        }
      } catch (verifyError) {
        console.error('Payment verification error:', verifyError.response?.data || verifyError.message);
      }
    }

    res.json({
      success: true,
      data: { transaction }
    });

  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while verifying payment'
    });
  }
});

module.exports = router;
