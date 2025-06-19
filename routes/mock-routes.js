const express = require('express');
const router = express.Router();

// Mock data
const mockUsers = [
  {
    id: '1',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+880 1700-000001',
    userType: 'teacher',
    location: { city: 'Dhaka', area: 'Dhanmondi' },
    rating: 4.8,
    profileImage: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=faces'
  },
  {
    id: '2', 
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+880 1700-000002',
    userType: 'house_owner',
    location: { city: 'Dhaka', area: 'Gulshan' },
    rating: 4.6,
    profileImage: 'https://images.unsplash.com/photo-1494790108755-2616c1a1b93f?w=200&h=200&fit=crop&crop=faces'
  }
];

const mockPosts = [
  {
    id: '1',
    title: 'Beautiful Residential Plot in Gulshan',
    category: 'land',
    subcategory: 'residential',
    description: 'Prime location residential plot ready for construction with all utilities available.',
    price: 2500000,
    location: { city: 'Dhaka', area: 'Gulshan', address: 'Road 45, Gulshan-2' },
    contactInfo: { name: 'Ahmed Real Estate', phone: '+880 1700-000001' },
    images: ['https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&h=300&fit=crop'],
    landDetails: { area: '3 Katha', landType: 'residential' },
    createdAt: new Date().toISOString(),
    userId: '1',
    status: 'active'
  },
  {
    id: '2',
    title: 'Mathematics Tutor Available',
    category: 'tuition',
    subcategory: 'mathematics',
    description: 'Experienced mathematics tutor for Higher Secondary students. 8+ years experience.',
    price: 800,
    location: { city: 'Dhaka', area: 'Dhanmondi' },
    contactInfo: { name: 'Dr. Sarah Rahman', phone: '+880 1700-000002' },
    images: ['https://images.unsplash.com/photo-1494790108755-2616c1a1b93f?w=200&h=200&fit=crop&crop=faces'],
    tuitionDetails: {
      subjects: ['Mathematics', 'Physics'],
      level: 'Higher Secondary',
      experience: '8 years',
      qualification: 'PhD in Mathematics, DU',
      availability: 'Mon-Fri 4PM-8PM',
      teachingMode: ['Online', 'Home Visit']
    },
    createdAt: new Date().toISOString(),
    userId: '1',
    status: 'active'
  },
  {
    id: '3',
    title: '3 Bedroom Apartment for Rent',
    category: 'to_let',
    subcategory: 'apartment',
    description: 'Modern 3 bedroom apartment in prime location with all amenities.',
    price: 25000,
    location: { city: 'Dhaka', area: 'Uttara', address: 'Sector 10, Uttara' },
    contactInfo: { name: 'City Properties', phone: '+880 1700-000003' },
    images: ['https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=400&h=300&fit=crop'],
    propertyDetails: {
      bedrooms: 3,
      bathrooms: 2,
      size: '1200 sqft',
      furnished: 'semi-furnished',
      amenities: ['parking', 'lift', 'generator']
    },
    createdAt: new Date().toISOString(),
    userId: '2',
    status: 'active'
  }
];

// Auth routes
router.post('/auth/register', (req, res) => {
  const { name, email, phone, password, userType } = req.body;
  
  // Simulate registration
  const newUser = {
    id: Date.now().toString(),
    name,
    email,
    phone,
    userType,
    location: { city: '', area: '' },
    rating: 0,
    profileImage: ''
  };
  
  mockUsers.push(newUser);
  
  // Generate mock token
  const token = 'mock_jwt_token_' + Date.now();
  
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    data: {
      user: newUser,
      token
    }
  });
});

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  // Find mock user
  const user = mockUsers.find(u => u.email === email);
  
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }
  
  // Generate mock token
  const token = 'mock_jwt_token_' + Date.now();
  
  res.json({
    success: true,
    message: 'Login successful',
    data: {
      user,
      token
    }
  });
});

// Posts routes
router.get('/posts', (req, res) => {
  const { category, city, search, page = 1, limit = 10 } = req.query;
  
  let filteredPosts = [...mockPosts];
  
  // Apply filters
  if (category && category !== 'all') {
    filteredPosts = filteredPosts.filter(post => post.category === category);
  }
  
  if (city) {
    filteredPosts = filteredPosts.filter(post => 
      post.location.city.toLowerCase().includes(city.toLowerCase())
    );
  }
  
  if (search) {
    filteredPosts = filteredPosts.filter(post =>
      post.title.toLowerCase().includes(search.toLowerCase()) ||
      post.description.toLowerCase().includes(search.toLowerCase())
    );
  }
  
  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedPosts = filteredPosts.slice(startIndex, endIndex);
  
  res.json({
    success: true,
    data: {
      posts: paginatedPosts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredPosts.length,
        pages: Math.ceil(filteredPosts.length / parseInt(limit))
      }
    }
  });
});

router.get('/posts/:id', (req, res) => {
  const post = mockPosts.find(p => p.id === req.params.id);
  
  if (!post) {
    return res.status(404).json({
      success: false,
      message: 'Post not found'
    });
  }
  
  res.json({
    success: true,
    data: { post }
  });
});

router.post('/posts', (req, res) => {
  const newPost = {
    id: Date.now().toString(),
    ...req.body,
    createdAt: new Date().toISOString(),
    userId: 'mock_user_id',
    status: 'active'
  };
  
  mockPosts.push(newPost);
  
  res.status(201).json({
    success: true,
    message: 'Post created successfully',
    data: { post: newPost }
  });
});

// Users routes
router.get('/users/profile', (req, res) => {
  // Mock authenticated user
  const user = mockUsers[0];
  
  res.json({
    success: true,
    data: { user }
  });
});

router.get('/users/:id', (req, res) => {
  const user = mockUsers.find(u => u.id === req.params.id);
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }
  
  res.json({
    success: true,
    data: { user }
  });
});

// Search tutors
router.get('/tutors', (req, res) => {
  const { subject, location, level, page = 1, limit = 10 } = req.query;
  
  let tutorPosts = mockPosts.filter(post => post.category === 'tuition');
  
  // Apply filters
  if (subject) {
    tutorPosts = tutorPosts.filter(post =>
      post.tuitionDetails?.subjects?.some(s => 
        s.toLowerCase().includes(subject.toLowerCase())
      )
    );
  }
  
  if (location) {
    tutorPosts = tutorPosts.filter(post =>
      post.location.area.toLowerCase().includes(location.toLowerCase())
    );
  }
  
  if (level) {
    tutorPosts = tutorPosts.filter(post =>
      post.tuitionDetails?.level?.toLowerCase().includes(level.toLowerCase())
    );
  }
  
  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedTutors = tutorPosts.slice(startIndex, endIndex);
  
  res.json({
    success: true,
    data: {
      tutors: paginatedTutors,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: tutorPosts.length,
        pages: Math.ceil(tutorPosts.length / parseInt(limit))
      }
    }
  });
});

// Dashboard stats
router.get('/dashboard/stats', (req, res) => {
  res.json({
    success: true,
    data: {
      totalPosts: mockPosts.length,
      activePosts: mockPosts.filter(p => p.status === 'active').length,
      totalUsers: mockUsers.length,
      categories: {
        land: mockPosts.filter(p => p.category === 'land').length,
        tuition: mockPosts.filter(p => p.category === 'tuition').length,
        to_let: mockPosts.filter(p => p.category === 'to_let').length,
        buy_rent: mockPosts.filter(p => p.category === 'buy_rent').length
      }
    }
  });
});

module.exports = router;
